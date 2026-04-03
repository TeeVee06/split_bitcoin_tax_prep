const test = require('node:test');
const assert = require('node:assert/strict');

const { summarizeSourceCoverage } = require('../bitcoinTax/sourceRegistry');

test('summarizeSourceCoverage lists Strike CSV as tested and verified', () => {
  const summary = summarizeSourceCoverage();

  assert.ok(
    summary.testedAndVerified.some((entry) => entry.sourceId === 'strike_csv' && entry.coverageLabel === 'Strike CSV')
  );
  assert.ok(
    !summary.supportedButUntested.some((entry) => entry.sourceId === 'strike_csv')
  );
  assert.ok(
    summary.testedAndVerified.some((entry) => entry.sourceId === 'coinbase_gain_loss_csv' && entry.coverageLabel === 'Coinbase gain/loss CSV')
  );
  assert.ok(
    !summary.supportedButUntested.some((entry) => entry.sourceId === 'coinbase_gain_loss_csv')
  );
});
