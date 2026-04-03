const { buildHeaderMap, normalizeHeader, parseCsvText } = require('../csvUtils');
const { createDetectedIdentifier, createNormalizedRecord } = require('../normalizedSchema');
const {
  normalizeAssetSymbol,
  parseBtcToSats,
  parseDateToIso,
  parseUsdCents,
  toTrimmedString,
} = require('../valueUtils');

const REQUIRED_HEADERS = [
  'Transaction Type',
  'Transaction ID',
  'Tax lot ID',
  'Asset name',
  'Amount',
  'Date Acquired',
  'Cost basis (USD)',
  'Date of Disposition',
  'Proceeds (USD)',
];

function parseCoinbaseReportDate(value) {
  const trimmed = toTrimmedString(value);
  const usDateMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (usDateMatch) {
    const [, month, day, year] = usDateMatch;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toISOString();
  }

  return parseDateToIso(trimmed);
}

function findHeaderRowIndex(rows) {
  return rows.findIndex((row) => {
    const headerMap = buildHeaderMap(row);
    return REQUIRED_HEADERS.every((header) => headerMap[normalizeHeader(header)] !== undefined);
  });
}

function buildRequiredHeaderError(headerRow) {
  const headerMap = buildHeaderMap(headerRow || []);
  const missing = REQUIRED_HEADERS.filter((header) => headerMap[normalizeHeader(header)] === undefined);

  return `Coinbase gain/loss CSV is missing required columns: ${missing.join(', ')}.`;
}

function buildSyntheticRecords({ documentId, sourceRowNumber, rowData }) {
  const noteBase = `Coinbase gain/loss report - ${rowData.transactionType || 'Disposition'}`;
  const accountLabel = 'Coinbase BTC';
  const referenceBase = [rowData.transactionId, rowData.taxLotId].filter(Boolean).join(':') || null;

  const acquisitionRecord = createNormalizedRecord({
    sourceDocumentId: documentId,
    sourceRowNumber,
    recordType: 'buy',
    occurredAt: rowData.dateAcquired,
    assetSymbol: 'BTC',
    quantitySats: rowData.quantitySats,
    fiatAmountCents: rowData.costBasisCents,
    toIdentifier: accountLabel,
    externalReference: referenceBase ? `${referenceBase}:acquired` : null,
    note: noteBase,
  });

  const dispositionRecord = createNormalizedRecord({
    sourceDocumentId: documentId,
    sourceRowNumber,
    recordType: 'sell',
    occurredAt: rowData.dateDisposed,
    assetSymbol: 'BTC',
    quantitySats: rowData.quantitySats,
    fiatAmountCents: rowData.proceedsCents,
    fromIdentifier: accountLabel,
    externalReference: referenceBase ? `${referenceBase}:disposed` : null,
    note: noteBase,
  });

  return [acquisitionRecord, dispositionRecord];
}

function parseCoinbaseGainLossCsvDocument({ documentId, file, inspection, source }) {
  const text = inspection?.text ?? file.buffer.toString('utf8');
  const rows = parseCsvText(text);
  const warnings = [
    'Coinbase gain/loss reports are already lot-level tax data. Split preserves those matched lot slices instead of recomputing FIFO from exchange activity.',
  ];

  const headerRowIndex = findHeaderRowIndex(rows);

  if (headerRowIndex < 0) {
    return {
      accepted: false,
      rejectionReason: buildRequiredHeaderError(rows[0] || []),
    };
  }

  const headerRow = rows[headerRowIndex];
  const headerMap = buildHeaderMap(headerRow);
  const bodyRows = rows.slice(headerRowIndex + 1).filter((row) => row.some((cell) => toTrimmedString(cell)));
  const normalizedRecords = [];
  const detectedIdentifiers = [
    createDetectedIdentifier({
      identifierType: 'account_label',
      value: 'Coinbase BTC',
      label: 'Account',
      note: 'Synthetic wallet label for Coinbase gain/loss report rows.',
      sourceDocumentIds: [documentId],
      sourceDocumentNames: [file.originalname],
    }),
  ];

  bodyRows.forEach((row, rowIndex) => {
    const sourceRowNumber = headerRowIndex + rowIndex + 2;
    const transactionType = toTrimmedString(row[headerMap[normalizeHeader('Transaction Type')]]);
    const transactionId = toTrimmedString(row[headerMap[normalizeHeader('Transaction ID')]]) || null;
    const taxLotId = toTrimmedString(row[headerMap[normalizeHeader('Tax lot ID')]]) || null;
    const assetSymbol = normalizeAssetSymbol(row[headerMap[normalizeHeader('Asset name')]]);
    const quantitySats = parseBtcToSats(row[headerMap[normalizeHeader('Amount')]]);
    const dateAcquired = parseCoinbaseReportDate(row[headerMap[normalizeHeader('Date Acquired')]]);
    const costBasisCents = parseUsdCents(row[headerMap[normalizeHeader('Cost basis (USD)')]]); 
    const dateDisposed = parseCoinbaseReportDate(row[headerMap[normalizeHeader('Date of Disposition')]]);
    const proceedsCents = parseUsdCents(row[headerMap[normalizeHeader('Proceeds (USD)')]]);

    if (assetSymbol !== 'BTC') {
      return;
    }

    if (!quantitySats || !dateAcquired || !dateDisposed || !Number.isFinite(costBasisCents) || !Number.isFinite(proceedsCents)) {
      warnings.push(`Skipped row ${sourceRowNumber} in ${file.originalname} because the Coinbase gain/loss row was incomplete.`);
      return;
    }

    normalizedRecords.push(
      ...buildSyntheticRecords({
        documentId,
        sourceRowNumber,
        rowData: {
          transactionType,
          transactionId,
          taxLotId,
          quantitySats,
          dateAcquired,
          costBasisCents,
          dateDisposed,
          proceedsCents,
        },
      })
    );
  });

  if (!normalizedRecords.length) {
    return {
      accepted: false,
      rejectionReason: 'Coinbase gain/loss CSV was recognized, but no BTC tax-lot rows could be normalized from it.',
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
      matchedTaxLotRows: normalizedRecords.length / 2,
      skippedRows: Math.max(0, bodyRows.length - normalizedRecords.length / 2),
      totalRows: bodyRows.length,
      sourceDisplayName: source.displayName,
    },
  };
}

module.exports = parseCoinbaseGainLossCsvDocument;
