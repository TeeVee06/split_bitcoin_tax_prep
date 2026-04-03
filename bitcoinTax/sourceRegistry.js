const DOCUMENT_SOURCES = [
  {
    sourceId: 'split_spending_csv',
    displayName: 'Split spending CSV',
    category: 'split_export',
    implemented: true,
    parserId: 'split_csv',
    acceptedExtensions: ['.csv'],
    filenamePatterns: [/split/i, /reward.?spend/i, /merchant.?spend/i],
    headerHints: ['date', 'timestamp', 'merchant', 'sats', 'btc', 'amount'],
    description: 'Split export used to identify spend events and related merchant metadata.',
  },
  {
    sourceId: 'coinbase_gain_loss_csv',
    displayName: 'Coinbase Gain/Loss CSV',
    category: 'exchange_export',
    implemented: true,
    parserId: 'coinbase_gain_loss_csv',
    acceptedExtensions: ['.csv'],
    filenamePatterns: [/coinbase/i, /gain.?loss/i, /cb-gainlosscsv/i],
    headerHints: ['transaction type', 'tax lot id', 'asset name', 'amount', 'date acquired', 'cost basis usd', 'date of disposition', 'proceeds usd'],
    description: 'Coinbase gain/loss CSV exports used to preserve lot-level bitcoin basis and disposition data from Coinbase tax reports.',
  },
  {
    sourceId: 'coinbase_csv',
    displayName: 'Coinbase CSV',
    category: 'exchange_export',
    implemented: true,
    parserId: 'generic_exchange_csv',
    acceptedExtensions: ['.csv'],
    filenamePatterns: [/coinbase/i],
    headerHints: ['date', 'type', 'asset', 'amount', 'fee'],
    description: 'Coinbase CSV exports used to reconstruct bitcoin buys, sells, sends, and receives.',
  },
  {
    sourceId: 'kraken_csv',
    displayName: 'Kraken CSV',
    category: 'exchange_export',
    implemented: true,
    parserId: 'generic_exchange_csv',
    acceptedExtensions: ['.csv'],
    filenamePatterns: [/kraken/i],
    headerHints: ['date', 'type', 'asset', 'amount', 'fee'],
    description: 'Kraken CSV exports used to reconstruct bitcoin trades and transfers.',
  },
  {
    sourceId: 'cash_app_csv',
    displayName: 'Cash App Bitcoin CSV',
    category: 'exchange_export',
    implemented: true,
    parserId: 'cash_app_csv',
    acceptedExtensions: ['.csv'],
    filenamePatterns: [/cash/i, /transactions/i],
    headerHints: ['transaction id', 'transaction type', 'net amount', 'asset type', 'asset price', 'asset amount'],
    description: 'Cash App bitcoin transaction history CSV used to reconstruct bitcoin buys and Lightning movements.',
  },
  {
    sourceId: 'coinbase_1099_da_pdf',
    displayName: 'Coinbase 1099-DA PDF',
    category: 'tax_form',
    implemented: true,
    parserId: 'coinbase_1099_pdf',
    acceptedExtensions: ['.pdf'],
    filenamePatterns: [/coinbase/i, /1099/i],
    textPatterns: [/COINBASE/i, /1099/i, /(DIGITAL ASSET|1099-DA)/i],
    headerHints: [],
    description: 'First-pass text extraction for Coinbase 1099-DA PDFs.',
  },
  {
    sourceId: 'robinhood_1099_da_pdf',
    displayName: 'Robinhood 1099-DA PDF',
    category: 'tax_form',
    implemented: true,
    parserId: 'robinhood_1099_pdf',
    acceptedExtensions: ['.pdf'],
    filenamePatterns: [/robinhood/i, /1099/i],
    textPatterns: [/ROBINHOOD/i, /1099/i, /(DIGITAL ASSET|1099-DA)/i],
    headerHints: [],
    description: 'First-pass text extraction for Robinhood 1099-DA PDFs.',
  },
  {
    sourceId: 'cash_app_1099_da_pdf',
    displayName: 'Cash App 1099-DA PDF',
    category: 'tax_form',
    implemented: true,
    parserId: 'cash_app_1099_pdf',
    acceptedExtensions: ['.pdf'],
    filenamePatterns: [/cash/i, /1099/i],
    textPatterns: [/(FORM 1099-DA|DIGITAL ASSET PROCEEDS FROM BROKER TRANSACTIONS)/i, /(BLOCK, INC\.|SQUARE, INC\.|CASH APP)/i, /BITCOIN/i],
    headerHints: [],
    description: 'Provider-specific extraction for Cash App 1099-DA PDFs based on the sample layout.',
  },
  {
    sourceId: 'swan_tax_csv',
    displayName: 'Swan Tax CSV',
    category: 'exchange_export',
    implemented: true,
    parserId: 'generic_exchange_csv',
    acceptedExtensions: ['.csv'],
    filenamePatterns: [/swan/i, /tax csv/i, /tax report/i],
    headerHints: ['date', 'type', 'asset', 'amount', 'fee'],
    description: 'Swan tax CSV exports used to reconstruct bitcoin purchases, sales, and qualifying USD deposits.',
  },
  {
    sourceId: 'swan_deposits_purchases_csv',
    displayName: 'Swan Deposits and Purchases CSV',
    category: 'exchange_export',
    implemented: true,
    parserId: 'generic_exchange_csv',
    acceptedExtensions: ['.csv'],
    filenamePatterns: [/swan/i, /deposits/i, /purchases/i],
    headerHints: ['date', 'type', 'asset', 'amount', 'fee'],
    description: 'Swan deposits and purchases CSV exports used to reconstruct bitcoin purchases, deposits, and fee line items.',
  },
  {
    sourceId: 'strike_csv',
    displayName: 'Strike CSV',
    category: 'exchange_export',
    implemented: true,
    parserId: 'strike_csv',
    acceptedExtensions: ['.csv'],
    filenamePatterns: [/strike/i, /annual transactions/i],
    headerHints: ['reference', 'date & time utc', 'transaction type', 'amount usd', 'fee usd', 'amount btc', 'cost basis usd', 'transaction hash'],
    description: 'Strike CSV exports used to reconstruct tested bitcoin purchases, receives, and sends from Strike annual transaction exports.',
  },
  {
    sourceId: 'river_csv',
    displayName: 'River CSV',
    category: 'exchange_export',
    implemented: true,
    parserId: 'generic_exchange_csv',
    acceptedExtensions: ['.csv'],
    filenamePatterns: [/river/i],
    headerHints: ['date', 'type', 'asset', 'amount', 'fee'],
    description: 'River CSV exports used to reconstruct bitcoin purchases and transfers based on publicly documented export availability.',
  },
  {
    sourceId: 'fold_bitcoin_csv',
    displayName: 'Fold Bitcoin CSV',
    category: 'exchange_export',
    implemented: true,
    parserId: 'generic_exchange_csv',
    acceptedExtensions: ['.csv'],
    filenamePatterns: [/fold/i, /bitcoin transaction history/i, /bitcoin statement/i],
    headerHints: ['date', 'type', 'asset', 'amount', 'fee'],
    description: 'Fold bitcoin transaction history CSV exports used to reconstruct bitcoin buys, sells, receives, and transfers.',
  },
  {
    sourceId: 'generic_exchange_csv',
    displayName: 'Generic exchange or broker CSV',
    category: 'exchange_export',
    implemented: true,
    parserId: 'generic_exchange_csv',
    acceptedExtensions: ['.csv'],
    filenamePatterns: [/transaction/i, /history/i, /trade/i, /fills?/i, /account/i, /export/i],
    headerHints: ['date', 'type', 'asset', 'amount', 'fee'],
    description: 'CSV exports from exchanges and brokers that show buys, sells, deposits, withdrawals, and fees.',
  },
  {
    sourceId: 'form_1099_da_pdf',
    displayName: '1099-DA PDF',
    category: 'tax_form',
    implemented: true,
    parserId: 'generic_1099_pdf',
    acceptedExtensions: ['.pdf'],
    filenamePatterns: [/1099/i, /1099-da/i, /tax/i],
    textPatterns: [/1099/i, /(DIGITAL ASSET|1099-DA|BROKER)/i],
    headerHints: [],
    description: 'First-pass text extraction for 1099-DA PDFs.',
  },
  {
    sourceId: 'generic_1099_pdf',
    displayName: 'Generic 1099 tax PDF',
    category: 'tax_form',
    implemented: true,
    parserId: 'generic_1099_pdf',
    acceptedExtensions: ['.pdf'],
    filenamePatterns: [/1099/i, /tax/i, /statement/i],
    textPatterns: [/1099/i, /(DIGITAL ASSET|1099-DA|BROKER)/i],
    headerHints: [],
    description: 'First-pass text extraction for 1099 PDFs that document digital asset dispositions or related account activity.',
  },
];

const TESTED_SOURCE_IDS = new Set([
  'split_spending_csv',
  'cash_app_1099_da_pdf',
  'cash_app_csv',
  'coinbase_gain_loss_csv',
  'strike_csv',
]);

function listDocumentSources() {
  return DOCUMENT_SOURCES.map((source) => ({ ...source }));
}

function getDocumentSource(sourceId) {
  return DOCUMENT_SOURCES.find((source) => source.sourceId === sourceId) || null;
}

function summarizeSourcesByCategory() {
  const summaryMap = new Map();

  DOCUMENT_SOURCES.forEach((source) => {
    if (!summaryMap.has(source.category)) {
      summaryMap.set(source.category, {
        category: source.category,
        implemented: [],
        planned: [],
      });
    }

    const bucket = source.implemented ? 'implemented' : 'planned';
    summaryMap.get(source.category)[bucket].push(source);
  });

  return Array.from(summaryMap.values());
}

function summarizeSourceCoverage() {
  const testedAndVerified = [];
  const supportedButUntested = [];

  DOCUMENT_SOURCES.forEach((source) => {
    const coverageEntry = {
      sourceId: source.sourceId,
      displayName: source.displayName,
      coverageLabel: source.sourceId === 'split_spending_csv'
        ? 'Split CSV'
        : source.sourceId === 'cash_app_1099_da_pdf'
        ? 'Cash App 1099 form'
        : source.sourceId === 'cash_app_csv'
          ? 'Cash App transaction CSV'
          : source.sourceId === 'coinbase_gain_loss_csv'
            ? 'Coinbase gain/loss CSV'
            : source.displayName,
    };

    if (TESTED_SOURCE_IDS.has(source.sourceId)) {
      testedAndVerified.push(coverageEntry);
      return;
    }

    if (source.implemented) {
      supportedButUntested.push(coverageEntry);
    }
  });

  return {
    testedAndVerified,
    supportedButUntested,
  };
}

module.exports = {
  getDocumentSource,
  listDocumentSources,
  summarizeSourceCoverage,
  summarizeSourcesByCategory,
};
