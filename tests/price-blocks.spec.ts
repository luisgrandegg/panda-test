import { expect, test, type TestInfo } from '@playwright/test';
import { loadConfig } from '../src/config';
import {
  chooseOption,
  findPriceBlocks,
  openPage,
  parsePrice,
  pickBlock,
  priceAnchor,
  readPrices,
  tagPriceBlocks,
} from '../src/prices';

/** Structured evidence for scripts/build-report.mjs, attached to each test as JSON. */
function attachJson(testInfo: TestInfo, name: string, data: unknown) {
  return testInfo.attach(name, { body: JSON.stringify(data, null, 2), contentType: 'application/json' });
}

interface PriceCheck {
  block: number | string;
  select: Record<string, string | number>;
  /** Numbers for comparing, and the texts as written in the config for the report. */
  expected: { price: number; originalPrice?: number; discount?: string; priceText: string; originalPriceText?: string };
  found: { prices: number[]; originalPrices: number[]; discount?: boolean };
  passed: boolean;
  problem?: string;
}

for (const cfg of loadConfig()) {
  test.describe(cfg.name, () => {
    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(!!cfg.projects && !cfg.projects.includes(testInfo.project.name), `not configured for ${testInfo.project.name}`);
      testInfo.annotations.push({ type: 'url', description: cfg.url });
      await openPage(page, cfg);
    });

    test('price blocks are on the page', async ({ page }, testInfo) => {
      const blocks = await findPriceBlocks(page, cfg);
      const withoutPrice: number[] = [];
      for (let i = 0; i < (await blocks.count()); i++) {
        if (!(await readPrices(blocks.nth(i), cfg.selectors)).current.length) withoutPrice.push(i + 1);
      }
      await attachJson(testInfo, 'blocks', {
        found: await blocks.count(),
        expected: cfg.expectedPriceBlocks ?? `at least ${cfg.minPriceBlocks}`,
        withoutPrice,
      });
      if (cfg.expectedPriceBlocks !== undefined) {
        await expect(blocks, 'number of price blocks').toHaveCount(cfg.expectedPriceBlocks);
      }
      expect.soft(withoutPrice, 'price blocks without a price').toEqual([]);
    });

    test(`first price block is visible within ${cfg.maxScrolls} scrolls`, async ({ page }, testInfo) => {
      const blocks = await findPriceBlocks(page, cfg);
      const anchor = await priceAnchor(blocks.first(), cfg.selectors);
      await expect(anchor, 'first price block is displayed').toBeVisible();

      await page.evaluate(() => window.scrollTo(0, 0));
      const { bottom, viewportHeight } = await anchor.evaluate((el) => ({
        bottom: el.getBoundingClientRect().bottom + window.scrollY,
        viewportHeight: window.innerHeight,
      }));
      // 1 screen = visible without scrolling; 1.5 = needs half a screen of scrolling.
      const screens = Math.round((bottom / viewportHeight) * 100) / 100;
      testInfo.annotations.push({ type: 'first price position', description: `${screens} screens` });

      await attachJson(testInfo, 'fold', { screens, maxScrolls: cfg.maxScrolls, bottomPx: Math.round(bottom), viewportHeight });
      await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, bottom - viewportHeight));
      await anchor.evaluate((el) => ((el as HTMLElement).style.outline = '3px solid #e5484d'));
      await testInfo.attach('first price block', {
        body: await page.screenshot({ type: 'jpeg', quality: 75 }),
        contentType: 'image/jpeg',
      });

      expect(
        screens,
        `first price ends ${bottom}px down (${screens} screens of ${viewportHeight}px); allowed ${cfg.maxScrolls}`,
      ).toBeLessThanOrEqual(cfg.maxScrolls);
    });

    if (cfg.combinations.length) {
      test('price combinations', async ({ page }, testInfo) => {
        const soft = expect.configure({ soft: true });
        const checks: PriceCheck[] = [];
        try {
          const blocks = await findPriceBlocks(page, cfg);
          for (const [i, combo] of cfg.combinations.entries()) {
            const options = Object.entries(combo.select ?? {}).map(([k, v]) => `${k}=${v}`).join(', ');
            const check: PriceCheck = {
              block: combo.block,
              select: combo.select ?? {},
              expected: {
                price: parsePrice(combo.price),
                originalPrice: combo.originalPrice === undefined ? undefined : parsePrice(combo.originalPrice),
                discount: combo.discount,
                priceText: String(combo.price),
                originalPriceText: combo.originalPrice === undefined ? undefined : String(combo.originalPrice),
              },
              found: { prices: [], originalPrices: [] },
              passed: false,
            };
            checks.push(check);
            await test.step(`block "${combo.block}" ${options || '(default options)'} -> ${combo.price}`, async () => {
              const block = pickBlock(blocks, combo.block);
              // Choosing an option can re-render the card and drop its tag.
              const prices = async () => {
                if (!(await block.count())) await tagPriceBlocks(page, cfg.selectors.priceBlock);
                return readPrices(block, cfg.selectors);
              };
              await soft(block, `price block "${combo.block}" exists`).toBeVisible();
              if (!(await block.isVisible())) {
                check.problem = `No price block "${combo.block}" on the page`;
                return;
              }

              const missing: string[] = [];
              for (const [key, value] of Object.entries(combo.select ?? {})) {
                if (!(await block.count())) await tagPriceBlocks(page, cfg.selectors.priceBlock);
                if (!(await chooseOption(page, block, key, String(value), cfg.options))) missing.push(`${key}=${value}`);
              }
              soft(missing, 'options not found on the page').toEqual([]);
              if (missing.length) {
                check.problem = `Option not available on the page: ${missing.join(', ')}`;
                return;
              }

              const { price, originalPrice, discount } = check.expected;
              await soft
                .poll(async () => (await prices()).current, { message: `current price ${price}` })
                .toContain(price);
              if (originalPrice !== undefined) {
                await soft
                  .poll(async () => (await prices()).original, { message: `original price ${originalPrice}` })
                  .toContain(originalPrice);
              }
              if (discount) await soft(block).toContainText(discount);

              const found = await prices();
              check.found = {
                prices: found.current,
                originalPrices: found.original,
                discount: discount ? found.text.includes(discount) : undefined,
              };
              const problems = [
                !found.current.includes(price) && 'price',
                originalPrice !== undefined && !found.original.includes(originalPrice) && 'crossed-out price',
                check.found.discount === false && 'discount label',
              ].filter(Boolean);
              check.passed = !problems.length;
              if (problems.length) check.problem = `Wrong ${problems.join(', ')}`;
              await block.scrollIntoViewIfNeeded();
              await testInfo.attach(`card ${i + 1}`, {
                body: await block.screenshot({ type: 'jpeg', quality: 70 }),
                contentType: 'image/jpeg',
              });
            });
          }
        } finally {
          await attachJson(testInfo, 'price checks', checks);
        }
      });
    }
  });
}
