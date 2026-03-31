const Big = require('big.js');

function toTrimmedString(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

function cleanNumberString(value) {
  const trimmed = toTrimmedString(value);
  const isParenthesizedNegative = /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed
    .replace(/^\((.*)\)$/, '$1')
    .replace(/[$,%]/g, '')
    .replace(/,/g, '')
    .replace(/\b(?:BTC|XBT|BITCOIN|USD)\b/gi, '')
    .replace(/\s+/g, '');

  if (isParenthesizedNegative && cleaned && !cleaned.startsWith('-')) {
    return `-${cleaned}`;
  }

  return cleaned;
}

function parseDecimalString(value) {
  const cleaned = cleanNumberString(value);

  if (!cleaned || cleaned === '-' || cleaned === '.') {
    return null;
  }

  try {
    return new Big(cleaned).toString();
  } catch (_) {
    return null;
  }
}

function parseIntegerString(value) {
  const decimal = parseDecimalString(value);

  if (!decimal) {
    return null;
  }

  try {
    return new Big(decimal).round(0, 0).toString();
  } catch (_) {
    return null;
  }
}

function parseUsdCents(value) {
  const decimal = parseDecimalString(value);

  if (!decimal) {
    return null;
  }

  try {
    return Number(new Big(decimal).times(100).round(0, 0).toString());
  } catch (_) {
    return null;
  }
}

function parseBtcToSats(value) {
  const decimal = parseDecimalString(value);

  if (!decimal) {
    return null;
  }

  try {
    return new Big(decimal).times(100000000).round(0, 0).toString();
  } catch (_) {
    return null;
  }
}

function parseDateToIso(value) {
  const trimmed = toTrimmedString(value);

  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function normalizeAssetSymbol(value) {
  const trimmed = toTrimmedString(value).toUpperCase();

  if (!trimmed) {
    return null;
  }

  if (trimmed.includes('BITCOIN') || trimmed.includes(' BTC')) {
    return 'BTC';
  }

  if (trimmed === 'XBT') {
    return 'BTC';
  }

  if (trimmed.includes('BTC')) {
    return 'BTC';
  }

  return trimmed.replace(/[^A-Z0-9-]/g, '') || null;
}

module.exports = {
  normalizeAssetSymbol,
  parseBtcToSats,
  parseDateToIso,
  parseDecimalString,
  parseIntegerString,
  parseUsdCents,
  toTrimmedString,
};
