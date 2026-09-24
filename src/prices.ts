import { expect, type Locator, type Page } from '@playwright/test';
import type { ResolvedPage, Selectors } from './config';

const CURRENCY = '€|\\$|£|EUR|USD|GBP';
const PRICE_RE = new RegExp(
  `(${CURRENCY})?\\s?(\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)\\s?(${CURRENCY})?`,
  'g',
);

/** Joins prices that the markup splits across lines, e.g. "19\n,99 €" -> "19,99 €". */
function normalize(text: string): string {
  return text.replace(/ /g, ' ').replace(/(\d)\s*([.,])\s*(\d)/g, '$1$2$3');
}

function toNumber(digits: string): number {
  const lastSep = Math.max(digits.lastIndexOf(','), digits.lastIndexOf('.'));
  // A separator followed by 1-2 digits is the decimal one; with 3 digits it separates thousands.
  const isDecimal = lastSep >= 0 && digits.length - lastSep - 1 <= 2;
  const int = (isDecimal ? digits.slice(0, lastSep) : digits).replace(/[.,]/g, '');
  const dec = isDecimal ? digits.slice(lastSep + 1) : '0';
  return Math.round(Number(`${int}.${dec}`) * 100) / 100;
}

/** Every price in a text. A number counts as a price when it has a currency sign or decimals. */
export function extractPrices(text: string): number[] {
  const prices: number[] = [];
  for (const m of normalize(text).matchAll(PRICE_RE)) {
    const [, before, digits, after] = m;
    if (before || after || /[.,]\d{1,2}$/.test(digits)) prices.push(toNumber(digits));
  }
  return prices;
}

/** 19.99, "19,99 €" and "€19.99" all become 19.99. */
export function parsePrice(value: number | string): number {
  if (typeof value === 'number') return Math.round(value * 100) / 100;
  const [first] = extractPrices(value);
  if (first === undefined) throw new Error(`Cannot read a price from "${value}"`);
  return first;
}

export async function acceptCookies(page: Page, selectors: string[]): Promise<void> {
  for (const sel of selectors) {
    const button = page.locator(sel).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 3000 }).catch(() => {});
      await button.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
      return;
    }
  }
}

export async function openPage(page: Page, cfg: ResolvedPage): Promise<void> {
  await page.goto(cfg.url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  if (cfg.cookieAccept.length) {
    // Consent banners often appear a moment after load.
    await page.locator(cfg.cookieAccept.join(', ')).first().waitFor({ timeout: 5000 }).catch(() => {});
    await acceptCookies(page, cfg.cookieAccept);
  }
}

/**
 * Marks the visible price blocks with data-pw-price-block="<n>" and their price elements with
 * data-pw-price. Uses selectors.priceBlock when given. Otherwise it treats as a block the widest
 * container around a price that also holds a call to action and no other block.
 */
export async function tagPriceBlocks(page: Page, blockSelector?: string): Promise<number> {
  return page.evaluate((blockSelector) => {
    const priceRe = /([€$£]\s?\d)|(\d\s?(€|\$|£|EUR|USD|GBP)(?![a-z]))/i;
    const buyRe = /compr|buy|añad|add to|obt[eé]n|consigu|suscr|subscri|order|checkout|oferta|ahora|now|get /i;
    const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ');
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.opacity !== '0';
    };
    const hasPrice = (el: Element) => priceRe.test(text(el));
    // Smallest elements that show a price.
    const pricesIn = (root: Element) =>
      [...root.querySelectorAll('*')].filter(
        (el) =>
          !el.closest('script, style, noscript, nav, footer') &&
          hasPrice(el) &&
          ![...el.children].some(hasPrice) &&
          visible(el),
      );

    document.querySelectorAll('[data-pw-price-block]').forEach((e) => e.removeAttribute('data-pw-price-block'));
    document.querySelectorAll('[data-pw-price]').forEach((e) => e.removeAttribute('data-pw-price'));

    let blocks: Element[];
    if (blockSelector) {
      blocks = [...document.querySelectorAll(blockSelector)].filter(visible);
    } else {
      const ctas = (root: Element) =>
        [...root.querySelectorAll('a[href], button, [role=button], input[type=submit]')].filter(visible);
      const found = new Set<Element>();
      for (const price of pricesIn(document.body)) {
        let fallback: Element | undefined;
        for (let el = price.parentElement; el && el !== document.body; el = el.parentElement) {
          const c = ctas(el);
          if (c.some((b) => buyRe.test(text(b)) || b.tagName === 'BUTTON')) {
            found.add(el);
            fallback = undefined;
            break;
          }
          if (c.length && !fallback) fallback = el;
        }
        if (fallback) found.add(fallback);
      }
      // Keep the innermost containers, then widen each one to its whole card.
      const inner = [...found].filter((a) => ![...found].some((b) => b !== a && a.contains(b)));
      const maxHeight = window.innerHeight * 1.5;
      blocks = inner.map((el) => {
        let block = el;
        for (let p = block.parentElement; p && p !== document.body; p = p.parentElement) {
          const pr = p.getBoundingClientRect();
          const br = block.getBoundingClientRect();
          const holdsOther = inner.some((o) => o !== el && p.contains(o));
          if (holdsOther || pr.width > br.width * 1.05 || pr.height > maxHeight) break;
          block = p;
        }
        return block;
      });
      blocks = [...new Set(blocks)];
    }

    blocks.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    blocks.forEach((block, i) => {
      block.setAttribute('data-pw-price-block', String(i + 1));
      pricesIn(block).forEach((p) => p.setAttribute('data-pw-price', ''));
    });
    return blocks.length;
  }, blockSelector);
}

/** Waits until at least `min` price blocks show up and returns a locator over all of them. */
export async function findPriceBlocks(page: Page, cfg: ResolvedPage, min = cfg.minPriceBlocks): Promise<Locator> {
  await expect
    .poll(() => tagPriceBlocks(page, cfg.selectors.priceBlock), {
      message: `at least ${min} price block(s) on the page`,
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(min);
  return page.locator('[data-pw-price-block]');
}

export function pickBlock(blocks: Locator, ref: number | string): Locator {
  return typeof ref === 'number' ? blocks.nth(ref - 1) : blocks.filter({ hasText: ref }).first();
}

/** The element the fold check measures: the block's first price, or the block itself. */
export async function priceAnchor(block: Locator, selectors: Selectors): Promise<Locator> {
  const price = block.locator(selectors.price ?? '[data-pw-price]').first();
  return (await price.count()) ? price : block;
}

export interface BlockPrices {
  current: number[];
  original: number[];
  text: string;
}

export async function readPrices(block: Locator, selectors: Selectors): Promise<BlockPrices> {
  const text = await block.innerText();
  const read = async (sel?: string) =>
    sel ? extractPrices(await block.locator(sel).first().innerText().catch(() => '')) : extractPrices(text);
  return { current: await read(selectors.price), original: await read(selectors.originalPrice), text };
}

async function clickOrSelect(scope: Locator | Page, step: string): Promise<boolean> {
  const wanted = step.trim().toLowerCase();
  for (const select of await scope.locator('select').all()) {
    if (!(await select.isVisible())) continue;
    const labels = await select.locator('option').allInnerTexts();
    const label = labels.find((l) => l.trim().toLowerCase() === wanted) ?? labels.find((l) => l.toLowerCase().includes(wanted));
    if (label !== undefined) {
      await select.selectOption({ label: label.trim() });
      return true;
    }
  }
  for (const exact of [true, false]) {
    const target = scope.getByText(step, { exact }).filter({ visible: true }).first();
    if (await target.count()) {
      await target.click();
      return true;
    }
  }
  return false;
}

/**
 * Chooses an option ("3 dispositivos", "2 años", "Dispositivos > 5") by looking inside the block
 * first and then on the whole page, for controls shared by every block such as a period toggle.
 * Returns false when a step could not be found.
 */
export async function chooseOption(page: Page, block: Locator, value: string): Promise<boolean> {
  for (const step of value.split(' > ')) {
    if (!(await clickOrSelect(block, step)) && !(await clickOrSelect(page, step))) return false;
  }
  return true;
}
