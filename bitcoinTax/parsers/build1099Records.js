const { createNormalizedRecord } = require('../normalizedSchema');
const {
  parseBtcToSats,
  parseDateToIso,
  parseUsdCents,
} = require('../valueUtils');

const DATE_MATCHER = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g;
const MONEY_MATCHER = /\(?\$?-?\d[\d,]*\.\d{2}\)?/g;
const BTC_INLINE_MATCHER = /\b([0-9][0-9,]*\.?[0-9]*)\s*(BTC|XBT|BITCOIN)\b/i;
const BTC_REVERSE_MATCHER = /\b(BTC|XBT|BITCOIN)\s*([0-9][0-9,]*\.?[0-9]*)\b/i;
const BITCOIN_TEXT_MATCHER = /\b(BTC|XBT|BITCOIN)\b/i;

function extractLineQuantitySats(line) {
  const forward = line.match(BTC_INLINE_MATCHER);

  if (forward) {
    return parseBtcToSats(forward[1]);
  }

  const reverse = line.match(BTC_REVERSE_MATCHER);

  if (reverse) {
    return parseBtcToSats(reverse[2]);
  }

  return null;
}

function pickOccurredAt(dateMatches) {
  if (!Array.isArray(dateMatches) || !dateMatches.length) {
    return null;
  }

  return parseDateToIso(dateMatches[dateMatches.length - 1]) || parseDateToIso(dateMatches[0]);
}

function pickFiatAmountCents(moneyMatches) {
  if (!Array.isArray(moneyMatches) || !moneyMatches.length) {
    return null;
  }

  return parseUsdCents(moneyMatches[0]);
}

function containsBitcoinText(value) {
  return BITCOIN_TEXT_MATCHER.test(String(value || ''));
}

function buildCandidateWindow(lines, startIndex) {
  return lines.slice(startIndex, startIndex + 3).join(' | ');
}

function getCandidateConfidence({ hasDates, hasMoney, hasQuantity, hasBitcoin }) {
  if (hasDates && hasMoney && (hasQuantity || hasBitcoin)) {
    return 'high';
  }

  if ((hasDates && hasMoney) || (hasMoney && (hasQuantity || hasBitcoin))) {
    return 'medium';
  }

  return 'low';
}

function buildCandidateRecord({ documentId, sourceRowNumber, primaryLine, windowText }) {
  const primaryDates = primaryLine.match(DATE_MATCHER) || [];
  const primaryMoneyMatches = primaryLine.match(MONEY_MATCHER) || [];
  const primaryQuantitySats = extractLineQuantitySats(primaryLine);
  const primaryHasBitcoin = containsBitcoinText(primaryLine);

  if (!primaryDates.length && !primaryMoneyMatches.length && !primaryQuantitySats && !primaryHasBitcoin) {
    return null;
  }

  const dates = windowText.match(DATE_MATCHER) || [];
  const moneyMatches = windowText.match(MONEY_MATCHER) || [];
  const quantitySats = extractLineQuantitySats(windowText);
  const hasBitcoin = containsBitcoinText(windowText);
  const confidence = getCandidateConfidence({
    hasDates: Boolean(dates.length),
    hasMoney: Boolean(moneyMatches.length),
    hasQuantity: Boolean(quantitySats),
    hasBitcoin,
  });

  if (confidence === 'low' || (!hasBitcoin && !quantitySats)) {
    return null;
  }

  return {
    confidence,
    record: createNormalizedRecord({
      sourceDocumentId: documentId,
      sourceRowNumber,
      recordType: 'sell',
      occurredAt: pickOccurredAt(dates),
      assetSymbol: 'BTC',
      quantitySats,
      fiatAmountCents: pickFiatAmountCents(moneyMatches),
      note: windowText,
    }),
  };
}

function dedupeCandidateRecords(candidates) {
  const seen = new Set();

  return candidates.filter((candidate) => {
    const key = [
      candidate.record.occurredAt || '',
      candidate.record.quantitySats || '',
      candidate.record.fiatAmountCents || '',
      candidate.record.note || '',
    ].join('::');

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function build1099ParseResult({
  documentId,
  file,
  source,
  lines,
  providerMatchers = [],
  requiredMatchers = [],
  minimumConfidence = 'high',
}) {
  const upperJoined = lines.join('\n').toUpperCase();
  const warnings = [];

  const providerMatched = providerMatchers.length
    ? providerMatchers.some((matcher) => matcher.test(upperJoined))
    : true;
  const requiredMatched = requiredMatchers.every((matcher) => matcher.test(upperJoined));

  if (!providerMatched || !requiredMatched) {
    return {
      accepted: false,
      rejectionReason: `${source.displayName} did not match the expected PDF markers for this provider.`,
    };
  }

  const candidateRecords = dedupeCandidateRecords(
    lines
      .map((_, index) =>
        buildCandidateRecord({
          documentId,
          sourceRowNumber: index + 1,
          primaryLine: lines[index],
          windowText: buildCandidateWindow(lines, index),
        })
      )
      .filter(Boolean)
  );
  const highConfidenceRecords = candidateRecords.filter((candidate) => candidate.confidence === 'high');
  const acceptedCandidates = minimumConfidence === 'medium'
    ? candidateRecords.filter((candidate) => candidate.confidence === 'high' || candidate.confidence === 'medium')
    : highConfidenceRecords;

  if (!acceptedCandidates.length) {
    return {
      accepted: false,
      rejectionReason: `${source.displayName} did not contain enough structured BTC transaction detail to parse safely.`,
    };
  }

  if (candidateRecords.length > acceptedCandidates.length) {
    warnings.push(
      `${candidateRecords.length - acceptedCandidates.length} low-confidence PDF row candidate${
        candidateRecords.length - acceptedCandidates.length === 1 ? '' : 's'
      } were ignored.`
    );
  }

  const normalizedRecords = acceptedCandidates.map((candidate) => candidate.record);
  const extractionConfidence = highConfidenceRecords.length === candidateRecords.length ? 'high' : 'medium';

  return {
    accepted: true,
    normalizedRecords,
    detectedIdentifiers: [],
    warnings,
    parseSummary: {
      parsedRows: normalizedRecords.length,
      skippedRows: Math.max(lines.length - normalizedRecords.length, 0),
      totalRows: lines.length,
      sourceDisplayName: source.displayName,
      extractionConfidence,
      candidateRows: candidateRecords.length,
      acceptedCandidateRows: acceptedCandidates.length,
    },
  };
}

module.exports = {
  build1099ParseResult,
};
