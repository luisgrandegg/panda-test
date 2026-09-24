---
name: onboarding
description: Set up a Windows computer to run the Playwright price tests. Installs Node.js, the project's npm packages and Playwright's Chromium, then verifies the setup. Use when someone is new to this repo, asks to "set up", "install what's needed" or "get the tests running", or when the preflight check reports missing software.
---

# Onboarding: set up this computer for the price tests

Get a Windows machine from zero to a passing preflight check, installing what's missing for the user. Assume they aren't technical: explain what each step does in one plain sentence, and don't paste long logs at them.

Everything the tests need:

| What | Why | Check |
|---|---|---|
| Git | Already there if Claude Code runs on Windows (it needs Git for Windows) | `git --version` |
| Node.js 20 or newer (LTS) | Runs the test suite | `node --version` |
| npm packages (`node_modules`) | Playwright and the test tools, pinned in `package-lock.json` | `npm run preflight` |
| Chromium for Playwright | The browser the tests drive | `npm run preflight` |

Run commands from the repository root (the folder with `package.json`). If you're not in this repo, say so and stop: the user has to clone it and start Claude Code inside it first.

## 1. Check what's there

1. Confirm the OS: `uname -s` (Git Bash shows `MINGW64_NT…`) or `$env:OS` in PowerShell (`Windows_NT`). On macOS or Linux, follow the same steps with that system's installer (Homebrew `brew install node@22`, or nvm) instead of winget.
2. Run `git --version`, `node --version`, `npm --version`, `winget --version`, then `npm run preflight -- --offline` if Node is present.
3. Show a short table: each item, found or missing, and the version.

If everything is present and preflight passes, skip to step 5.

## 2. Ask before installing

Use AskUserQuestion to confirm the plan. List exactly what will be installed. Windows may show a permission (UAC) prompt they have to accept, and installs take a few minutes. Options: "Install everything (Recommended)", "Only show me the commands". With the second option, give the commands and stop.

## 3. Install Node.js

Only if Node is missing, or older than 20:

```bash
winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements
```

Use `winget upgrade` with the same flags when an older Node is installed. Tell the user to accept the Windows permission prompt if one appears.

**The new Node isn't on this session's PATH yet.** Prefix every later command in this skill with the install folder:
- Git Bash: `export PATH="/c/Program Files/nodejs:$PATH" && <command>`
- PowerShell: `$env:Path = "C:\Program Files\nodejs;" + $env:Path; <command>`

Check with `node --version` (with the prefix).

If it fails:
- **`winget` not found:** ask them to install "App Installer" from the Microsoft Store, or to download and run the LTS installer from https://nodejs.org. Wait for them to confirm, then check again.
- **Access denied / needs admin rights and they have none:** ask them to get Node.js LTS installed by IT. Or install per user without admin: `winget install --id Schniz.fnm -e`, then `fnm install --lts` and `fnm default lts-latest`. With fnm, run later commands through `fnm exec --using=default -- <command>`.
- **Any other failure:** show the one relevant error line and stop. Don't try random alternatives.

## 4. Install the project's packages and browser

```bash
npm ci
npx playwright install chromium
```

`npm ci` installs the exact versions from `package-lock.json`. Never use `npm install` here: it would change the lockfile.

Common problems:
- **Proxy or network errors** (`ETIMEDOUT`, `ECONNREFUSED`, `407`): ask for the company proxy address, then `npm config set proxy <url>` and `npm config set https-proxy <url>`. For the browser download, set `HTTPS_PROXY=<url>` on the same command.
- **Certificate errors** (`SELF_SIGNED_CERT_IN_CHAIN`, `UNABLE_TO_GET_ISSUER_CERT`): the company inspects HTTPS traffic. Ask IT for the root certificate file and set `NODE_EXTRA_CA_CERTS=<path to .pem>`. Never turn off certificate checks (`strict-ssl false`, `NODE_TLS_REJECT_UNAUTHORIZED=0`).
- **PowerShell says "running scripts is disabled"**: run `npm.cmd` / `npx.cmd` instead. Or, with the user's OK, `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- **Antivirus removes or blocks Chromium:** run `npx playwright install chromium` once more. If it still fails, they need IT to allow `%LOCALAPPDATA%\ms-playwright`.

## 5. Verify

1. `npm run preflight`: it checks Node, packages, browser and config, and that every page opens. Each failing line says how to fix it. A page that doesn't open usually means no internet or VPN access to pandasecurity.com. That's not an install problem, so report it and move on.
2. `npm run test:selftest`: runs the whole suite against local copies of the page, which needs no internet (about a minute). It must end with every test passed.

## 6. Wrap up

Tell the user, briefly:
- what was installed (with versions) and that the self-test passed
- to close and reopen the terminal or Claude Code so Node is found without the PATH prefix
- what they can do next:
  - "generate the price config" (price-config skill) to set up pages and prices
  - "run the price tests" (price-test-runner agent) to check the pages and get a report
  - `npm test` to run the tests directly

Don't commit anything. Onboarding only changes this computer, not the repository.
