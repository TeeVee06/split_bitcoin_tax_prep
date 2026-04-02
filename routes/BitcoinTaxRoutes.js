require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const path = require('path');
const Big = require('big.js');

const { calculateDraftTaxResult } = require('../bitcoinTax/calculationEngine');
const { buildOfficialFormMapping } = require('../bitcoinTax/formMapping');
const { buildDownloadPackage } = require('../bitcoinTax/packageBuilder');
const {
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
} = require('../bitcoinTax/sessionStore');
const { parseBitcoinTaxDocument } = require('../bitcoinTax/parserRegistry');
const { summarizeSourceCoverage } = require('../bitcoinTax/sourceRegistry');

const router = express.Router();

const BITCOIN_TAX_SESSION_COOKIE = 'splitBitcoinTaxSession';
const SESSION_COOKIE_MAX_AGE_MS = 1000 * 60 * 90;
const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const MAX_DOCUMENT_COUNT = 12;
const SUPPORTED_EXTENSIONS = new Set(['.csv', '.pdf']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_DOCUMENT_BYTES,
    files: MAX_DOCUMENT_COUNT,
  },
});

function applyNoStoreHeaders(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`;
  }

  return `${value} B`;
}

function formatUsdCents(value) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }

  return `$${(value / 100).toFixed(2)}`;
}

function formatSatsAsBtc(value) {
  if (!value) {
    return '0 BTC';
  }

  try {
    const formatted = new Big(String(value))
      .div(100000000)
      .toFixed(8)
      .replace(/\.?0+$/, '');

    return `${formatted} BTC`;
  } catch (_) {
    return `${String(value)} sats`;
  }
}

function decorateCalculationResult(calculationResult) {
  if (!calculationResult) {
    return null;
  }

  const officialForms = buildOfficialFormMapping(calculationResult);

  return {
    ...calculationResult,
    draftRows: calculationResult.draftRows.map((row) => ({
      ...row,
      quantityText: formatSatsAsBtc(row.quantitySats),
      proceedsText: formatUsdCents(row.proceedsCents),
      basisText: formatUsdCents(row.basisCents),
      gainLossText: formatUsdCents(row.gainLossCents),
    })),
    totals: Object.fromEntries(
      Object.entries(calculationResult.totals).map(([key, value]) => [
        key,
        {
          ...value,
          proceedsText: formatUsdCents(value.proceedsCents),
          basisText: formatUsdCents(value.basisCents),
          gainLossText: formatUsdCents(value.gainLossCents),
        },
      ])
    ),
    officialForms,
  };
}

function listReviewableSendTransactions(session) {
  return (session.acceptedDocuments || [])
    .flatMap((document) =>
      (document.normalizedRecords || [])
        .filter((record) => record.recordType === 'send' && record.assetSymbol === 'BTC')
        .map((record) => ({
          ...record,
          sourceDocumentName: document.originalName,
          sourceDisplayName: document.sourceDisplayName,
          selectedSpending: Array.isArray(session.spendingSendRecordIds) && session.spendingSendRecordIds.includes(record.recordId),
        }))
    )
    .sort((left, right) => {
      const leftTime = left.occurredAt ? new Date(left.occurredAt).getTime() : 0;
      const rightTime = right.occurredAt ? new Date(right.occurredAt).getTime() : 0;
      return rightTime - leftTime;
    });
}

function getOrCreateTaxSession(req, res) {
  const existingSessionId = req.cookies?.[BITCOIN_TAX_SESSION_COOKIE];
  let session = getSession(existingSessionId);

  if (!session) {
    session = createSession();
    res.cookie(BITCOIN_TAX_SESSION_COOKIE, session.sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_COOKIE_MAX_AGE_MS,
    });
  }

  return session;
}

function buildTaxSessionView(session) {
  const calculationResult = session.phase === 'calculation-ready'
    ? decorateCalculationResult(calculateDraftTaxResult(session))
    : null;
  const snapshot = getSessionSnapshot(session);
  const reviewableSendTransactions = listReviewableSendTransactions(session).map((record) => ({
    ...record,
    quantityText: formatSatsAsBtc(record.quantitySats),
    fiatAmountText: formatUsdCents(record.fiatAmountCents),
  }));
  const acceptedDocuments = snapshot.acceptedDocuments.map((document) => ({
    ...document,
    sizeText: formatBytes(document.sizeBytes),
  }));
  const rejectedDocuments = snapshot.rejectedDocuments.map((document) => ({
    ...document,
    sizeText: formatBytes(document.sizeBytes),
  }));
  const detectedIdentifiers = snapshot.detectedIdentifiers.map((identifier) => ({
    ...identifier,
    sourceDocumentNameText: Array.isArray(identifier.sourceDocumentNames) && identifier.sourceDocumentNames.length
      ? identifier.sourceDocumentNames.join(', ')
      : 'uploaded documents',
  }));

  return {
    ...snapshot,
    acceptedDocuments,
    rejectedDocuments,
    detectedIdentifiers,
    counts: {
      accepted: acceptedDocuments.length,
      identifiers: detectedIdentifiers.length,
      normalizedRecords: acceptedDocuments.reduce(
        (total, document) => total + Number(document.normalizedRecordCount || 0),
        0
      ),
      ownedIdentifiers: snapshot.ownedIdentifierIds.length,
      reviewableSends: reviewableSendTransactions.length,
      spendingMarked: snapshot.spendingSendRecordIds.length,
    },
    calculationResult,
    reviewableSendTransactions,
  };
}

function renderBitcoinTaxPage(req, res, overrides = {}) {
  applyNoStoreHeaders(res);

  const session = overrides.session || getOrCreateTaxSession(req, res);

  return res.render('BitcoinTax', {
    formError: null,
    phaseNotice: null,
    sourceCoverageSummary: summarizeSourceCoverage(),
    taxSession: buildTaxSessionView(session),
    ...overrides,
  });
}

function formatUploadError(error) {
  if (!error) {
    return 'Unable to process your upload right now.';
  }

  if (error.code === 'LIMIT_FILE_SIZE') {
    return `Each file must be ${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB or smaller.`;
  }

  if (error.code === 'LIMIT_FILE_COUNT') {
    return `Upload up to ${MAX_DOCUMENT_COUNT} files at a time.`;
  }

  return 'Unable to process your upload right now.';
}

function normalizeOwnedIdentifierSelection(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === 'string' && entry.trim() !== '');
  }

  if (typeof value === 'string' && value.trim() !== '') {
    return [value.trim()];
  }

  return [];
}

function normalizeRecordSelection(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === 'string' && entry.trim() !== '');
  }

  if (typeof value === 'string' && value.trim() !== '') {
    return [value.trim()];
  }

  return [];
}

router.get('/bitcoin-tax', (req, res) => {
  return renderBitcoinTaxPage(req, res);
});

router.post('/bitcoin-tax/upload', (req, res) => {
  upload.array('documents', MAX_DOCUMENT_COUNT)(req, res, async (error) => {
    const session = getOrCreateTaxSession(req, res);
    let acceptedCount = 0;
    let hadRejectedUpload = false;

    if (session.phase !== 'upload') {
      return renderBitcoinTaxPage(req, res, {
        session,
        formError: 'Return to the upload phase before adding more documents.',
      });
    }

    if (error) {
      return renderBitcoinTaxPage(req, res, {
        session,
        formError: formatUploadError(error),
      });
    }

    const files = Array.isArray(req.files) ? req.files : [];

    if (!files.length) {
      return renderBitcoinTaxPage(req, res, {
        session,
        formError: 'Upload at least one CSV or PDF document to continue.',
      });
    }

    for (const file of files) {
      const documentId = crypto.randomUUID();
      const extension = path.extname(String(file.originalname || '')).toLowerCase();

      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        addRejectedDocument(session, file, {
          accepted: false,
          documentId,
          rejectionReason: `Unsupported file type ${extension || '(none)'}. Upload CSV or PDF files only.`,
        });
        hadRejectedUpload = true;
        continue;
      }

      const parsedDocument = await parseBitcoinTaxDocument({
        documentId,
        file,
      });

      if (parsedDocument.accepted) {
        addAcceptedDocument(session, file, parsedDocument);
        acceptedCount += 1;
      } else {
        addRejectedDocument(session, file, parsedDocument);
        hadRejectedUpload = true;
      }
    }

    return renderBitcoinTaxPage(req, res, {
      session,
      phaseNotice: acceptedCount
        ? `Accepted ${acceptedCount} uploaded ${acceptedCount === 1 ? 'file' : 'files'}. Keep going, or move to wallet review when you are done.`
        : null,
      formError: hadRejectedUpload
        ? 'Some uploaded files were rejected and not added to this session.'
        : null,
    });
  });
});

router.post('/bitcoin-tax/done-uploading', (req, res) => {
  const session = getOrCreateTaxSession(req, res);

  if (!session.acceptedDocuments.length) {
    return renderBitcoinTaxPage(req, res, {
      session,
      formError: 'Upload at least one accepted document before moving to wallet review.',
    });
  }

  startWalletReview(session);

  return renderBitcoinTaxPage(req, res, {
    session,
    phaseNotice: 'Upload phase complete. Review the raw wallets and addresses found in your accepted documents.',
  });
});

router.post('/bitcoin-tax/back-to-upload', (req, res) => {
  const session = getOrCreateTaxSession(req, res);
  returnToUploadPhase(session);

  return renderBitcoinTaxPage(req, res, {
    session,
    phaseNotice: 'You are back in the upload phase. You can keep adding documents.',
  });
});

router.post('/bitcoin-tax/back-to-wallet-review', (req, res) => {
  const session = getOrCreateTaxSession(req, res);

  if (!session.acceptedDocuments.length) {
    return renderBitcoinTaxPage(req, res, {
      session,
      formError: 'Upload at least one accepted document before reviewing wallets.',
    });
  }

  startWalletReview(session);

  return renderBitcoinTaxPage(req, res, {
    session,
    phaseNotice: 'Review your wallet selections and make any changes you need.',
  });
});

router.post('/bitcoin-tax/back-to-send-review', (req, res) => {
  const session = getOrCreateTaxSession(req, res);

  if (!session.acceptedDocuments.length) {
    return renderBitcoinTaxPage(req, res, {
      session,
      formError: 'Upload at least one accepted document before reviewing outgoing sends.',
    });
  }

  const reviewableSendTransactions = listReviewableSendTransactions(session);

  if (!reviewableSendTransactions.length) {
    startCalculationReady(session);

    return renderBitcoinTaxPage(req, res, {
      session,
      phaseNotice: 'There are no outgoing BTC sends that need review in this session.',
    });
  }

  startSendReview(session);

  return renderBitcoinTaxPage(req, res, {
    session,
    phaseNotice: 'Review the outgoing BTC sends that may represent reportable spending.',
  });
});

router.post('/bitcoin-tax/wallets', (req, res) => {
  const session = getOrCreateTaxSession(req, res);

  if (session.phase !== 'wallet-review') {
    return renderBitcoinTaxPage(req, res, {
      session,
      formError: 'Complete the upload phase before reviewing wallets.',
    });
  }

  const ownedIdentifierIds = normalizeOwnedIdentifierSelection(req.body.ownedIdentifierIds);
  const ownedIdentifierNotes = {};

  session.detectedIdentifiers.forEach((identifier) => {
    const noteValue = req.body[`identifier_note_${identifier.identifierId}`];
    const trimmedNote = String(noteValue || '').trim();

    if (trimmedNote) {
      ownedIdentifierNotes[identifier.identifierId] = trimmedNote;
    }
  });

  saveOwnedIdentifiers(session, ownedIdentifierIds, ownedIdentifierNotes);
  const reviewableSendTransactions = listReviewableSendTransactions(session);

  if (reviewableSendTransactions.length) {
    startSendReview(session);

    return renderBitcoinTaxPage(req, res, {
      session,
      phaseNotice: 'Wallet selections saved. Review outgoing send transactions and mark the ones that were actual spending.',
    });
  }

  startCalculationReady(session);

  return renderBitcoinTaxPage(req, res, {
    session,
    phaseNotice: 'Wallet selections captured. Draft calculations were generated for this session.',
  });
});

router.post('/bitcoin-tax/send-review', (req, res) => {
  const session = getOrCreateTaxSession(req, res);

  if (session.phase !== 'send-review') {
    return renderBitcoinTaxPage(req, res, {
      session,
      formError: 'Complete wallet review before reviewing outgoing send transactions.',
    });
  }

  const spendingSendRecordIds = normalizeRecordSelection(req.body.spendingSendRecordIds);
  saveSpendingSendRecordIds(session, spendingSendRecordIds);
  startCalculationReady(session);

  return renderBitcoinTaxPage(req, res, {
    session,
    phaseNotice: 'Outgoing send review saved. Draft calculations were generated for this session.',
  });
});

router.post('/bitcoin-tax/reset', (req, res) => {
  const session = getOrCreateTaxSession(req, res);
  const reset = resetSession(session);

  return renderBitcoinTaxPage(req, res, {
    session: reset,
    phaseNotice: 'Your tax-prep session was cleared.',
  });
});

router.post('/bitcoin-tax/download-package', async (req, res) => {
  applyNoStoreHeaders(res);

  const session = getOrCreateTaxSession(req, res);

  if (session.phase !== 'calculation-ready') {
    return renderBitcoinTaxPage(req, res, {
      session,
      formError: 'Complete wallet review and draft calculations before downloading the package.',
    });
  }

  const calculationResult = calculateDraftTaxResult(session);

  try {
    const packageBuffer = await buildDownloadPackage(session, calculationResult);
    const filename = `split_bitcoin_tax_prep_packet_${new Date().toISOString().slice(0, 10)}.zip`;

    destroySession(session.sessionId);
    res.clearCookie(BITCOIN_TAX_SESSION_COOKIE);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    return res.send(packageBuffer);
  } catch (error) {
    return renderBitcoinTaxPage(req, res, {
      session,
      formError: 'Unable to generate the download package right now.',
    });
  }
});

module.exports = router;
