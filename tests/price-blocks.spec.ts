import { expect, test } from '@playwright/test';
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

for (const cfg of loadConfig()) {
  test.describe(cfg.name, () => {
    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(!!cfg.projects && !cfg.projects.includes(testInfo.project.name), `not configured for ${testInfo.project.name}`);
      testInfo.annotations.push({ type: 'url', description: cfg.url });
      await openPage(page, cfg);
    });

    test('price blocks are on the page', async ({ page }) => {
      const blocks = await findPriceBlocks(page, cfg);
      if (cfg.expectedPriceBlocks !== undefined) {
        await expect(blocks, 'number of price blocks').toHaveCount(cfg.expectedPriceBlocks);
      }
      for (let i = 0; i < (await blocks.count()); i++) {
        const { current } = await readPrices(blocks.nth(i), cfg.selectors);
        expect.soft(current.length, `price block ${i + 1} shows a price`).toBeGreaterThan(0);
      }
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

      await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, bottom - viewportHeight));
      await testInfo.attach('first price block', { body: await page.screenshot(), contentType: 'image/png' });

      expect(
        screens,
        `first price ends ${bottom}px down (${screens} screens of ${viewportHeight}px); allowed ${cfg.maxScrolls}`,
      ).toBeLessThanOrEqual(cfg.maxScrolls);
    });

    if (cfg.combinations.length) {
      test('price combinations', async ({ page }) => {
        const soft = expect.configure({ soft: true });
        const blocks = await findPriceBlocks(page, cfg);
        for (const combo of cfg.combinations) {
          const options = Object.entries(combo.select ?? {}).map(([k, v]) => `${k}=${v}`).join(', ');
          await test.step(`block "${combo.block}" ${options || '(default options)'} -> ${combo.price}`, async () => {
            const block = pickBlock(blocks, combo.block);
            // Choosing an option can re-render the card and drop its tag.
            const prices = async () => {
              if (!(await block.count())) await tagPriceBlocks(page, cfg.selectors.priceBlock);
              return readPrices(block, cfg.selectors);
            };
            await soft(block, `price block "${combo.block}" exists`).toBeVisible();
            if (!(await block.isVisible())) return;

            const missing: string[] = [];
            for (const value of Object.values(combo.select ?? {})) {
              if (!(await block.count())) await tagPriceBlocks(page, cfg.selectors.priceBlock);
              if (!(await chooseOption(page, block, value))) missing.push(value);
            }
            soft(missing, 'options not found on the page').toEqual([]);
            if (missing.length) return;

            const price = parsePrice(combo.price);
            await soft
              .poll(async () => (await prices()).current, { message: `current price ${price}` })
              .toContain(price);
            if (combo.originalPrice !== undefined) {
              const original = parsePrice(combo.originalPrice);
              await soft
                .poll(async () => (await prices()).original, { message: `original price ${original}` })
                .toContain(original);
            }
            if (combo.discount) await soft(block).toContainText(combo.discount);
          });
        }
      });
    }
  });
}
