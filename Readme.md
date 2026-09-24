# Promo page price block tests

Playwright checks for Panda promotion pages. For every URL in the config it checks:

1. **Price blocks are on the page.** At least `minPriceBlocks` blocks (or exactly `expectedPriceBlocks`), and each one shows a price.
2. **The first price block is visible early.** The first price of the first block must end within `maxScrolls` screen heights of the top of the page. `1` means visible without scrolling; the default `1.5` allows half a screen of scrolling.
3. **Price combinations.** For each combination in the config, the suite chooses the options (devices, years…) and checks the current price, and optionally the original price and the discount text. Every combination is checked even if an earlier one fails.

Every page runs twice, on a **desktop** viewport (1366×768) and a **mobile** one (Pixel 7), because the fold depends on screen size.

## Setup (Windows)

1. Clone this repository and open Claude Code in its folder.
2. Ask Claude to **"set up this computer for the price tests"** (the `onboarding` skill). It checks what's installed, then, with your OK, installs:
   - Node.js LTS (through `winget`)
   - the npm packages (`npm ci`)
   - Playwright's Chromium

   It finishes by running the preflight and the offline self-test.

Manual setup: install Node.js 20+ LTS, then run `npm ci` and `npx playwright install chromium`.

## Running

The easiest way: ask Claude to **"run the price tests"**. The `price-test-runner` agent (`.claude/agents/`):
1. Runs the preflight. If something is missing it stops, and says which skill fixes it.
2. Runs the whole suite.
3. Writes `reports/<date_time>/report.html`: a self-contained page with an executive summary, results per page and viewport, the issues in plain language, and the evidence (first-price screenshots, every price with a picture of its card, failure screenshots). Where claude.ai Artifacts are available, it also publishes the report as a private Artifact.

By hand:

```bash
npm run preflight               # Node, packages, browser, config, pages reachable (--offline skips the last)
npm run config                  # build config/pages.json from the marketing CSVs
node scripts/build-config.mjs --pages a.csv --prices b.csv --check   # validate other CSVs
npm test                        # build the config, then test desktop + mobile
npm run test:desktop            # desktop only
npm run report:summary          # executive HTML report of the last run, in reports/
npm run report                  # Playwright's technical report (traces, steps)
npm run discover                # list the blocks found on each page (checks nothing)
npm run test:selftest           # the suite against local copies of the page, no internet needed
```

To run a hand-written config: `PRICE_CONFIG=config/other.json npx playwright test` (in PowerShell: `$env:PRICE_CONFIG="config/other.json"; npx playwright test`).

## Config

Pages and prices come from two spreadsheets that the marketing team fills in: `config/marketing/pages.csv` and `config/marketing/prices.csv` (column guide: [GUIDE.md](.claude/skills/price-config/templates/GUIDE.md)). In Claude Code, the `/price-config` skill walks through it: it hands out blank templates, or validates your CSVs and generates the config. `npm run config` checks them and generates `config/pages.json`; `npm test` runs it first. So edit the CSVs, not `pages.json`.

The page layout shared by all promo pages (selectors, option controls) is in `config/layout.json` and becomes the `defaults` block below. To use extra settings the spreadsheets don't cover, write a JSON config by hand and run it with `PRICE_CONFIG=config/my.json npx playwright test`. `config/pages.example.json` shows more options.

```jsonc
{
  "defaults": {
    "maxScrolls": 1.5,
    "expectedPriceBlocks": 4,           // or "minPriceBlocks"
    "selectors": {
      // Desktop (>=1200px) and mobile cards; only the visible set counts.
      "priceBlock": "#hero_cards_desktop .hero_card, #hero_cards_mobile .hero_card_mobile",
      "price": ".prices .precio_despues",
      "originalPrice": ".prices .precio_antes"
    },
    "options": {
      // Desktop: shared buttons above the cards. Mobile: a <select> inside each card.
      "devices": ["#devices_number button[value='{value}']", "select[class*='licenseNumber']"],
      "years": ["#duration_number button[value='{value}']", "select[class*='licenseLenght']"]
    }
  },
  "pages": [
    {
      "name": "ES promo dome2305 (PPCES)",
      "url": "https://www.pandasecurity.com/security-promotion/?reg=ES&lang=es&...",
      "projects": ["desktop"],          // optional: desktop only
      "combinations": [
        { "block": "Essential", "select": { "devices": 1, "years": 1 }, "price": "27,96 €", "originalPrice": "39,95 €", "discount": "-30%" },
        { "block": "Premium", "select": { "devices": 10, "years": 2 }, "price": 99.99 }
      ]
    }
  ]
}
```

Combination fields:

| field | meaning |
|---|---|
| `block` | Product name as shown on the card (`"Essential"`, `"Advanced"`, `"Complete"`, `"Premium"`), or a 1-based position. |
| `select` | Options to set first. Keys match `options`; values are the button / `<select>` values (`1`, `3`, `5`, `10` devices; `1`, `2`, `3` years). Options carry over to the next combination, so list every option in each combination. |
| `price` | Expected current price: `19.99`, `"19,99 €"` or `"€19.99"`. |
| `originalPrice` | Expected crossed-out price (optional). |
| `discount` | Text the card must contain, e.g. `"-30%"` (optional). |

### Option controls

Each entry in `options` lists candidate selectors, tried in order: inside the card first, then on the whole page. The first visible one wins. `{value}` is replaced with the wanted value. For a `<select>`, the option is matched by value or label; anything else is clicked. That's how one combination works on both layouts. On desktop the `#devices_number` button is visible and gets clicked; on mobile the buttons are hidden, so the card's own `licenseNumber…` dropdown is used.

An option with no entry in `options` is looked up by its text instead (e.g. `"3 dispositivos"`), as a `<select>` option or clickable text. Use `"A > B"` to click through a custom dropdown.

## How blocks are found

With `selectors.priceBlock`, the blocks are the **visible** elements it matches. Without it, the suite guesses: a block is the container around a price (a number next to €, $ or £) that also has a call to action, widened to the whole card. `npm run discover` prints what was found on each page (tag, classes, prices, `<select>` options, text) and attaches a full-page screenshot with the blocks outlined in red to the HTML report.

## Self-test

`npm run test:selftest` runs the suite against local pages in `tests/fixtures/`. `dome2305.html` is a trimmed copy of the real layout (same ids, classes and 1200px breakpoint), tested with the same `defaults` as `pages.json`. `generic.html` covers auto-detection. Only the 1 device / 1 year prices in the fixture are real.
