const test = require('node:test');
const assert = require('node:assert/strict');

const { parseBitcoinTaxDocument } = require('../bitcoinTax/parserRegistry');

function buildUploadFile(originalname, text) {
  return {
    originalname,
    buffer: Buffer.from(text, 'utf8'),
  };
}

test('parseBitcoinTaxDocument recognizes and normalizes Strike CSV uploads', async () => {
  const strikeCsv = [
    'Reference,Date & Time (UTC),Transaction Type,Amount USD,Fee USD,Amount BTC,Fee BTC,BTC Price,Cost Basis (USD),Destination,Description,Transaction Hash',
    'ref-buy,Nov 23 2025 02:03:01,Purchase,100.00,0.98,0.00115043,0.00000000,86894.12,100.00,,Recurring buy,',
    'ref-send,Dec 01 2025 11:05:10,Send,25.00,0.10,-0.00025000,0.00000000,100000.00,,bc1qexampledestination0000000000000000000000,Sent to wallet,abc123',
    'ref-receive,Dec 15 2025 14:30:22,Receive,12.50,0.00,0.00012500,0.00000000,100000.00,,,Received from friend,def456',
    'ref-deposit,Dec 20 2025 08:00:00,Deposit,100.00,0.00,0.00000000,0.00000000,0.00,0.00,,USD deposit,',
  ].join('\n');

  const result = await parseBitcoinTaxDocument({
    documentId: 'doc-strike-1',
    file: buildUploadFile('2025 annual transactions.csv', strikeCsv),
  });

  assert.equal(result.accepted, true);
  assert.equal(result.sourceId, 'strike_csv');
  assert.equal(result.sourceDisplayName, 'Strike CSV');
  assert.equal(result.parserId, 'strike_csv');
  assert.equal(result.normalizedRecords.length, 3);
  assert.equal(result.parseSummary.parsedRows, 3);
  assert.equal(result.parseSummary.totalRows, 4);

  const [buyRecord, sendRecord, receiveRecord] = result.normalizedRecords;

  assert.equal(buyRecord.recordType, 'buy');
  assert.equal(buyRecord.occurredAt, '2025-11-23T02:03:01.000Z');
  assert.equal(buyRecord.quantitySats, '115043');
  assert.equal(buyRecord.fiatAmountCents, 10000);
  assert.equal(buyRecord.feeAmountCents, 98);
  assert.equal(buyRecord.toIdentifier, 'Strike BTC');

  assert.equal(sendRecord.recordType, 'send');
  assert.equal(sendRecord.quantitySats, '25000');
  assert.equal(sendRecord.fromIdentifier, 'Strike BTC');
  assert.equal(sendRecord.toIdentifier, 'bc1qexampledestination0000000000000000000000');
  assert.equal(sendRecord.txid, 'abc123');

  assert.equal(receiveRecord.recordType, 'receive');
  assert.equal(receiveRecord.quantitySats, '12500');
  assert.equal(receiveRecord.toIdentifier, 'Strike BTC');
  assert.equal(receiveRecord.txid, 'def456');

  assert.ok(
    result.detectedIdentifiers.some((identifier) => identifier.value === 'Strike BTC')
  );
  assert.ok(
    result.detectedIdentifiers.some((identifier) => identifier.value === 'bc1qexampledestination0000000000000000000000')
  );
});

test('parseBitcoinTaxDocument fails closed for malformed Strike CSVs', async () => {
  const malformedStrikeCsv = [
    'Reference,Transaction Type,Amount USD',
    'ref-buy,Purchase,100.00',
  ].join('\n');

  const result = await parseBitcoinTaxDocument({
    documentId: 'doc-strike-2',
    file: buildUploadFile('strike annual transactions.csv', malformedStrikeCsv),
  });

  assert.equal(result.accepted, false);
  assert.equal(result.sourceId, 'strike_csv');
  assert.match(result.rejectionReason, /Strike CSV is missing required columns/i);
  assert.match(result.rejectionReason, /Date & Time \(UTC\)/);
});

test('parseBitcoinTaxDocument recognizes and normalizes Cash App bitcoin CSV uploads', async () => {
  const cashAppCsv = [
    'Transaction ID,Date,Transaction Type,Amount,Fee,Net Amount,Asset Type,Asset Amount',
    'tx-buy,2025-01-01T00:00:00Z,Bitcoin Buy,100.00,1.25,98.75,BTC,0.00100000',
    'tx-send,2025-01-02T00:00:00Z,Bitcoin Lightning Withdrawal,20.00,0.25,19.75,BTC,0.00020000',
    'tx-skip,2025-01-03T00:00:00Z,Card Purchase,12.00,0.00,12.00,USD,12.00',
  ].join('\n');

  const result = await parseBitcoinTaxDocument({
    documentId: 'doc-cash-app-1',
    file: buildUploadFile('Cash App transactions.csv', cashAppCsv),
  });

  assert.equal(result.accepted, true);
  assert.equal(result.sourceId, 'cash_app_csv');
  assert.equal(result.parserId, 'cash_app_csv');
  assert.equal(result.normalizedRecords.length, 2);
  assert.equal(result.parseSummary.parsedRows, 2);
  assert.equal(result.parseSummary.skippedRows, 1);

  const [buyRecord, sendRecord] = result.normalizedRecords;

  assert.equal(buyRecord.recordType, 'buy');
  assert.equal(buyRecord.quantitySats, '100000');
  assert.equal(buyRecord.fiatAmountCents, 10000);
  assert.equal(buyRecord.feeAmountCents, 125);
  assert.equal(buyRecord.toIdentifier, 'Cash App BTC');

  assert.equal(sendRecord.recordType, 'send');
  assert.equal(sendRecord.quantitySats, '20000');
  assert.equal(sendRecord.fiatAmountCents, 1975);
  assert.equal(sendRecord.fromIdentifier, 'Cash App BTC');
  assert.equal(sendRecord.txid, 'tx-send');

  assert.ok(
    result.warnings.some((warning) => warning.includes('supported Cash App bitcoin transaction shapes'))
  );
});

test('parseBitcoinTaxDocument recognizes and normalizes Coinbase gain/loss CSV uploads', async () => {
  const coinbaseCsv = [
    '"This report includes all taxable activity on Coinbase with realized gains or losses.",,,,,,,,,,,',
    ',,,,,,,,,,,',
    'Gain/loss report,,,,,,,,,,,',
    'User,example-user-id,test@example.com,,,,,,,,,',
    ',,,,,,,,,,,',
    'Transaction Type,Transaction ID,Tax lot ID,Asset name,Amount,Date Acquired,Cost basis (USD),Date of Disposition,Proceeds (USD),Gains (Losses) (USD),Holding period (Days),Data source',
    'Fee,fee-tx-1,lot-1,BTC,0.00000460,12/02/2025,0.417452346,12/04/2025,0.4233388551444870,0.0058865091444873900,2,Coinbase',
    'Sell,sell-tx-1,lot-2,BTC,0.00010000,11/30/2025,8.88000000,12/05/2025,9.25000000,0.37000000,5,Coinbase',
  ].join('\n');

  const result = await parseBitcoinTaxDocument({
    documentId: 'doc-coinbase-1',
    file: buildUploadFile('Coinbase-2025-CB-GAINLOSSCSV.csv', coinbaseCsv),
  });

  assert.equal(result.accepted, true);
  assert.equal(result.sourceId, 'coinbase_gain_loss_csv');
  assert.equal(result.parserId, 'coinbase_gain_loss_csv');
  assert.equal(result.normalizedRecords.length, 4);
  assert.equal(result.parseSummary.matchedTaxLotRows, 2);
  assert.equal(result.parseSummary.totalRows, 2);

  const [buyRecord, sellRecord] = result.normalizedRecords;

  assert.equal(buyRecord.recordType, 'buy');
  assert.equal(buyRecord.occurredAt, '2025-12-02T00:00:00.000Z');
  assert.equal(buyRecord.quantitySats, '460');
  assert.equal(buyRecord.fiatAmountCents, 41);
  assert.equal(buyRecord.toIdentifier, 'Coinbase BTC');

  assert.equal(sellRecord.recordType, 'sell');
  assert.equal(sellRecord.occurredAt, '2025-12-04T00:00:00.000Z');
  assert.equal(sellRecord.quantitySats, '460');
  assert.equal(sellRecord.fiatAmountCents, 42);
  assert.equal(sellRecord.fromIdentifier, 'Coinbase BTC');

  assert.ok(
    result.detectedIdentifiers.some((identifier) => identifier.value === 'Coinbase BTC')
  );
  assert.ok(
    result.warnings.some((warning) => /Coinbase gain\/loss reports are already lot-level tax data/i.test(warning))
  );
});

test('parseBitcoinTaxDocument warns when a provider file falls back to the generic CSV parser', async () => {
  const coinbaseCsv = [
    'Date,Type,Asset,Amount,Proceeds,Fee,From,To,Transaction ID,Description',
    '2025-01-01T00:00:00Z,Buy,BTC,0.00100000,100.00,1.00,,Coinbase BTC,buy-1,Recurring buy',
    '2025-01-03T00:00:00Z,Send,BTC,0.00020000,20.00,0.20,Coinbase BTC,bc1qcoinbasedestination0000000000000000000000,send-1,Sent to wallet',
  ].join('\n');

  const result = await parseBitcoinTaxDocument({
    documentId: 'doc-coinbase-2',
    file: buildUploadFile('coinbase-transactions.csv', coinbaseCsv),
  });

  assert.equal(result.accepted, true);
  assert.equal(result.sourceId, 'coinbase_csv');
  assert.equal(result.parserId, 'generic_exchange_csv');
  assert.equal(result.usedGenericParser, true);
  assert.ok(
    result.warnings.some((warning) => /generic CSV fallback, not a Coinbase-specific parser/i.test(warning))
  );
});
