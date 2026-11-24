# Final E2E QA Execution Report – AAQA-1

Date: 2026-11-23 · App: https://www.saucedemo.com · Runner: Playwright (Chromium, headless, 1 worker)

## 1. Jira issues

| Type | Keys |
|---|---|
| Test (14) | AAQA-16 … AAQA-29 |
| Test Execution | AAQA-30 |
| Bug | AAQA-31 |

## 2. Playwright results — 13 passed · 1 failed · 0 skipped

| Jira | TC | Category | Result |
|---|---|---|---|
| AAQA-16 | TC-01 valid login | Positive | PASS |
| AAQA-17 | TC-02 wrong password | Negative | PASS |
| AAQA-18 | TC-03 empty username | Negative | PASS |
| AAQA-19 | TC-04 empty password | Negative | PASS |
| AAQA-20 | TC-05 locked-out user | Negative/Security | PASS |
| AAQA-21 | TC-06 cart item details | Positive (AC1) | PASS |
| AAQA-22 | TC-07 cart total price | Functional (AC1) | **FAIL** → AAQA-31 |
| AAQA-23 | TC-08 Continue Shopping | Positive (AC1) | PASS |
| AAQA-24 | TC-09 Checkout | Positive (AC1) | PASS |
| AAQA-25 | TC-10 multiple items | Edge | PASS |
| AAQA-26 | TC-11 empty cart | Edge | PASS |
| AAQA-27 | TC-12 remove item | Edge | PASS |
| AAQA-28 | TC-13 unauthenticated cart | Security | PASS |
| AAQA-29 | TC-14 password masked | Security | PASS |

Note: an earlier run without the password set passed 5 and skipped 9; the results above are from the full run with the password supplied by you through the `SAUCE_PASSWORD` environment variable (never stored in files).

## 3. Defect
**AAQA-31** — Cart page shows no total price (AC1 requires "total price calculation"). Not a script error: screenshot shows items, Continue Shopping and Checkout but no total. Linked to AAQA-1, AAQA-30 and the failed test AAQA-22. Product decision needed: add total to cart, or amend AC1 (total only appears on checkout step two).

## 4. Evidence attachment confirmation
- Screenshots attached to each Test: AAQA-16, 17, 18, 19, 20, 21, 23, 24, 25, 26, 27, 28, 29 (pass screenshots) and AAQA-22 (failure screenshot).
- Failure screenshot attached to Bug AAQA-31.
- `playwright-report.zip` (HTML report + traces) attached to AAQA-30.
- Result comments posted on all 14 Tests and on AAQA-30; summary comment posted on AAQA-1.
- Local copies: `playwright-report/`, `test-results/` (screenshots, traces, `results.json`).

## 5. Known limitations
- Xray Test Run statuses were not updated (no Test Run tool in the Atlassian MCP); results were logged as comments per the agreed fallback. Tests ↔ Execution association uses ordinary "Relates" links.
- **Link direction issue:** the Defect link between AAQA-31 and AAQA-22 was created reversed (it reads "AAQA-31 created AAQA-22"; it should read "AAQA-22 created AAQA-31"). The MCP has no delete-link operation, so please delete that link in Jira (open AAQA-31 → Links → remove) and re-add it from AAQA-22 if you want the exact wording. Other links are unaffected.
- AAQA-1 left in To Do; not committed or pushed anywhere. `.vscode/mcp.json` untouched.

## 6. Files added/changed
`playwright.config.js`, `tests/pages/*.js`, `tests/aaqa-1/aaqa-1.spec.js`, `package.json` / `package-lock.json` (added `@playwright/test`), `Requirements/Phase2_Test_Cases_Report.md`, this report.
