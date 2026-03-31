const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { buildOfficialFormMapping } = require('./formMapping');

const FORM_8949_TEMPLATE_PATH = path.join(__dirname, 'templates', 'f8949-2025.pdf');
const SCHEDULE_D_TEMPLATE_PATH = path.join(__dirname, 'templates', 'f1040sd-2025.pdf');
const FORM_8949_ROWS_PER_PAGE = 11;

const FORM_8949_BOX_INDEX = {
  I: { G: 3, H: 4, I: 5 },
  II: { J: 3, K: 4, L: 5 },
};

function readTemplateBuffer(templatePath) {
  return fs.readFileSync(templatePath);
}

function setIfPresent(form, fieldName, value) {
  try {
    const field = form.getTextField(fieldName);
    field.setText(String(value || ''));
  } catch (_) {
    return;
  }
}

function checkIfPresent(form, fieldName) {
  try {
    form.getCheckBox(fieldName).check();
  } catch (_) {
    return;
  }
}

function paginate(items, pageSize) {
  const pages = [];

  for (let index = 0; index < items.length; index += pageSize) {
    pages.push(items.slice(index, index + pageSize));
  }

  return pages;
}

function build8949PageConfigs(formMapping) {
  const grouped = new Map();

  (formMapping.form8949SummaryRows || []).forEach((row) => {
    const key = `${row.part}:${row.box}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        part: row.part,
        box: row.box,
        scheduleDLine: row.scheduleDLine,
        rows: [],
      });
    }

    grouped.get(key).rows.push(row);
  });

  return Array.from(grouped.values()).flatMap((group) =>
    paginate(group.rows, FORM_8949_ROWS_PER_PAGE).map((rows) => ({
      ...group,
      rows,
    }))
  );
}

function get8949RowFieldNames(part, rowIndex) {
  const pagePrefix = part === 'I'
    ? 'topmostSubform[0].Page1[0].Table_Line1_Part1[0]'
    : 'topmostSubform[0].Page2[0].Table_Line1_Part2[0]';
  const fieldPrefix = part === 'I' ? 'f1_' : 'f2_';
  const startNumber = 3 + rowIndex * 8;
  const rowNumber = rowIndex + 1;

  return [
    `${pagePrefix}.Row${rowNumber}[0].${fieldPrefix}${String(startNumber).padStart(2, '0')}[0]`,
    `${pagePrefix}.Row${rowNumber}[0].${fieldPrefix}${String(startNumber + 1).padStart(2, '0')}[0]`,
    `${pagePrefix}.Row${rowNumber}[0].${fieldPrefix}${String(startNumber + 2).padStart(2, '0')}[0]`,
    `${pagePrefix}.Row${rowNumber}[0].${fieldPrefix}${String(startNumber + 3).padStart(2, '0')}[0]`,
    `${pagePrefix}.Row${rowNumber}[0].${fieldPrefix}${String(startNumber + 4).padStart(2, '0')}[0]`,
    `${pagePrefix}.Row${rowNumber}[0].${fieldPrefix}${String(startNumber + 5).padStart(2, '0')}[0]`,
    `${pagePrefix}.Row${rowNumber}[0].${fieldPrefix}${String(startNumber + 6).padStart(2, '0')}[0]`,
    `${pagePrefix}.Row${rowNumber}[0].${fieldPrefix}${String(startNumber + 7).padStart(2, '0')}[0]`,
  ];
}

function get8949TotalsFieldNames(part) {
  return part === 'I'
    ? [
        'topmostSubform[0].Page1[0].f1_91[0]',
        'topmostSubform[0].Page1[0].f1_92[0]',
        'topmostSubform[0].Page1[0].f1_93[0]',
        'topmostSubform[0].Page1[0].f1_94[0]',
      ]
    : [
        'topmostSubform[0].Page2[0].f2_91[0]',
        'topmostSubform[0].Page2[0].f2_92[0]',
        'topmostSubform[0].Page2[0].f2_93[0]',
        'topmostSubform[0].Page2[0].f2_94[0]',
      ];
}

function get8949IdentityFields(part) {
  return part === 'I'
    ? {
        name: 'topmostSubform[0].Page1[0].f1_01[0]',
        ssn: 'topmostSubform[0].Page1[0].f1_02[0]',
        pageIndex: 0,
        checkboxPrefix: 'topmostSubform[0].Page1[0].c1_1',
      }
    : {
        name: 'topmostSubform[0].Page2[0].f2_01[0]',
        ssn: 'topmostSubform[0].Page2[0].f2_02[0]',
        pageIndex: 1,
        checkboxPrefix: 'topmostSubform[0].Page2[0].c2_1',
      };
}

async function buildFilledForm8949Pdf(formMapping, taxpayer = {}) {
  const templateBytes = readTemplateBuffer(FORM_8949_TEMPLATE_PATH);
  const outputPdf = await PDFDocument.create();
  const pageConfigs = build8949PageConfigs(formMapping);

  if (!pageConfigs.length) {
    return null;
  }

  for (const config of pageConfigs) {
    const pdf = await PDFDocument.load(templateBytes);
    const form = pdf.getForm();
    const identityFields = get8949IdentityFields(config.part);

    setIfPresent(form, identityFields.name, taxpayer.name || '');
    setIfPresent(form, identityFields.ssn, taxpayer.ssn || '');

    const checkboxIndex = FORM_8949_BOX_INDEX[config.part]?.[config.box];

    if (Number.isInteger(checkboxIndex)) {
      checkIfPresent(form, `${identityFields.checkboxPrefix}[${checkboxIndex}]`);
    }

    let pageProceeds = 0;
    let pageBasis = 0;
    let pageAdjustment = 0;
    let pageGainLoss = 0;

    config.rows.forEach((row, rowIndex) => {
      const fields = get8949RowFieldNames(config.part, rowIndex);

      setIfPresent(form, fields[0], row.description || '');
      setIfPresent(form, fields[1], '');
      setIfPresent(form, fields[2], '');
      setIfPresent(form, fields[3], row.proceeds || '');
      setIfPresent(form, fields[4], row.costOrOtherBasis || '');
      setIfPresent(form, fields[5], row.code || '');
      setIfPresent(form, fields[6], row.adjustmentAmount || '');
      setIfPresent(form, fields[7], row.gainOrLoss || '');

      pageProceeds += Number(row.totals.proceedsCents || 0);
      pageBasis += Number(row.totals.basisCents || 0);
      pageAdjustment += Number(row.totals.adjustmentCents || 0);
      pageGainLoss += Number(row.totals.gainLossCents || 0);
    });

    const totalsFields = get8949TotalsFieldNames(config.part);
    setIfPresent(form, totalsFields[0], (pageProceeds / 100).toFixed(2));
    setIfPresent(form, totalsFields[1], (pageBasis / 100).toFixed(2));
    setIfPresent(form, totalsFields[2], (pageAdjustment / 100).toFixed(2));
    setIfPresent(form, totalsFields[3], (pageGainLoss / 100).toFixed(2));

    form.flatten();

    const [copiedPage] = await outputPdf.copyPages(pdf, [identityFields.pageIndex]);
    outputPdf.addPage(copiedPage);
  }

  return Buffer.from(await outputPdf.save());
}

function getScheduleDIdentityFields() {
  return {
    page1Name: 'topmostSubform[0].Page1[0].f1_1[0]',
    page1Ssn: 'topmostSubform[0].Page1[0].f1_2[0]',
    page2Name: 'topmostSubform[0].Page2[0].f2_1[0]',
  };
}

function setScheduleDRow(form, fieldNames, row) {
  if (!row) {
    return;
  }

  setIfPresent(form, fieldNames[0], row.proceeds || '');
  setIfPresent(form, fieldNames[1], row.costOrOtherBasis || '');
  setIfPresent(form, fieldNames[2], row.adjustmentAmount || '0.00');
  setIfPresent(form, fieldNames[3], row.gainOrLoss || '');
}

async function buildFilledScheduleDPdf(formMapping, taxpayer = {}) {
  const templateBytes = readTemplateBuffer(SCHEDULE_D_TEMPLATE_PATH);
  const pdf = await PDFDocument.load(templateBytes);
  const form = pdf.getForm();
  const identityFields = getScheduleDIdentityFields();

  setIfPresent(form, identityFields.page1Name, taxpayer.name || '');
  setIfPresent(form, identityFields.page1Ssn, taxpayer.ssn || '');
  setIfPresent(form, identityFields.page2Name, taxpayer.name || '');

  setScheduleDRow(form, [
    'topmostSubform[0].Page1[0].Table_PartI[0].Row1b[0].f1_7[0]',
    'topmostSubform[0].Page1[0].Table_PartI[0].Row1b[0].f1_8[0]',
    'topmostSubform[0].Page1[0].Table_PartI[0].Row1b[0].f1_9[0]',
    'topmostSubform[0].Page1[0].Table_PartI[0].Row1b[0].f1_10[0]',
  ], formMapping.scheduleD.shortTerm.line1b);
  setScheduleDRow(form, [
    'topmostSubform[0].Page1[0].Table_PartI[0].Row2[0].f1_11[0]',
    'topmostSubform[0].Page1[0].Table_PartI[0].Row2[0].f1_12[0]',
    'topmostSubform[0].Page1[0].Table_PartI[0].Row2[0].f1_13[0]',
    'topmostSubform[0].Page1[0].Table_PartI[0].Row2[0].f1_14[0]',
  ], formMapping.scheduleD.shortTerm.line2);
  setScheduleDRow(form, [
    'topmostSubform[0].Page1[0].Table_PartI[0].Row3[0].f1_15[0]',
    'topmostSubform[0].Page1[0].Table_PartI[0].Row3[0].f1_16[0]',
    'topmostSubform[0].Page1[0].Table_PartI[0].Row3[0].f1_17[0]',
    'topmostSubform[0].Page1[0].Table_PartI[0].Row3[0].f1_18[0]',
  ], formMapping.scheduleD.shortTerm.line3);

  const shortTermTotal = [
    formMapping.scheduleD.shortTerm.line1b,
    formMapping.scheduleD.shortTerm.line2,
    formMapping.scheduleD.shortTerm.line3,
  ].reduce((sum, row) => sum + Number(row?.gainOrLoss || 0), 0);
  setIfPresent(form, 'topmostSubform[0].Page1[0].f1_22[0]', shortTermTotal.toFixed(2));

  setScheduleDRow(form, [
    'topmostSubform[0].Page1[0].Table_PartII[0].Row8b[0].f1_27[0]',
    'topmostSubform[0].Page1[0].Table_PartII[0].Row8b[0].f1_28[0]',
    'topmostSubform[0].Page1[0].Table_PartII[0].Row8b[0].f1_29[0]',
    'topmostSubform[0].Page1[0].Table_PartII[0].Row8b[0].f1_30[0]',
  ], formMapping.scheduleD.longTerm.line8b);
  setScheduleDRow(form, [
    'topmostSubform[0].Page1[0].Table_PartII[0].Row9[0].f1_31[0]',
    'topmostSubform[0].Page1[0].Table_PartII[0].Row9[0].f1_32[0]',
    'topmostSubform[0].Page1[0].Table_PartII[0].Row9[0].f1_33[0]',
    'topmostSubform[0].Page1[0].Table_PartII[0].Row9[0].f1_34[0]',
  ], formMapping.scheduleD.longTerm.line9);
  setScheduleDRow(form, [
    'topmostSubform[0].Page1[0].Table_PartII[0].Row10[0].f1_35[0]',
    'topmostSubform[0].Page1[0].Table_PartII[0].Row10[0].f1_36[0]',
    'topmostSubform[0].Page1[0].Table_PartII[0].Row10[0].f1_37[0]',
    'topmostSubform[0].Page1[0].Table_PartII[0].Row10[0].f1_38[0]',
  ], formMapping.scheduleD.longTerm.line10);

  const longTermTotal = [
    formMapping.scheduleD.longTerm.line8b,
    formMapping.scheduleD.longTerm.line9,
    formMapping.scheduleD.longTerm.line10,
  ].reduce((sum, row) => sum + Number(row?.gainOrLoss || 0), 0);
  setIfPresent(form, 'topmostSubform[0].Page1[0].f1_43[0]', longTermTotal.toFixed(2));

  form.flatten();

  return Buffer.from(await pdf.save());
}

async function buildOfficialIrsPdfPackage(calculationResult, taxpayer = {}) {
  const formMapping = buildOfficialFormMapping(calculationResult);
  const form8949Pdf = await buildFilledForm8949Pdf(formMapping, taxpayer);
  const scheduleDPdf = await buildFilledScheduleDPdf(formMapping, taxpayer);

  return {
    form8949Pdf,
    scheduleDPdf,
    formMapping,
  };
}

module.exports = {
  buildFilledForm8949Pdf,
  buildFilledScheduleDPdf,
  buildOfficialIrsPdfPackage,
};
