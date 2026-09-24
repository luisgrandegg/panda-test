// Checks that everything the price tests need is in place, without changing anything:
//
//   node scripts/preflight.mjs [--offline]
//
// 1. Node.js version   2. npm dependencies   3. Playwright's Chromium
// 4. marketing CSVs are valid (config/marketing/*.csv)   5. every page opens in the browser
//
// --offline skips step 5. Prints one line per check with how to fix a failure, and exits with 1
// when something blocks the test run.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const { values: args } = parseArgs({ options: { offline: { type: 'boolean', default: false } } });

let blocked = false;
const ok = (msg) => console.log(`  OK    ${msg}`);
const warn = (msg, fix) => console.log(`  WARN  ${msg}${fix ? `\n        -> ${fix}` : ''}`);
const fail = (msg, fix) => {
  blocked = true;
  console.log(`  FAIL  ${msg}${fix ? `\n        -> ${fix}` : ''}`);
};

console.log('Preflight\n');

// 1. Node.js
const major = Number(process.versions.node.split('.')[0]);
if (major >= 20) ok(`Node.js ${process.versions.node}`);
else fail(`Node.js ${process.versions.node} is too old (20 or newer needed)`, 'Install Node.js LTS (onboarding skill)');

// 2. npm dependencies
let playwrightVersion;
try {
  playwrightVersion = require('@playwright/test/package.json').version;
  const wanted = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')).packages?.[
    'node_modules/@playwright/test'
  ]?.version;
  if (wanted && wanted !== playwrightVersion) {
    fail(`@playwright/test ${playwrightVersion} installed, ${wanted} expected`, 'Run: npm ci');
  } else ok(`npm dependencies (Playwright ${playwrightVersion})`);
} catch {
  fail('npm dependencies are not installed', 'Run: npm ci');
}

// 3. Chromium for Playwright
let chromium;
if (playwrightVersion) {
  try {
    ({ chromium } = await import(require.resolve('playwright-core')).then((m) => m.default ?? m));
    const exe = chromium.executablePath();
    if (fs.existsSync(exe)) ok('Chromium for Playwright');
    else fail('Chromium for Playwright is not installed', 'Run: npx playwright install chromium');
  } catch (e) {
    fail(`Cannot load Playwright: ${e.message.split('\n')[0]}`, 'Run: npm ci');
  }
}

// 4. Config
let pages = [];
try {
  const out = execFileSync(process.execPath, [path.join(root, 'scripts/build-config.mjs'), '--check'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const warnings = out.split('\n').filter((l) => l.startsWith('warning:'));
  ok(`Config: ${out.split('\n').find((l) => l.startsWith('Valid:')).replace('Valid: ', '')} in config/marketing/`);
  for (const w of warnings) warn(w.replace('warning: ', 'Config: '));
  // The pages the test run will use once `npm test` regenerates config/pages.json.
  const tmp = path.join(os.tmpdir(), `price-preflight-${process.pid}.json`);
  execFileSync(process.execPath, [path.join(root, 'scripts/build-config.mjs'), '--out', tmp], { cwd: root, stdio: 'ignore' });
  pages = JSON.parse(fs.readFileSync(tmp, 'utf8')).pages;
  fs.rmSync(tmp, { force: true });
} catch (e) {
  const details = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || e.message;
  fail(`Config is not valid:\n        ${details.split('\n').join('\n        ')}`, 'Fix the CSVs (price-config skill)');
}

// 5. Pages reachable in the browser (also proves the browser starts)
if (args.offline) {
  warn('Page access not checked (--offline)');
} else if (chromium && pages.length && !blocked) {
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    for (const { name, url } of pages) {
      try {
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        if (res && res.status() >= 400) fail(`${name}: the page answered HTTP ${res.status()}`, `Check the url: ${url}`);
        else ok(`${name}: page opens`);
      } catch (e) {
        fail(
          `${name}: cannot open the page (${e.message.split('\n')[0]})`,
          'Check the internet connection, VPN/proxy, or the url in pages.csv',
        );
      }
    }
  } catch (e) {
    fail(`The browser does not start: ${e.message.split('\n')[0]}`, 'Run: npx playwright install chromium');
  } finally {
    await browser?.close();
  }
}

console.log(blocked ? '\nPreflight FAILED: fix the items above before running the tests.' : '\nPreflight passed.');
process.exit(blocked ? 1 : 0);
