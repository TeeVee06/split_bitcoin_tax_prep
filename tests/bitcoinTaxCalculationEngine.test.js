const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateDraftTaxResult } = require('../bitcoinTax/calculationEngine');
const {
  createDetectedIdentifier,
  createNormalizedRecord,
} = require('../bitcoinTax/normalizedSchema');

function createAcceptedDocument(records, overrides = {}) {
  return {
    sourceId: 'test_source',
    parserId: 'test_parser',
    originalName: 'test-document.csv',
    sourceDisplayName: 'Test Source',
    normalizedRecords: records,
    ...overrides,
  };
}

function createSession(overrides = {}) {
  return {
    acceptedDocuments: [],
    detectedIdentifiers: [],
    ownedIdentifierIds: [],
    spendingSendRecordIds: [],
    ...overrides,
  };
}

test('calculateDraftTaxResult suppresses explicit self-transfers', () => {
  const walletA = createDetectedIdentifier({
    identifierType: 'wallet_label',
    value: 'My Wallet A',
  });
  const walletB = createDetectedIdentifier({
    identifierType: 'wallet_label',
    value: 'My Wallet B',
  });

  const transferRecord = createNormalizedRecord({
    recordId: 'send-1',
    recordType: 'send',
    occurredAt: '2025-01-02T00:00:00.000Z',
    assetSymbol: 'BTC',
    quantitySats: 25_000,
    fromIdentifier: walletA.value,
    toIdentifier: walletB.value,
  });

  const result = calculateDraftTaxResult(createSession({
    acceptedDocuments: [createAcceptedDocument([transferRecord])],
    detectedIdentifiers: [walletA, walletB],
    ownedIdentifierIds: [walletA.identifierId, walletB.identifierId],
  }));

  assert.equal(result.status, 'no_reportable_rows');
  assert.equal(result.draftRows.length, 0);
  assert.equal(result.counts.selfTransfersSuppressed, 1);
  assert.match(result.warnings.join('\n'), /suppressed as explicit self-transfers/);
});

test('calculateDraftTaxResult uses FIFO basis for a marked spending send', () => {
  const ownedWallet = createDetectedIdentifier({
    identifierType: 'wallet_label',
    value: 'Split Wallet',
  });

  const buyRecord = createNormalizedRecord({
    recordId: 'buy-1',
    recordType: 'buy',
    occurredAt: '2025-01-01T00:00:00.000Z',
    assetSymbol: 'BTC',
    quantitySats: 1_000,
    fiatAmountCents: 100,
    feeAmountCents: 10,
    toIdentifier: ownedWallet.value,
  });

  const sendRecord = createNormalizedRecord({
    recordId: 'send-1',
    recordType: 'send',
    occurredAt: '2025-02-01T00:00:00.000Z',
    assetSymbol: 'BTC',
    quantitySats: 400,
    fiatAmountCents: 80,
    fromIdentifier: ownedWallet.value,
    toIdentifier: 'merchant-address',
  });

  const result = calculateDraftTaxResult(createSession({
    acceptedDocuments: [createAcceptedDocument([buyRecord, sendRecord])],
    detectedIdentifiers: [ownedWallet],
    ownedIdentifierIds: [ownedWallet.identifierId],
    spendingSendRecordIds: ['send-1'],
  }));

  assert.equal(result.status, 'ready');
  assert.equal(result.draftRows.length, 1);

  const [row] = result.draftRows;
  assert.equal(row.holdingPeriod, 'short');
  assert.equal(row.quantitySats, '400');
  assert.equal(row.proceedsCents, 80);
  assert.equal(row.basisCents, 44);
  assert.equal(row.gainLossCents, 36);
  assert.equal(result.totals.short.rows, 1);
  assert.equal(result.totals.short.proceedsCents, 80);
  assert.equal(result.totals.short.basisCents, 44);
  assert.equal(result.totals.short.gainLossCents, 36);
});

test('calculateDraftTaxResult flags dispositions that cannot be matched to prior lots', () => {
  const ownedWallet = createDetectedIdentifier({
    identifierType: 'wallet_label',
    value: 'Split Wallet',
  });

  const sendRecord = createNormalizedRecord({
    recordId: 'send-2',
    recordType: 'send',
    occurredAt: '2025-03-01T00:00:00.000Z',
    assetSymbol: 'BTC',
    quantitySats: 250,
    fiatAmountCents: 50,
    fromIdentifier: ownedWallet.value,
    toIdentifier: 'merchant-address',
  });

  const result = calculateDraftTaxResult(createSession({
    acceptedDocuments: [createAcceptedDocument([sendRecord])],
    detectedIdentifiers: [ownedWallet],
    ownedIdentifierIds: [ownedWallet.identifierId],
    spendingSendRecordIds: ['send-2'],
  }));

  assert.equal(result.status, 'needs_more_info');
  assert.equal(result.draftRows.length, 0);
  assert.equal(result.counts.incompleteDispositions, 1);
  assert.match(result.issues.join('\n'), /could not be fully matched to prior buy lots/);
  assert.match(result.issues.join('\n'), /250 sats remain without basis/);
});
