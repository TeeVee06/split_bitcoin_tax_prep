const Big = require('big.js');
const { normalizeIdentifierValue } = require('./normalizedSchema');

function toBig(value) {
  return new Big(String(value || 0));
}

function normalizeOwnedIdentifierSet(session) {
  const selectedIds = new Set(session.ownedIdentifierIds || []);

  return new Set(
    (session.detectedIdentifiers || [])
      .filter((identifier) => selectedIds.has(identifier.identifierId))
      .map((identifier) => normalizeIdentifierValue(identifier.value).toLowerCase())
      .filter(Boolean)
  );
}

function normalizeSpendingSendRecordSet(session) {
  return new Set((session.spendingSendRecordIds || []).filter(Boolean));
}

function normalizeRecordIdentifier(value) {
  return normalizeIdentifierValue(value).toLowerCase();
}

function isOwnedIdentifier(value, ownedValues) {
  const normalized = normalizeRecordIdentifier(value);

  return normalized ? ownedValues.has(normalized) : false;
}

function flattenAcceptedRecords(session) {
  return (session.acceptedDocuments || [])
    .flatMap((document) =>
      (document.normalizedRecords || []).map((record) => ({
        ...record,
        sourceId: document.sourceId,
        parserId: document.parserId,
        sourceDocumentName: document.originalName,
        sourceDisplayName: document.sourceDisplayName,
      }))
    )
    .sort((left, right) => {
      const leftTime = left.occurredAt ? new Date(left.occurredAt).getTime() : 0;
      const rightTime = right.occurredAt ? new Date(right.occurredAt).getTime() : 0;
      return leftTime - rightTime;
    });
}

function classifyRecord(record, ownedValues, spendingSendRecordIds) {
  const fromOwned = isOwnedIdentifier(record.fromIdentifier, ownedValues);
  const toOwned = isOwnedIdentifier(record.toIdentifier, ownedValues);
  const isMovement = record.recordType === 'send' || record.recordType === 'receive' || record.recordType === 'transfer';

  if (isMovement && fromOwned && toOwned) {
    return 'self_transfer';
  }

  if (record.recordType === 'buy') {
    return 'acquisition';
  }

  if (record.recordType === 'sell' || record.recordType === 'spend') {
    return 'disposition';
  }

  if (record.recordType === 'send' && spendingSendRecordIds.has(record.recordId)) {
    return 'disposition';
  }

  if (isMovement) {
    return 'movement';
  }

  return 'ignored';
}

function buildLot(record) {
  if (!record.quantitySats || !Number.isFinite(record.fiatAmountCents)) {
    return null;
  }

  const feeAmountCents = Number.isFinite(record.feeAmountCents) ? record.feeAmountCents : 0;

  return {
    acquisitionRecordId: record.recordId,
    acquiredAt: record.occurredAt,
    sourceId: record.sourceId || null,
    sourceDisplayName: record.sourceDisplayName || null,
    sourceDocumentName: record.sourceDocumentName,
    txid: record.txid || null,
    externalReference: record.externalReference || null,
    note: record.note || null,
    totalQuantitySats: toBig(record.quantitySats),
    remainingQuantitySats: toBig(record.quantitySats),
    totalBasisCents: toBig(record.fiatAmountCents + feeAmountCents),
    remainingBasisCents: toBig(record.fiatAmountCents + feeAmountCents),
  };
}

function minimumBig(left, right) {
  return left.lte(right) ? left : right;
}

function roundDownBigToNumber(value) {
  return Number(value.round(0, 0).toString());
}

function buildHoldingPeriod(acquiredAt, disposedAt) {
  if (!acquiredAt || !disposedAt) {
    return 'unknown';
  }

  const acquiredTime = new Date(acquiredAt).getTime();
  const disposedTime = new Date(disposedAt).getTime();

  if (!Number.isFinite(acquiredTime) || !Number.isFinite(disposedTime)) {
    return 'unknown';
  }

  return disposedTime - acquiredTime > 365 * 24 * 60 * 60 * 1000 ? 'long' : 'short';
}

function initializeTotals() {
  return {
    rows: 0,
    proceedsCents: 0,
    basisCents: 0,
    gainLossCents: 0,
  };
}

function addToTotals(target, row) {
  target.rows += 1;
  target.proceedsCents += Number(row.proceedsCents || 0);
  target.basisCents += Number(row.basisCents || 0);
  target.gainLossCents += Number(row.gainLossCents || 0);
}

function calculateDraftTaxResult(session) {
  const ownedValues = normalizeOwnedIdentifierSet(session);
  const spendingSendRecordIds = normalizeSpendingSendRecordSet(session);
  const records = flattenAcceptedRecords(session);
  const counts = {
    acquisitionRecords: 0,
    dispositionRecords: 0,
    selfTransfersSuppressed: 0,
    movementRecordsExcluded: 0,
    ignoredRecords: 0,
    incompleteAcquisitions: 0,
    incompleteDispositions: 0,
  };
  const issues = [];
  const warnings = [];
  const lots = [];
  const draftRows = [];
  const totals = {
    short: initializeTotals(),
    long: initializeTotals(),
    unknown: initializeTotals(),
  };

  records.forEach((record) => {
    const classification = classifyRecord(record, ownedValues, spendingSendRecordIds);

    if (classification === 'self_transfer') {
      counts.selfTransfersSuppressed += 1;
      return;
    }

    if (classification === 'movement') {
      counts.movementRecordsExcluded += 1;
      return;
    }

    if (classification === 'ignored') {
      counts.ignoredRecords += 1;
      return;
    }

    if (classification === 'acquisition') {
      counts.acquisitionRecords += 1;

      const lot = buildLot(record);

      if (!lot) {
        counts.incompleteAcquisitions += 1;
        issues.push(`Acquisition row from ${record.sourceDocumentName} is missing quantity or USD basis.`);
        return;
      }

      lots.push(lot);
      return;
    }

    if (classification === 'disposition') {
      counts.dispositionRecords += 1;

      if (!record.quantitySats || !Number.isFinite(record.fiatAmountCents)) {
        counts.incompleteDispositions += 1;
        issues.push(`Disposition row from ${record.sourceDocumentName} is missing quantity or proceeds.`);
        return;
      }

      let quantityRemainingSats = toBig(record.quantitySats);
      const originalQuantitySats = toBig(record.quantitySats);
      const feeAmountCents = Number.isFinite(record.feeAmountCents) ? record.feeAmountCents : 0;
      const totalProceedsCents = toBig(record.fiatAmountCents - feeAmountCents);
      let proceedsRemainingCents = totalProceedsCents;
      let matchedThisDisposition = false;

      while (quantityRemainingSats.gt(0) && lots.length) {
        const lot = lots[0];

        if (lot.remainingQuantitySats.lte(0)) {
          lots.shift();
          continue;
        }

        const allocatedQuantitySats = minimumBig(quantityRemainingSats, lot.remainingQuantitySats);
        const takingEntireDisposition = allocatedQuantitySats.eq(quantityRemainingSats);
        const takingEntireLot = allocatedQuantitySats.eq(lot.remainingQuantitySats);
        const allocatedProceedsCents = takingEntireDisposition
          ? proceedsRemainingCents
          : totalProceedsCents.times(allocatedQuantitySats).div(originalQuantitySats).round(0, 0);
        const allocatedBasisCents = takingEntireLot
          ? lot.remainingBasisCents
          : lot.remainingBasisCents.times(allocatedQuantitySats).div(lot.remainingQuantitySats).round(0, 0);
        const holdingPeriod = buildHoldingPeriod(lot.acquiredAt, record.occurredAt);
        const row = {
          acquisitionRecordId: lot.acquisitionRecordId,
          dispositionRecordId: record.recordId,
          acquiredAt: lot.acquiredAt,
          disposedAt: record.occurredAt,
          quantitySats: allocatedQuantitySats.toString(),
          proceedsCents: roundDownBigToNumber(allocatedProceedsCents),
          basisCents: roundDownBigToNumber(allocatedBasisCents),
          gainLossCents: roundDownBigToNumber(allocatedProceedsCents.minus(allocatedBasisCents)),
          holdingPeriod,
          assetSymbol: 'BTC',
          dispositionSourceId: record.sourceId || null,
          dispositionSourceDisplayName: record.sourceDisplayName || null,
          acquisitionSourceDocumentName: lot.sourceDocumentName,
          acquisitionSourceId: lot.sourceId || null,
          acquisitionSourceDisplayName: lot.sourceDisplayName || null,
          dispositionSourceDocumentName: record.sourceDocumentName,
          dispositionTxid: record.txid || null,
          acquisitionTxid: lot.txid || null,
          dispositionExternalReference: record.externalReference || null,
          acquisitionExternalReference: lot.externalReference || null,
          note: record.note || lot.note || null,
        };

        draftRows.push(row);
        addToTotals(totals[holdingPeriod] || totals.unknown, row);
        matchedThisDisposition = true;

        quantityRemainingSats = quantityRemainingSats.minus(allocatedQuantitySats);
        proceedsRemainingCents = proceedsRemainingCents.minus(allocatedProceedsCents);
        lot.remainingQuantitySats = lot.remainingQuantitySats.minus(allocatedQuantitySats);
        lot.remainingBasisCents = lot.remainingBasisCents.minus(allocatedBasisCents);

        if (lot.remainingQuantitySats.lte(0)) {
          lots.shift();
        }
      }

      if (quantityRemainingSats.gt(0)) {
        issues.push(
          `Disposition from ${record.sourceDocumentName} on ${record.occurredAt || 'unknown date'} could not be fully matched to prior buy lots. ${quantityRemainingSats.toString()} sats remain without basis.`
        );
      }

      if (!matchedThisDisposition) {
        counts.incompleteDispositions += 1;
      }
    }
  });

  if (counts.movementRecordsExcluded > 0) {
    warnings.push(
      `${counts.movementRecordsExcluded} send, receive, or transfer record${
        counts.movementRecordsExcluded === 1 ? '' : 's'
      } were left as non-spending and excluded from the draft tax rows in this beta calculation pass.`
    );
  }

  if (counts.selfTransfersSuppressed > 0) {
    warnings.push(
      `${counts.selfTransfersSuppressed} record${
        counts.selfTransfersSuppressed === 1 ? '' : 's'
      } were suppressed as explicit self-transfers because both sides matched identifiers you marked as owned.`
    );
  }

  const blockingIssues = counts.incompleteAcquisitions > 0
    || counts.incompleteDispositions > 0
    || issues.length > 0;
  const hasDraftRows = draftRows.length > 0;
  const status = blockingIssues
    ? 'needs_more_info'
    : hasDraftRows
      ? 'ready'
      : 'no_reportable_rows';

  return {
    status,
    counts,
    issues,
    warnings,
    draftRows,
    totals,
  };
}

module.exports = {
  calculateDraftTaxResult,
};
