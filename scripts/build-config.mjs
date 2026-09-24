// Builds config/pages.json from the marketing spreadsheets:
//   config/marketing/pages.csv   name, url, cards, max_scrolls, viewports
//   config/marketing/prices.csv  page, product, devices, years, price, original_price, discount
// and the page layout (selectors, option controls) in config/layout.json.
// Accepts ";" or "," separated files, as exported by Excel or Google Sheets.
import fs from 'node:fs';

const DIR = process.env.MARKETING_DIR ?? 'config/marketing';
const errors = [];

function parseCsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const header = text.slice(0, text.indexOf('\n'));
  const sep = (header.match(/;/g) ?? []).length >= (header.match(/,/g) ?? []).length ? ';' : ',';
  const rows = [];
  let row = [''];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') row[row.length - 1] += text[i++];
      else if (ch === '"') quoted = false;
      else row[row.length - 1] += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) row.push('');
    else if (ch === '\n') rows.push(row), (row = ['']);
    else if (ch !== '\r') row[row.length - 1] += ch;
  }
  rows.push(row);
  const [head, ...body] = rows.filter((r) => r.some((cell) => cell.trim()));
  const keys = head.map((h) => h.trim().toLowerCase());
  // Line numbers as the spreadsheet shows them (header is line 1).
  return body.map((r, i) => ({ line: i + 2, ...Object.fromEntries(keys.map((k, j) => [k, (r[j] ?? '').trim()])) }));
}

function required(row, file, ...keys) {
  for (const k of keys) if (!row[k]) errors.push(`${file} line ${row.line}: "${k}" is empty`);
}

const number = (value, file, row, key) => {
  if (!value) return undefined; // already reported by required()
  const n = Number(value.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) errors.push(`${file} line ${row.line}: "${key}" must be a number, got "${value}"`);
  return n;
};

const hasPrice = (v) => /\d/.test(v);

const pages = parseCsv(`${DIR}/pages.csv`).map((row) => {
  required(row, 'pages.csv', 'name', 'url');
  const page = { name: row.name, url: row.url };
  if (row.url && !/^https?:\/\//.test(row.url)) errors.push(`pages.csv line ${row.line}: url must start with http(s)://`);
  if (/[?&](gclid|gbraid|wbraid|gad_[a-z]+)=/.test(row.url)) {
    errors.push(`pages.csv line ${row.line}: remove ad click ids (gclid, gbraid, gad_...) from the url`);
  }
  if (row.cards) page.expectedPriceBlocks = number(row.cards, 'pages.csv', row, 'cards');
  if (row.max_scrolls) page.maxScrolls = number(row.max_scrolls, 'pages.csv', row, 'max_scrolls');
  const viewports = row.viewports?.toLowerCase();
  if (viewports === 'desktop' || viewports === 'mobile') page.projects = [viewports];
  else if (viewports && viewports !== 'both') {
    errors.push(`pages.csv line ${row.line}: viewports must be desktop, mobile or both, got "${row.viewports}"`);
  }
  page.combinations = [];
  return page;
});

const byName = new Map(pages.map((p) => [p.name, p]));
if (byName.size !== pages.length) errors.push('pages.csv: two pages have the same name');

for (const row of parseCsv(`${DIR}/prices.csv`)) {
  required(row, 'prices.csv', 'page', 'product', 'devices', 'years', 'price');
  const page = byName.get(row.page);
  if (!page) {
    if (row.page) errors.push(`prices.csv line ${row.line}: page "${row.page}" is not in pages.csv`);
    continue;
  }
  for (const key of ['price', 'original_price']) {
    if (row[key] && !hasPrice(row[key])) errors.push(`prices.csv line ${row.line}: "${key}" has no number: "${row[key]}"`);
  }
  const combo = {
    block: row.product,
    select: {
      devices: number(row.devices, 'prices.csv', row, 'devices'),
      years: number(row.years, 'prices.csv', row, 'years'),
    },
    price: row.price,
  };
  if (row.original_price) combo.originalPrice = row.original_price;
  if (row.discount) combo.discount = row.discount;
  page.combinations.push(combo);
}

if (errors.length) {
  console.error(`Cannot build config/pages.json:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}

const defaults = JSON.parse(fs.readFileSync('config/layout.json', 'utf8'));
fs.writeFileSync('config/pages.json', `${JSON.stringify({ defaults, pages }, null, 2)}\n`);
const combos = pages.reduce((n, p) => n + p.combinations.length, 0);
console.log(`config/pages.json: ${pages.length} page(s), ${combos} price combination(s)`);
