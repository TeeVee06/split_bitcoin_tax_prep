const path = require('path');
const parseCashApp1099PdfDocument = require('./parsers/cashApp1099PdfParser');
const parseCashAppCsvDocument = require('./parsers/cashAppCsvParser');
const { buildHeaderMap, normalizeHeader, parseCsvText } = require('./csvUtils');
const parseCoinbase1099PdfDocument = require('./parsers/coinbase1099PdfParser');
const { extractPdfStrings, splitPdfLines } = require('./parsers/pdfTextUtils');
const { listDocumentSources } = require('./sourceRegistry');
const parseGenericExchangeCsvDocument = require('./parsers/genericExchangeCsvParser');
const parseGeneric1099PdfDocument = require('./parsers/generic1099PdfParser');
const parseRobinhood1099PdfDocument = require('./parsers/robinhood1099PdfParser');
const parseSplitCsvDocument = require('./parsers/splitCsvParser');

const parserRegistry = {
  cash_app_1099_pdf: parseCashApp1099PdfDocument,
  cash_app_csv: parseCashAppCsvDocument,
  coinbase_1099_pdf: parseCoinbase1099PdfDocument,
  generic_1099_pdf: parseGeneric1099PdfDocument,
  robinhood_1099_pdf: parseRobinhood1099PdfDocument,
  split_csv: parseSplitCsvDocument,
  generic_exchange_csv: parseGenericExchangeCsvDocument,
};

function buildTabularInspection(rows, extra = {}) {
  if (!rows.length) {
    return {
      ...extra,
      tabular: {
        headerIndexMap: {},
        headerMap: {},
        headerRow: [],
        bodyRows: [],
      },
    };
  }

  const headerRow = rows[0].map((headerCell) => String(headerCell || '').trim());
  const headerMap = buildHeaderMap(headerRow);
  const headerIndexMap = headerRow.reduce((accumulator, headerCell, index) => {
    accumulator[normalizeHeader(headerCell)] = index;
    return accumulator;
  }, {});

  return {
    ...extra,
    tabular: {
      headerIndexMap,
      headerMap,
      headerRow,
      bodyRows: rows.slice(1),
    },
  };
}

function inspectCsvFile(file) {
  const text = file.buffer.toString('utf8');
  const rows = parseCsvText(text);

  return buildTabularInspection(rows, {
    text,
  });
}

function inspectUploadedDocument(file) {
  const extension = path.extname(String(file.originalname || '')).toLowerCase();
  const lowerFilename = String(file.originalname || '').toLowerCase();

  if (extension === '.csv') {
    return {
      extension,
      lowerFilename,
      ...inspectCsvFile(file),
    };
  }

  if (extension === '.pdf') {
    try {
      const pdfText = extractPdfStrings(file.buffer);
      const pdfLines = splitPdfLines(pdfText);

      return {
        extension,
        lowerFilename,
        tabular: null,
        text: null,
        pdfText,
        pdfLines,
      };
    } catch (_) {
      return {
        extension,
        lowerFilename,
        tabular: null,
        text: null,
        pdfText: null,
        pdfLines: [],
      };
    }
  }

  return {
    extension,
    lowerFilename,
    tabular: null,
    text: null,
    pdfText: null,
    pdfLines: [],
  };
}

function scoreSourceMatch(source, inspection) {
  if (!source.acceptedExtensions.includes(inspection.extension)) {
    return -1;
  }

  let score = 1;

  source.filenamePatterns.forEach((pattern) => {
    if (pattern.test(inspection.lowerFilename)) {
      score += 4;
    }
  });

  if (inspection.tabular && Array.isArray(source.headerHints) && source.headerHints.length) {
    const headerNames = Object.keys(inspection.tabular.headerMap);
    const matchedHints = source.headerHints.filter((hint) => headerNames.includes(normalizeHeader(hint)));
    score += matchedHints.length;
  }

  if (inspection.pdfText && Array.isArray(source.textPatterns) && source.textPatterns.length) {
    const matchedPatterns = source.textPatterns.filter((pattern) => pattern.test(inspection.pdfText));
    score += matchedPatterns.length * 3;
  }

  return score;
}

function detectDocumentSource(inspection) {
  const sources = listDocumentSources();
  let bestMatch = null;

  sources.forEach((source) => {
    const score = scoreSourceMatch(source, inspection);

    if (score < 0) {
      return;
    }

    if (!bestMatch || score > bestMatch.score || (score === bestMatch.score && source.implemented && !bestMatch.source.implemented)) {
      bestMatch = {
        score,
        source,
      };
    }
  });

  return bestMatch ? bestMatch.source : null;
}

async function parseBitcoinTaxDocument({ file, documentId }) {
  const inspection = inspectUploadedDocument(file);
  const detectedSource = detectDocumentSource(inspection);

  if (!detectedSource) {
    return {
      accepted: false,
      documentId,
      rejectionReason: 'We do not recognize this document source yet.',
    };
  }

  if (!detectedSource.implemented || !detectedSource.parserId) {
    return {
      accepted: false,
      documentId,
      sourceId: detectedSource.sourceId,
      sourceDisplayName: detectedSource.displayName,
      rejectionReason: `${detectedSource.displayName} is recognized, but its parser is not implemented yet.`,
    };
  }

  const parser = parserRegistry[detectedSource.parserId];

  if (!parser) {
    return {
      accepted: false,
      documentId,
      sourceId: detectedSource.sourceId,
      sourceDisplayName: detectedSource.displayName,
      rejectionReason: `${detectedSource.displayName} is recognized, but no parser is currently available.`,
    };
  }

  const parseResult = await parser({
    documentId,
    file,
    inspection,
    source: detectedSource,
  });

  return {
    documentId,
    sourceId: detectedSource.sourceId,
    sourceDisplayName: detectedSource.displayName,
    parserId: detectedSource.parserId,
    ...parseResult,
  };
}

module.exports = {
  parseBitcoinTaxDocument,
};
