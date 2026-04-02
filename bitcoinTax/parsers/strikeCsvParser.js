const { getCellValue } = require('../csvUtils');
const {
  createDetectedIdentifier,
  createNormalizedRecord,
  looksLikeBitcoinAddress,
} = require('../normalizedSchema');
const {
  parseBtcToSats,
  parseUsdCents,
  toTrimmedString,
} = require('../valueUtils');

const ACCOUNT_LABEL = 'Strike BTC';
const REFERENCE_ALIASES = ['reference'];
const DATE_ALIASES = ['date & time utc'];
const TYPE_ALIASES = ['transaction type'];
const AMOUNT_USD_ALIASES = ['amount usd'];
const FEE_USD_ALIASES = ['fee usd'];
const AMOUNT_BTC_ALIASES = ['amount btc'];
const COST_BASIS_USD_ALIASES = ['cost basis usd'];
const DESTINATION_ALIASES = ['destination'];
const DESCRIPTION_ALIASES = ['description'];
const HASH_ALIASES = ['transaction hash'];
const NOTE_ALIASES = ['note'];
const MONTH_INDEX = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function parseStrikeUtcDateToIso(value) {
  const trimmed = toTrimmedString(value);

  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);

  if (!match) {
    return null;
  }

  const [, monthLabel, dayValue, yearValue, hourValue, minuteValue, secondValue] = match;
  const monthIndex = MONTH_INDEX[monthLabel.toLowerCase()];

  if (!Number.isFinite(monthIndex)) {
    return null;
  }

  const parsed = new Date(Date.UTC(
    Number(yearValue),
    monthIndex,
    Number(dayValue),
    Number(hourValue),
    Number(minuteValue),
    Number(secondValue)
  ));

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function absoluteSats(value) {
  const parsed = parseBtcToSats(value);

  if (!parsed) {
    return null;
  }

  return parsed.startsWith('-') ? parsed.slice(1) : parsed;
}

function absoluteUsdCents(value) {
  const parsed = parseUsdCents(value);
  return Number.isFinite(parsed) ? Math.abs(parsed) : null;
}

function mapStrikeTransactionType(rawType) {
  const normalized = String(rawType || '').trim().toLowerCase();

  if (normalized === 'purchase') {
    return 'buy';
  }

  if (normalized === 'send') {
    return 'send';
  }

  if (normalized === 'receive') {
    return 'receive';
  }

  if (normalized === 'deposit') {
    return 'fiat_deposit';
  }

  return 'unknown';
}

function buildDetectedIdentifiers(documentId, originalName, destination) {
  const identifiers = [
    createDetectedIdentifier({
      identifierType: 'account_label',
      value: ACCOUNT_LABEL,
      label: 'Account',
      sourceDocumentIds: [documentId],
      sourceDocumentNames: [originalName],
    }),
  ];

  if (looksLikeBitcoinAddress(destination)) {
    identifiers.push(
      createDetectedIdentifier({
        identifierType: 'bitcoin_address',
        value: destination,
        label: 'Destination',
        sourceDocumentIds: [documentId],
        sourceDocumentNames: [originalName],
      })
    );
  }

  return identifiers;
}

function parseStrikeCsvDocument({ documentId, file, inspection, source }) {
  const headerRow = inspection.tabular.headerRow;
  const headerMap = inspection.tabular.headerMap;
  const bodyRows = inspection.tabular.bodyRows;
  const warnings = [];
  const normalizedRecords = [];
  const detectedIdentifiers = buildDetectedIdentifiers(documentId, file.originalname, null);
  const requiredHeaders = [
    { label: 'Reference', aliases: REFERENCE_ALIASES },
    { label: 'Date & Time (UTC)', aliases: DATE_ALIASES },
    { label: 'Transaction Type', aliases: TYPE_ALIASES },
  ];
  const missingHeaders = requiredHeaders
    .filter(({ aliases }) => getCellValue(headerRow, inspection.tabular.headerIndexMap, aliases) === null)
    .map(({ label }) => label);

  if (missingHeaders.length) {
    return {
      accepted: false,
      rejectionReason: `Strike CSV is missing required columns: ${missingHeaders.join(', ')}.`,
    };
  }

  bodyRows.forEach((row, rowIndex) => {
    const sourceRowNumber = rowIndex + 2;
    const occurredAt = parseStrikeUtcDateToIso(getCellValue(row, headerMap, DATE_ALIASES));
    const rawType = toTrimmedString(getCellValue(row, headerMap, TYPE_ALIASES));
    const recordType = mapStrikeTransactionType(rawType);
    const externalReference = toTrimmedString(getCellValue(row, headerMap, REFERENCE_ALIASES)) || null;
    const quantitySats = absoluteSats(getCellValue(row, headerMap, AMOUNT_BTC_ALIASES));
    const amountUsdCents = absoluteUsdCents(getCellValue(row, headerMap, AMOUNT_USD_ALIASES));
    const costBasisUsdCents = absoluteUsdCents(getCellValue(row, headerMap, COST_BASIS_USD_ALIASES));
    const feeAmountCents = absoluteUsdCents(getCellValue(row, headerMap, FEE_USD_ALIASES)) || 0;
    const destination = toTrimmedString(getCellValue(row, headerMap, DESTINATION_ALIASES)) || null;
    const description = toTrimmedString(getCellValue(row, headerMap, DESCRIPTION_ALIASES));
    const note = toTrimmedString(getCellValue(row, headerMap, NOTE_ALIASES));
    const txid = toTrimmedString(getCellValue(row, headerMap, HASH_ALIASES)) || null;

    if (recordType === 'fiat_deposit') {
      return;
    }

    if (recordType === 'unknown') {
      warnings.push(`Skipped row ${sourceRowNumber} in ${file.originalname} because Strike transaction type "${rawType || 'unknown'}" is not supported yet.`);
      return;
    }

    if (!occurredAt) {
      warnings.push(`Skipped row ${sourceRowNumber} in ${file.originalname} because the UTC timestamp could not be parsed.`);
      return;
    }

    if (recordType === 'buy' && !quantitySats) {
      warnings.push(`Skipped row ${sourceRowNumber} in ${file.originalname} because the Strike purchase row was missing a BTC amount.`);
      return;
    }

    if (recordType === 'send' && !quantitySats) {
      warnings.push(`Skipped row ${sourceRowNumber} in ${file.originalname} because the Strike send row was missing a BTC amount.`);
      return;
    }

    const noteParts = [rawType, description, note].filter(Boolean);
    let fromIdentifier = null;
    let toIdentifier = null;
    let fiatAmountCents = null;

    if (recordType === 'buy') {
      toIdentifier = ACCOUNT_LABEL;
      fiatAmountCents = costBasisUsdCents ?? amountUsdCents;
    } else if (recordType === 'send') {
      fromIdentifier = ACCOUNT_LABEL;
      toIdentifier = destination;
      fiatAmountCents = amountUsdCents;
    } else if (recordType === 'receive') {
      toIdentifier = ACCOUNT_LABEL;
      fiatAmountCents = amountUsdCents;
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
        externalReference,
        note: noteParts.join(' - ') || null,
      })
    );

    if (looksLikeBitcoinAddress(destination)) {
      detectedIdentifiers.push(
        createDetectedIdentifier({
          identifierType: 'bitcoin_address',
          value: destination,
          label: 'Destination',
          sourceDocumentIds: [documentId],
          sourceDocumentNames: [file.originalname],
          sourceRowNumbers: [sourceRowNumber],
        })
      );
    }
  });

  if (!normalizedRecords.length) {
    return {
      accepted: false,
      rejectionReason: 'Strike CSV was recognized, but no supported bitcoin transaction rows could be normalized from it.',
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

module.exports = parseStrikeCsvDocument;
