const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const express = require('express');
const cookieParser = require('cookie-parser');

const bitcoinTaxRoutes = require('../routes/BitcoinTaxRoutes');

function createTestApp() {
  const app = express();

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));

  app.get('/', (_req, res) => {
    res.redirect('/bitcoin-tax');
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(bitcoinTaxRoutes);

  return app;
}

async function withServer(run) {
  const app = createTestApp();
  const server = app.listen(0);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test server did not expose a valid address');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run({ baseUrl });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

async function maybeWithServer(t, run) {
  try {
    await withServer(run);
  } catch (error) {
    if (error && error.code === 'EPERM') {
      t.skip('Local socket binding is not permitted in this environment.');
      return;
    }

    throw error;
  }
}

function extractSessionCookie(response) {
  return response.headers.get('set-cookie');
}

function buildStrikePurchaseCsv() {
  return [
    'Reference,Date & Time (UTC),Transaction Type,Amount USD,Fee USD,Amount BTC,Fee BTC,BTC Price,Cost Basis (USD),Destination,Description,Transaction Hash',
    'ref-buy,Nov 23 2025 02:03:01,Purchase,100.00,0.98,0.00115043,0.00000000,86894.12,100.00,,Recurring buy,',
  ].join('\n');
}

test('GET /bitcoin-tax renders the beta workspace and creates a session cookie', async (t) => {
  await maybeWithServer(t, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/bitcoin-tax`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Bitcoin Tax Reporting/);
    assert.ok(extractSessionCookie(response));
  });
});

test('POST /bitcoin-tax/upload with no files returns a helpful validation message', async (t) => {
  await maybeWithServer(t, async ({ baseUrl }) => {
    const bootstrap = await fetch(`${baseUrl}/bitcoin-tax`);
    const cookie = extractSessionCookie(bootstrap);

    const form = new FormData();
    const response = await fetch(`${baseUrl}/bitcoin-tax/upload`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
      },
      body: form,
    });

    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Upload at least one CSV or PDF document to continue\./);
  });
});

test('uploading a valid Strike CSV moves the session into wallet review, then calculation-ready', async (t) => {
  await maybeWithServer(t, async ({ baseUrl }) => {
    const bootstrap = await fetch(`${baseUrl}/bitcoin-tax`);
    const cookie = extractSessionCookie(bootstrap);

    const uploadForm = new FormData();
    uploadForm.append(
      'documents',
      new Blob([buildStrikePurchaseCsv()], { type: 'text/csv' }),
      '2025 annual transactions.csv'
    );

    const uploadResponse = await fetch(`${baseUrl}/bitcoin-tax/upload`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
      },
      body: uploadForm,
    });
    const uploadHtml = await uploadResponse.text();

    assert.equal(uploadResponse.status, 200);
    assert.match(uploadHtml, /Accepted 1 uploaded file/);
    assert.match(uploadHtml, /Continue to wallet review/);

    const walletReviewResponse = await fetch(`${baseUrl}/bitcoin-tax/done-uploading`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
      },
    });
    const walletReviewHtml = await walletReviewResponse.text();

    assert.equal(walletReviewResponse.status, 200);
    assert.match(walletReviewHtml, /Confirm wallets/);
    assert.match(walletReviewHtml, /Wallet selections saved|Confirm the identifiers that belong to you|Continue without wallet selections/);

    const walletSaveForm = new URLSearchParams();
    const calculationReadyResponse = await fetch(`${baseUrl}/bitcoin-tax/wallets`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: walletSaveForm,
    });
    const calculationReadyHtml = await calculationReadyResponse.text();

    assert.equal(calculationReadyResponse.status, 200);
    assert.match(calculationReadyHtml, /Draft Calculation/);
    assert.match(calculationReadyHtml, /Download package|Run draft calculations|Draft rows are ready|No draft tax rows were produced yet|More information is still needed/);
  });
});

test('uploading an unsupported file type is rejected without breaking the session', async (t) => {
  await maybeWithServer(t, async ({ baseUrl }) => {
    const bootstrap = await fetch(`${baseUrl}/bitcoin-tax`);
    const cookie = extractSessionCookie(bootstrap);

    const form = new FormData();
    form.append(
      'documents',
      new Blob(['not-a-supported-tax-file'], { type: 'text/plain' }),
      'notes.txt'
    );

    const response = await fetch(`${baseUrl}/bitcoin-tax/upload`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
      },
      body: form,
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Some uploaded files were rejected and not added to this session\./);
    assert.match(html, /Rejected/);
    assert.match(html, /notes\.txt/);
  });
});
