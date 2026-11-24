/**
 * Unit tests: jira-xray-creator.js
 * Run with: node --test packages/xray-integration/test/jira-xray-creator.test.js
 *
 * All tests are mock-based — no live Jira calls are made.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  XRAY_TEST_ISSUE_TYPE_NAME,
  XRAY_TEST_EXECUTION_TYPE_NAME,
  XRAY_LINK_TYPE_NAME,
  detectDuplicateTests,
} from "../src/jira-xray-creator.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Build a mock MCP client whose callTool resolves to a fixed response. */
function mockClient(responses = {}) {
  return {
    callTool: async ({ name, arguments: args }) => {
      if (responses[name]) return responses[name](args);
      return { content: [{ type: "text", text: JSON.stringify({ data: {} }) }] };
    },
    close: async () => {},
  };
}

/** Minimal mock callJiraTool that wraps the mock client. */
function makeCallJiraTool(client) {
  return async (cl, toolName, args) => {
    const raw = await cl.callTool({ name: toolName, arguments: args });
    // Parse text response
    const text = (raw?.content || []).find((c) => c.type === "text")?.text || "{}";
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error) throw new Error(parsed.error);
      return parsed.data ?? parsed;
    } catch {
      return {};
    }
  };
}

// ---------------------------------------------------------------------------
// Tests: constants
// ---------------------------------------------------------------------------

describe("Xray issue type constants", () => {
  it("XRAY_TEST_ISSUE_TYPE_NAME is 'Test'", () => {
    assert.equal(XRAY_TEST_ISSUE_TYPE_NAME, "Test");
  });

  it("XRAY_TEST_EXECUTION_TYPE_NAME is 'Test Execution'", () => {
    assert.equal(XRAY_TEST_EXECUTION_TYPE_NAME, "Test Execution");
  });

  it("XRAY_LINK_TYPE_NAME is 'Test'", () => {
    assert.equal(XRAY_LINK_TYPE_NAME, "Test");
  });
});

// ---------------------------------------------------------------------------
// Tests: detectDuplicateTests
// ---------------------------------------------------------------------------

describe("detectDuplicateTests", () => {
  it("returns all as safeToCreate when searchJira returns no issues", async () => {
    const client = mockClient({
      searchJira: () => ({
        content: [{ type: "text", text: JSON.stringify({ data: { issues: [] } }) }],
      }),
    });
    const callJiraTool = makeCallJiraTool(client);

    const testCases = [
      { testCaseId: "TC-TEST-1-001", title: "Login with valid credentials" },
      { testCaseId: "TC-TEST-1-002", title: "Login with invalid credentials" },
    ];

    const result = await detectDuplicateTests(client, "cloud-id-123", "TEST-1", testCases, callJiraTool);
    assert.deepEqual(result.duplicates, []);
    assert.equal(result.safeToCreate.length, 2);
  });

  it("detects duplicate when existing issue has matching summary", async () => {
    const client = mockClient({
      searchJira: () => ({
        content: [{ type: "text", text: JSON.stringify({
          data: {
            issues: [
              { key: "TEST-10", fields: { summary: "[Positive] AC1: Successful Login" } },
            ],
          },
        }) }],
      }),
    });
    const callJiraTool = makeCallJiraTool(client);

    const testCases = [
      { testCaseId: "TC-TEST-1-001", title: "[Positive] AC1: Successful Login" }, // duplicate
      { testCaseId: "TC-TEST-1-002", title: "[Negative] Login with empty fields" }, // unique
    ];

    const result = await detectDuplicateTests(client, "cloud-id-123", "TEST-1", testCases, callJiraTool);
    assert.ok(result.duplicates.includes("TC-TEST-1-001"), "Should detect duplicate");
    assert.ok(result.safeToCreate.includes("TC-TEST-1-002"), "New case should be safe to create");
  });

  it("handles searchJira failure gracefully (non-fatal)", async () => {
    const client = mockClient({
      searchJira: () => { throw new Error("Not available"); },
    });
    const callJiraTool = async () => { throw new Error("Not available"); };

    const testCases = [{ testCaseId: "TC-TEST-1-001", title: "Login" }];

    // Should not throw
    const result = await detectDuplicateTests(client, "cloud-id-123", "TEST-1", testCases, callJiraTool);
    assert.ok(Array.isArray(result.duplicates));
    assert.ok(Array.isArray(result.safeToCreate));
  });

  it("returns empty arrays when no test cases provided", async () => {
    const client = mockClient({});
    const callJiraTool = makeCallJiraTool(client);
    const result = await detectDuplicateTests(client, "cloud-id", "TEST-1", [], callJiraTool);
    assert.deepEqual(result.duplicates, []);
    assert.deepEqual(result.safeToCreate, []);
  });
});
