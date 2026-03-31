const { getCellValue, rowToObject } = require('../csvUtils');
const { collectIdentifiersFromFlatRow, createNormalizedRecord } = require('../normalizedSchema');
const {
  normalizeAssetSymbol,
  parseBtcToSats,
  parseDateToIso,
  parseIntegerString,
  parseUsdCents,
  toTrimmedString,
} = require('../valueUtils');

const TIMESTAMP_ALIASES = ['date', 'timestamp', 'created at', 'transaction date', 'paid at', 'spent at'];
const MERCHANT_ALIASES = ['merchant', 'merchant name', 'place', 'business', 'store'];
const SATS_ALIASES = ['sats', 'amount sats', 'satoshis', 'amount in sats'];
const BTC_ALIASES = ['btc', 'btc amount', 'bitcoin amount', 'amount btc'];
const USD_ALIASES = ['usd', 'usd amount', 'amount usd', 'merchant spend usd', 'spend usd', 'merchant spend'];
const NOTE_ALIASES = ['note', 'memo', 'description', 'caption'];
const TXID_ALIASES = ['txid', 'transaction id', 'payment hash', 'reference'];

function parseSplitCsvDocument({ documentId, file, inspection, source }) {
  const headerRow = inspection.tabular.headerRow;
  const headerMap = inspection.tabular.headerMap;
  const bodyRows = inspection.tabular.bodyRows;
  const warnings = [];
  const normalizedRecords = [];
  const detectedIdentifiers = [];

  const hasTimestamp = TIMESTAMP_ALIASES.some((alias) => getCellValue(headerRow, inspection.tabular.headerIndexMap, [alias]) !== null);
  const hasAmountColumn = SATS_ALIASES.some((alias) => getCellValue(headerRow, inspection.tabular.headerIndexMap, [alias]) !== null)
    || BTC_ALIASES.some((alias) => getCellValue(headerRow, inspection.tabular.headerIndexMap, [alias]) !== null)
    || USD_ALIASES.some((alias) => getCellValue(headerRow, inspection.tabular.headerIndexMap, [alias]) !== null);

  if (!hasTimestamp || !hasAmountColumn) {
    return {
      accepted: false,
      rejectionReason: 'Split CSV is missing the date or amount columns needed for spend parsing.',
    };
  }

  bodyRows.forEach((row, rowIndex) => {
    const sourceRowNumber = rowIndex + 2;
    const flatRow = rowToObject(headerRow, row);
    const occurredAt = parseDateToIso(getCellValue(row, headerMap, TIMESTAMP_ALIASES));
    const merchant = toTrimmedString(getCellValue(row, headerMap, MERCHANT_ALIASES));
    const quantitySats = parseIntegerString(getCellValue(row, headerMap, SATS_ALIASES))
      || parseBtcToSats(getCellValue(row, headerMap, BTC_ALIASES));
    const fiatAmountCents = parseUsdCents(getCellValue(row, headerMap, USD_ALIASES));
    const noteParts = [merchant, toTrimmedString(getCellValue(row, headerMap, NOTE_ALIASES))].filter(Boolean);
    const txid = toTrimmedString(getCellValue(row, headerMap, TXID_ALIASES)) || null;

    if (!occurredAt || (!quantitySats && !fiatAmountCents)) {
      warnings.push(`Skipped row ${sourceRowNumber} in ${file.originalname} because the row was missing a usable date or amount.`);
      return;
    }

    normalizedRecords.push(
      createNormalizedRecord({
        sourceDocumentId: documentId,
        sourceRowNumber,
        recordType: 'spend',
        occurredAt,
        assetSymbol: normalizeAssetSymbol('BTC'),
        quantitySats,
        fiatAmountCents,
        txid,
        note: noteParts.join(' - ') || null,
      })
    );

    detectedIdentifiers.push(
      ...collectIdentifiersFromFlatRow(flatRow, {
        sourceDocumentId: documentId,
        sourceDocumentName: file.originalname,
        sourceRowNumber,
      })
    );
  });

  if (!normalizedRecords.length) {
    return {
      accepted: false,
      rejectionReason: 'Split CSV was recognized, but no spend rows could be normalized from it.',
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

module.exports = parseSplitCsvDocument;
