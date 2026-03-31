const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const SWIFT_EXTRACTOR_PATH = path.join(__dirname, '..', 'scripts', 'extractPdfText.swift');
const SWIFT_BINARY_PATH = path.join(os.tmpdir(), 'split_bitcoin_tax_prep_pdf_extractor');
const SWIFT_MODULE_CACHE_PATH = path.join(os.tmpdir(), 'split-swift-module-cache');

function buildSwiftEnv() {
  return {
    ...process.env,
    SWIFT_MODULECACHE_PATH: SWIFT_MODULE_CACHE_PATH,
    CLANG_MODULE_CACHE_PATH: SWIFT_MODULE_CACHE_PATH,
  };
}

function ensureSwiftExtractorBinary() {
  if (!fs.existsSync(SWIFT_EXTRACTOR_PATH) || !fs.existsSync('/usr/bin/swiftc')) {
    return null;
  }

  try {
    const scriptStats = fs.statSync(SWIFT_EXTRACTOR_PATH);
    const binaryStats = fs.existsSync(SWIFT_BINARY_PATH)
      ? fs.statSync(SWIFT_BINARY_PATH)
      : null;

    if (!binaryStats || binaryStats.mtimeMs < scriptStats.mtimeMs) {
      execFileSync('/usr/bin/swiftc', [SWIFT_EXTRACTOR_PATH, '-o', SWIFT_BINARY_PATH], {
        encoding: 'utf8',
        env: buildSwiftEnv(),
        maxBuffer: 1024 * 1024 * 20,
        timeout: 30000,
      });
    }

    return SWIFT_BINARY_PATH;
  } catch (_) {
    return null;
  }
}

function extractPdfTextWithSwift(tempPath) {
  const binaryPath = ensureSwiftExtractorBinary();

  if (binaryPath && fs.existsSync(binaryPath)) {
    return execFileSync(binaryPath, [tempPath], {
      encoding: 'utf8',
      env: buildSwiftEnv(),
      maxBuffer: 1024 * 1024 * 20,
      timeout: 30000,
    });
  }

  if (!fs.existsSync(SWIFT_EXTRACTOR_PATH) || !fs.existsSync('/usr/bin/swift')) {
    return '';
  }

  return execFileSync('/usr/bin/swift', [SWIFT_EXTRACTOR_PATH, tempPath], {
    encoding: 'utf8',
    env: buildSwiftEnv(),
    maxBuffer: 1024 * 1024 * 20,
    timeout: 30000,
  });
}

function extractPdfStrings(buffer) {
  const tempPath = path.join(os.tmpdir(), `split-tax-${crypto.randomUUID()}.pdf`);

  fs.writeFileSync(tempPath, buffer);

  try {
    const swiftText = extractPdfTextWithSwift(tempPath);

    if (String(swiftText || '').trim()) {
      return swiftText;
    }

    return execFileSync('/usr/bin/strings', [tempPath], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
    });
  } finally {
    fs.unlinkSync(tempPath);
  }
}

function normalizePdfText(rawText) {
  return String(rawText || '')
    .replace(/\u0000/g, '')
    .replace(/\r/g, '\n');
}

function splitPdfLines(text) {
  return normalizePdfText(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

module.exports = {
  extractPdfStrings,
  normalizePdfText,
  splitPdfLines,
};
