---
name: price-test-runner
description: Runs the promo page price tests end to end and delivers an executive report with evidence. Checks the setup first (software, config, page access), runs the Playwright suite, then writes a self-contained HTML report with an executive summary, screenshots and every price checked. Use when someone asks to run, execute or check the price tests, verify promo prices, or wants a test report.
---

You run the price tests in this repository and turn the result into a report that a marketing lead or manager can read in two minutes. You check and report; you don't fix. Never edit the tests, the CSVs, `config/`, or anything under `src/`, never install software, and never commit.

Work from the repository root (the folder with `package.json`). Commands work in Git Bash and PowerShell on Windows, and on macOS/Linux.

## 1. Preflight

Run `npm run preflight`. It prints one line per check (OK / WARN / FAIL), each FAIL with how to fix it, and exits 1 if anything blocks.

- **Software missing** (Node.js, npm packages, Chromium): stop. Report what's missing and that the **onboarding** skill installs it.
- **Config invalid:** stop. Report the problems it lists and that the **price-config** skill fixes the spreadsheets.
- **Pages don't open:** if every page fails, stop. It's almost always internet, VPN or proxy access to pandasecurity.com; say so. If only some pages fail, continue; the report will show those as "could not be checked". Mention it in the summary.

When preflight stops you, don't run the tests. Return the short "blocked" answer described in step 5.

## 2. Run the tests

Run `npm test`. It regenerates `config/pages.json` from the marketing CSVs, then runs every page on desktop and mobile. Give the command a 10-minute timeout; a large config can take several minutes.

If the request narrows the run, use these instead:
- desktop only: `npm run test:desktop`
- one page: `npm run config`, then `npx playwright test -g "<page name>"`

Don't pass `--reporter`: that replaces the JSON reporter the report is built from.

Exit code 1 only means some checks failed; that's a normal result, so keep going. It's a real problem only if `test-results/results.json` wasn't written (Playwright crashed or the config didn't load). Then report the error lines and stop.

## 3. Build the report

1. Run `npm run report:summary`. It prints the report folder (`reports/<date_time>/`), the status and the issues, and writes `summary.json` there. Read `summary.json`.
2. Write the executive summary in that folder as `executive-summary.md`, for a non-technical reader:
   - First sentence: the verdict, with scope. "All 32 price checks on 2 pages passed on desktop and mobile." or "3 of 32 prices are wrong on the ES promo page."
   - Then what matters for the business, one short bullet each: which page, which product and option, what customers see compared with what was expected, and on which device type. Group repeated issues; for example, the same wrong price on desktop and mobile is one bullet.
   - Separate three kinds of problem, because different people fix them:
     - **the page is wrong**, e.g. a price differs or the first price is too far down (web team)
     - **the spreadsheet is probably wrong**, e.g. an option that doesn't exist on the page, or every price off by the same pattern (marketing, via the price-config skill)
     - **could not be checked**: page didn't load, network (whoever runs the tests)
   - End with the next step for each owner.
   - Plain words: "customers on mobile see 52,46 €", not "assertion failed". No speculation beyond the evidence. Use `**bold**` sparingly; lines starting with `- ` become bullets. 4–10 lines in total.
3. Rebuild the report with your summary: `node scripts/build-report.mjs --summary-file "reports/<folder>/executive-summary.md" --fragment`. This overwrites `report.html` in the same folder and also writes `artifact.html`.

## 4. Deliver

- If the Artifact tool is available, publish `reports/<folder>/artifact.html`. Use the icon `chart` and a one-sentence description with the run date and verdict. The page is private until the user shares it. If publishing isn't possible, skip it quietly.
- In any case, the file to open is `reports/<folder>/report.html`. It's self-contained: screenshots are embedded, so it can be emailed or attached as-is. The full technical Playwright report opens with `npm run report` on this machine.

## 5. What to return

Keep it short. The report holds the detail.

```
Price tests: PASS | FAIL | BLOCKED — <one-line verdict>
Checked: <n> pages × <viewports> · checks <passed>/<run> · prices <passed>/<run> · first price worst case <x> screens (limit <y>)
Issues:
- <page (viewport)>: <plain description>   (at most 8; say "and N more" beyond that)
Report: <artifact link, if published> · <path to report.html>
Next: <who does what>
```

When blocked in preflight, return `Price tests: BLOCKED`, the failing preflight lines, and the fix (onboarding skill, price-config skill, or network access). There's no report in that case.
