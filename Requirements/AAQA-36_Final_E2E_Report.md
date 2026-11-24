# AAQA-36 Final E2E Report – E-commerce Checkout Process

Date: 2026-11-24 · App: https://www.saucedemo.com · Runner: Playwright (Chromium, headless)

## 1. Jira issues
| Type | Keys |
|---|---|
| Story | AAQA-36 (left In Progress for sign-off) |
| Tests (15) | AAQA-37 … AAQA-51 |
| Test Execution | AAQA-52 |
| Bugs (new) | AAQA-53, AAQA-54, AAQA-55 |
| Bug (existing, reused) | AAQA-31 |

## 2. Results — 10 passed · 4 failed · 1 inconclusive

| Jira | TC | Scenario | Result |
|---|---|---|---|
| AAQA-37 | TC-01 | Cart item details | PASS |
| AAQA-38 | TC-02 | Cart total price (AC1) | **FAIL** → existing Bug AAQA-31 |
| AAQA-39 | TC-03 | Continue Shopping / Checkout offered | **INCONCLUSIVE** – Windows file-lock error `EBUSY` during artifact cleanup, not an assertion; needs a re-run |
| AAQA-40 | TC-04 | Checkout info page fields | PASS |
| AAQA-41 | TC-05 | Empty First Name error | PASS |
| AAQA-42 | TC-06 | Empty Last Name error | PASS |
| AAQA-43 | TC-07 | Empty Zip error | PASS |
| AAQA-44 | TC-08 | Overview items, payment, shipping, totals | PASS |
| AAQA-45 | TC-09 | Finish → confirmation, Back Home | PASS |
| AAQA-46 | TC-10 | Cart cleared, Back Home | PASS |
| AAQA-47 | TC-11 | Special characters rejected (AC5) | **FAIL** → AAQA-53 |
| AAQA-48 | TC-12 | Empty cart blocked (Rule 3) | **FAIL** → AAQA-54 |
| AAQA-49 | TC-13 | Cancel on info page → cart | PASS |
| AAQA-50 | TC-14 | Cancel on overview → cart (Rule 5) | **FAIL** → AAQA-55 |
| AAQA-51 | TC-15 | Unauthenticated checkout denied | PASS |

## 3. Defects
- **AAQA-31** (existing): cart page shows no total price (AC1). Linked to AAQA-38 and AAQA-36; no duplicate logged.
- **AAQA-53**: special characters accepted in First/Last Name and Zip; user reaches the overview (AC5).
- **AAQA-54**: checkout can be started with an empty cart (Business Rule 3).
- **AAQA-55**: Cancel on the order overview goes to Products, not the cart (Business Rule 5). Product owner may decide to amend the rule instead.

## 4. Xray / Jira sync
- Test details steps (Action / TestData / Expected Result): all 15 Tests.
- Test Runs on AAQA-52: 15 tests added; 10 set to PASSED and 4 to FAILED; AAQA-39 left TO DO (inconclusive).
- Failure screenshots attached to AAQA-38, 47, 48, 50 and Bugs AAQA-53, 54, 55 (AAQA-31 already has its screenshot from the AAQA-1 run). HTML report + traces zip attached to AAQA-52.
- Result comments on failed/inconclusive Tests, AAQA-52 and AAQA-36.
- Links: Test → Bug ("Defect"), Bug → AAQA-36 ("Relates"), Tests → AAQA-52 ("Relates"/Xray run).

## 5. Statuses
- **Done:** passed Tests AAQA-37, 40, 41, 42, 43, 44, 45, 46, 49, 51 and Test Execution AAQA-52.
- **Still In Progress:** AAQA-36, failed Tests AAQA-38, 47, 48, 50, and inconclusive AAQA-39 (needs a re-run before it can be closed).
- **To Do:** Bugs AAQA-53, 54, 55.

## 6. Notes
- To re-run only the inconclusive test: `npx playwright test tests/aaqa-36 -g "TC-03"`, then `node scripts/xray-sync.mjs runs AAQA-36 AAQA-52`. The EBUSY error is a Windows file lock (antivirus/indexer on `test-results`); closing File Explorer on that folder usually avoids it.
- `scripts/xray-sync.mjs` now treats file-lock errors as inconclusive and resolves Test Executions as well as Tests.
- Reversed Defect link on AAQA-31 → AAQA-22 (from AAQA-1 work) still needs manual removal in Jira. No commits or pushes made.
