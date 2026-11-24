/**
 * Unit tests: traceability.js
 * Run with: node --test packages/xray-integration/test/traceability.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTraceabilityMatrix } from "../src/traceability.js";
import { buildTestScenarios, buildTestCases } from "../src/test-case-builder.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REQ = {
  projectKey: "TEST",
  storyId: "TEST-1",
  jiraUrl: "https://example.atlassian.net/browse/TEST-1",
  summary: "TEST-1 – Login Feature",
  applicationUrl: "",
  acceptanceCriteria: [
    { id: "AC1", title: "Successful Login", given: ["on login page"], when: ["submit valid creds"], then: ["redirected to dashboard"], raw: "" },
    { id: "AC2", title: "Invalid Login", given: ["on login page"], when: ["submit invalid creds"], then: ["see error message"], raw: "" },
  ],
  functionalities: ["Login form"],
  missingFunctionalities: ["Account lockout", "Remember Me"],
  ambiguities: [],
  businessRules: [],
  negativeScenarios: [],
  dependencies: [],
  clarifications: [],
  recommendations: [],
  gherkinBlock: "",
  _userStoryText: "",
  _analysisText: "",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildTraceabilityMatrix", () => {
  it("creates rows for every acceptance criterion", () => {
    const scenarios = buildTestScenarios(REQ);
    const testCases = buildTestCases(REQ, scenarios);
    const matrix = buildTraceabilityMatrix(REQ, testCases);

    const acRows = matrix.rows.filter((r) => r.requirementType === "Acceptance Criterion");
    assert.equal(acRows.length, REQ.acceptanceCriteria.length, "Should have one row per AC");
  });

  it("creates rows for missing functionalities (gap rows)", () => {
    const scenarios = buildTestScenarios(REQ);
    const testCases = buildTestCases(REQ, scenarios);
    const matrix = buildTraceabilityMatrix(REQ, testCases);

    const gapRows = matrix.rows.filter((r) => r.requirementType === "Gap / Missing Functionality");
    assert.equal(gapRows.length, REQ.missingFunctionalities.length, "Should have one gap row per missing functionality");
  });

  it("marks AC rows as Covered when test cases exist", () => {
    const scenarios = buildTestScenarios(REQ);
    const testCases = buildTestCases(REQ, scenarios);
    const matrix = buildTraceabilityMatrix(REQ, testCases);

    const acRows = matrix.rows.filter((r) => r.requirementType === "Acceptance Criterion");
    const coveredRows = acRows.filter((r) => r.coverageStatus === "Covered");
    assert.ok(coveredRows.length > 0, "At least some AC rows should be Covered");
  });

  it("includes summary with coverage percentage", () => {
    const scenarios = buildTestScenarios(REQ);
    const testCases = buildTestCases(REQ, scenarios);
    const matrix = buildTraceabilityMatrix(REQ, testCases);

    assert.ok(typeof matrix.summary.coveragePercent === "number");
    assert.ok(matrix.summary.coveragePercent >= 0 && matrix.summary.coveragePercent <= 100);
    assert.ok(typeof matrix.summary.status === "string");
  });

  it("stores storyId and projectKey", () => {
    const scenarios = buildTestScenarios(REQ);
    const testCases = buildTestCases(REQ, scenarios);
    const matrix = buildTraceabilityMatrix(REQ, testCases);

    assert.equal(matrix.storyId, "TEST-1");
    assert.equal(matrix.projectKey, "TEST");
  });

  it("gap rows have empty coveringJiraKeys before import", () => {
    const scenarios = buildTestScenarios(REQ);
    const testCases = buildTestCases(REQ, scenarios);
    const matrix = buildTraceabilityMatrix(REQ, testCases);

    const gapRows = matrix.rows.filter((r) => r.requirementType === "Gap / Missing Functionality");
    for (const row of gapRows) {
      assert.deepEqual(row.coveringJiraKeys, [], "Gap rows should have no Jira keys before import");
    }
  });

  it("works with zero ACs — returns at least gap rows", () => {
    const noAcReq = { ...REQ, acceptanceCriteria: [] };
    const scenarios = buildTestScenarios(noAcReq);
    const testCases = buildTestCases(noAcReq, scenarios);
    const matrix = buildTraceabilityMatrix(noAcReq, testCases);

    assert.ok(matrix.rows.length >= REQ.missingFunctionalities.length);
  });
});
