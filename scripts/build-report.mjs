// Turns the last test run (test-results/results.json) into a self-contained HTML report with an
// executive summary and the evidence: screenshots, first-price positions and every price checked.
//
//   node scripts/build-report.mjs [--summary-file FILE] [--fragment]
//
//   --summary-file  text for the "Executive summary" section (paragraphs, "- " bullets). Without
//                   it the report writes a factual summary itself.
//   --fragment      also write artifact.html: the same page without <!doctype>/<html>/<head>/<body>,
//                   for publishing as a claude.ai Artifact
//
// Writes reports/<run date>/report.html and summary.json (the figures and issues, for tools), and
// prints a short digest. Running it again for the same run overwrites that folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({
  options: {
    results: { type: 'string', default: path.join(root, 'test-results/results.json') },
    'summary-file': { type: 'string' },
    fragment: { type: 'boolean', default: false },
  },
});

if (!fs.existsSync(args.results)) {
  console.error(`No test results at ${args.results}. Run the tests first: npm test`);
  process.exit(1);
}
const run = JSON.parse(fs.readFileSync(args.results, 'utf8'));

// ---------- read the run ----------

const stripAnsi = (s = '') => s.replace(/\u001b\[[0-9;]*m/g, '');
const h = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function readAttachment(a) {
  if (a.body) return Buffer.from(a.body, 'base64');
  if (a.path && fs.existsSync(a.path)) return fs.readFileSync(a.path);
  return undefined;
}
const json = (a) => {
  const buf = a && readAttachment(a);
  try {
    return buf ? JSON.parse(buf.toString('utf8')) : undefined;
  } catch {
    return undefined;
  }
};
const image = (a) => {
  const buf = a && readAttachment(a);
  return buf ? `data:${a.contentType};base64,${buf.toString('base64')}` : undefined;
};

/** One entry per page × viewport, with the three checks. */
const rows = new Map();
function walk(suite, trail) {
  for (const child of suite.suites ?? []) walk(child, [...trail, child.title]);
  for (const spec of suite.specs ?? []) {
    const pageName = trail.at(-1);
    for (const t of spec.tests) {
      const key = `${pageName}\u0000${t.projectName}`;
      if (!rows.has(key)) {
        rows.set(key, { page: pageName, viewport: t.projectName, url: undefined, checks: {} });
      }
      const row = rows.get(key);
      const result = t.results.at(-1) ?? {};
      const annotations = [...(t.annotations ?? []), ...(result.annotations ?? [])];
      row.url ??= annotations.find((a) => a.type === 'url')?.description;
      const byName = (n) => result.attachments?.find((a) => a.name === n);
      const kind = spec.title.startsWith('price blocks')
        ? 'blocks'
        : spec.title.startsWith('first price')
          ? 'fold'
          : 'prices';
      row.checks[kind] = {
        status: t.status === 'skipped' ? 'skipped' : t.status === 'expected' || t.status === 'flaky' ? 'passed' : 'failed',
        errors: (result.errors ?? []).map((e) => stripAnsi(e.message ?? e.value ?? '')),
        blocks: json(byName('blocks')),
        fold: json(byName('fold')),
        prices: json(byName('price checks')),
        foldShot: image(byName('first price block')),
        failShot: image(result.attachments?.find((a) => a.name === 'screenshot')),
        cards: Object.fromEntries(
          (result.attachments ?? []).filter((a) => a.name.startsWith('card ')).map((a) => [a.name, image(a)]),
        ),
      };
    }
  }
}
for (const s of run.suites ?? []) walk(s, [s.title]);
const all = [...rows.values()].filter((r) => Object.values(r.checks).some((c) => c.status !== 'skipped'));

// ---------- figures and issues ----------

/** Formats a number the way the expected price was written ("27,96 €", "€27.96", "27.96"). */
function formatLike(sample, n) {
  if (n === undefined) return '';
  const comma = /\d,\d{1,2}(\D|$)/.test(sample ?? '');
  const num = n.toFixed(2).replace('.', comma ? ',' : '.');
  const cur = (sample ?? '').match(/€|\$|£|EUR|USD|GBP/)?.[0];
  if (!cur) return num;
  return /^\s*(€|\$|£|EUR|USD|GBP)/.test(sample) ? `${cur}${num}` : `${num} ${cur}`;
}
const optionsText = (select) =>
  [select.devices && `${select.devices} device${select.devices > 1 ? 's' : ''}`, select.years && `${select.years} year${select.years > 1 ? 's' : ''}`]
    .filter(Boolean)
    .join(' / ') || 'default options';
const firstLine = (s) => s.split('\n').find((l) => l.trim())?.trim() ?? '';

const issues = [];
let checksRun = 0;
let checksPassed = 0;
let pricesRun = 0;
let pricesPassed = 0;
let worstFold;

for (const r of all) {
  const where = `${r.page} (${r.viewport})`;
  for (const [kind, c] of Object.entries(r.checks)) {
    if (c.status === 'skipped') continue;
    checksRun++;
    if (c.status === 'passed') checksPassed++;
    if (kind === 'fold' && c.fold && (!worstFold || c.fold.screens > worstFold.screens)) {
      worstFold = { ...c.fold, where };
    }
    if (kind === 'prices' && c.prices) {
      pricesRun += c.prices.length;
      pricesPassed += c.prices.filter((p) => p.passed).length;
    }
    if (c.status !== 'failed') continue;

    if (kind === 'blocks' && c.blocks) {
      if (typeof c.blocks.expected === 'number' && c.blocks.found !== c.blocks.expected) {
        issues.push({ where, check: 'Price cards', text: `found ${c.blocks.found} price cards, expected ${c.blocks.expected}` });
      }
      if (c.blocks.withoutPrice?.length) {
        issues.push({ where, check: 'Price cards', text: `card(s) ${c.blocks.withoutPrice.join(', ')} show no price` });
      }
    } else if (kind === 'fold' && c.fold) {
      issues.push({
        where,
        check: 'First price position',
        text: `the first price is ${c.fold.screens} screens down; the limit is ${c.fold.maxScrolls}`,
      });
    } else if (kind === 'prices' && c.prices?.length) {
      for (const p of c.prices.filter((x) => !x.passed)) {
        const what = `${p.block}, ${optionsText(p.select)}`;
        if (p.problem && !p.problem.startsWith('Wrong')) {
          issues.push({ where, check: 'Price', text: `${what}: ${p.problem.toLowerCase()}` });
          continue;
        }
        const bits = [];
        if (!p.found.prices.includes(p.expected.price)) {
          bits.push(
            `price ${p.expected.priceText}, page shows ${p.found.prices.map((n) => formatLike(p.expected.priceText, n)).join(' / ') || 'no price'}`,
          );
        }
        if (p.expected.originalPrice !== undefined && !p.found.originalPrices.includes(p.expected.originalPrice)) {
          bits.push(
            `crossed-out price ${p.expected.originalPriceText}, page shows ${p.found.originalPrices.map((n) => formatLike(p.expected.originalPriceText, n)).join(' / ') || 'none'}`,
          );
        }
        if (p.found.discount === false) bits.push(`discount label "${p.expected.discount}" not shown`);
        issues.push({ where, check: 'Price', text: `${what}: expected ${bits.join('; ') || 'a different result'}` });
      }
    }
    // A failure the structured data does not explain (page did not load, test crashed...).
    const explained = issues.some((i) => i.where === where && i.check === { blocks: 'Price cards', fold: 'First price position', prices: 'Price' }[kind]);
    if (!explained) {
      issues.push({ where, check: { blocks: 'Price cards', fold: 'First price position', prices: 'Price' }[kind], text: `could not be checked: ${firstLine(c.errors[0] ?? 'unknown error')}` });
    }
  }
}

const passed = checksRun > 0 && checksRun === checksPassed;
const pageNames = [...new Set(all.map((r) => r.page))];
const viewports = [...new Set(all.map((r) => r.viewport))];
const started = new Date(run.stats?.startTime ?? Date.now());
const durationS = Math.round((run.stats?.duration ?? 0) / 1000);

const summary = {
  status: checksRun === 0 ? 'no-tests' : passed ? 'passed' : 'failed',
  startedAt: started.toISOString(),
  durationSeconds: durationS,
  pages: pageNames.length,
  viewports,
  checks: { run: checksRun, passed: checksPassed },
  prices: { run: pricesRun, passed: pricesPassed },
  worstFirstPrice: worstFold ? { screens: worstFold.screens, limit: worstFold.maxScrolls, where: worstFold.where } : null,
  issues,
};

// ---------- executive summary text ----------

function autoSummary() {
  if (!checksRun) return ['No tests ran. Check that config/pages.json lists pages and that the run was not interrupted.'];
  const lines = [
    `${pageNames.length} page${pageNames.length > 1 ? 's' : ''} checked on ${viewports.join(' and ')}: ${checksPassed} of ${checksRun} checks passed${pricesRun ? `, and ${pricesPassed} of ${pricesRun} prices matched` : ''}.`,
  ];
  if (worstFold) {
    lines.push(
      `The first price appears at most ${worstFold.screens} screens down (${worstFold.where}); the limit is ${worstFold.maxScrolls}.`,
    );
  }
  lines.push(passed ? 'No action needed.' : `${issues.length} issue${issues.length > 1 ? 's' : ''} to review, listed below.`);
  return lines;
}

function renderText(text) {
  const out = [];
  let list = [];
  const flush = () => list.length && (out.push(`<ul>${list.map((li) => `<li>${li}</li>`).join('')}</ul>`), (list = []));
  const inline = (s) => h(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  for (const block of text.split(/\n\s*\n/)) {
    for (const line of block.split('\n').filter((l) => l.trim())) {
      if (/^\s*[-*]\s+/.test(line)) list.push(inline(line.replace(/^\s*[-*]\s+/, '')));
      else (flush(), out.push(`<p>${inline(line)}</p>`));
    }
    flush();
  }
  return out.join('\n');
}

const summaryHtml = args['summary-file']
  ? renderText(fs.readFileSync(args['summary-file'], 'utf8'))
  : autoSummary().map((l) => `<p>${h(l)}</p>`).join('\n');

// ---------- HTML ----------

const pill = (status, label) => `<span class="pill ${status}">${h(label ?? { passed: 'Pass', failed: 'Fail', skipped: 'Not run' }[status])}</span>`;

function matrixCell(c, detail) {
  if (!c) return '<td class="muted">–</td>';
  return `<td>${pill(c.status)}${detail ? ` <span class="detail">${h(detail)}</span>` : ''}</td>`;
}

const matrix = all
  .map((r) => {
    const { blocks, fold, prices } = r.checks;
    const priceDetail = prices?.prices ? `${prices.prices.filter((p) => p.passed).length}/${prices.prices.length}` : '';
    return `<tr>
      <th scope="row">${h(r.page)}</th><td class="mono">${h(r.viewport)}</td>
      ${matrixCell(blocks, blocks?.blocks ? `${blocks.blocks.found} found` : '')}
      ${matrixCell(fold, fold?.fold ? `${fold.fold.screens} / ${fold.fold.maxScrolls}` : '')}
      ${matrixCell(prices, priceDetail)}
    </tr>`;
  })
  .join('');

const issuesHtml = issues.length
  ? `<ol class="issues">${issues
      .map((i) => `<li><span class="where">${h(i.where)} · ${h(i.check)}</span><span>${h(i.text)}</span></li>`)
      .join('')}</ol>`
  : '<p class="muted">None. Every check passed.</p>';

function priceTable(c) {
  if (!c?.prices?.length) return '';
  const rowsHtml = c.prices
    .map((p, i) => {
      const found = p.found.prices.map((n) => formatLike(p.expected.priceText, n)).join(' / ');
      const foundOrig = p.found.originalPrices.map((n) => formatLike(p.expected.originalPriceText, n)).join(' / ');
      const shot = c.cards[`card ${i + 1}`];
      return `<tr class="${p.passed ? '' : 'bad'}">
        <td>${h(p.block)}</td><td class="opts">${h(optionsText(p.select))}</td>
        <td class="num">${h(p.expected.priceText)}</td><td class="num">${h(found || '–')}</td>
        <td class="num">${h(p.expected.originalPriceText ?? '–')}</td><td class="num">${h(p.expected.originalPriceText ? foundOrig || '–' : '–')}</td>
        <td>${p.expected.discount ? `${h(p.expected.discount)} ${p.found.discount ? '✓' : p.found.discount === false ? '✗' : ''}` : '–'}</td>
        <td>${pill(p.passed ? 'passed' : 'failed')}${p.problem ? `<div class="detail">${h(p.problem)}</div>` : ''}</td>
        <td>${shot ? `<details><summary>View card</summary><img loading="lazy" src="${shot}" alt="${h(p.block)} card, ${h(optionsText(p.select))}"></details>` : ''}</td>
      </tr>`;
    })
    .join('');
  return `<div class="scroll"><table class="prices">
    <thead><tr><th>Product</th><th>Options</th><th class="num">Expected</th><th class="num">On page</th><th class="num">Crossed-out expected</th><th class="num">On page</th><th>Discount</th><th>Result</th><th>Evidence</th></tr></thead>
    <tbody>${rowsHtml}</tbody></table></div>`;
}

function errorsHtml(r) {
  const failed = Object.entries(r.checks).filter(([, c]) => c.status === 'failed');
  if (!failed.length) return '';
  return failed
    .map(
      ([kind, c]) => `<details class="tech"><summary>Technical details: ${h({ blocks: 'price cards', fold: 'first price position', prices: 'prices' }[kind])}</summary>
        ${c.errors.map((e) => `<pre>${h(e.slice(0, 4000))}</pre>`).join('')}
        ${c.failShot ? `<img loading="lazy" src="${c.failShot}" alt="Page at the moment of failure">` : ''}
      </details>`,
    )
    .join('');
}

const evidence = pageNames
  .map((name) => {
    const pageRows = all.filter((r) => r.page === name);
    const url = pageRows.find((r) => r.url)?.url;
    return `<section class="page">
      <h3>${h(name)}</h3>
      ${url ? `<p class="url mono"><a href="${h(url)}" target="_blank" rel="noopener">${h(url)}</a></p>` : ''}
      ${pageRows
        .map((r) => {
          const { fold } = r.checks;
          return `<div class="viewport">
            <h4>${h(r.viewport)}</h4>
            <div class="vgrid">
              <figure class="shot">
                ${fold?.foldShot ? `<img loading="lazy" src="${fold.foldShot}" alt="First price block on ${h(r.viewport)}">` : '<div class="noshot">No screenshot</div>'}
                <figcaption>${
                  fold?.fold
                    ? `First price ends ${fold.fold.bottomPx}px down: <strong>${fold.fold.screens} screens</strong> of ${fold.fold.viewportHeight}px (limit ${fold.fold.maxScrolls}). Outlined in red.`
                    : 'First price position not measured.'
                }</figcaption>
              </figure>
              <div class="vbody">
                ${priceTable(r.checks.prices) || '<p class="muted">No prices configured for this page.</p>'}
                ${errorsHtml(r)}
              </div>
            </div>
          </div>`;
        })
        .join('')}
    </section>`;
  })
  .join('');

const dateText = started.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
const verdict =
  summary.status === 'passed' ? 'All checks passed' : summary.status === 'failed' ? `${issues.length} issue${issues.length > 1 ? 's' : ''} found` : 'No tests ran';

const body = `<title>Price Check Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>
  :root {
    --paper: #f6f8fb; --panel: #ffffff; --ink: #18212d; --soft: #5a6677; --rule: #dbe1ea;
    --accent: #2459b8; --pass: #1d7f55; --pass-bg: #e3f4ec; --fail: #b8322b; --fail-bg: #fbe7e5;
    --warn: #9a6512; --skip-bg: #eef1f5; --band: #eaf0fa;
    --sans: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif; --mono: "IBM Plex Mono", Consolas, ui-monospace, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --paper: #11161d; --panel: #18202a; --ink: #e5eaf1; --soft: #9aa6b6; --rule: #2a3441;
      --accent: #79a6ff; --pass: #4cc48d; --pass-bg: #163326; --fail: #ff7a70; --fail-bg: #3a1c1a;
      --warn: #e0a64b; --skip-bg: #222b36; --band: #1a2533;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --paper: #11161d; --panel: #18202a; --ink: #e5eaf1; --soft: #9aa6b6; --rule: #2a3441;
    --accent: #79a6ff; --pass: #4cc48d; --pass-bg: #163326; --fail: #ff7a70; --fail-bg: #3a1c1a;
    --warn: #e0a64b; --skip-bg: #222b36; --band: #1a2533;
  }
  * { box-sizing: border-box; }
  img { max-width: 100%; height: auto; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.55 var(--sans); padding-inline: 16px; }
  .wrap { max-width: 1120px; margin: 0 auto; padding-block: 32px 64px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 40px; }
  h1, h2, h3, h4 { margin: 0; line-height: 1.2; text-wrap: balance; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--soft); font-weight: 600; margin-bottom: 14px; }
  h3 { font-size: 20px; font-weight: 600; }
  h4 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; font-family: var(--mono); font-weight: 500; color: var(--soft); }
  p { margin: 0; max-width: 68ch; }
  a { color: var(--accent); }
  .mono, .num, .detail, pre { font-family: var(--mono); }
  .muted { color: var(--soft); }
  header { display: grid; gap: 18px; }
  .eyebrow { font-family: var(--mono); font-size: 12px; color: var(--soft); display: flex; flex-wrap: wrap; gap: 6px 18px; }
  .verdict { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 18px 20px; border-radius: 10px; background: var(--band); border-left: 6px solid var(--accent); }
  .verdict.passed { border-left-color: var(--pass); }
  .verdict.failed { border-left-color: var(--fail); }
  .verdict h1 { font-size: clamp(24px, 4vw, 34px); font-weight: 700; }
  .exec { display: grid; gap: 10px; font-size: 16px; }
  .exec ul { margin: 0; padding-left: 20px; max-width: 68ch; }
  .figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
  .figure { background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; padding: 14px 16px; display: grid; gap: 2px; }
  .figure b { font-size: 28px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .figure span { font-size: 13px; color: var(--soft); }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; background: var(--panel); font-size: 14px; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--rule); vertical-align: top; }
  thead th { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--soft); font-weight: 600; }
  td.opts { white-space: nowrap; }
  tbody th { font-weight: 500; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.bad td { background: var(--fail-bg); }
  .pill { display: inline-block; font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 999px; letter-spacing: .02em; }
  .pill.passed { background: var(--pass-bg); color: var(--pass); }
  .pill.failed { background: var(--fail-bg); color: var(--fail); }
  .pill.skipped { background: var(--skip-bg); color: var(--soft); }
  .verdict .pill { font-size: 14px; padding: 4px 12px; }
  .detail { font-size: 12px; color: var(--soft); }
  .issues { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; counter-reset: i; }
  .issues li { background: var(--panel); border: 1px solid var(--rule); border-left: 4px solid var(--fail); border-radius: 6px; padding: 10px 14px; display: grid; gap: 2px; }
  .issues .where { font-size: 12px; font-family: var(--mono); color: var(--soft); }
  .page { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; padding-top: 24px; border-top: 1px solid var(--rule); }
  .url { font-size: 12px; word-break: break-all; }
  .viewport { display: grid; gap: 10px; }
  .vgrid { display: grid; gap: 16px; }
  .shot { margin: 0; display: grid; gap: 8px; max-width: 560px; }
  .shot img { border: 1px solid var(--rule); border-radius: 6px; display: block; max-height: 640px; width: auto; }
  .shot figcaption { font-size: 13px; color: var(--soft); }
  .noshot { border: 1px dashed var(--rule); border-radius: 6px; padding: 40px 12px; text-align: center; color: var(--soft); }
  .vbody { display: grid; gap: 12px; min-width: 0; }
  details summary { cursor: pointer; color: var(--accent); font-size: 13px; white-space: nowrap; }
  details summary:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  details img { margin-top: 8px; max-width: 320px; width: 100%; border: 1px solid var(--rule); border-radius: 6px; display: block; }
  details.tech { background: var(--panel); border: 1px solid var(--rule); border-radius: 6px; padding: 10px 14px; }
  details.tech img { max-width: 100%; }
  pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; background: var(--paper); padding: 10px; border-radius: 4px; margin: 8px 0 0; }
  footer { font-size: 13px; color: var(--soft); display: grid; gap: 4px; border-top: 1px solid var(--rule); padding-top: 16px; }
  code { font-family: var(--mono); font-size: 12px; }
</style>
<div class="wrap">
  <header>
    <div class="eyebrow"><span>Promo page price check</span><span>${h(dateText)}</span><span>${durationS}s</span><span>${h(viewports.join(' + '))}</span></div>
    <div class="verdict ${summary.status}">${pill(summary.status === 'passed' ? 'passed' : summary.status === 'failed' ? 'failed' : 'skipped', summary.status === 'passed' ? 'PASS' : summary.status === 'failed' ? 'FAIL' : 'NO RUN')}<h1>${h(verdict)}</h1></div>
  </header>

  <section><h2>Executive summary</h2><div class="exec">${summaryHtml}</div></section>

  <section class="figures" aria-label="Key figures">
    <div class="figure"><b>${pageNames.length}</b><span>pages checked</span></div>
    <div class="figure"><b>${checksPassed}/${checksRun}</b><span>checks passed</span></div>
    <div class="figure"><b>${pricesPassed}/${pricesRun}</b><span>prices matched</span></div>
    <div class="figure"><b>${worstFold ? `${worstFold.screens}` : '–'}</b><span>screens to the first price, worst case${worstFold ? ` (limit ${worstFold.maxScrolls})` : ''}</span></div>
  </section>

  <section><h2>Results by page</h2><div class="scroll"><table>
    <thead><tr><th>Page</th><th>Viewport</th><th>Price cards</th><th>First price position</th><th>Prices</th></tr></thead>
    <tbody>${matrix}</tbody></table></div></section>

  <section><h2>Issues</h2>${issuesHtml}</section>

  <section><h2>Evidence</h2><div style="display:grid;gap:32px">${evidence || '<p class="muted">No evidence recorded.</p>'}</div></section>

  <footer>
    <span>Playwright ${h(run.config?.version ?? '')} · Node ${h(process.versions.node)} · ${h(os.type())} · ${pageNames.length} page(s) from config/pages.json</span>
    <span>Full technical report with traces: run <code>npm run report</code> on the machine that ran the tests.</span>
  </footer>
</div>`;

const htmlOut = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${body.replace('</style>', '</style>\n</head>\n<body>')}\n</body>\n</html>\n`;

const stamp = started.toISOString().slice(0, 16).replace('T', '_').replace(':', '');
const outDir = path.join(root, 'reports', stamp);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'report.html'), htmlOut);
fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
if (args.fragment) fs.writeFileSync(path.join(outDir, 'artifact.html'), body);

console.log(`Report: ${path.join(outDir, 'report.html')}`);
console.log(`Status: ${summary.status.toUpperCase()} · checks ${checksPassed}/${checksRun} · prices ${pricesPassed}/${pricesRun}`);
for (const i of issues) console.log(`  - ${i.where} · ${i.check}: ${i.text}`);
