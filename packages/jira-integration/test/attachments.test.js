import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendAttachmentStatus,
  assertAttachmentToolAvailable,
  getAttachmentUploadEntry,
  readAttachmentUploadState,
  recordAttachmentUpload,
  saveAttachmentUploadState,
  uploadAndVerifyAttachment,
  validateUploadCommand,
} from "../src/attachments.js";

const reportPath = "C:\\reports\\Requirement Analysis-deadbeef.md";

function createMockJira({ initialAttachments = [] } = {}) {
  const attachments = [...initialAttachments];
  const calls = [];
  const callTool = async (_client, name, args) => {
    calls.push({ name, args });
    if (name === "getJiraIssue") {
      return { issue: { key: "DEMO-1", fields: { attachment: [...attachments] } } };
    }
    if (name === "uploadAttachmentToJiraIssue" && args.filePath) {
      return {
        uploadCommand: `curl.exe --form "file=@${reportPath}" "https://upload.example.invalid/upload?signature=hidden"`,
      };
    }
    if (name === "uploadAttachmentToJiraIssue" && args.fileId) {
      attachments.push({ id: "attachment-1", filename: "requirement-analysis-deadbeef.md", size: 128 });
      return { attached: true };
    }
    throw new Error(`Unexpected mock tool: ${name}`);
  };
  return { attachments, calls, callTool };
}

test("validates the generated report target and rejects shell commands", () => {
  const args = validateUploadCommand(
    `curl.exe --form "file=@${reportPath}" "https://upload.example.invalid/upload?signature=hidden"`,
    reportPath
  );
  assert.equal(args.includes("--form"), true);
  assert.throws(
    () => validateUploadCommand(`curl.exe ${reportPath} | powershell`, reportPath),
    /unsupported shell syntax/
  );
  assert.throws(
    () => validateUploadCommand(`powershell -Command "upload ${reportPath}"`, reportPath),
    /only curl is allowed/
  );
});

test("uploads, associates, then verifies a report against the intended Jira issue", async () => {
  const mock = createMockJira();
  const result = await uploadAndVerifyAttachment({
    client: {},
    cloudId: "cloud",
    issueKey: "DEMO-1",
    filePath: reportPath,
    filename: "requirement-analysis-deadbeef.md",
    size: 128,
    callTool: mock.callTool,
    executeUpload: async () => "media-file-id",
  });
  assert.equal(result.alreadyExists, false);
  assert.equal(result.attachment.filename, "requirement-analysis-deadbeef.md");
  assert.deepEqual(mock.calls.map((call) => call.name), [
    "getJiraIssue",
    "uploadAttachmentToJiraIssue",
    "uploadAttachmentToJiraIssue",
    "getJiraIssue",
  ]);
  assert.equal(mock.calls[2].args.fileId, "media-file-id");
});

test("skips matching existing attachments and rejects wrong-issue verification", async () => {
  const mock = createMockJira({
    initialAttachments: [
      { id: "existing", filename: "requirement-analysis-deadbeef.md", size: 128 },
    ],
  });
  const result = await uploadAndVerifyAttachment({
    client: {},
    cloudId: "cloud",
    issueKey: "DEMO-1",
    filePath: reportPath,
    filename: "requirement-analysis-deadbeef.md",
    size: 128,
    callTool: mock.callTool,
  });
  assert.equal(result.alreadyExists, true);
  assert.equal(mock.calls.length, 1);

  await assert.rejects(
    uploadAndVerifyAttachment({
      client: {},
      cloudId: "cloud",
      issueKey: "DEMO-1",
      filePath: reportPath,
      filename: "requirement-analysis-deadbeef.md",
      size: 128,
      callTool: async () => ({ issue: { key: "OTHER-1", fields: { attachment: [] } } }),
    }),
    /wrong issue/
  );
});

test("reads, saves, and updates attachment upload state in .jira-attachment-upload-state.json", async () => {
  const tempDir = path.join(os.tmpdir(), `jira-state-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const stateFilePath = path.join(tempDir, ".jira-attachment-upload-state.json");

  try {
    const initial = await readAttachmentUploadState(stateFilePath);
    assert.deepEqual(initial, { version: 1, entries: {} });

    const timestamp = "2026-11-21T12:00:00.000Z";
    const recorded = await recordAttachmentUpload(stateFilePath, {
      filename: "requirement-analysis.md",
      attachmentId: "10099",
      size: 4096,
      uploadedAt: timestamp,
      status: "verified",
    });

    assert.deepEqual(recorded, {
      attachmentId: "10099",
      filename: "requirement-analysis.md",
      size: 4096,
      uploadedAt: timestamp,
      status: "verified",
    });

    const queried = await getAttachmentUploadEntry(stateFilePath, "requirement-analysis.md");
    assert.deepEqual(queried, recorded);

    const missing = await getAttachmentUploadEntry(stateFilePath, "non-existent.md");
    assert.equal(missing, null);

    const reloaded = await readAttachmentUploadState(stateFilePath);
    assert.equal(reloaded.version, 1);
    assert.deepEqual(reloaded.entries["requirement-analysis.md"], recorded);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("appendAttachmentStatus formats report cleanly before comment status", () => {
  const originalReport = `# User Story Summary

Some summary text.

## Jira Comment Status

- **Status:** Analysis complete; proposed comment not posted
- **Proposed comment:**

> Test comment
`;

  const updatedReport = appendAttachmentStatus(originalReport, {
    status: "Attached and verified as attachment 10099",
    attachmentId: "10099",
    filename: "requirement-analysis.md",
    uploadedAt: "2026-11-21T12:00:00.000Z",
  });

  assert.ok(updatedReport.includes("## Jira Attachment Status"));
  assert.ok(updatedReport.includes("- **Attachment ID:** 10099"));
  assert.ok(updatedReport.includes("- **Status:** Attached and verified as attachment 10099"));
  assert.ok(updatedReport.includes("## Jira Comment Status"));

  const attachmentIndex = updatedReport.indexOf("## Jira Attachment Status");
  const commentIndex = updatedReport.indexOf("## Jira Comment Status");
  assert.ok(attachmentIndex < commentIndex, "Attachment status should precede comment status");

  const reUpdated = appendAttachmentStatus(updatedReport, {
    status: "Already attached and verified as attachment 10099",
    attachmentId: "10099",
    filename: "requirement-analysis.md",
    uploadedAt: "2026-11-21T12:00:00.000Z",
  });
  assert.equal((reUpdated.match(/## Jira Attachment Status/g) || []).length, 1);
  assert.ok(reUpdated.includes("- **Status:** Already attached and verified as attachment 10099"));
  assert.ok(reUpdated.includes("## Jira Comment Status"));
});

test("assertAttachmentToolAvailable verifies tool presence", async () => {
  const clientWithTool = {
    listTools: async () => ({
      tools: [{ name: "uploadAttachmentToJiraIssue" }, { name: "getJiraIssue" }],
    }),
  };
  await assertAttachmentToolAvailable(clientWithTool);

  const clientWithoutTool = {
    listTools: async () => ({
      tools: [{ name: "getJiraIssue" }],
    }),
  };
  await assert.rejects(
    assertAttachmentToolAvailable(clientWithoutTool),
    /does not expose "uploadAttachmentToJiraIssue"/
  );
});
