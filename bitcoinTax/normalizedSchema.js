const crypto = require('crypto');

const RECORD_TYPES = Object.freeze([
  'buy',
  'sell',
  'send',
  'receive',
  'spend',
  'transfer',
  'statement',
  'unknown',
]);

const IDENTIFIER_TYPES = Object.freeze([
  'bitcoin_address',
  'account_label',
  'wallet_label',
  'unknown',
]);

function normalizeRecordType(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();

  return RECORD_TYPES.includes(normalized) ? normalized : 'unknown';
}

function normalizeIdentifierType(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();

  return IDENTIFIER_TYPES.includes(normalized) ? normalized : 'unknown';
}

function looksLikeBitcoinAddress(value) {
  const trimmed = String(value || '').trim();

  if (!trimmed || trimmed.length < 14) {
    return false;
  }

  return /^(bc1|tb1|1|3|m|n|2)[a-zA-Z0-9]{10,}$/.test(trimmed);
}

function normalizeIdentifierValue(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function buildIdentifierKey(identifierType, normalizedValue) {
  return `${normalizeIdentifierType(identifierType)}::${String(normalizedValue || '').toLowerCase()}`;
}

function createNormalizedRecord(input) {
  return {
    recordId: input.recordId || crypto.randomUUID(),
    sourceDocumentId: input.sourceDocumentId || null,
    sourceRowNumber: Number.isFinite(input.sourceRowNumber) ? input.sourceRowNumber : null,
    recordType: normalizeRecordType(input.recordType),
    occurredAt: input.occurredAt || null,
    assetSymbol: input.assetSymbol || null,
    quantitySats: input.quantitySats || null,
    fiatCurrency: input.fiatCurrency || 'USD',
    fiatAmountCents: Number.isFinite(input.fiatAmountCents) ? input.fiatAmountCents : null,
    feeAmountCents: Number.isFinite(input.feeAmountCents) ? input.feeAmountCents : null,
    fromIdentifier: input.fromIdentifier || null,
    toIdentifier: input.toIdentifier || null,
    txid: input.txid || null,
    externalReference: input.externalReference || null,
    note: input.note || null,
  };
}

function createDetectedIdentifier(input) {
  const normalizedValue = normalizeIdentifierValue(input.value);
  const identifierType = normalizeIdentifierType(
    input.identifierType || (looksLikeBitcoinAddress(normalizedValue) ? 'bitcoin_address' : 'unknown')
  );

  return {
    identifierId: input.identifierId || crypto.randomUUID(),
    identifierType,
    value: normalizedValue,
    normalizedValue: normalizedValue.toLowerCase(),
    key: buildIdentifierKey(identifierType, normalizedValue),
    label: input.label || null,
    note: input.note || '',
    sourceDocumentIds: input.sourceDocumentIds ? [...input.sourceDocumentIds] : [],
    sourceDocumentNames: input.sourceDocumentNames ? [...input.sourceDocumentNames] : [],
    sourceRowNumbers: input.sourceRowNumbers ? [...input.sourceRowNumbers] : [],
  };
}

function collectIdentifiersFromFlatRow(flatRow, context) {
  const identifiers = [];
  const rowEntries = Object.entries(flatRow || {});

  rowEntries.forEach(([headerLabel, rawValue]) => {
    const trimmedValue = normalizeIdentifierValue(rawValue);
    const normalizedHeader = String(headerLabel || '').trim().toLowerCase();

    if (!trimmedValue) {
      return;
    }

    const looksLikeIdentifierField = /(address|wallet|account|source|destination|from|to)/i.test(normalizedHeader);

    if (!looksLikeIdentifierField && !looksLikeBitcoinAddress(trimmedValue)) {
      return;
    }

    const identifierType = looksLikeBitcoinAddress(trimmedValue)
      ? 'bitcoin_address'
      : /(wallet)/i.test(normalizedHeader)
        ? 'wallet_label'
        : 'account_label';

    identifiers.push(
      createDetectedIdentifier({
        identifierType,
        value: trimmedValue,
        label: headerLabel,
        sourceDocumentIds: context.sourceDocumentId ? [context.sourceDocumentId] : [],
        sourceDocumentNames: context.sourceDocumentName ? [context.sourceDocumentName] : [],
        sourceRowNumbers: Number.isFinite(context.sourceRowNumber) ? [context.sourceRowNumber] : [],
      })
    );
  });

  return identifiers;
}

module.exports = {
  buildIdentifierKey,
  collectIdentifiersFromFlatRow,
  createDetectedIdentifier,
  createNormalizedRecord,
  looksLikeBitcoinAddress,
  normalizeIdentifierType,
  normalizeIdentifierValue,
  normalizeRecordType,
};
