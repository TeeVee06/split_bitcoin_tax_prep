const { getCellValue, rowToObject } = require('../csvUtils');
const { createDetectedIdentifier, createNormalizedRecord } = require('../normalizedSchema');
const {
  parseBtcToSats,
  parseDateToIso,
  parseUsdCents,
  toTrimmedString,
} = require('../valueUtils');

const ACCOUNT_LABEL = 'Provider BTC';
const DATE_ALIASES = ['date'];
const TYPE_ALIASES = ['type'];
const TXID_ALIASES = ['transaction id'];
const AMOUNT_ALIASES = ['amount'];
const FEE_ALIASES = ['fee'];
const ASSET_ALIASES = ['asset'];
const ASSET_AMOUNT_ALIASES = ['asset amount'];

function buildCommonDetectedIdentifier(documentId, originalName) {
  return createDetectedIdentifier({
    identifierType: 'account_label',
    value: ACCOUNT_LABEL,
    label: 'Account',
    sourceDocumentIds: [documentId],
    sourceDocumentNames: [originalName],
  });
}

function mapProviderTransactionType(rawType) {
  const normalized = String(rawType || '').trim().toLowerCase();

  if (normalized === 'buy') {
    return 'buy';
  }

  if (normalized === 'sell') {
    return 'sell';
  }

  if (normalized === 'withdrawal') {
    return 'send';
  }

  if (normalized === 'deposit') {
    return 'receive';
  }

  return 'unknown';
}

function parseProviderCsvDocument({ documentId, file, inspection, source }) {
  const headerRow = inspection.tabular.headerRow;
  const headerMap = inspection.tabular.headerMap;
  const bodyRows = inspection.tabular.bodyRows;
  const warnings = [];
  const normalizedRecords = [];
  const detectedIdentifiers = [buildCommonDetectedIdentifier(documentId, file.originalname)];

  const requiredHeaders = ['date', 'type', 'asset'];
  const headerNames = Object.keys(headerMap);
  const missingHeaders = requiredHeaders.filter((header) => !headerNames.includes(header));

  if (missingHeaders.length) {
    return {
      accepted: false,
      rejectionReason: `${source.displayName} is missing required columns: ${missingHeaders.join(', ')}.`,
    };
  }

  bodyRows.forEach((row, rowIndex) => {
    const sourceRowNumber = rowIndex + 2;
    const flatRow = rowToObject(headerRow, row);
    const occurredAt = parseDateToIso(getCellValue(row, headerMap, DATE_ALIASES));
    const rawType = toTrimmedString(getCellValue(row, headerMap, TYPE_ALIASES));
    const assetSymbol = toTrimmedString(getCellValue(row, headerMap, ASSET_ALIASES));
    const txid = toTrimmedString(getCellValue(row, headerMap, TXID_ALIASES)) || null;
    const quantitySats = parseBtcToSats(getCellValue(row, headerMap, ASSET_AMOUNT_ALIASES));
    const fiatAmountCents = parseUsdCents(getCellValue(row, headerMap, AMOUNT_ALIASES));
    const feeAmountCents = parseUsdCents(getCellValue(row, headerMap, FEE_ALIASES)) || 0;
    const recordType = mapProviderTransactionType(rawType);

    if (assetSymbol !== 'BTC' || !occurredAt || !quantitySats || recordType === 'unknown') {
      warnings.push(`Skipped row ${sourceRowNumber} in ${file.originalname} because it did not match the supported ${source.displayName} bitcoin row shape.`);
      return;
    }

    let fromIdentifier = null;
    let toIdentifier = null;

    if (recordType === 'buy' || recordType === 'receive') {
      toIdentifier = ACCOUNT_LABEL;
    } else if (recordType === 'sell' || recordType === 'send') {
      fromIdentifier = ACCOUNT_LABEL;
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
        note: rawType || JSON.stringify(flatRow),
      })
    );
  });

  if (!normalizedRecords.length) {
    return {
      accepted: false,
      rejectionReason: `${source.displayName} was recognized, but no bitcoin rows could be normalized from it.`,
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

module.exports = parseProviderCsvDocument;
