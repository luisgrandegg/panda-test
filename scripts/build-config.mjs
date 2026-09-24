// Builds config/pages.json from the marketing spreadsheets and the shared page layout.
//
//   node scripts/build-config.mjs [--pages FILE] [--prices FILE] [--check]
//
//   --pages   pages CSV  (name, url, cards, max_scrolls, viewports). Default config/marketing/pages.csv
//   --prices  prices CSV (page, product, devices, years, price, original_price, discount).
//             Default config/marketing/prices.csv
//   --check   validate only, do not write config/pages.json
//   --out     write the config to another file instead of config/pages.json
//
// The selectors and option controls come from config/layout.json. Accepts ";" or "," separated
// files, as exported by Excel or Google Sheets. Exits with 1 and lists every problem, with its
// spreadsheet line number, when the files are not valid.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// What the dome2305 promotion pages offer.
const PRODUCTS = ['Essential', 'Advanced', 'Complete', 'Premium'];
const DEVICES = [1, 3, 5, 10];
const YEARS = [1, 2, 3];
const PRICE_COLUMNS = ['page', 'product', 'devices', 'years', 'price', 'original_price', 'discount'];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({
  options: {
    pages: { type: 'string', default: path.join(root, 'config/marketing/pages.csv') },
    prices: { type: 'string', default: path.join(root, 'config/marketing/prices.csv') },
    check: { type: 'boolean', default: false },
    out: { type: 'string', default: path.join(root, 'config/pages.json') },
  },
});

const errors = [];
const warnings = [];

function parseCsv(file, label, columns) {
  if (!fs.existsSync(file)) {
    console.error(`Cannot find ${label}: ${path.resolve(file)}`);
    process.exit(1);
  }
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const header = text.split('\n', 1)[0];
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
  // Keep physical line numbers (header is line 1) so errors point at the right spreadsheet row.
  const numbered = rows.map((r, i) => ({ r, line: i + 1 })).filter(({ r }) => r.some((cell) => cell.trim()));
  if (!numbered.length) {
    errors.push(`${label}: the file is empty`);
    return [];
  }
  const keys = numbered[0].r.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const missing = columns.filter((c) => !keys.includes(c));
  if (missing.length) {
    errors.push(`${label}: missing column(s) ${missing.join(', ')}. The header must be: ${columns.join(sep)}`);
    return [];
  }
  const rowsOut = numbered
    .slice(1)
    .map(({ r, line }) => ({ line, ...Object.fromEntries(keys.map((k, j) => [k, (r[j] ?? '').trim()])) }));
  if (!rowsOut.length) warnings.push(`${label}: no rows under the header`);
  return rowsOut;
}

const at = (label, row) => `${label} line ${row.line}`;

function required(label, row, ...keys) {
  for (const k of keys) if (!row[k]) errors.push(`${at(label, row)}: "${k}" is empty`);
}

function number(label, row, key, allowed) {
  const value = row[key];
  if (!value) return undefined; // reported by required() when it matters
  const n = Number(value.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) {
    errors.push(`${at(label, row)}: "${key}" must be a number, got "${value}"`);
  } else if (allowed && !allowed.includes(n)) {
    errors.push(`${at(label, row)}: "${key}" must be one of ${allowed.join(', ')}, got "${value}"`);
  }
  return n;
}

function price(label, row, key) {
  const value = row[key];
  if (!value) return undefined;
  const m = value.replace(/\s/g, '').match(/\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?/);
  if (!m) {
    errors.push(`${at(label, row)}: "${key}" has no price in it: "${value}"`);
    return undefined;
  }
  const digits = m[0];
  const sep = Math.max(digits.lastIndexOf(','), digits.lastIndexOf('.'));
  const decimal = sep >= 0 && digits.length - sep - 1 <= 2;
  return Number(
    decimal ? `${digits.slice(0, sep).replace(/[.,]/g, '')}.${digits.slice(sep + 1)}` : digits.replace(/[.,]/g, ''),
  );
}

// ---- pages.csv ----
const P = 'pages.csv';
const pages = parseCsv(args.pages, P, ['name', 'url']).map((row) => {
  required(P, row, 'name', 'url');
  const page = { name: row.name, url: row.url };
  if (row.url && !/^https?:\/\/\S+$/.test(row.url)) {
    errors.push(`${at(P, row)}: "url" must start with https:// and have no spaces, got "${row.url}"`);
  }
  if (/[?&](gclid|gbraid|wbraid|gad_[a-z]+)=/.test(row.url)) {
    errors.push(`${at(P, row)}: remove the ad click ids (gclid, gbraid, wbraid, gad_...) from the url`);
  }
  if (row.cards) page.expectedPriceBlocks = number(P, row, 'cards', [1, 2, 3, 4]);
  if (row.max_scrolls) page.maxScrolls = number(P, row, 'max_scrolls');
  if (page.maxScrolls > 5) warnings.push(`${at(P, row)}: max_scrolls ${row.max_scrolls} is very lenient`);
  const viewports = row.viewports?.toLowerCase();
  if (viewports === 'desktop' || viewports === 'mobile') page.projects = [viewports];
  else if (viewports && viewports !== 'both') {
    errors.push(`${at(P, row)}: "viewports" must be desktop, mobile or both, got "${row.viewports}"`);
  }
  page.combinations = [];
  page.line = row.line;
  return page;
});

const byName = new Map();
for (const page of pages) {
  if (byName.has(page.name)) errors.push(`${P} line ${page.line}: the name "${page.name}" is used twice`);
  byName.set(page.name, page);
}

// ---- prices.csv ----
const R = 'prices.csv';
const seen = new Map();
for (const row of parseCsv(args.prices, R, PRICE_COLUMNS.slice(0, 5))) {
  required(R, row, 'page', 'product', 'devices', 'years', 'price');
  const page = byName.get(row.page);
  if (row.page && !page) {
    errors.push(`${at(R, row)}: page "${row.page}" is not in pages.csv (names must match exactly)`);
  }
  const product = PRODUCTS.find((p) => p.toLowerCase() === row.product.toLowerCase());
  if (row.product && !product) {
    errors.push(`${at(R, row)}: "product" must be one of ${PRODUCTS.join(', ')}, got "${row.product}"`);
  }
  const devices = number(R, row, 'devices', DEVICES);
  const years = number(R, row, 'years', YEARS);
  const now = price(R, row, 'price');
  const before = price(R, row, 'original_price');
  if (now !== undefined && before !== undefined && now >= before) {
    warnings.push(`${at(R, row)}: price ${row.price} is not lower than original_price ${row.original_price}`);
  }
  if (row.discount && !/^-?\d+([.,]\d+)?\s?%$/.test(row.discount)) {
    errors.push(`${at(R, row)}: "discount" must look like -30%, got "${row.discount}"`);
  }

  const key = [row.page, product, devices, years].join('|');
  if (seen.has(key)) {
    errors.push(`${at(R, row)}: same page, product, devices and years as line ${seen.get(key)}`);
  }
  seen.set(key, row.line);
  if (!page) continue;

  const combo = { block: product ?? row.product, select: { devices, years }, price: row.price };
  if (row.original_price) combo.originalPrice = row.original_price;
  if (row.discount) combo.discount = row.discount;
  page.combinations.push(combo);
}

for (const page of pages) {
  if (!page.combinations.length) warnings.push(`${P} line ${page.line}: "${page.name}" has no prices, only its cards and fold will be checked`);
  delete page.line;
}

// ---- report ----
for (const w of warnings) console.log(`warning: ${w}`);
if (errors.length) {
  console.error(`\n${errors.length} problem(s), config not generated:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}

const summary = pages.map((p) => `  ${p.name}: ${p.combinations.length} price(s)`).join('\n');
if (args.check) {
  console.log(`Valid: ${pages.length} page(s)\n${summary}`);
} else {
  const defaults = JSON.parse(fs.readFileSync(path.join(root, 'config/layout.json'), 'utf8'));
  fs.writeFileSync(args.out, `${JSON.stringify({ defaults, pages }, null, 2)}\n`);
  console.log(`Generated ${path.relative(root, args.out) || args.out}: ${pages.length} page(s)\n${summary}`);
}
