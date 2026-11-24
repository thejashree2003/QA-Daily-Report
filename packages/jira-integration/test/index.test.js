import test from "node:test";
import assert from "node:assert/strict";
import {
  expandEnvironmentValues,
  getJiraCloudId,
  getJiraIssue,
  parseMcpResponse,
  readServerDefinition,
  redactSensitiveText,
} from "../src/index.js";

test("expands configured environment references without accepting literal credential values", () => {
  assert.deepEqual(
    expandEnvironmentValues(
      { CLIENT_TOKEN: "${JIRA_TOKEN}", MODE: "oauth" },
      { JIRA_TOKEN: "private-value" }
    ),
    { CLIENT_TOKEN: "private-value", MODE: "oauth" }
  );
  assert.throws(
    () => expandEnvironmentValues({ CLIENT_TOKEN: "private-value" }, {}),
    /must reference an environment variable/
  );
  assert.throws(
    () => expandEnvironmentValues({ CLIENT_TOKEN: "${MISSING_TOKEN}" }, {}),
    /Required environment variable MISSING_TOKEN is not set/
  );
});

test("selects the configured Atlassian stdio server without exposing credentials", () => {
  const server = { command: "npx", args: ["-y", "mcp-remote", "https://example.invalid"] };
  const result = readServerDefinition(
    { servers: { browser: { command: "node", args: [] }, atlassian: server } },
    "mcp.json",
    {}
  );
  assert.equal(result.serverName, "atlassian");
  assert.equal(result.server, server);
  assert.throws(
    () => readServerDefinition({ servers: { atlassian: { command: "node", args: [], type: "sse" } } }, "mcp.json", {}),
    /must use type "stdio"/
  );
  assert.throws(
    () => readServerDefinition({
      servers: { atlassian: { command: "node", args: ["Authorization: Bearer private-value"] } },
    }, "mcp.json", {}),
    /inline credential/
  );
  assert.throws(
    () => readServerDefinition({
      servers: { atlassian: { command: "node", args: ["https://example.invalid/?access_token=private-value"] } },
    }, "mcp.json", {}),
    /inline credential|credential query parameters/
  );
});

test("parses MCP responses and redacts bearer credentials in tool errors", () => {
  assert.deepEqual(
    parseMcpResponse({ structuredContent: { issue: { key: "TEST-1" } } }, "getJiraIssue"),
    { issue: { key: "TEST-1" } }
  );
  assert.throws(
    () => parseMcpResponse({ isError: true, content: [{ text: "Authorization: Bearer secret-value" }] }, "tool"),
    /Authorization: Bearer \[REDACTED\]/
  );
  assert.throws(
    () => parseMcpResponse({
      isError: true,
      content: [{ text: "https://example.invalid/path?signature=secret-value" }],
    }, "tool"),
    /https:\/\/example\.invalid\/path\?\[REDACTED\]/
  );
  assert.throws(
    () => parseMcpResponse({
      isError: true,
      content: [{ text: "credential ghp_1234567890123456789012345678901234567890" }],
    }, "tool"),
    /credential \[REDACTED\]/
  );
  assert.match(redactSensitiveText("Username: standard_user"), /Username: \[REDACTED\]/);
});

test("rejects an issue response that does not match the configured project and issue", async () => {
  const client = {
    async callTool() {
      return {
        structuredContent: {
          issue: {
            key: "OTHER-1",
            fields: { project: { key: "OTHER" } },
          },
        },
      };
    },
  };
  await assert.rejects(
    getJiraIssue(client, "cloud", { projectKey: "TEST", issueKey: "TEST-1" }),
    /Jira returned OTHER-1/
  );
});

test("selects the configured Jira cloud when multiple Atlassian sites are present", async () => {
  const client = {
    async callTool() {
      return {
        structuredContent: {
          resources: [
            { cloudId: "jira-a", url: "https://a.example", products: [{ id: "jira" }] },
            { cloudId: "jira-b", url: "https://b.example", products: [{ id: "jira" }] },
          ],
        },
      };
    },
  };
  assert.deepEqual(await getJiraCloudId(client, { JIRA_CLOUD_ID: "jira-b" }), {
    cloudId: "jira-b",
    siteUrl: "https://b.example",
  });
});
