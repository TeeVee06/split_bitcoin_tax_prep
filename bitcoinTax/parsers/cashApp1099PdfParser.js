const { createDetectedIdentifier, createNormalizedRecord } = require('../normalizedSchema');
const { parseBtcToSats, parseDateToIso, parseUsdCents } = require('../valueUtils');
const { extractPdfStrings, splitPdfLines } = require('./pdfTextUtils');

const ACCOUNT_LABEL = 'Cash App BTC';
const DETAIL_ROW_MATCHER = /(\d{2}-\d{2}-\d{4})\s+([0-9.]+)\s+BTC\b.*?\$([0-9,]+\.\d{2})/g;

function parseCashApp1099PdfDocument({ documentId, file, inspection, source }) {
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

  if (!/(FORM 1099-DA|DIGITAL ASSET PROCEEDS FROM BROKER TRANSACTIONS)/i.test(joined) || !/(BLOCK, INC\.|SQUARE, INC\.|CASH APP)/i.test(joined)) {
    return {
      accepted: false,
      rejectionReason: `${source.displayName} did not match the expected Cash App 1099-DA layout.`,
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
        note: 'Cash App Form 1099-DA detail row',
      })
    );
  }

  if (!normalizedRecords.length) {
    const quantityMatch = joined.match(/1c Number of units\s+([0-9.]+)/i);
    const soldDateMatch = joined.match(/1e Date sold or disposed\s+(\d{2}\/\d{2}\/\d{4})/i);
    const proceedsMatch = joined.match(/1f Proceeds\s+([0-9,]+\.\d{2})/i);

    if (quantityMatch && soldDateMatch && proceedsMatch) {
      normalizedRecords.push(
        createNormalizedRecord({
          sourceDocumentId: documentId,
          sourceRowNumber: 1,
          recordType: 'sell',
          occurredAt: parseDateToIso(soldDateMatch[1]),
          assetSymbol: 'BTC',
          quantitySats: parseBtcToSats(quantityMatch[1]),
          fiatAmountCents: parseUsdCents(proceedsMatch[1]),
          note: 'Cash App Form 1099-DA summary row',
        })
      );
      warnings.push('Cash App 1099-DA detail table was not isolated, so the parser used the form summary fields instead.');
    }
  }

  if (!normalizedRecords.length) {
    return {
      accepted: false,
      rejectionReason: `${source.displayName} was recognized, but no Cash App bitcoin disposition rows could be extracted from the sample layout.`,
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

module.exports = parseCashApp1099PdfDocument;
