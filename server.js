require('dotenv').config();

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

const bitcoinTaxRoutes = require('./routes/BitcoinTaxRoutes');

const app = express();
const port = Number(process.env.PORT || 5050);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.get('/', (_req, res) => {
  res.redirect('/bitcoin-tax');
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use(bitcoinTaxRoutes);

app.listen(port, () => {
  console.log(`split_bitcoin_tax_prep running at http://localhost:${port}`);
});
