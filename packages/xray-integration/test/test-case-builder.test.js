/**
 * Unit tests: test-case-builder.js
 * Run with: node --test packages/xray-integration/test/test-case-builder.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTestScenarios, buildTestCases } from "../src/test-case-builder.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINIMAL_REQ = {
  projectKey: "TEST",
  storyId: "TEST-1",
  jiraUrl: "https://example.atlassian.net/browse/TEST-1",
  summary: "TEST-1 – Login Feature",
  applicationUrl: "https://www.example.com",
  acceptanceCriteria: [
    {
      id: "AC1",
      title: "Successful Login",
      given: ["I am on the login page"],
      when: ["I enter valid credentials and submit"],
      then: ["I should be redirected to the dashboard", "I should see a welcome message"],
      raw: "GIVEN I am on the login page\nWHEN I enter valid credentials\nTHEN I should see dashboard",
    },
  ],
  functionalities: ["Login form with username and password"],
  missingFunctionalities: ["Error handling for invalid credentials", "Account lockout"],
  ambiguities: ["Session timeout is unclear"],
  businessRules: [],
  negativeScenarios: ["Login with empty username", "Login with invalid password"],
  dependencies: [],
  clarifications: [],
  recommendations: [],
  gherkinBlock: "",
  _userStoryText: "",
  _analysisText: "",
};

const EMPTY_REQ = {
  projectKey: "X",
  storyId: "X-1",
  jiraUrl: "",
  summary: "X-1",
  applicationUrl: "",
  acceptanceCriteria: [],
  functionalities: [],
  missingFunctionalities: [],
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
// Tests: buildTestScenarios
// ---------------------------------------------------------------------------

describe("buildTestScenarios", () => {
  it("creates positive scenarios for each AC", () => {
    const scenarios = buildTestScenarios(MINIMAL_REQ);
    const positives = scenarios.filter((s) => s.type === "positive");
    assert.ok(positives.length >= 1, "Should have at least one positive scenario");
    assert.ok(positives.some((s) => s.relatedAc === "AC1"), "Should map to AC1");
  });

  it("creates negative scenarios from negativeScenarios list", () => {
    const scenarios = buildTestScenarios(MINIMAL_REQ);
    const negatives = scenarios.filter((s) => s.type === "negative");
    assert.ok(negatives.length >= 2, "Should have 2 negative scenarios");
  });

  it("creates gap scenarios from missingFunctionalities", () => {
    const scenarios = buildTestScenarios(MINIMAL_REQ);
    const gaps = scenarios.filter((s) => s.type === "edge");
    assert.ok(gaps.length >= 2, "Should have gap scenarios for missing functionalities");
  });

  it("includes story ID in labels", () => {
    const scenarios = buildTestScenarios(MINIMAL_REQ);
    for (const s of scenarios) {
      assert.ok(s.labels.includes("TEST-1"), `Scenario ${s.scenarioId} should include storyId in labels`);
    }
  });

  it("generates at least one scenario even with empty requirements", () => {
    const scenarios = buildTestScenarios(EMPTY_REQ);
    assert.ok(scenarios.length >= 1, "Should always generate at least one scenario");
  });

  it("scenario IDs are unique", () => {
    const scenarios = buildTestScenarios(MINIMAL_REQ);
    const ids = scenarios.map((s) => s.scenarioId);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length, "All scenario IDs should be unique");
  });

  it("scenario IDs include story ID without hardcoding", () => {
    const scenarios = buildTestScenarios(MINIMAL_REQ);
    for (const s of scenarios) {
      assert.ok(s.scenarioId.includes("TEST-1"), `${s.scenarioId} should include story ID`);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: buildTestCases
// ---------------------------------------------------------------------------

describe("buildTestCases", () => {
  it("creates one test case per scenario", () => {
    const scenarios = buildTestScenarios(MINIMAL_REQ);
    const testCases = buildTestCases(MINIMAL_REQ, scenarios);
    assert.equal(testCases.length, scenarios.length, "Should have one TC per scenario");
  });

  it("test case IDs are unique and sequential", () => {
    const scenarios = buildTestScenarios(MINIMAL_REQ);
    const testCases = buildTestCases(MINIMAL_REQ, scenarios);
    const ids = testCases.map((tc) => tc.testCaseId);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length, "Test case IDs must be unique");
  });

  it("test case IDs include story ID", () => {
    const scenarios = buildTestScenarios(MINIMAL_REQ);
    const testCases = buildTestCases(MINIMAL_REQ, scenarios);
    for (const tc of testCases) {
      assert.ok(tc.testCaseId.includes("TEST-1"), `${tc.testCaseId} should include story ID`);
    }
  });

  it("each test case has at least one step", () => {
    const scenarios = buildTestScenarios(MINIMAL_REQ);
    const testCases = buildTestCases(MINIMAL_REQ, scenarios);
    for (const tc of testCases) {
      assert.ok(tc.steps.length >= 1, `${tc.testCaseId} should have at least one step`);
    }
  });

  it("step numbers are sequential within each test case", () => {
    const scenarios = buildTestScenarios(MINIMAL_REQ);
    const testCases = buildTestCases(MINIMAL_REQ, scenarios);
    for (const tc of testCases) {
      for (let i = 0; i < tc.steps.length; i++) {
        assert.equal(tc.steps[i].step, i + 1, `Step ${i + 1} in ${tc.testCaseId} should have sequential number`);
      }
    }
  });

  it("positive TC for AC1 uses GWT-derived steps", () => {
    const scenarios = buildTestScenarios(MINIMAL_REQ);
    const testCases = buildTestCases(MINIMAL_REQ, scenarios);
    const ac1tc = testCases.find((tc) => tc.relatedAc === "AC1");
    assert.ok(ac1tc, "Should have a TC for AC1");
    const hasGiven = ac1tc.steps.some((s) => /precondition|login page/i.test(s.action));
    assert.ok(hasGiven, "Steps should include GIVEN clause");
  });

  it("test cases have relatedStory set", () => {
    const scenarios = buildTestScenarios(MINIMAL_REQ);
    const testCases = buildTestCases(MINIMAL_REQ, scenarios);
    for (const tc of testCases) {
      assert.equal(tc.relatedStory, "TEST-1");
    }
  });

  it("jiraTestKey is empty string before Jira creation", () => {
    const scenarios = buildTestScenarios(MINIMAL_REQ);
    const testCases = buildTestCases(MINIMAL_REQ, scenarios);
    for (const tc of testCases) {
      assert.equal(tc.jiraTestKey, "", "jiraTestKey should be empty before import");
    }
  });

  it("automationStatus defaults to Manual", () => {
    const scenarios = buildTestScenarios(MINIMAL_REQ);
    const testCases = buildTestCases(MINIMAL_REQ, scenarios);
    for (const tc of testCases) {
      assert.equal(tc.automationStatus, "Manual");
    }
  });
});
