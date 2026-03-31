function parseCsvText(text) {
  const rows = [];
  let currentField = '';
  let currentRow = [];
  let inQuotes = false;

  function pushField() {
    currentRow.push(currentField);
    currentField = '';
  }

  function pushRow() {
    const hasContent = currentRow.some((field) => String(field || '').trim() !== '');

    if (hasContent) {
      rows.push(currentRow);
    }

    currentRow = [];
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentField += '"';
        index += 1;
        continue;
      }

      if (char === '"') {
        inQuotes = false;
        continue;
      }

      currentField += char;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      pushField();
      continue;
    }

    if (char === '\n') {
      pushField();
      pushRow();
      continue;
    }

    if (char === '\r') {
      if (nextChar === '\n') {
        index += 1;
      }

      pushField();
      pushRow();
      continue;
    }

    currentField += char;
  }

  if (currentField !== '' || currentRow.length) {
    pushField();
    pushRow();
  }

  return rows;
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildHeaderMap(headerRow) {
  const headerMap = {};

  headerRow.forEach((headerValue, index) => {
    const normalized = normalizeHeader(headerValue);

    if (normalized && headerMap[normalized] === undefined) {
      headerMap[normalized] = index;
    }
  });

  return headerMap;
}

function findFirstHeaderMatch(headerMap, aliases) {
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);

    if (headerMap[normalizedAlias] !== undefined) {
      return normalizedAlias;
    }
  }

  return null;
}

function getCellValue(row, headerMap, aliases) {
  const matchedHeader = findFirstHeaderMatch(headerMap, aliases);

  if (!matchedHeader) {
    return null;
  }

  const index = headerMap[matchedHeader];

  if (index === undefined || !Array.isArray(row)) {
    return null;
  }

  return row[index] ?? null;
}

function rowToObject(headerRow, row) {
  return headerRow.reduce((accumulator, headerValue, index) => {
    accumulator[String(headerValue || '').trim() || `column_${index + 1}`] = row[index] ?? '';
    return accumulator;
  }, {});
}

module.exports = {
  buildHeaderMap,
  findFirstHeaderMatch,
  getCellValue,
  normalizeHeader,
  parseCsvText,
  rowToObject,
};
