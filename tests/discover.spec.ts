import { test } from '@playwright/test';
import { loadConfig } from '../src/config';
import { findPriceBlocks, openPage, readPrices } from '../src/prices';

// `npm run discover`: lists the price blocks found on each configured page, to help write
// selectors and price combinations. It checks nothing.
for (const cfg of loadConfig()) {
  test(`discover: ${cfg.name}`, async ({ page }, testInfo) => {
    await openPage(page, cfg);
    const blocks = await findPriceBlocks(page, cfg);
    const lines = [`\n=== ${cfg.name} [${testInfo.project.name}] ${cfg.url}`];
    for (let i = 0; i < (await blocks.count()); i++) {
      const block = blocks.nth(i);
      const { current, text } = await readPrices(block, cfg.selectors);
      const info = await block.evaluate((el) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id,
        classes: el.className.toString(),
        top: Math.round(el.getBoundingClientRect().top + window.scrollY),
        selects: [...el.querySelectorAll('select')].map((s) => [...s.options].map((o) => o.text.trim())),
      }));
      lines.push(
        `#${i + 1} <${info.tag}${info.id ? ` id="${info.id}"` : ''} class="${info.classes}"> top=${info.top}px`,
        `   prices: ${current.join(' | ')}`,
        ...info.selects.map((opts) => `   <select>: ${opts.join(' | ')}`),
        `   text: ${text.replace(/\s+/g, ' ').slice(0, 200)}`,
      );
    }
    console.log(lines.join('\n'));
    await page.addStyleTag({ content: '[data-pw-price-block]{outline:3px solid red!important}' });
    await testInfo.attach('price blocks', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
}
