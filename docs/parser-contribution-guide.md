# Parser Contribution Guide

This project accepts provider-specific parsers for Bitcoin tax documents.

The best model to follow right now is:

- CSV example: [cashAppCsvParser.js](../bitcoinTax/parsers/cashAppCsvParser.js)
- PDF example: [cashApp1099PdfParser.js](../bitcoinTax/parsers/cashApp1099PdfParser.js)

## Goal

A parser should take one recognized document and turn it into a deterministic normalized result:

- `accepted: true` with `normalizedRecords`, `detectedIdentifiers`, `warnings`, and `parseSummary`
- or `accepted: false` with a clear `rejectionReason`

## Provider Parser Checklist

1. Recognize the source cleanly
2. Require the key columns or text anchors
3. Normalize only rows the document actually supports
4. Reject unsupported or ambiguous layouts
5. Return warnings for skipped rows

## Parser Contract

Each parser receives:

- `documentId`
- `file`
- `inspection`
- `source`

Each parser should return one of:

```js
{
  accepted: false,
  rejectionReason: 'Clear reason here.',
}
```

or:

```js
{
  accepted: true,
  normalizedRecords: [],
  detectedIdentifiers: [],
  warnings: [],
  parseSummary: {
    parsedRows: 0,
    skippedRows: 0,
    totalRows: 0,
    sourceDisplayName: source.displayName,
  },
}
```

## Normalized Record Rules

Use [createNormalizedRecord](../bitcoinTax/normalizedSchema.js) for every output row.

Important fields:

- `recordType`
- `occurredAt`
- `assetSymbol`
- `quantitySats`
- `fiatAmountCents`
- `feeAmountCents`
- `fromIdentifier`
- `toIdentifier`
- `txid`
- `note`

Do not infer facts the file does not prove.

Examples:

- If a file proves a BTC buy, emit `buy`
- If a file proves a BTC sale/disposition, emit `sell`
- If a file only proves an outgoing BTC movement, emit `send`
- If a file only proves an incoming BTC movement, emit `receive`

## Detected Identifier Rules

Use [createDetectedIdentifier](../bitcoinTax/normalizedSchema.js) for any wallet, account, or address identifier we can show back to the user.

Examples:

- account label like `Cash App BTC`
- wallet label from an export
- blockchain address when present

## CSV Parser Pattern

The Cash App CSV parser is a good model:

1. define header aliases
2. require the minimum needed headers
3. map the provider’s transaction types to normalized record types
4. parse row by row
5. skip rows that do not match the supported bitcoin shapes
6. return accepted only if at least one normalized row was created

## PDF Parser Pattern

The Cash App 1099 parser is a good model:

1. extract PDF text from `inspection.pdfLines` or `extractPdfStrings`
2. verify provider-specific layout anchors
3. extract only the supported row shape
4. fall back to a lower-confidence summary parse only when needed
5. reject the file if no supported disposition rows can be extracted

## Where To Wire A New Parser

### 1. Source registry

Add the provider source in [sourceRegistry.js](../bitcoinTax/sourceRegistry.js):

- `sourceId`
- `displayName`
- `implemented`
- `parserId`
- `acceptedExtensions`
- `filenamePatterns`
- `headerHints` or `textPatterns`

### 2. Parser registry

Register the parser in [parserRegistry.js](../bitcoinTax/parserRegistry.js).

### 3. Parser module

Create the implementation under [bitcoinTax/parsers](../bitcoinTax/parsers).

## Acceptance Criteria For A New Parser

A parser is ready to merge when:

- it recognizes the intended provider format
- it rejects the wrong shape cleanly
- it emits normalized BTC rows only when supported
- it returns warnings for skipped rows
- it does not over-classify ambiguous movements

## Starter Code Templates

- [providerCsvParser.example.js](../bitcoinTax/parsers/providerCsvParser.example.js)
- [provider1099PdfParser.example.js](../bitcoinTax/parsers/provider1099PdfParser.example.js)
