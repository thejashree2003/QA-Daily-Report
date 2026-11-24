# Agent: Jira Xray Excel Test Case Generator

## Overview

| Property         | Value |
|---|---|
| **Agent Name**   | Jira Xray Excel Test Case Generator Agent |
| **Version**      | 1.0.0 |
| **Script**       | `scripts/jira-xray-test-case-generator.js` |
| **Library**      | `packages/xray-integration/` |
| **Depends On**   | Requirements Analysis Agent (must run first) |
| **Jira Test Type** | Xray `Test` issue (type ID `10010`) |
| **Link Type**    | `Test` (ID `10006`) — outward: "tests" |
| **Excel Library** | `exceljs` (Node.js) |

---

## Purpose

Transforms a completed Requirements Analysis document into:
1. Structured test scenarios categorised as Positive / Negative / Gap/Edge
2. Detailed test cases with step-by-step actions and expected results
3. A Requirements Traceability Matrix (RTM)
4. A multi-sheet Excel workbook (5 sheets, Xray-compatible)
5. Jira Xray Test issues (after user approval)
6. A Jira Test Execution issue linking all tests to the story

This agent does **not** replace the Requirements Analysis Agent — it consumes its output.

---

## Inputs

### Required CLI Arguments
```bash
node scripts/jira-xray-test-case-generator.js \
  --project <PROJECT_KEY> \
  --story   <STORY_ID>
```

### Examples
```bash
# Generate test cases for AAQA-1 (local only — no Jira write)
node scripts/jira-xray-test-case-generator.js --project AAQA --story AAQA-1

# Validate inputs only
node scripts/jira-xray-test-case-generator.js --project AAQA --story AAQA-1 --check

# Generate AND import to Jira (requires APPROVE confirmation)
node scripts/jira-xray-test-case-generator.js --project AAQA --story AAQA-1 --import
```

### npm Scripts
```bash
npm run xray-test-cases -- --project AAQA --story AAQA-1
npm run xray-test-cases:import -- --project AAQA --story AAQA-1
```

### Automatically Resolved Input Files
The agent resolves these paths automatically from `--project` and `--story`:
- `user-stories/{STORY-ID}/user-story.md`
- `user-stories/{STORY-ID}/requirement-analysis.md`

If either file is missing, the agent exits with a clear error message.

---

## Outputs

All outputs are saved under `user-stories/{STORY-ID}/`:

| File | Phase | Description |
|---|---|---|
| `test-scenarios.md` | 3 | High-level scenario catalogue |
| `test-cases.md` | 4 | Detailed test cases with steps |
| `requirements-test-traceability.md` | 5 | Requirements Traceability Matrix |
| `jira-xray-test-cases-{STORY-ID}.xlsx` | 6 | 5-sheet Excel workbook |
| `excel-validation-report.md` | 7 | Workbook validation results |
| `jira-test-creation-report.md` | 9 | Jira import results (after approval) |
| `test-execution-report.md` | 11 | Test Execution issue details |

---

## 12-Phase Workflow

| Phase | Description | Jira Write? |
|---|---|---|
| 1 | Validate CLI arguments and resolve input paths | No |
| 2 | Parse `user-story.md` and `requirement-analysis.md` | No |
| 3 | Generate test scenarios → `test-scenarios.md` | No |
| 4 | Generate detailed test cases → `test-cases.md` | No |
| 5 | Build RTM → `requirements-test-traceability.md` | No |
| 6 | Generate Excel workbook → `.xlsx` | No |
| 7 | Validate Excel workbook → `excel-validation-report.md` | No |
| 8 | Present summary; await `APPROVE {STORY-ID}` from user | No |
| 9 | Create Jira Xray Test issues via MCP | ✅ Yes |
| 10 | Verify created Test issues | Read only |
| 11 | Create Test Execution; link all tests | ✅ Yes |
| 12 | Update `user-stories/README.md` index | No |

> **Phases 9–11 are gated behind explicit user approval.** The agent prompts:
> ```
> Type APPROVE AAQA-1 to proceed (or anything else to cancel):
> ```

---

## Excel Workbook Structure

The generated `.xlsx` file contains **5 worksheets**:

| Sheet | Contents |
|---|---|
| `Test Scenarios` | Scenario ID, type, title, related AC, priority, labels |
| `Test Cases` | Full test case details including preconditions, test data, expected outcome |
| `Test Steps` | Flat step table: Test Case ID, Step #, Action, Expected Result, Test Data |
| `Traceability Matrix` | Requirement ID → covering tests → coverage status → risk |
| `Summary` | Story metadata, counts, coverage %, generation timestamp |

### Visual Design
- Frozen header rows with navy-blue styling
- Auto-filter on all columns
- Type-colour coding: Green (positive) / Red (negative) / Amber (boundary) / Purple (gap)
- 5-sheet structure matches Xray import preparation workflow

---

## Jira Xray Field Mapping

| Field | Value |
|---|---|
| `issueType` | `"Test"` (Xray Test issue type, ID `10010`) |
| `summary` | Test case title |
| `description` | Formatted markdown: TC ID, preconditions, steps, expected outcome |
| `priority` | Derived from scenario type (High / Medium / Low) |
| `labels` | Story ID + type tags |
| **Link type** | `"Test"` (ID `10006`) |
| **Link direction** | `inwardIssue=TEST_KEY`, `outwardIssue=STORY_KEY` (Test "tests" Story) |

---

## Test Execution

The agent creates a Jira **Test Execution** issue (type ID `10013`) and links every created Test issue to it.

- Initial execution status: **TODO / Not Executed**
- Tests are **never** marked Passed or Failed automatically
- All test execution must be performed manually or via Xray's execution workflow

---

## Duplicate Detection

Before creating Test issues, the agent searches Jira for existing Test issues linked to the story and compares summaries (case-insensitive). Duplicates are skipped and reported in the creation report.

---

## Security

- No credentials, API tokens, or passwords are written to the Excel workbook
- Credential-like patterns are checked during Excel validation and block import
- MCP authentication tokens are managed by `mcp-remote` via `~/.mcp-auth/`
- Jira write operations require `BypassSandbox: true` when run in Antigravity sandbox

---

## Library Structure

```
packages/xray-integration/
├── package.json
└── src/
    ├── index.js                  ← barrel export
    ├── requirements-parser.js   ← parse user-story.md + requirement-analysis.md
    ├── test-case-builder.js     ← build scenarios and test cases
    ├── excel-generator.js       ← generate 5-sheet .xlsx workbook
    ├── excel-validator.js       ← validate workbook before import
    ├── traceability.js          ← build RTM
    └── jira-xray-creator.js    ← create Jira Test/Execution issues via MCP
└── test/
    ├── requirements-parser.test.js
    ├── test-case-builder.test.js
    ├── excel-generator.test.js
    ├── traceability.test.js
    └── jira-xray-creator.test.js
```

---

## Running Unit Tests

```bash
# All xray-integration tests
node --test packages/xray-integration/test/requirements-parser.test.js \
              packages/xray-integration/test/test-case-builder.test.js \
              packages/xray-integration/test/excel-generator.test.js \
              packages/xray-integration/test/traceability.test.js \
              packages/xray-integration/test/jira-xray-creator.test.js

# Or using npm script
npm run test:xray
```

---

## Dependencies

This agent reuses existing project packages — no new external dependencies required:

| Dependency | Purpose | Source |
|---|---|---|
| `exceljs` | Excel workbook generation | Already in `package.json` |
| `@modelcontextprotocol/sdk` | MCP client | Already in `package.json` |
| `mcp-remote` | Atlassian OAuth proxy | Already in `package.json` |
| `packages/jira-integration` | MCP connection + Jira tools | Existing project package |

---

## Reusability

This agent is designed to work with **any project key and story ID**. It:
- Accepts `--project` and `--story` as CLI arguments
- Never hardcodes project keys, story IDs, cloud IDs, or URLs
- Reads project root from `import.meta.url`
- Works with any Jira project that has Xray installed

```bash
# Works for any story in any project
node scripts/jira-xray-test-case-generator.js --project MYPROJ --story MYPROJ-42
```
