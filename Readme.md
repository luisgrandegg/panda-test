# Promo page price block tests

Playwright checks for Panda promotion pages. For every URL in the config it checks:

1. **Price blocks are on the page.** At least `minPriceBlocks` blocks (or exactly `expectedPriceBlocks`), and each one shows a price.
2. **The first price block is visible early.** The first price of the first block must end within `maxScrolls` screen heights of the top of the page. `1` means visible without scrolling; the default `1.5` allows half a screen of scrolling.
3. **Price combinations.** For each combination in the config, the suite chooses the options (devices, years…) and checks the current price, and optionally the original price and the discount text. Every combination is checked even if an earlier one fails.

Every page runs twice, on a **desktop** viewport (1366×768) and a **mobile** one (Pixel 7), because the fold depends on screen size.

## Setup

```bash
npm install
npx playwright install chromium
```

## Running

```bash
npm test                        # config/pages.json, desktop + mobile
npm run test:desktop            # desktop only
PRICE_CONFIG=config/other.json npm test   # another config file
npm run discover                # list the blocks found on each page (checks nothing)
npm run test:selftest           # run the suite against the local fixture page
npm run report                  # open the HTML report (screenshots, traces)
```

## Config

`config/pages.json`. See `config/pages.example.json` for a fuller example.

```jsonc
{
  "defaults": {                       // applies to every page; any page can override it
    "maxScrolls": 1.5,
    "minPriceBlocks": 1,
    "cookieAccept": "#onetrust-accept-btn-handler",   // or false; common banners are tried by default
    "selectors": {                    // all optional, see "How blocks are found"
      "priceBlock": ".product-box",
      "price": ".price-final",
      "originalPrice": ".price-old"
    }
  },
  "pages": [
    {
      "name": "ES promo",
      "url": "https://www.pandasecurity.com/security-promotion/?reg=ES&lang=es&...",
      "expectedPriceBlocks": 3,
      "projects": ["desktop"],        // optional: run on desktop only
      "combinations": [
        { "block": 1, "price": "19,99 €", "originalPrice": "39,99 €", "discount": "-50%" },
        { "block": "Advanced", "select": { "devices": "3 dispositivos", "years": "2 años" }, "price": 49.99 }
      ]
    }
  ]
}
```

Combination fields:

| field | meaning |
|---|---|
| `block` | 1-based block number, or text in the block (e.g. the product name). |
| `select` | Options to choose first. The keys are only labels. Each value is looked for as a `<select>` option, then as clickable text; first inside the block, then on the whole page (for toggles shared by all blocks). Use `"Devices > 5"` to click through a custom dropdown. |
| `price` | Expected current price: `19.99`, `"19,99 €"` or `"€19.99"`. |
| `originalPrice` | Expected crossed-out price (optional). |
| `discount` | Text the block must contain, e.g. `"-50%"` (optional). |

## How blocks are found

With no `selectors`, the suite finds blocks on its own. A block is the container around a price (a number next to €, $ or £) that also has a call to action (a buy button or link), widened to the whole card. Prices split across elements, like `19<sup>,99 €</sup>`, are read correctly.

Detection is a heuristic, so once you know the page markup, set the selectors:

- `priceBlock`: when detection picks up something extra (such as a "desde 19,99 €" banner with a button) or misses a card.
- `price` / `originalPrice`: without them, `price` passes if the value appears **anywhere** in the block, so it can match the crossed-out price. With them, each value is read from its own element.

`npm run discover` prints what was found on each page (tag, classes, prices, `<select>` options, text) and attaches a full-page screenshot with the blocks outlined in red to the HTML report.
