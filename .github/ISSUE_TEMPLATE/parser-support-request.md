---
name: Parser support request
about: Track a provider-specific parser or parser improvement
title: "Parser support: "
labels: parser
assignees: ""
---

## Provider

Example: Coinbase, Kraken, Gemini, Cash App

## File Format

Example: CSV, XLSX, 1099-DA PDF

## Official Documentation

Link the provider's official export or tax-form documentation here.

## What We Need To Extract

- Record types:
- Timestamp:
- BTC quantity:
- USD proceeds or basis:
- Fees:
- Account or wallet identifiers:
- Transaction ID or reference:

## Detection Rules

- Expected filename patterns:
- Expected headers or PDF text anchors:

## Acceptance Criteria

- [ ] The parser recognizes the intended provider format
- [ ] The parser rejects mismatched layouts cleanly
- [ ] The parser emits normalized BTC rows only when supported
- [ ] The parser returns warnings for skipped rows
- [ ] Ambiguous outgoing movements are not over-classified as spending

## Notes

Use the parser guide in `docs/parser-contribution-guide.md` and the Cash App parsers as the main examples.
