const crypto = require('crypto');
const { buildIdentifierKey } = require('./normalizedSchema');

const SESSION_TTL_MS = 1000 * 60 * 90;
const sessions = new Map();

function buildEmptySession(sessionId = crypto.randomUUID()) {
  const now = Date.now();

  return {
    sessionId,
    phase: 'upload',
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    acceptedDocuments: [],
    rejectedDocuments: [],
    detectedIdentifiers: [],
    ownedIdentifierIds: [],
    ownedIdentifierNotes: {},
    spendingSendRecordIds: [],
  };
}

function touchSession(session) {
  const now = Date.now();
  session.updatedAt = new Date(now).toISOString();
  session.expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
  return session;
}

function createSession() {
  const session = buildEmptySession();
  sessions.set(session.sessionId, session);
  return session;
}

function getSession(sessionId) {
  if (!sessionId) {
    return null;
  }

  const session = sessions.get(sessionId) || null;

  if (!session) {
    return null;
  }

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }

  return touchSession(session);
}

function destroySession(sessionId) {
  if (sessionId) {
    sessions.delete(sessionId);
  }
}

function resetSession(session) {
  const reset = buildEmptySession(session.sessionId);
  sessions.set(reset.sessionId, reset);
  return reset;
}

function mergeDetectedIdentifiers(session, incomingIdentifiers) {
  const identifierMap = new Map(
    session.detectedIdentifiers.map((identifier) => [buildIdentifierKey(identifier.identifierType, identifier.value), identifier])
  );

  incomingIdentifiers.forEach((incomingIdentifier) => {
    const key = buildIdentifierKey(incomingIdentifier.identifierType, incomingIdentifier.value);
    const existing = identifierMap.get(key);

    if (!existing) {
      const created = {
        ...incomingIdentifier,
        sourceDocumentIds: [...(incomingIdentifier.sourceDocumentIds || [])],
        sourceDocumentNames: [...(incomingIdentifier.sourceDocumentNames || [])],
        sourceRowNumbers: [...(incomingIdentifier.sourceRowNumbers || [])],
      };

      identifierMap.set(key, created);
      return;
    }

    existing.sourceDocumentIds = Array.from(
      new Set([...(existing.sourceDocumentIds || []), ...(incomingIdentifier.sourceDocumentIds || [])])
    );
    existing.sourceDocumentNames = Array.from(
      new Set([...(existing.sourceDocumentNames || []), ...(incomingIdentifier.sourceDocumentNames || [])])
    );
    existing.sourceRowNumbers = Array.from(
      new Set([...(existing.sourceRowNumbers || []), ...(incomingIdentifier.sourceRowNumbers || [])])
    ).sort((left, right) => left - right);
  });

  session.detectedIdentifiers = Array.from(identifierMap.values()).sort((left, right) =>
    left.value.localeCompare(right.value)
  );
}

function addAcceptedDocument(session, file, parsedDocument) {
  session.acceptedDocuments.push({
    documentId: parsedDocument.documentId,
    originalName: file.originalname,
    mimeType: file.mimetype || null,
    sizeBytes: file.size,
    receivedAt: new Date().toISOString(),
    sourceId: parsedDocument.sourceId,
    sourceDisplayName: parsedDocument.sourceDisplayName,
    parserId: parsedDocument.parserId,
    parseSummary: parsedDocument.parseSummary || null,
    normalizedRecords: parsedDocument.normalizedRecords || [],
    detectedIdentifiers: parsedDocument.detectedIdentifiers || [],
    warnings: parsedDocument.warnings || [],
    buffer: file.buffer,
  });

  mergeDetectedIdentifiers(session, parsedDocument.detectedIdentifiers || []);
  touchSession(session);

  return session;
}

function addRejectedDocument(session, file, parsedDocument) {
  session.rejectedDocuments.push({
    documentId: parsedDocument.documentId,
    originalName: file.originalname,
    mimeType: file.mimetype || null,
    sizeBytes: file.size,
    receivedAt: new Date().toISOString(),
    sourceId: parsedDocument.sourceId || null,
    sourceDisplayName: parsedDocument.sourceDisplayName || null,
    rejectionReason: parsedDocument.rejectionReason || 'Unable to parse this document.',
  });

  touchSession(session);

  return session;
}

function startWalletReview(session) {
  session.phase = 'wallet-review';
  return touchSession(session);
}

function startSendReview(session) {
  session.phase = 'send-review';
  return touchSession(session);
}

function startCalculationReady(session) {
  session.phase = 'calculation-ready';
  return touchSession(session);
}

function returnToUploadPhase(session) {
  session.phase = 'upload';
  return touchSession(session);
}

function saveOwnedIdentifiers(session, ownedIdentifierIds, ownedIdentifierNotes) {
  session.ownedIdentifierIds = [...new Set((ownedIdentifierIds || []).filter(Boolean))];
  session.ownedIdentifierNotes = { ...(ownedIdentifierNotes || {}) };
  return touchSession(session);
}

function saveSpendingSendRecordIds(session, spendingSendRecordIds) {
  session.spendingSendRecordIds = [...new Set((spendingSendRecordIds || []).filter(Boolean))];
  return touchSession(session);
}

function getSessionSnapshot(session) {
  return {
    sessionId: session.sessionId,
    phase: session.phase,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
    acceptedDocuments: session.acceptedDocuments.map((document) => ({
      documentId: document.documentId,
      originalName: document.originalName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      receivedAt: document.receivedAt,
      sourceId: document.sourceId,
      sourceDisplayName: document.sourceDisplayName,
      parserId: document.parserId,
      parseSummary: document.parseSummary,
      warnings: document.warnings,
      normalizedRecordCount: Array.isArray(document.normalizedRecords) ? document.normalizedRecords.length : 0,
      detectedIdentifierCount: Array.isArray(document.detectedIdentifiers) ? document.detectedIdentifiers.length : 0,
    })),
    rejectedDocuments: session.rejectedDocuments.map((document) => ({ ...document })),
    detectedIdentifiers: session.detectedIdentifiers.map((identifier) => ({
      ...identifier,
      selectedOwned: session.ownedIdentifierIds.includes(identifier.identifierId),
      note: session.ownedIdentifierNotes[identifier.identifierId] || '',
    })),
    ownedIdentifierIds: [...session.ownedIdentifierIds],
    spendingSendRecordIds: [...session.spendingSendRecordIds],
  };
}

setInterval(() => {
  const now = Date.now();

  sessions.forEach((session, sessionId) => {
    if (new Date(session.expiresAt).getTime() <= now) {
      sessions.delete(sessionId);
    }
  });
}, 60 * 1000).unref();

module.exports = {
  addAcceptedDocument,
  addRejectedDocument,
  createSession,
  destroySession,
  getSession,
  getSessionSnapshot,
  resetSession,
  returnToUploadPhase,
  saveOwnedIdentifiers,
  saveSpendingSendRecordIds,
  startCalculationReady,
  startSendReview,
  startWalletReview,
};
