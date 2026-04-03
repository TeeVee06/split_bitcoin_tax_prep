# Contributing

Thanks for considering a contribution to `split_bitcoin_tax_prep`.

## Good First Contribution Areas

- Add parser support for a provider export we already track
- Improve parsing accuracy for an existing provider
- Add fixture-based parser tests
- Improve wallet/send review UX
- Improve documentation

## Before You Start

1. Open or find an issue first.
2. Confirm the source format is officially documented or already tracked by the project.
3. Keep changes focused. One provider parser per pull request is ideal.

## Parser Contribution Rules

- Fail closed. If the file shape is unclear, reject it instead of guessing.
- Do not use an LLM for document extraction or tax calculations.
- Use provider-specific parsers and deterministic calculation logic so uploaded financial data is not routed through external AI companies for document extraction or tax math.
- Preserve raw intent. Parse outgoing movements as outgoing movements when the document does not prove they were spending.
- Use `createNormalizedRecord()` and `createDetectedIdentifier()` instead of building raw objects by hand.
- Include warnings for skipped rows.
- Prefer provider-specific parsers over widening the generic parser.

## Parser Workflow

1. Add or confirm the source entry in [bitcoinTax/sourceRegistry.js](bitcoinTax/sourceRegistry.js)
2. Add the parser module under [bitcoinTax/parsers](bitcoinTax/parsers)
3. Register the parser in [bitcoinTax/parserRegistry.js](bitcoinTax/parserRegistry.js)
4. Verify accepted and rejected behavior against the expected file shape
5. Update docs if the provider becomes tested and verified

## Parser Guide

Use the detailed parser guide in [docs/parser-contribution-guide.md](docs/parser-contribution-guide.md).

## Pull Requests

- Keep PR descriptions concrete.
- Include the provider name and file format in the PR title.
- Mention what was added, what was intentionally rejected, and any current limitations.

## Testing

- Run the local test suite before opening a pull request:

```bash
npm test
```

- If you change parser behavior, also run the parser scenario harness:

```bash
npm run test:parsers
```

- `npm run test:parsers` exercises representative CSV and PDF layouts for the supported parser set, so parser changes should usually be reflected there too.
- GitHub Actions runs the same test suite on pushes and pull requests.
- If you change parser behavior, tax calculation behavior, or the upload/review flow, add or update tests with the change.
