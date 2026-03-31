const archiver = require('archiver');
const PDFDocument = require('pdfkit');
const { buildOfficialFormMapping } = require('./formMapping');
const { buildOfficialIrsPdfPackage } = require('./irsPdfBuilder');

function sanitizeFilename(value, fallback = 'document') {
  const base = String(value || fallback)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  return base || fallback;
}

function formatUsdCents(value) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }

  return `$${(value / 100).toFixed(2)}`;
}

function formatSatsAsBtc(value) {
  if (!value) {
    return '0 BTC';
  }

  const sats = BigInt(String(value));
  const whole = sats / 100000000n;
  const fractional = String(sats % 100000000n).padStart(8, '0').replace(/0+$/, '');

  return fractional ? `${whole.toString()}.${fractional} BTC` : `${whole.toString()} BTC`;
}

function buildDraftRowsCsv(calculationResult) {
  const header = [
    'acquired_at',
    'disposed_at',
    'holding_period',
    'quantity_btc',
    'proceeds_usd',
    'basis_usd',
    'gain_loss_usd',
    'acquisition_source_document',
    'disposition_source_document',
    'note',
  ];
  const lines = [header.join(',')];

  (calculationResult.draftRows || []).forEach((row) => {
    const values = [
      row.acquiredAt || '',
      row.disposedAt || '',
      row.holdingPeriod || '',
      formatSatsAsBtc(row.quantitySats).replace(' BTC', ''),
      (Number(row.proceedsCents || 0) / 100).toFixed(2),
      (Number(row.basisCents || 0) / 100).toFixed(2),
      (Number(row.gainLossCents || 0) / 100).toFixed(2),
      row.acquisitionSourceDocumentName || '',
      row.dispositionSourceDocumentName || '',
      row.note || '',
    ];

    lines.push(
      values
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(',')
    );
  });

  return `${lines.join('\n')}\n`;
}

function buildSummaryJson(session, calculationResult) {
  const officialForms = buildOfficialFormMapping(calculationResult);

  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      phase: session.phase,
      counts: calculationResult.counts,
      totals: calculationResult.totals,
      warnings: calculationResult.warnings,
      issues: calculationResult.issues,
      acceptedDocuments: (session.acceptedDocuments || []).map((document) => ({
        originalName: document.originalName,
        sourceDisplayName: document.sourceDisplayName,
        parserId: document.parserId,
        normalizedRecordCount: Array.isArray(document.normalizedRecords) ? document.normalizedRecords.length : 0,
      })),
      draftRows: calculationResult.draftRows,
      officialForms,
    },
    null,
    2
  );
}

function buildForm8949AttachmentStatementCsv(formMapping) {
  const header = [
    'form_8949_part',
    'form_8949_box',
    'schedule_d_line',
    'description',
    'date_acquired',
    'date_sold_or_disposed',
    'proceeds',
    'cost_or_other_basis',
    'adjustment_code',
    'adjustment_amount',
    'gain_or_loss',
    'acquisition_source_document',
    'disposition_source_document',
  ];
  const lines = [header.join(',')];

  (formMapping.attachmentStatementRows || []).forEach((row) => {
    const values = [
      row.form8949Part,
      row.form8949Box,
      row.scheduleDLine,
      row.description,
      row.dateAcquired,
      row.dateSoldOrDisposed,
      row.proceeds,
      row.costOrOtherBasis,
      row.adjustmentCode,
      row.adjustmentAmount,
      row.gainOrLoss,
      row.acquisitionSourceDocumentName,
      row.dispositionSourceDocumentName,
    ];

    lines.push(values.map((value) => `"${String(value || '').replace(/"/g, '""')}"`).join(','));
  });

  return `${lines.join('\n')}\n`;
}

function buildForm8949SummaryCsv(formMapping) {
  const header = [
    'form_8949_part',
    'form_8949_box',
    'schedule_d_line',
    'code',
    'description',
    'rows',
    'proceeds',
    'cost_or_other_basis',
    'adjustment_amount',
    'gain_or_loss',
  ];
  const lines = [header.join(',')];

  (formMapping.form8949SummaryRows || []).forEach((row) => {
    const values = [
      row.part,
      row.box,
      row.scheduleDLine,
      row.code,
      row.description,
      row.totals.rows,
      row.proceeds,
      row.costOrOtherBasis,
      row.adjustmentAmount,
      row.gainOrLoss,
    ];

    lines.push(values.map((value) => `"${String(value || '').replace(/"/g, '""')}"`).join(','));
  });

  return `${lines.join('\n')}\n`;
}

function buildScheduleDSummaryCsv(formMapping) {
  const header = ['section', 'line', 'form_8949_box', 'rows', 'proceeds', 'basis', 'gain_or_loss'];
  const lines = [header.join(',')];
  const scheduleRows = [
    ['short_term', '1b', formMapping.scheduleD.shortTerm.line1b],
    ['short_term', '2', formMapping.scheduleD.shortTerm.line2],
    ['short_term', '3', formMapping.scheduleD.shortTerm.line3],
    ['long_term', '8b', formMapping.scheduleD.longTerm.line8b],
    ['long_term', '9', formMapping.scheduleD.longTerm.line9],
    ['long_term', '10', formMapping.scheduleD.longTerm.line10],
  ];

  scheduleRows.forEach(([section, line, row]) => {
    if (!row) {
      return;
    }

    const values = [
      section,
      line,
      row.box,
      row.totals.rows,
      row.proceeds,
      row.costOrOtherBasis,
      row.gainOrLoss,
    ];

    lines.push(values.map((value) => `"${String(value || '').replace(/"/g, '""')}"`).join(','));
  });

  return `${lines.join('\n')}\n`;
}

function pushSectionTitle(doc, title) {
  doc.moveDown();
  doc.font('Helvetica-Bold').fontSize(14).text(title);
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(10);
}

function addBulletLines(doc, lines) {
  lines.forEach((line) => {
    doc.text(`- ${line}`);
  });
}

function ensureSpace(doc, amount = 40) {
  if (doc.y > doc.page.height - amount) {
    doc.addPage();
  }
}

function buildPdfBuffer(session, calculationResult) {
  return new Promise((resolve, reject) => {
    const formMapping = buildOfficialFormMapping(calculationResult);
    const doc = new PDFDocument({ margin: 48, size: 'LETTER' });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(22).text('Bitcoin Tax Draft Packet');
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(11);
    doc.text(`Generated: ${new Date().toISOString()}`);
    doc.text('Prepared from user-provided documents during this session.');
    doc.text('This beta output is a draft calculation package, not a filed tax return.');
    doc.text('Review all files, forms, and calculations with a qualified tax professional before using them for any tax reporting or filing.');

    pushSectionTitle(doc, 'Summary');
    addBulletLines(doc, [
      `Status: ${calculationResult.status}`,
      `${calculationResult.counts.acquisitionRecords} acquisition records used to build FIFO lots`,
      `${calculationResult.counts.dispositionRecords} disposition records evaluated`,
      `${calculationResult.counts.selfTransfersSuppressed} self-transfer records suppressed`,
      `${calculationResult.draftRows.length} draft FIFO rows generated`,
      `Short-term gain/loss: ${formatUsdCents(calculationResult.totals.short.gainLossCents)}`,
      `Long-term gain/loss: ${formatUsdCents(calculationResult.totals.long.gainLossCents)}`,
    ]);

    pushSectionTitle(doc, 'Provided Documents');
    (session.acceptedDocuments || []).forEach((document, index) => {
      ensureSpace(doc);
      doc.text(
        `${index + 1}. ${document.originalName} (${document.sourceDisplayName}, ${
          Array.isArray(document.normalizedRecords) ? document.normalizedRecords.length : 0
        } normalized rows)`
      );
    });

    if (calculationResult.warnings && calculationResult.warnings.length) {
      pushSectionTitle(doc, 'Warnings');
      addBulletLines(doc, calculationResult.warnings);
    }

    if (calculationResult.issues && calculationResult.issues.length) {
      pushSectionTitle(doc, 'Open Issues');
      addBulletLines(doc, calculationResult.issues);
    }

    pushSectionTitle(doc, 'Form 8949 Mapping');
    if (!formMapping.form8949SummaryRows.length) {
      doc.text('No Form 8949 summary rows were generated.');
    } else {
      formMapping.form8949SummaryRows.forEach((row) => {
        ensureSpace(doc, 55);
        doc.text(
          `Part ${row.part} | Box ${row.box} | Schedule D line ${row.scheduleDLine} | ${row.totals.rows} row${
            row.totals.rows === 1 ? '' : 's'
          }`
        );
        doc.text(
          `Proceeds: $${row.proceeds} | Basis: $${row.costOrOtherBasis} | Gain/Loss: $${row.gainOrLoss}`
        );
        doc.moveDown(0.4);
      });
    }

    pushSectionTitle(doc, 'Draft FIFO Rows');
    if (!calculationResult.draftRows.length) {
      doc.text('No draft FIFO rows were generated from the current upload set.');
    } else {
      calculationResult.draftRows.forEach((row, index) => {
        ensureSpace(doc, 70);
        doc.font('Helvetica-Bold').text(
          `${index + 1}. ${formatSatsAsBtc(row.quantitySats)} | ${row.holdingPeriod}-term`
        );
        doc.font('Helvetica')
          .text(`Acquired: ${row.acquiredAt || 'unknown'}`)
          .text(`Disposed: ${row.disposedAt || 'unknown'}`)
          .text(
            `Proceeds: ${formatUsdCents(row.proceedsCents)} | Basis: ${formatUsdCents(row.basisCents)} | Gain/Loss: ${formatUsdCents(row.gainLossCents)}`
          )
          .text(`Buy source: ${row.acquisitionSourceDocumentName || 'unknown'}`)
          .text(`Disposition source: ${row.dispositionSourceDocumentName || 'unknown'}`);

        if (row.note) {
          doc.text(`Note: ${row.note}`);
        }

        doc.moveDown(0.6);
      });
    }

    doc.end();
  });
}

function buildReadmeText() {
  return [
    'Bitcoin Tax Draft Package',
    '',
    'This package was generated from the files you uploaded during this session.',
    'It includes filled IRS Form 8949 and Schedule D PDFs, a PDF summary, Form 8949 attachment-statement rows, Form 8949 summary rows, Schedule D rollups, a JSON calculation summary, and the accepted source documents used to create the draft output.',
    '',
    'This beta package is a draft aid and not a filed return.',
    'Review all files, forms, and calculations with a qualified tax professional before using them for any tax reporting or filing.',
    '',
  ].join('\n');
}

function collectArchiveBuffer(archive) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('warning', (error) => {
      if (error.code !== 'ENOENT') {
        reject(error);
      }
    });
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function buildDownloadPackage(session, calculationResult) {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const archiveBufferPromise = collectArchiveBuffer(archive);
  const formMapping = buildOfficialFormMapping(calculationResult);
  const irsPdfPackage = await buildOfficialIrsPdfPackage(calculationResult);
  const pdfBuffer = await buildPdfBuffer(session, calculationResult);

  archive.append(pdfBuffer, { name: 'final-tax-packet.pdf' });
  if (irsPdfPackage.form8949Pdf) {
    archive.append(irsPdfPackage.form8949Pdf, { name: 'irs-form-8949-filled.pdf' });
  }
  if (irsPdfPackage.scheduleDPdf) {
    archive.append(irsPdfPackage.scheduleDPdf, { name: 'irs-schedule-d-filled.pdf' });
  }
  archive.append(buildDraftRowsCsv(calculationResult), { name: 'form-8949-draft.csv' });
  archive.append(buildForm8949AttachmentStatementCsv(formMapping), { name: 'form-8949-attachment-statement.csv' });
  archive.append(buildForm8949SummaryCsv(formMapping), { name: 'form-8949-summary.csv' });
  archive.append(buildScheduleDSummaryCsv(formMapping), { name: 'schedule-d-summary.csv' });
  archive.append(buildSummaryJson(session, calculationResult), { name: 'calculation-summary.json' });
  archive.append(buildReadmeText(), { name: 'README.txt' });

  (session.acceptedDocuments || []).forEach((document, index) => {
    const filename = sanitizeFilename(document.originalName, `source-document-${index + 1}`);
    archive.append(document.buffer, { name: `accepted-source-documents/${filename}` });
  });

  archive.finalize();

  return archiveBufferPromise;
}

module.exports = {
  buildDownloadPackage,
};
