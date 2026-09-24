---
name: price-config
description: Generate or update the price test config (config/pages.json) from the marketing pages.csv and prices.csv spreadsheets. Use when someone wants to set up, update or check the pages and prices the Playwright price tests verify, needs the blank CSV templates, or says "generate the price config".
---

# Price test config

Help someone, usually from marketing and not technical, turn two spreadsheets into `config/pages.json`, the list of pages and prices the tests check:

- `pages.csv`: one row per landing page (`name;url;cards;max_scrolls;viewports`)
- `prices.csv`: one row per price to check (`page;product;devices;years;price;original_price;discount`)

The columns are explained in `templates/GUIDE.md`, next to this file. The files the tests read are `config/marketing/pages.csv` and `config/marketing/prices.csv`; `npm test` regenerates `config/pages.json` from them every run. So a new config is only real once its CSVs are in `config/marketing/`.

Talk in the user's language, keep it plain (say "row 4 of prices.csv", not "validation error"), and don't show JSON unless asked.

## 1. Ask what they have

Use AskUserQuestion: "Do you already have the pages and prices CSV files?"
- **I have the CSVs**: go to step 3.
- **I need the templates**: go to step 2.

## 2. Give the templates

1. Ask where to save them. Suggest a new folder such as `price-templates/` in the current directory. Never overwrite existing files without asking.
2. Copy `templates/pages.csv`, `templates/prices.csv` and `templates/GUIDE.md` from this skill's folder there.
3. Say where they are and summarize what goes in each file (a few lines, drawing on GUIDE.md), with one example row each:
   - pages.csv: `ES promo;https://www.pandasecurity.com/security-promotion/?reg=ES&lang=es&campaign=dome2305&coupon=PPCES&track=99526;4;1.5;both`
   - prices.csv: `ES promo;Essential;1;1;27,96 €;39,95 €;-30%`
4. Tell them to fill both files and come back (or run this skill again) with their location. Offer to fill the files for them if they paste or type the data in the chat; then write it into the CSVs and continue with step 4.

Stop here until they have the files.

## 3. Find the CSVs

Ask for the location of the files: a folder, or the two file paths. Then:
- Folder: look for `pages.csv` and `prices.csv` in it. If the names differ, pick the files by header row (pages has `name` and `url`; prices has `page`, `product`, `price`). Ask if still unsure.
- Relative paths are relative to where the user is; resolve them to absolute paths, and check both files exist before going on.
- An `.xlsx` or Google Sheets link: ask them to save/export each tab as CSV. Don't convert it yourself.

Show the first lines of each file so they can confirm they're the right ones.

## 4. Validate

From the repository root:

```bash
node scripts/build-config.mjs --pages "<pages.csv>" --prices "<prices.csv>" --check
```

Exit code 0 means valid. Otherwise it lists every problem with its file and line number, e.g. `prices.csv line 5: "devices" must be one of 1, 3, 5, 10, got "4"`. The script checks:
- required columns and cells
- URLs, including removing ad-click ids (`gclid`, `gbraid`, `wbraid`, `gad_…`)
- product names (Essential, Advanced, Complete, Premium), devices (1, 3, 5, 10) and years (1, 2, 3)
- prices that contain a number, and discounts like `-30%`
- price rows that point to a page not in pages.csv, and duplicate rows

When there are problems:
1. Explain them grouped by file, one line each, with the row and what to change.
2. Sort the fixes:
   - **Mechanical**, with only one right answer: stripping `gclid`/`gad_…` from a URL, extra spaces, a page name that differs from pages.csv only by case or spacing. Offer to fix these in their CSV; edit only after they agree.
   - **Needs their knowledge**: a missing or unreadable price, devices `4`, an unknown product, a page missing from pages.csv. Ask; **never invent or guess a price or a URL**.
3. Re-run the check after each round of fixes until it passes.

Warnings (e.g. a price not lower than its original price, a page with no prices) don't block. Show them and ask whether to go on or fix them first.

## 5. Generate

1. Show a short summary from the check output: pages and number of prices each.
2. If `config/marketing/pages.csv` or `prices.csv` already exist and differ from the new files, say so and confirm before replacing them. Mention how many pages/prices there were before and after.
3. Copy the validated files to `config/marketing/pages.csv` and `config/marketing/prices.csv` (skip a file that already is that path).
4. Run `npm run config`. It must report `Generated config/pages.json`; if it fails, go back to step 4 with its output.
5. Tell them it's done. Then offer, without doing it unasked:
   - Run the tests: `npm test`. It needs dependencies (`npm install`, `npx playwright install chromium`) and access to pandasecurity.com. The HTML report opens with `npm run report`.
   - Commit the updated CSVs and `config/pages.json`, so the whole team and CI use them.

Don't edit `config/pages.json` or `config/layout.json` by hand in this skill. The first is generated. The second holds the page selectors, which are for developers.
