const { getCellValue, rowToObject } = require('../csvUtils');
const { createDetectedIdentifier, createNormalizedRecord } = require('../normalizedSchema');
const {
  parseBtcToSats,
  parseDateToIso,
  parseUsdCents,
  toTrimmedString,
} = require('../valueUtils');

const ACCOUNT_LABEL = 'Cash App BTC';
const DATE_ALIASES = ['date'];
const TYPE_ALIASES = ['transaction type'];
const TXID_ALIASES = ['transaction id'];
const AMOUNT_ALIASES = ['amount'];
const FEE_ALIASES = ['fee'];
const NET_AMOUNT_ALIASES = ['net amount'];
const ASSET_TYPE_ALIASES = ['asset type'];
const ASSET_AMOUNT_ALIASES = ['asset amount'];

function absoluteNumber(value) {
  return Number.isFinite(value) ? Math.abs(value) : null;
}

function buildCommonDetectedIdentifier(documentId, originalName) {
  return createDetectedIdentifier({
    identifierType: 'account_label',
    value: ACCOUNT_LABEL,
    label: 'Account',
    sourceDocumentIds: [documentId],
    sourceDocumentNames: [originalName],
  });
}

function mapCashAppTransactionType(rawType) {
  const normalized = String(rawType || '').trim().toLowerCase();

  if (normalized === 'bitcoin buy') {
    return 'buy';
  }

  if (normalized === 'bitcoin lightning withdrawal') {
    return 'send';
  }

  if (normalized === 'bitcoin lightning deposit' || normalized === 'bitcoin received p2p') {
    return 'receive';
  }

  return 'unknown';
}

function parseCashAppCsvDocument({ documentId, file, inspection, source }) {
  const headerRow = inspection.tabular.headerRow;
  const headerMap = inspection.tabular.headerMap;
  const bodyRows = inspection.tabular.bodyRows;
  const warnings = [];
  const normalizedRecords = [];
  const detectedIdentifiers = [buildCommonDetectedIdentifier(documentId, file.originalname)];

  const requiredHeaders = [
    'transaction id',
    'date',
    'transaction type',
    'fee',
    'asset type',
    'asset amount',
  ];
  const headerNames = Object.keys(headerMap);
  const missingHeaders = requiredHeaders.filter((header) => !headerNames.includes(header));

  if (missingHeaders.length) {
    return {
      accepted: false,
      rejectionReason: `Cash App CSV is missing required columns: ${missingHeaders.join(', ')}.`,
    };
  }

  bodyRows.forEach((row, rowIndex) => {
    const sourceRowNumber = rowIndex + 2;
    const flatRow = rowToObject(headerRow, row);
    const occurredAt = parseDateToIso(getCellValue(row, headerMap, DATE_ALIASES));
    const rawType = toTrimmedString(getCellValue(row, headerMap, TYPE_ALIASES));
    const assetType = toTrimmedString(getCellValue(row, headerMap, ASSET_TYPE_ALIASES));
    const txid = toTrimmedString(getCellValue(row, headerMap, TXID_ALIASES)) || null;
    const quantitySats = parseBtcToSats(getCellValue(row, headerMap, ASSET_AMOUNT_ALIASES));
    const amountCents = absoluteNumber(parseUsdCents(getCellValue(row, headerMap, AMOUNT_ALIASES)));
    const netAmountCents = absoluteNumber(parseUsdCents(getCellValue(row, headerMap, NET_AMOUNT_ALIASES)));
    const feeAmountCents = absoluteNumber(parseUsdCents(getCellValue(row, headerMap, FEE_ALIASES))) || 0;
    const recordType = mapCashAppTransactionType(rawType);

    if (assetType !== 'BTC' || !occurredAt || !quantitySats || recordType === 'unknown') {
      warnings.push(`Skipped row ${sourceRowNumber} in ${file.originalname} because it did not match the supported Cash App bitcoin transaction shapes.`);
      return;
    }

    let fiatAmountCents = amountCents;
    let fromIdentifier = null;
    let toIdentifier = null;

    if (recordType === 'buy') {
      toIdentifier = ACCOUNT_LABEL;
    } else if (recordType === 'receive') {
      toIdentifier = ACCOUNT_LABEL;
      fiatAmountCents = netAmountCents || amountCents;
    } else if (recordType === 'send') {
      fromIdentifier = ACCOUNT_LABEL;
      fiatAmountCents = netAmountCents || amountCents;
    }

    normalizedRecords.push(
      createNormalizedRecord({
        sourceDocumentId: documentId,
        sourceRowNumber,
        recordType,
        occurredAt,
        assetSymbol: 'BTC',
        quantitySats,
        fiatAmountCents,
        feeAmountCents,
        fromIdentifier,
        toIdentifier,
        txid,
        note: rawType,
      })
    );

  });

  if (!normalizedRecords.length) {
    return {
      accepted: false,
      rejectionReason: 'Cash App CSV was recognized, but no bitcoin transaction rows could be normalized from it.',
    };
  }

  return {
    accepted: true,
    normalizedRecords,
    detectedIdentifiers,
    warnings,
    parseSummary: {
      headerRow,
      parsedRows: normalizedRecords.length,
      skippedRows: Math.max(0, bodyRows.length - normalizedRecords.length),
      totalRows: bodyRows.length,
      sourceDisplayName: source.displayName,
    },
  };
}

module.exports = parseCashAppCsvDocument;
