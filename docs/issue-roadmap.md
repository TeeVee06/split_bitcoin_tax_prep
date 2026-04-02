# Issue Roadmap Draft

These are good starter issues to create in GitHub when the repo is ready.

## Parser Support Issues

1. `Parser support: Coinbase CSV`
   Official docs: Coinbase transaction history / reports
   Acceptance criteria: recognize Coinbase CSV, normalize BTC buy/sell/send/receive rows, reject mismatched layouts cleanly.

2. `Parser support: Kraken CSV`
   Official docs: Kraken account history export
   Acceptance criteria: recognize Kraken CSV exports, normalize BTC trade and movement rows, reject unsupported layouts cleanly.

3. `Evaluate safe Gemini import support`
   Official docs: Gemini transaction history export
   Acceptance criteria: choose a maintained parser library, document the security posture, and only re-enable Gemini imports once the dependency is acceptable for untrusted uploads.

4. `Parser support: Coinbase 1099-DA PDF`
   Official docs: Coinbase tax form guidance
   Acceptance criteria: detect provider layout anchors, extract supported BTC disposition rows, reject unsupported layouts.

5. `Parser support: Robinhood 1099-DA PDF`
   Official docs: Robinhood tax form guidance
   Acceptance criteria: detect provider layout anchors, extract supported BTC disposition rows, reject unsupported layouts.

6. `Parser support: River CSV`
   Official docs: River account activity export
   Acceptance criteria: recognize River CSV, normalize BTC buy/send/receive rows, reject unsupported layouts.

7. `Parser support: Fold Bitcoin CSV`
   Official docs: Fold bitcoin transaction history export
   Acceptance criteria: recognize Fold CSV, normalize supported BTC rows, reject unsupported layouts.

## Confirmation Issues

8. `Confirm export format: Swan Bitcoin transaction CSV`
   Goal: verify the exact officially documented Swan export shape before treating it as tested support.

## Quality Issues

9. `Add fixture-based parser tests`
    Goal: define a stable test approach for provider-specific parsers.

10. `Improve wallet/address extraction review`
    Goal: make wallet ownership review clearer without adding invasive data collection.

11. `Improve outgoing send review UX`
    Goal: make unresolved sends faster to review at scale.
