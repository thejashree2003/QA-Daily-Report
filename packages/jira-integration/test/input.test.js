import test from "node:test";
import assert from "node:assert/strict";
import { parseJiraInputMarkdown } from "../src/input.js";

test("parses every configured Jira row without requiring hardcoded issue IDs", () => {
  const rows = parseJiraInputMarkdown(`| Project Key | User Story ID |
|---|---|
| DEMO | DEMO-12 |
| QA2 | QA2-3 |`);
  assert.deepEqual(rows, [
    { projectKey: "DEMO", issueKey: "DEMO-12" },
    { projectKey: "QA2", issueKey: "QA2-3" },
  ]);
});

test("rejects malformed, duplicate, and project-mismatched input rows", () => {
  assert.throws(
    () => parseJiraInputMarkdown("| Project Key | User Story ID |\n|---|---|\n| DEMO | QA-1 |"),
    /Invalid User Story ID/
  );
  assert.throws(
    () => parseJiraInputMarkdown("| Project Key | User Story ID |\n|---|---|\n| DEMO | DEMO-1 |\n| DEMO | DEMO-1 |"),
    /Duplicate User Story ID/
  );
  assert.throws(
    () => parseJiraInputMarkdown("| Project Key | User Story ID |\n|---|---|\n| DEMO | DEMO-1 | Extra |"),
    /Malformed configuration table row/
  );
});
