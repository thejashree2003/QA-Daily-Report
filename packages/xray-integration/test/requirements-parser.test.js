/**
 * Unit tests: requirements-parser.js
 * Run with: node --test packages/xray-integration/test/requirements-parser.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDocuments, resolveDocumentPaths } from "../src/requirements-parser.js";
import path from "node:path";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_USER_STORY = `
# Extracted Jira User Story: TEST-1

- **Jira URL:** https://example.atlassian.net/browse/TEST-1
- **Project:** Test Project
- **Issue ID:** 99999
- **Issue Type:** Story

## Summary

TEST-1 – Implement Login Feature

## Description

\`\`\`markdown
# User Story: US1

## Story Title
As a customer, I want to login

## Application URL
https://www.example.com

## Acceptance Criteria

### AC1: Successful Login
- GIVEN I am on the login page
- WHEN I enter valid credentials and submit
- THEN I should be redirected to the dashboard
- AND I should see a welcome message
\`\`\`

## Attachments

None returned.
`;

const SAMPLE_ANALYSIS = `
# Requirement Analysis: TEST-1

## 1. User Story Overview
- **Issue Key:** TEST-1

## 3. Functionalities Covered
- Login form with username and password fields
- Redirection after successful login

## 4. Missing Functionalities
- Error handling for invalid credentials
- Account lockout after repeated failures
- Remember me functionality

## 5. Identified Requirement Gaps

| Gap ID | Description |
|---|---|
| GAP-01 | No error message specification |

## 7. Ambiguities
- Unclear session timeout duration
- Dashboard URL not specified

## 6. Negative and Boundary Scenarios
- Login with empty username
- Login with empty password
- Login with invalid password
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseDocuments", () => {
  it("extracts project key and story ID", () => {
    const req = parseDocuments(SAMPLE_USER_STORY, SAMPLE_ANALYSIS, "TEST", "TEST-1");
    assert.equal(req.projectKey, "TEST");
    assert.equal(req.storyId, "TEST-1");
  });

  it("extracts Jira URL", () => {
    const req = parseDocuments(SAMPLE_USER_STORY, SAMPLE_ANALYSIS, "TEST", "TEST-1");
    assert.match(req.jiraUrl, /example\.atlassian\.net/);
  });

  it("extracts story summary", () => {
    const req = parseDocuments(SAMPLE_USER_STORY, SAMPLE_ANALYSIS, "TEST", "TEST-1");
    assert.match(req.summary, /Login Feature/);
  });

  it("extracts acceptance criteria with GWT", () => {
    const req = parseDocuments(SAMPLE_USER_STORY, SAMPLE_ANALYSIS, "TEST", "TEST-1");
    assert.ok(req.acceptanceCriteria.length > 0, "Should have at least one AC");
    const ac1 = req.acceptanceCriteria.find((a) => a.id === "AC1");
    assert.ok(ac1, "AC1 should be found");
    assert.ok(ac1.given.length > 0, "AC1 should have GIVEN clauses");
    assert.ok(ac1.then.length > 0, "AC1 should have THEN clauses");
  });

  it("extracts functionalities from analysis", () => {
    const req = parseDocuments(SAMPLE_USER_STORY, SAMPLE_ANALYSIS, "TEST", "TEST-1");
    assert.ok(req.functionalities.length > 0, "Should have functionalities");
  });

  it("extracts missing functionalities", () => {
    const req = parseDocuments(SAMPLE_USER_STORY, SAMPLE_ANALYSIS, "TEST", "TEST-1");
    assert.ok(req.missingFunctionalities.length > 0, "Should have missing functionalities");
    const hasLockout = req.missingFunctionalities.some((f) => /lockout|invalid/i.test(f));
    assert.ok(hasLockout, "Should include credential/lockout gap");
  });

  it("extracts ambiguities", () => {
    const req = parseDocuments(SAMPLE_USER_STORY, SAMPLE_ANALYSIS, "TEST", "TEST-1");
    assert.ok(req.ambiguities.length > 0, "Should have ambiguities");
  });

  it("extracts negative scenarios", () => {
    const req = parseDocuments(SAMPLE_USER_STORY, SAMPLE_ANALYSIS, "TEST", "TEST-1");
    assert.ok(req.negativeScenarios.length > 0, "Should have negative scenarios");
  });

  it("returns empty arrays gracefully for missing sections", () => {
    const req = parseDocuments("# Empty Story\n## Summary\nMy Story", "# Empty Analysis\n", "X", "X-1");
    assert.ok(Array.isArray(req.acceptanceCriteria));
    assert.ok(Array.isArray(req.functionalities));
    assert.ok(Array.isArray(req.missingFunctionalities));
    assert.ok(Array.isArray(req.ambiguities));
  });

  it("preserves raw text for downstream use", () => {
    const req = parseDocuments(SAMPLE_USER_STORY, SAMPLE_ANALYSIS, "TEST", "TEST-1");
    assert.ok(req._userStoryText.includes("TEST-1"));
    assert.ok(req._analysisText.includes("TEST-1"));
  });
});

describe("resolveDocumentPaths", () => {
  it("builds correct paths from project root and story ID", () => {
    const { userStoryPath, requirementAnalysisPath } = resolveDocumentPaths("/project", "AAQA-1");
    assert.ok(userStoryPath.includes("AAQA-1"));
    assert.ok(userStoryPath.endsWith("user-story.md"));
    assert.ok(requirementAnalysisPath.endsWith("requirement-analysis.md"));
  });

  it("works with any story ID without hardcoding", () => {
    for (const id of ["AAQA-1", "AAQA-7", "PROJ-123", "X-99"]) {
      const { userStoryPath } = resolveDocumentPaths("/root", id);
      assert.ok(userStoryPath.includes(id), `Path should include ${id}`);
    }
  });
});
