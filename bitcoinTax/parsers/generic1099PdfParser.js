const { build1099ParseResult } = require('./build1099Records');
const { extractPdfStrings, splitPdfLines } = require('./pdfTextUtils');

function parseGeneric1099PdfDocument({ documentId, file, inspection, source }) {
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

  if (!lines.length) {
    return {
      accepted: false,
      rejectionReason: `${source.displayName} did not contain extractable text.`,
    };
  }

  return build1099ParseResult({
    documentId,
    file,
    source,
    lines,
    providerMatchers: [],
    requiredMatchers: [/1099/i, /(DIGITAL ASSET|1099-DA|BROKER)/i],
    minimumConfidence: 'medium',
  });
}

module.exports = parseGeneric1099PdfDocument;
