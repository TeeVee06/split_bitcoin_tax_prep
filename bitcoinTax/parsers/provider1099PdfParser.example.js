const { createDetectedIdentifier, createNormalizedRecord } = require('../normalizedSchema');
const { parseBtcToSats, parseDateToIso, parseUsdCents } = require('../valueUtils');
const { extractPdfStrings, splitPdfLines } = require('./pdfTextUtils');

const ACCOUNT_LABEL = 'Provider BTC';
const DETAIL_ROW_MATCHER = /(\d{2}-\d{2}-\d{4})\s+([0-9.]+)\s+BTC\b.*?\$([0-9,]+\.\d{2})/g;

function parseProvider1099PdfDocument({ documentId, file, inspection, source }) {
  let lines;

  try {
    lines = Array.isArray(inspection?.pdfLines) && inspection.pdfLines.length
      ? inspection.pdfLines
      : splitPdfLines(extractPdfStrings(file.buffer));
  } catch (_) {
    return {
      accepted: false,
      rejectionReason: `Unable to read extractable text from ${source.displayName}.`,
    };
  }

  const joined = lines.join('\n');

  if (!/1099/i.test(joined) || !/DIGITAL ASSET|1099-DA|BROKER/i.test(joined) || !/PROVIDER NAME HERE/i.test(joined)) {
    return {
      accepted: false,
      rejectionReason: `${source.displayName} did not match the expected provider-specific 1099 layout.`,
    };
  }

  const normalizedRecords = [];
  const warnings = [];
  const detectedIdentifiers = [
    createDetectedIdentifier({
      identifierType: 'account_label',
      value: ACCOUNT_LABEL,
      label: 'Account',
      sourceDocumentIds: [documentId],
      sourceDocumentNames: [file.originalname],
    }),
  ];

  let detailMatch;

  while ((detailMatch = DETAIL_ROW_MATCHER.exec(joined)) !== null) {
    const [, soldDate, quantityText, proceedsText] = detailMatch;
    const occurredAt = parseDateToIso(soldDate);
    const quantitySats = parseBtcToSats(quantityText);
    const fiatAmountCents = parseUsdCents(proceedsText);

    if (!occurredAt || !quantitySats || !fiatAmountCents) {
      continue;
    }

    normalizedRecords.push(
      createNormalizedRecord({
        sourceDocumentId: documentId,
        sourceRowNumber: normalizedRecords.length + 1,
        recordType: 'sell',
        occurredAt,
        assetSymbol: 'BTC',
        quantitySats,
        fiatAmountCents,
        note: `${source.displayName} detail row`,
      })
    );
  }

  if (!normalizedRecords.length) {
    warnings.push(`${source.displayName} was recognized, but no supported detail rows were isolated.`);
    return {
      accepted: false,
      rejectionReason: `${source.displayName} was recognized, but no supported bitcoin disposition rows could be extracted.`,
    };
  }

  return {
    accepted: true,
    normalizedRecords,
    detectedIdentifiers,
    warnings,
    parseSummary: {
      parsedRows: normalizedRecords.length,
      skippedRows: 0,
      totalRows: lines.length,
      sourceDisplayName: source.displayName,
      extractionConfidence: warnings.length ? 'medium' : 'high',
    },
  };
}

module.exports = parseProvider1099PdfDocument;
