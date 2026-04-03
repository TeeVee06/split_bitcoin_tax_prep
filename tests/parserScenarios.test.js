const test = require('node:test');
const assert = require('node:assert/strict');

const { buildHeaderMap, parseCsvText } = require('../bitcoinTax/csvUtils');
const parseCashApp1099PdfDocument = require('../bitcoinTax/parsers/cashApp1099PdfParser');
const parseCashAppCsvDocument = require('../bitcoinTax/parsers/cashAppCsvParser');
const parseCoinbase1099PdfDocument = require('../bitcoinTax/parsers/coinbase1099PdfParser');
const parseCoinbaseGainLossCsvDocument = require('../bitcoinTax/parsers/coinbaseGainLossCsvParser');
const parseGeneric1099PdfDocument = require('../bitcoinTax/parsers/generic1099PdfParser');
const parseGenericExchangeCsvDocument = require('../bitcoinTax/parsers/genericExchangeCsvParser');
const parseRobinhood1099PdfDocument = require('../bitcoinTax/parsers/robinhood1099PdfParser');
const parseSplitCsvDocument = require('../bitcoinTax/parsers/splitCsvParser');
const parseStrikeCsvDocument = require('../bitcoinTax/parsers/strikeCsvParser');

function buildUploadFile(originalname, text) {
  return {
    originalname,
    buffer: Buffer.from(text, 'utf8'),
  };
}

function buildCsvInspection(text) {
  const rows = parseCsvText(text);
  const headerRow = rows[0];
  const headerMap = buildHeaderMap(headerRow);
  const headerIndexMap = headerRow.reduce((accumulator, headerCell, index) => {
    accumulator[String(headerCell || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()] = index;
    return accumulator;
  }, {});

  return {
    text,
    tabular: {
      headerRow,
      headerMap,
      headerIndexMap,
      bodyRows: rows.slice(1),
    },
  };
}

function buildPdfInspection(lines) {
  return {
    pdfLines: lines,
    pdfText: lines.join('\n'),
    tabular: null,
    text: null,
  };
}

const parserScenarios = [
  {
    name: 'split_csv parses spend exports',
    run: async () => {
      const csv = [
        'Date,Merchant,Sats,USD,Transaction ID,Note',
        '2025-12-01T12:00:00Z,Merchant One,2100,2.10,split-tx-1,Coffee',
        '2025-12-03T09:30:00Z,Merchant Two,5500,5.50,split-tx-2,Breakfast',
      ].join('\n');
      return parseSplitCsvDocument({
        documentId: 'scenario-split',
        file: buildUploadFile('split_spending.csv', csv),
        inspection: buildCsvInspection(csv),
        source: { displayName: 'Split spending CSV' },
      });
    },
    assertResult: (result) => {
      assert.equal(result.accepted, true);
      assert.equal(result.normalizedRecords.length, 2);
      assert.deepEqual(result.normalizedRecords.map((row) => row.recordType), ['spend', 'spend']);
    },
  },
  {
    name: 'cash_app_csv parses supported bitcoin transaction shapes',
    run: async () => {
      const csv = [
        'Transaction ID,Date,Transaction Type,Amount,Fee,Net Amount,Asset Type,Asset Amount',
        'tx-buy,2025-01-01T00:00:00Z,Bitcoin Buy,100.00,1.25,98.75,BTC,0.00100000',
        'tx-send,2025-01-02T00:00:00Z,Bitcoin Lightning Withdrawal,20.00,0.25,19.75,BTC,0.00020000',
        'tx-receive,2025-01-03T00:00:00Z,Bitcoin Lightning Deposit,12.00,0.00,12.00,BTC,0.00012000',
      ].join('\n');
      return parseCashAppCsvDocument({
        documentId: 'scenario-cashapp',
        file: buildUploadFile('cash-app.csv', csv),
        inspection: buildCsvInspection(csv),
        source: { displayName: 'Cash App Bitcoin CSV' },
      });
    },
    assertResult: (result) => {
      assert.equal(result.accepted, true);
      assert.deepEqual(result.normalizedRecords.map((row) => row.recordType), ['buy', 'send', 'receive']);
      assert.ok(result.detectedIdentifiers.some((identifier) => identifier.value === 'Cash App BTC'));
    },
  },
  {
    name: 'strike_csv parses annual transaction exports',
    run: async () => {
      const csv = [
        'Reference,Date & Time (UTC),Transaction Type,Amount USD,Fee USD,Amount BTC,Fee BTC,BTC Price,Cost Basis (USD),Destination,Description,Transaction Hash',
        'ref-buy,Nov 23 2025 02:03:01,Purchase,100.00,0.98,0.00115043,0.00000000,86894.12,100.00,,Recurring buy,',
        'ref-send,Dec 01 2025 11:05:10,Send,25.00,0.10,-0.00025000,0.00000000,100000.00,,bc1qexampledestination0000000000000000000000,Sent to wallet,abc123',
        'ref-receive,Dec 15 2025 14:30:22,Receive,12.50,0.00,0.00012500,0.00000000,100000.00,,,Received from friend,def456',
      ].join('\n');
      return parseStrikeCsvDocument({
        documentId: 'scenario-strike',
        file: buildUploadFile('2025 annual transactions.csv', csv),
        inspection: buildCsvInspection(csv),
        source: { displayName: 'Strike CSV' },
      });
    },
    assertResult: (result) => {
      assert.equal(result.accepted, true);
      assert.deepEqual(result.normalizedRecords.map((row) => row.recordType), ['buy', 'send', 'receive']);
      assert.ok(result.detectedIdentifiers.some((identifier) => identifier.value === 'Strike BTC'));
    },
  },
  {
    name: 'coinbase_gain_loss_csv preserves matched lot slices',
    run: async () => {
      const csv = [
        '"This report includes all taxable activity on Coinbase with realized gains or losses.",,,,,,,,,,,',
        ',,,,,,,,,,,',
        'Gain/loss report,,,,,,,,,,,',
        'User,example-user-id,test@example.com,,,,,,,,,',
        ',,,,,,,,,,,',
        'Transaction Type,Transaction ID,Tax lot ID,Asset name,Amount,Date Acquired,Cost basis (USD),Date of Disposition,Proceeds (USD),Gains (Losses) (USD),Holding period (Days),Data source',
        'Fee,fee-tx-1,lot-1,BTC,0.00000460,12/02/2025,0.417452346,12/04/2025,0.4233388551444870,0.0058865091444873900,2,Coinbase',
        'Sell,sell-tx-1,lot-2,BTC,0.00010000,11/30/2025,8.88000000,12/05/2025,9.25000000,0.37000000,5,Coinbase',
      ].join('\n');
      return parseCoinbaseGainLossCsvDocument({
        documentId: 'scenario-coinbase-gainloss',
        file: buildUploadFile('Coinbase-2025-CB-GAINLOSSCSV.csv', csv),
        inspection: { text: csv, tabular: null },
        source: { displayName: 'Coinbase Gain/Loss CSV' },
      });
    },
    assertResult: (result) => {
      assert.equal(result.accepted, true);
      assert.equal(result.parseSummary.matchedTaxLotRows, 2);
      assert.deepEqual(result.normalizedRecords.map((row) => row.recordType), ['buy', 'sell', 'buy', 'sell']);
      assert.ok(result.detectedIdentifiers.some((identifier) => identifier.value === 'Coinbase BTC'));
    },
  },
  {
    name: 'generic_exchange_csv parses a representative exchange export',
    run: async () => {
      const csv = [
        'Date,Type,Asset,Amount,Proceeds,Fee,From,To,Transaction ID,Description',
        '2025-01-01T00:00:00Z,Buy,BTC,0.00100000,100.00,1.00,,Generic Exchange BTC,buy-1,Recurring buy',
        '2025-01-03T00:00:00Z,Send,BTC,0.00020000,20.00,0.20,Generic Exchange BTC,bc1qgenericdestination000000000000000000000,send-1,Sent to wallet',
      ].join('\n');
      return parseGenericExchangeCsvDocument({
        documentId: 'scenario-generic-exchange',
        file: buildUploadFile('generic_exchange.csv', csv),
        inspection: buildCsvInspection(csv),
        source: { displayName: 'Generic exchange or broker CSV' },
      });
    },
    assertResult: (result) => {
      assert.equal(result.accepted, true);
      assert.deepEqual(result.normalizedRecords.map((row) => row.recordType), ['buy', 'send']);
    },
  },
  {
    name: 'cash_app_1099_pdf parses the expected provider text layout',
    run: async () => {
      const lines = [
        'FORM 1099-DA',
        'DIGITAL ASSET PROCEEDS FROM BROKER TRANSACTIONS',
        'BLOCK, INC. CASH APP',
        '01-15-2025 0.01500000 BTC $640.25',
      ];
      return parseCashApp1099PdfDocument({
        documentId: 'scenario-cashapp-1099',
        file: buildUploadFile('CashApp1099.pdf', '%PDF'),
        inspection: buildPdfInspection(lines),
        source: { displayName: 'Cash App 1099-DA PDF' },
      });
    },
    assertResult: (result) => {
      assert.equal(result.accepted, true);
      assert.equal(result.normalizedRecords.length, 1);
      assert.equal(result.normalizedRecords[0].recordType, 'sell');
    },
  },
  {
    name: 'coinbase_1099_pdf parses the expected provider text layout',
    run: async () => {
      const lines = [
        'COINBASE',
        'FORM 1099-DA',
        'DIGITAL ASSET PROCEEDS FROM BROKER TRANSACTIONS',
        'Disposed 0.01000000 BTC on 2025-12-05 for $925.00',
      ];
      return parseCoinbase1099PdfDocument({
        documentId: 'scenario-coinbase-1099',
        file: buildUploadFile('Coinbase1099.pdf', '%PDF'),
        inspection: buildPdfInspection(lines),
        source: { displayName: 'Coinbase 1099-DA PDF' },
      });
    },
    assertResult: (result) => {
      assert.equal(result.accepted, true);
      assert.ok(result.normalizedRecords.length >= 1);
      assert.equal(result.normalizedRecords[0].recordType, 'sell');
    },
  },
  {
    name: 'robinhood_1099_pdf parses the expected provider text layout',
    run: async () => {
      const lines = [
        'ROBINHOOD',
        'FORM 1099-DA',
        'DIGITAL ASSET PROCEEDS FROM BROKER TRANSACTIONS',
        'Disposed 0.02000000 BTC on 2025-12-10 for $1,850.00',
      ];
      return parseRobinhood1099PdfDocument({
        documentId: 'scenario-robinhood-1099',
        file: buildUploadFile('Robinhood1099.pdf', '%PDF'),
        inspection: buildPdfInspection(lines),
        source: { displayName: 'Robinhood 1099-DA PDF' },
      });
    },
    assertResult: (result) => {
      assert.equal(result.accepted, true);
      assert.ok(result.normalizedRecords.length >= 1);
      assert.equal(result.normalizedRecords[0].recordType, 'sell');
    },
  },
  {
    name: 'generic_1099_pdf parses a representative generic 1099 layout',
    run: async () => {
      const lines = [
        'FORM 1099-DA',
        'DIGITAL ASSET PROCEEDS FROM BROKER TRANSACTIONS',
        'Broker statement',
        'Disposed 0.00500000 BTC on 2025-12-11 for $462.50',
      ];
      return parseGeneric1099PdfDocument({
        documentId: 'scenario-generic-1099',
        file: buildUploadFile('Generic1099.pdf', '%PDF'),
        inspection: buildPdfInspection(lines),
        source: { displayName: '1099-DA PDF' },
      });
    },
    assertResult: (result) => {
      assert.equal(result.accepted, true);
      assert.ok(result.normalizedRecords.length >= 1);
      assert.equal(result.normalizedRecords[0].recordType, 'sell');
    },
  },
];

parserScenarios.forEach((scenario) => {
  test(`parser scenario: ${scenario.name}`, async () => {
    const result = await scenario.run();
    scenario.assertResult(result);
  });
});
