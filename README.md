# split_bitcoin_tax_prep

Standalone beta web app for uploading supported Bitcoin tax documents, reviewing wallet ownership and outgoing sends, and downloading a draft tax packet with filled IRS support files.

## Beta Status

This project is in beta and is intended for testing and feedback.

- Output is draft tax-prep support only.
- All files, forms, and calculations should be reviewed with a qualified tax professional before any reporting or filing use.
- Supported source coverage is still expanding.

## Project Design

- No LLM is used to extract data from uploaded documents or to perform tax calculations.
- Provider-specific parsers and deterministic calculation logic are used instead.
- This is intentional so uploaded financial data is not routed through external AI companies for document extraction or tax math.

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Start the app:

```bash
npm run dev
```

3. Open:

```text
http://localhost:5050/bitcoin-tax
```

## Run Tests

```bash
npm test
```

## Included Feature Flow

- Upload supported CSV and PDF files
- Accept or reject each upload immediately
- Mark wallets and addresses you own
- Review outgoing send transactions and mark real spending
- Generate a draft tax packet download

## Tested And Verified Sources

- Split CSV
- Cash App 1099 form
- Cash App transaction CSV
- Strike CSV

## Contributing

- Contribution guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- Parser guide: [docs/parser-contribution-guide.md](docs/parser-contribution-guide.md)
- Starter issue roadmap: [docs/issue-roadmap.md](docs/issue-roadmap.md)
