const { getCellValue, rowToObject } = require('../csvUtils');
const { collectIdentifiersFromFlatRow, createNormalizedRecord } = require('../normalizedSchema');
const {
  normalizeAssetSymbol,
  parseBtcToSats,
  parseDateToIso,
  parseUsdCents,
  toTrimmedString,
} = require('../valueUtils');

const TIMESTAMP_ALIASES = ['date', 'timestamp', 'time', 'created at', 'transaction date', 'trade date'];
const TYPE_ALIASES = ['type', 'transaction type', 'side', 'action', 'category', 'subtype', 'transaction', 'tag'];
const ASSET_ALIASES = ['asset', 'currency', 'coin', 'symbol', 'pair', 'base asset', 'received currency', 'sent currency'];
const QUANTITY_ALIASES = ['amount', 'quantity', 'size', 'btc amount', 'asset amount', 'filled size', 'received amount', 'sent amount', 'amount btc', 'btc quantity', 'qty'];
const USD_ALIASES = ['usd amount', 'amount usd', 'subtotal', 'total usd', 'proceeds', 'value usd', 'price usd', 'native amount', 'received value usd', 'cash value', 'usd value', 'total value', 'amount in usd'];
const FEE_ALIASES = ['fee', 'fee usd', 'trading fee', 'fee amount', 'fees', 'fee amount usd'];
const SENT_AMOUNT_ALIASES = ['sent amount'];
const SENT_CURRENCY_ALIASES = ['sent currency'];
const RECEIVED_AMOUNT_ALIASES = ['received amount'];
const RECEIVED_CURRENCY_ALIASES = ['received currency'];
const FROM_ALIASES = ['from', 'source', 'account', 'wallet', 'from account', 'source account'];
const TO_ALIASES = ['to', 'destination', 'to account', 'destination account', 'address'];
const TXID_ALIASES = ['txid', 'transaction id', 'transaction hash', 'hash', 'order id', 'id', 'reference code'];
const NOTE_ALIASES = ['description', 'memo', 'note', 'details', 'reference code'];

function normalizeCurrencyCode(value) {
  const normalized = normalizeAssetSymbol(value);

  if (normalized) {
    return normalized;
  }

  const trimmed = toTrimmedString(value).toUpperCase();

  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/[^A-Z0-9-]/g, '') || null;
}

function selectBtcQuantitySats(row, headerMap) {
  const sentCurrency = normalizeCurrencyCode(getCellValue(row, headerMap, SENT_CURRENCY_ALIASES));
  const receivedCurrency = normalizeCurrencyCode(getCellValue(row, headerMap, RECEIVED_CURRENCY_ALIASES));

  if (sentCurrency === 'BTC') {
    return parseBtcToSats(getCellValue(row, headerMap, SENT_AMOUNT_ALIASES));
  }

  if (receivedCurrency === 'BTC') {
    return parseBtcToSats(getCellValue(row, headerMap, RECEIVED_AMOUNT_ALIASES));
  }

  return parseBtcToSats(getCellValue(row, headerMap, QUANTITY_ALIASES));
}

function selectUsdAmountCents(row, headerMap) {
  const sentCurrency = normalizeCurrencyCode(getCellValue(row, headerMap, SENT_CURRENCY_ALIASES));
  const receivedCurrency = normalizeCurrencyCode(getCellValue(row, headerMap, RECEIVED_CURRENCY_ALIASES));

  if (sentCurrency === 'USD') {
    return parseUsdCents(getCellValue(row, headerMap, SENT_AMOUNT_ALIASES));
  }

  if (receivedCurrency === 'USD') {
    return parseUsdCents(getCellValue(row, headerMap, RECEIVED_AMOUNT_ALIASES));
  }

  return parseUsdCents(getCellValue(row, headerMap, USD_ALIASES));
}

function inferRecordType(rawType, rawDescription) {
  const normalized = `${String(rawType || '')} ${String(rawDescription || '')}`.trim().toLowerCase();

  if (/buy|purchase/.test(normalized)) {
    return 'buy';
  }

  if (/sell/.test(normalized)) {
    return 'sell';
  }

  if (/withdraw|send/.test(normalized)) {
    return 'send';
  }

  if (/deposit|receive/.test(normalized)) {
    return 'receive';
  }

  if (/payment|spend/.test(normalized)) {
    return 'spend';
  }

  if (/transfer/.test(normalized)) {
    return 'transfer';
  }

  return 'unknown';
}

function parseGenericExchangeCsvDocument({ documentId, file, inspection, source }) {
  const headerRow = inspection.tabular.headerRow;
  const headerMap = inspection.tabular.headerMap;
  const bodyRows = inspection.tabular.bodyRows;
  const warnings = [];
  const normalizedRecords = [];
  const detectedIdentifiers = [];

  const hasTimestampColumn = TIMESTAMP_ALIASES.some((alias) => getCellValue(headerRow, inspection.tabular.headerIndexMap, [alias]) !== null);
  const hasStructureColumn = TYPE_ALIASES.some((alias) => getCellValue(headerRow, inspection.tabular.headerIndexMap, [alias]) !== null)
    || ASSET_ALIASES.some((alias) => getCellValue(headerRow, inspection.tabular.headerIndexMap, [alias]) !== null)
    || QUANTITY_ALIASES.some((alias) => getCellValue(headerRow, inspection.tabular.headerIndexMap, [alias]) !== null);

  if (!hasTimestampColumn || !hasStructureColumn) {
    return {
      accepted: false,
      rejectionReason: 'Exchange CSV is missing the minimum date and transaction structure columns needed for parsing.',
    };
  }

  bodyRows.forEach((row, rowIndex) => {
    const sourceRowNumber = rowIndex + 2;
    const flatRow = rowToObject(headerRow, row);
    const occurredAt = parseDateToIso(getCellValue(row, headerMap, TIMESTAMP_ALIASES));
    const rawType = toTrimmedString(getCellValue(row, headerMap, TYPE_ALIASES));
    const rawAsset = toTrimmedString(getCellValue(row, headerMap, ASSET_ALIASES));
    const rawNote = toTrimmedString(getCellValue(row, headerMap, NOTE_ALIASES));
    const assetSymbol = normalizeAssetSymbol(rawAsset || rawNote);

    if (assetSymbol !== 'BTC' && !/btc|bitcoin/i.test(`${rawAsset} ${rawNote}`)) {
      return;
    }

    const quantitySats = selectBtcQuantitySats(row, headerMap);
    const fiatAmountCents = selectUsdAmountCents(row, headerMap);
    const feeAmountCents = parseUsdCents(getCellValue(row, headerMap, FEE_ALIASES));
    const fromIdentifier = toTrimmedString(getCellValue(row, headerMap, FROM_ALIASES)) || null;
    const toIdentifier = toTrimmedString(getCellValue(row, headerMap, TO_ALIASES)) || null;
    const txid = toTrimmedString(getCellValue(row, headerMap, TXID_ALIASES)) || null;
    const recordType = inferRecordType(rawType, rawNote);

    if (!occurredAt || (!quantitySats && !fiatAmountCents && !fromIdentifier && !toIdentifier)) {
      warnings.push(`Skipped row ${sourceRowNumber} in ${file.originalname} because the row did not contain enough BTC transaction data.`);
      return;
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
        note: [rawType, rawNote].filter(Boolean).join(' - ') || null,
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
      rejectionReason: 'Exchange CSV was recognized, but no BTC transaction rows could be normalized from it.',
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

module.exports = parseGenericExchangeCsvDocument;
