function formatDateForForm(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return '';
  }

  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const year = String(date.getUTCFullYear());

  return `${month}/${day}/${year}`;
}

function formatUsdForForm(value) {
  return (Number(value || 0) / 100).toFixed(2);
}

function formatBtc(value) {
  const sats = BigInt(String(value || 0));
  const whole = sats / 100000000n;
  const fractional = String(sats % 100000000n).padStart(8, '0');

  return `${whole.toString()}.${fractional}`;
}

function inferDispositionReporting(row) {
  const sourceId = String(row.dispositionSourceId || '').toLowerCase();

  if (sourceId.includes('1099')) {
    return {
      reportedOn1099Da: true,
      basisReportedToIrs: false,
    };
  }

  return {
    reportedOn1099Da: false,
    basisReportedToIrs: false,
  };
}

function determineForm8949Box(row) {
  const reporting = inferDispositionReporting(row);

  if (row.holdingPeriod === 'short') {
    if (reporting.reportedOn1099Da && reporting.basisReportedToIrs) {
      return { box: 'G', part: 'I', scheduleDLine: '1b' };
    }

    if (reporting.reportedOn1099Da) {
      return { box: 'H', part: 'I', scheduleDLine: '2' };
    }

    return { box: 'I', part: 'I', scheduleDLine: '3' };
  }

  if (row.holdingPeriod === 'long') {
    if (reporting.reportedOn1099Da && reporting.basisReportedToIrs) {
      return { box: 'J', part: 'II', scheduleDLine: '8b' };
    }

    if (reporting.reportedOn1099Da) {
      return { box: 'K', part: 'II', scheduleDLine: '9' };
    }

    return { box: 'L', part: 'II', scheduleDLine: '10' };
  }

  return { box: 'UNMAPPED', part: 'unknown', scheduleDLine: null };
}

function buildDescription(row) {
  const quantity = `${formatBtc(row.quantitySats)} BTC`;
  const txidOrReference = row.dispositionTxid || row.dispositionExternalReference || null;

  return txidOrReference
    ? `${quantity} (${String(txidOrReference).slice(0, 24)})`
    : quantity;
}

function initializeSummaryRow(box, part, scheduleDLine) {
  return {
    box,
    part,
    scheduleDLine,
    code: 'M',
    description: 'See attached statement',
    sourceDisplayName: '',
    totals: {
      rows: 0,
      proceedsCents: 0,
      basisCents: 0,
      adjustmentCents: 0,
      gainLossCents: 0,
    },
  };
}

function buildOfficialFormMapping(calculationResult) {
  const summaryMap = new Map();
  const attachmentStatementRows = [];
  const assumptions = [
    'Rows tied to parsed 1099 documents are mapped as reported on Form 1099-DA with basis not reported to the IRS.',
    'Rows not tied to a parsed 1099 document are mapped as not reported on Form 1099-DA.',
    'Form 8949 summary rows are prepared under Exception 2 using code M and attached statements.',
  ];

  (calculationResult.draftRows || []).forEach((row, index) => {
    const mapping = determineForm8949Box(row);

    if (!mapping.scheduleDLine) {
      return;
    }

    const attachmentRow = {
      rowNumber: index + 1,
      form8949Box: mapping.box,
      form8949Part: mapping.part,
      scheduleDLine: mapping.scheduleDLine,
      description: buildDescription(row),
      dateAcquired: formatDateForForm(row.acquiredAt),
      dateSoldOrDisposed: formatDateForForm(row.disposedAt),
      proceeds: formatUsdForForm(row.proceedsCents),
      costOrOtherBasis: formatUsdForForm(row.basisCents),
      adjustmentCode: '',
      adjustmentAmount: '',
      gainOrLoss: formatUsdForForm(row.gainLossCents),
      acquisitionSourceDocumentName: row.acquisitionSourceDocumentName || '',
      dispositionSourceDocumentName: row.dispositionSourceDocumentName || '',
    };

    attachmentStatementRows.push(attachmentRow);

    const summarySourceName = row.dispositionSourceDisplayName || row.dispositionSourceDocumentName || 'Source';
    const summaryKey = `${mapping.part}:${mapping.box}:${mapping.scheduleDLine}:${summarySourceName}`;

    if (!summaryMap.has(summaryKey)) {
      const summaryRow = initializeSummaryRow(mapping.box, mapping.part, mapping.scheduleDLine);
      summaryRow.sourceDisplayName = summarySourceName;
      summaryRow.description = `${summarySourceName} see attached statement`;
      summaryMap.set(summaryKey, summaryRow);
    }

    const summary = summaryMap.get(summaryKey);
    summary.totals.rows += 1;
    summary.totals.proceedsCents += Number(row.proceedsCents || 0);
    summary.totals.basisCents += Number(row.basisCents || 0);
    summary.totals.gainLossCents += Number(row.gainLossCents || 0);
  });

  const form8949SummaryRows = Array.from(summaryMap.values())
    .sort((left, right) => left.scheduleDLine.localeCompare(right.scheduleDLine))
    .map((row) => ({
      ...row,
      proceeds: formatUsdForForm(row.totals.proceedsCents),
      costOrOtherBasis: formatUsdForForm(row.totals.basisCents),
      adjustmentAmount: formatUsdForForm(row.totals.adjustmentCents),
      gainOrLoss: formatUsdForForm(row.totals.gainLossCents),
    }));

  const scheduleD = {
    shortTerm: {
      line1b: form8949SummaryRows.find((row) => row.scheduleDLine === '1b') || null,
      line2: form8949SummaryRows.find((row) => row.scheduleDLine === '2') || null,
      line3: form8949SummaryRows.find((row) => row.scheduleDLine === '3') || null,
    },
    longTerm: {
      line8b: form8949SummaryRows.find((row) => row.scheduleDLine === '8b') || null,
      line9: form8949SummaryRows.find((row) => row.scheduleDLine === '9') || null,
      line10: form8949SummaryRows.find((row) => row.scheduleDLine === '10') || null,
    },
  };

  return {
    assumptions,
    attachmentStatementRows,
    form8949SummaryRows,
    scheduleD,
  };
}

module.exports = {
  buildOfficialFormMapping,
};
