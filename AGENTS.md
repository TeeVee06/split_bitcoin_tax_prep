# AGENTS.md

## Optional Internal Context

- Internal Split agents with access to the full project folder may also review `PROJECT_MAP_INTERNAL.md` at the project root for cross-repo context.
- External contributors and public-only review agents should ignore that file. This repo's `AGENTS.md` is the complete repo-local guidance.

This file is for coding agents working in `split_bitcoin_tax_prep`.

It complements, but does not replace:

- `README.md`
- `CONTRIBUTING.md`
- `docs/parser-contribution-guide.md`

## Project Purpose

This repository is a standalone beta web app for Bitcoin tax-prep support.

The app lets a user:

1. Upload supported CSV and PDF tax documents
2. Review which wallets and addresses belong to them
3. Review outgoing BTC sends and mark true spending
4. Generate a draft download package with tax-support files and filled IRS form outputs

This project is intentionally deterministic.

- Do not add LLM-based extraction
- Do not add AI-based tax calculations
- Do not route uploaded financial documents through external AI services

## Repository URL

- GitHub: `https://github.com/TeeVee06/split_bitcoin_tax_prep`

## Project Relationships

This repo has two important roles at once:

- it is a real open-source project intended for outside developer contributions
- it is also the upstream standalone version of the Bitcoin tax-prep flow that is hosted inside the private `Split` backend

Unlike the public mirror repos, this repository is meant to accept meaningful outside contributions when they fit the project goals.

## Internal Context For Split Agents

Some instructions in this file describe the relationship between this standalone repo and the private hosted copy inside `Split`.

- Those relationship and sync instructions are for internal Split agents and maintainers.
- External contributors and external review agents should treat them as project context, not as a required contribution workflow.
- Outside contributors are not expected to update the private `Split` backend repo themselves.

## Release And Sync Rules

- Changes pushed to `main` in this repo are public releases.
- For internal Split agents: when behavior, parser support, route flow, templates, or UI changes here, the hosted `Split` backend version must also be updated.
- Do not treat the hosted backend copy as automatically synced.
- For internal Split agents: if you change tax-prep logic here and do not also update the backend copy, call that out explicitly.
- External contributors should note when a change appears likely to require hosted-backend sync, but they are not responsible for performing that private-repo update.

The hosted backend copy currently lives primarily in:

- `Split/bitcoinTax/`
- `Split/routes/BitcoinTaxRoutes.js`
- `Split/views/BitcoinTax.ejs`

If the standalone app changes its web surface, also verify whether matching assets or route wiring in `Split` need to change.

## Local Setup

From the repo root:

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:5050/bitcoin-tax
```

Production-style start:

```bash
npm start
```

Environment notes:

- Node: `>=18`
- Default port: `5050`
- Static assets: `public/`
- Main route: `/bitcoin-tax`

## How To Use The App

The current user flow is step-based:

1. Upload source documents
2. Continue to wallet review
3. Mark owned wallets and addresses
4. Review outgoing sends and mark true spending
5. Generate and download the draft packet

Important behavior:

- Uploads are parsed immediately
- Unsupported files should be rejected clearly
- Wallet review is used to suppress self-transfers
- BTC sends should not automatically be treated as taxable spending unless the source file proves it or the user marks it as spending

## Core File Map

Server and routes:

- `server.js`
- `routes/BitcoinTaxRoutes.js`

Primary UI:

- `views/BitcoinTax.ejs`
- `public/css/BitcoinTax.css`

Tax engine and packaging:

- `bitcoinTax/calculationEngine.js`
- `bitcoinTax/formMapping.js`
- `bitcoinTax/irsPdfBuilder.js`
- `bitcoinTax/packageBuilder.js`

Session and normalized data:

- `bitcoinTax/sessionStore.js`
- `bitcoinTax/normalizedSchema.js`
- `bitcoinTax/valueUtils.js`

Parser wiring:

- `bitcoinTax/sourceRegistry.js`
- `bitcoinTax/parserRegistry.js`
- `bitcoinTax/parsers/`

Parser examples:

- `bitcoinTax/parsers/cashAppCsvParser.js`
- `bitcoinTax/parsers/cashApp1099PdfParser.js`
- `bitcoinTax/parsers/providerCsvParser.example.js`
- `bitcoinTax/parsers/provider1099PdfParser.example.js`

Reference docs:

- `README.md`
- `CONTRIBUTING.md`
- `docs/parser-contribution-guide.md`
- `docs/issue-roadmap.md`

Hosted-copy relationship:

- This repo contains the standalone tax-prep app.
- The private `Split` backend contains an embedded/hosted version of the same tax-prep flow.
- Internal Split agents should preserve functional parity between the standalone repo and the hosted backend copy unless the user explicitly wants them to diverge.

## Current Supported Flow And Assumptions

The app currently centers on:

- explicit BTC buy rows becoming FIFO acquisition lots
- explicit sell rows and user-marked spending rows becoming dispositions
- self-transfer suppression after owned wallet review
- draft outputs for support and beta testing, not final filing without professional review

If a proposed change weakens those assumptions, stop and rethink it before editing.

## Agent Rules For Contributions

### 1. Preserve deterministic tax behavior

- Do not guess when the source document is ambiguous
- Fail closed when the file shape is unclear
- Reject unsupported layouts instead of stretching a parser to fit them

### 2. Prefer provider-specific parsers

- Do not widen `genericExchangeCsvParser.js` when the format is really provider-specific
- Add a dedicated parser when a provider has its own stable export layout

### 3. Respect normalized record intent

- Use `createNormalizedRecord()` and `createDetectedIdentifier()`
- Do not build raw record objects by hand
- Preserve what the file actually proves

Examples:

- proven BTC buy -> `buy`
- proven BTC sell/disposition -> `sell`
- proven outgoing BTC movement only -> `send`
- proven incoming BTC movement only -> `receive`

### 4. Keep UI phases aligned with route phases

If you change the UX flow, verify the route/session phases still make sense:

- `upload`
- `wallet-review`
- `send-review`
- `calculation-ready`

Do not create a UI that implies logic the backend does not support.

### 5. Keep the beta warning intent intact

This app is still a beta testing tool.

- Do not remove the cautionary framing
- Do not present draft output as final tax filing output
- Keep language clear that users should review results with a qualified tax professional

### 6. Update coverage metadata when support changes

If you add or materially improve a parser:

- update `bitcoinTax/sourceRegistry.js`
- update `bitcoinTax/parserRegistry.js`
- update docs if the provider becomes tested and verified

If a source is only supported in theory, do not mark it as tested.

### 7. Preserve standalone and hosted parity for internal Split work

- If you are working as an internal Split agent and you change parsing, calculation, route flow, session behavior, templates, or package output here, assume the backend-hosted copy in `Split` probably needs the same change.
- If you are working as an internal Split agent, do not silently leave the standalone repo ahead of the hosted version without telling the user.
- If a change is meant to stay standalone-only, say that explicitly.

## Parser Contribution Workflow

When adding a parser:

1. Add or confirm the source in `bitcoinTax/sourceRegistry.js`
2. Add the parser under `bitcoinTax/parsers/`
3. Register it in `bitcoinTax/parserRegistry.js`
4. Reject wrong shapes clearly
5. Return warnings for skipped rows
6. Update docs if support status changed

Use the detailed guide in `docs/parser-contribution-guide.md`.

## UI Contribution Workflow

When adjusting the interface:

- keep the flow simple and step-based
- avoid duplicate controls or repeated sidebars
- keep supported-document guidance visible on upload
- keep review screens focused on one decision at a time
- prefer adding a new step over cramming more logic into one screen

## Package Output Expectations

Agents should preserve the draft packet behavior:

- draft CSV outputs
- Form 8949 support files
- Schedule D support files
- filled PDF outputs where supported by the templates

Known nuance:

- `pdf-lib` may warn about stripping XFA data from IRS templates
- treat that as a PDF-template compatibility concern, not a tax-math concern

## Before Finishing A Change

An agent should try to verify:

- the app still starts locally
- uploads still parse
- wallet review still works
- send review still works
- draft calculations still generate
- if you are acting as an internal Split agent, the hosted `Split` backend copy is either updated too or explicitly noted as needing sync

If runtime verification is not possible, say so explicitly and describe what was verified by source review only.

## Good First Places To Read

If you are new to this repo, read files in this order:

1. `README.md`
2. `CONTRIBUTING.md`
3. `routes/BitcoinTaxRoutes.js`
4. `views/BitcoinTax.ejs`
5. `bitcoinTax/sessionStore.js`
6. `bitcoinTax/calculationEngine.js`
7. `docs/parser-contribution-guide.md`
