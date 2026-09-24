# Price test spreadsheets

The automated tests open every page listed here and check its prices. Fill in both files and send them back, or edit them in Excel / Google Sheets and export as CSV with the same names. Separating columns with `;` or `,` both work.

## pages.csv: one row per landing page

| column | what to write | example |
|---|---|---|
| `name` | Any short, unique name. `prices.csv` refers to the page by it. | `ES promo dome2305 (PPCES)` |
| `url` | The landing URL with every parameter that changes the price (`reg`, `lang`, `campaign`, `coupon`, `track`, `recommended`, `productID`). **Leave out** `gclid`, `gbraid` and `gad_…`. | `https://www.pandasecurity.com/security-promotion/?reg=ES&lang=es&campaign=dome2305&coupon=PPCES&track=99526` |
| `cards` | How many product cards the page shows. Blank = 4. | `4` |
| `max_scrolls` | How far down the first price may be, in screen heights. `1` = visible without scrolling. Blank = 1.5. | `1.5` |
| `viewports` | `desktop`, `mobile` or `both`. Blank = both. | `both` |

## prices.csv: one row per price to check

| column | what to write | example |
|---|---|---|
| `page` | The `name` of the page, exactly as in `pages.csv`. | `ES promo dome2305 (PPCES)` |
| `product` | `Essential`, `Advanced`, `Complete` or `Premium`, as written on the card. | `Premium` |
| `devices` | `1`, `3`, `5` or `10` | `10` |
| `years` | `1`, `2` or `3` | `1` |
| `price` | Final price, exactly as shown. | `55,98 €` |
| `original_price` | Crossed-out price. Optional. | `139,95 €` |
| `discount` | Discount label on the card. Optional. | `-60%` |

A page with no rows in `prices.csv` still gets checked for its cards and for how far down the first price is.

Prioritize if the full list is too long (4 products × 4 device options × 3 durations = 48 rows per page). At minimum include:
- 1 device / 1 year for every product
- whatever the campaign advertises (e.g. Premium 10 devices)
- one 2- or 3-year option per product

## Also tell us

- When each promotion starts and ends, and before prices or coupons change. Otherwise the tests fail on every campaign change.
- Whether the discount label changes with devices/years, or is always the same for a product.
- Whether the Premium 10-device 70% offer box (coupon `PPCALL`) should also be checked.
