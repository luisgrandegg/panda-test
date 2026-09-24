import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** CSS selectors. Anything left out falls back to auto-detection. */
export interface Selectors {
  /** One element per price block (product card). Auto-detected when omitted. */
  priceBlock?: string;
  /** Current (final) price inside a block. When omitted, every price in the block's text is used. */
  price?: string;
  /** Original / crossed-out price inside a block. */
  originalPrice?: string;
}

export interface PageSettings {
  /** How far down the first price block may sit, in screen heights. 1 = above the fold. Default 1.5. */
  maxScrolls?: number;
  /** Minimum number of price blocks the page must show. Default 1. */
  minPriceBlocks?: number;
  /** Exact number of price blocks the page must show. */
  expectedPriceBlocks?: number;
  /** Cookie banner "accept" button(s). `false` disables cookie handling. */
  cookieAccept?: string | string[] | false;
  selectors?: Selectors;
  /**
   * How to set each option used in `combinations[].select`, e.g.
   * { "devices": ["#devices_number button[value='{value}']", "select.licenseNumber"] }.
   * Candidates are tried in order, inside the block first and then on the whole page; the first
   * visible one is used. A <select> gets the option whose value or label matches; anything else is
   * clicked. `{value}` is replaced with the wanted value. Options without an entry are looked up
   * by their text instead.
   */
  options?: Record<string, string | string[]>;
  /** Only run this page on these Playwright projects (e.g. ["desktop"]). Default: all. */
  projects?: string[];
}

export interface PriceCombination {
  /** Which block: 1-based index, or text found in the block (e.g. the product name). */
  block: number | string;
  /**
   * Options to choose before reading the price, e.g. { "devices": 3, "years": 1 }.
   * Keys with an entry in `options` use those controls. For other keys the value is looked for as
   * a <select> option, then as clickable text, inside the block first and then on the whole page;
   * "A > B" clicks A and then B, for custom dropdowns.
   */
  select?: Record<string, string | number>;
  /** Expected current price, e.g. 19.99 or "19,99 €". */
  price: number | string;
  /** Expected original / crossed-out price. */
  originalPrice?: number | string;
  /** Text the block must contain after selecting, e.g. "-50%". */
  discount?: string;
}

export interface PageConfig extends PageSettings {
  name: string;
  url: string;
  combinations?: PriceCombination[];
}

export interface SuiteConfig {
  defaults?: PageSettings;
  pages: PageConfig[];
}

export interface ResolvedPage extends PageConfig {
  maxScrolls: number;
  minPriceBlocks: number;
  cookieAccept: string[];
  selectors: Selectors;
  options: Record<string, string[]>;
  combinations: PriceCombination[];
}

const DEFAULT_COOKIE_ACCEPT = [
  '#onetrust-accept-btn-handler',
  '#didomi-notice-agree-button',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  'button:has-text("Aceptar todas")',
  'button:has-text("Aceptar")',
  'button:has-text("Accept all")',
  'button:has-text("Accept")',
];

export const CONFIG_PATH = path.resolve(process.env.PRICE_CONFIG ?? 'config/pages.json');

function fail(msg: string): never {
  throw new Error(`Invalid config ${CONFIG_PATH}: ${msg}`);
}

function resolveUrl(url: string): string {
  // Relative paths point at local files next to the config (used by the self-test fixtures).
  if (url.startsWith('./') || url.startsWith('../')) {
    const [file, query] = url.split('?');
    return pathToFileURL(path.resolve(path.dirname(CONFIG_PATH), file)).href + (query ? `?${query}` : '');
  }
  return url;
}

export function loadConfig(): ResolvedPage[] {
  if (!fs.existsSync(CONFIG_PATH)) fail('file not found');
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as SuiteConfig;
  if (!Array.isArray(raw.pages) || raw.pages.length === 0) fail('"pages" must be a non-empty array');
  const d = raw.defaults ?? {};

  return raw.pages.map((p, i) => {
    if (!p.name) fail(`pages[${i}] is missing "name"`);
    if (!p.url) fail(`pages[${i}] ("${p.name}") is missing "url"`);
    for (const [j, c] of (p.combinations ?? []).entries()) {
      if (c.block === undefined) fail(`${p.name}: combinations[${j}] is missing "block"`);
      if (c.price === undefined) fail(`${p.name}: combinations[${j}] is missing "price"`);
    }
    const cookie = p.cookieAccept ?? d.cookieAccept;
    return {
      ...d,
      ...p,
      url: resolveUrl(p.url),
      maxScrolls: p.maxScrolls ?? d.maxScrolls ?? 1.5,
      minPriceBlocks: p.minPriceBlocks ?? d.minPriceBlocks ?? 1,
      expectedPriceBlocks: p.expectedPriceBlocks ?? d.expectedPriceBlocks,
      cookieAccept: cookie === false ? [] : cookie === undefined ? DEFAULT_COOKIE_ACCEPT : [cookie].flat(),
      selectors: { ...d.selectors, ...p.selectors },
      options: Object.fromEntries(
        Object.entries({ ...d.options, ...p.options }).map(([k, v]) => [k, [v].flat()]),
      ),
      projects: p.projects ?? d.projects,
      combinations: p.combinations ?? [],
    };
  });
}
