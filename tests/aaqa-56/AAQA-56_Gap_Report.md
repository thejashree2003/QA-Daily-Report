# AAQA-56 Requirements Gap Report

Source: Jira AAQA-56 (Story, To Do, Medium). Fields cited exactly.
- **Summary:** `E-commerce Checkout ` (trailing space)
- **Description heading:** `# User Story: SCRUM-101 - E-commerce Checkout Process`
- **Story Title:** `As a customer, I want to complete my purchase through a checkout process so that I can order products online.`
- **Story Description:** `Implement a complete checkout flow that allows customers to review their cart, enter shipping information, select payment method, and confirm their order. The checkout process should be intuitive, secure, and provide clear feedback at each step.`
- **Acceptance Criteria:** AC1 Cart Review, AC2 Checkout Information Entry, AC3 Order Overview, AC4 Order Completion, AC5 Error Handling

## Gaps and ambiguities

| # | Gap | Evidence in AAQA-56 | Risk / question for the product owner |
|---|---|---|---|
| G1 | Payment method selection is described but not covered by any AC | Story Description: "select payment method". AC3 only says "I should see payment and shipping information". | No testable behaviour for choosing a payment method. Is selection required? |
| G2 | Shipping information entry is described but AC2 has no address fields | Story Description: "enter shipping information". AC2: "form fields for First Name, Last Name, and Zip/Postal Code". | Are First Name, Last Name and Zip the full shipping input? |
| G3 | Story key mismatch | Description heading says `SCRUM-101`, the Jira key is AAQA-56. | Traceability confusion; stale copy of another story? |
| G4 | Content is identical to AAQA-36 | Same title, description and AC1 to AC5. | Possible duplicate story. Tests were created independently as requested. |
| G5 | AC1 total price location unclear | AC1: "I should see the total price calculation" on the cart page. | Known app behaviour: total appears only on the overview step. See existing Bug AAQA-31. |
| G6 | Error messages not specified | AC2: "an error message indicating which field is required"; AC5: "appropriate validation error messages". | No exact wording or order of validation when several fields are empty. |
| G7 | "Invalid data" undefined | AC5: "invalid data (e.g., special characters, incomplete information)". | No rules for allowed characters, length or zip format. |
| G8 | Cart state after order not defined | AC4 mentions only the success message and "Back Home" button. | Should the cart be emptied? Tested as an edge case (TC-10). |
| G9 | No login-required or empty-cart rules | Not stated anywhere in AAQA-56. (AAQA-36 had a Business Rules section; AAQA-56 does not.) | Access control for checkout URLs undefined. Tested as a security case (TC-12). |
| G10 | No Cancel behaviour | AC3 mentions "options to Cancel or Finish" but not where Cancel leads. | Cart or Products? (Existing Bug AAQA-55 on AAQA-36 shows Products.) |
| G11 | Non-functional needs missing | "intuitive, secure, and provide clear feedback" has no measurable criteria. No browser, mobile or accessibility scope. | Not testable as written. |
| G12 | Credentials in the story | Description lists a Username and Password in plain text. | Move to a secret store; tests read the password from `SAUCE_PASSWORD`. |

## Coverage decision
12 Test cases: TC-01 to TC-03 (AC1), TC-04 to TC-07 (AC2), TC-08 (AC3), TC-09 to TC-10 (AC4), TC-11 (AC5), TC-12 (security gap G9). G1, G2, G6, G7, G10 and G11 need product owner input before they can be tested.
