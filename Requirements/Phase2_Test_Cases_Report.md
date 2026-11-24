# Phase 2 – Test Case Design & Xray Issue Creation (AAQA-1)

Date: 2026-11-23 · Site: thejashreetheja03.atlassian.net · App under test: https://www.saucedemo.com

Note: AAQA-1's title says "I want to login" but its only Acceptance Criterion is AC1 (Cart Review). Tests cover both login (story goal) and cart review (AC1).

## Created Jira issues

| Item | Key |
|---|---|
| Test Execution | AAQA-30 |
| Tests | AAQA-16 … AAQA-29 (14) |

Links: every Test → AAQA-1 (link type "Test", reads "tests"); every Test → AAQA-30 and AAQA-30 → AAQA-1 (link type "Relates"). Xray run-level association (Test Runs) is not available through the Atlassian MCP, so Tests are tied to the Execution with ordinary Jira links.

## Test case matrix

| TC | Jira | Category | Priority | Summary | Steps (short) | Test data | Expected result |
|---|---|---|---|---|---|---|---|
| TC-01 | AAQA-16 | Positive / Functional | High | Valid user logs in, reaches Products | Open site → enter valid creds → Login | `standard_user` + valid password (env var) | Lands on /inventory.html |
| TC-02 | AAQA-17 | Negative | High | Wrong password rejected | Enter user + wrong password → Login | `standard_user` / `wrong_password` | Stays on login; "do not match" error |
| TC-03 | AAQA-18 | Negative | Medium | Empty username rejected | Blank user → Login | password `any_value` | "Username is required" |
| TC-04 | AAQA-19 | Negative | Medium | Empty password rejected | Blank password → Login | `standard_user` | "Password is required" |
| TC-05 | AAQA-20 | Negative / Security | Medium | Locked-out user denied | Login as locked user | `locked_out_user` + valid password (env var) | "locked out" error |
| TC-06 | AAQA-21 | Positive / Functional (AC1) | High | Cart shows name, description, price, qty | Add Backpack → open cart | Sauce Labs Backpack | Name, description, $29.99, qty 1 |
| TC-07 | AAQA-22 | Functional (AC1) | High | Cart shows total price | Add Backpack + Bike Light → open cart | $29.99 + $9.99 | Total $39.98 visible on cart page |
| TC-08 | AAQA-23 | Positive (AC1) | Medium | Continue Shopping returns to Products | Click Continue Shopping | 1 item in cart | /inventory.html; badge still 1 |
| TC-09 | AAQA-24 | Positive (AC1) | High | Checkout goes to step one | Click Checkout | 1 item in cart | /checkout-step-one.html |
| TC-10 | AAQA-25 | Edge | Medium | Multiple items listed, badge matches | Add 3 items → open cart | Backpack, Bike Light, Bolt T-Shirt | 3 rows, qty 1 each, badge 3 |
| TC-11 | AAQA-26 | Edge | Low | Empty cart, nav buttons present | Open /cart.html with no items | – | No rows, no badge, both buttons present |
| TC-12 | AAQA-27 | Edge / Functional | Medium | Remove item updates cart and badge | Remove Backpack | Backpack + Bike Light | Only Bike Light; badge 1 |
| TC-13 | AAQA-28 | Security / Negative | High | Unauthenticated /cart.html denied | Visit /cart.html with no session | – | Redirect to login with access error |
| TC-14 | AAQA-29 | Security | Medium | Password field masked | Type in password field | any text | Input type is `password` |

All Tests carry labels `AUTO-QA`, `AAQA-1`, plus category labels. Test steps are stored in the Description (the Atlassian MCP cannot write Xray's structured manual-step field).
