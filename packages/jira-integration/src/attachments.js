import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const uploadToolName = "uploadAttachmentToJiraIssue";

function tokenizeUploadCommand(command) {
  if (typeof command !== "string" || !command.trim() || /[\r\n]/.test(command)) {
    throw new Error("Jira MCP returned an empty or multiline attachment upload command.");
  }

  const tokens = [];
  let token = "";
  let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (quote) {
      if (character === quote) {
        quote = null;
      } else if (character === "\\" && quote === '"' && ["\\", '"'].includes(command[index + 1])) {
        token += command[index + 1];
        index += 1;
      } else {
        token += character;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
    } else if (";&|<>`".includes(character)) {
      throw new Error("Jira MCP returned an attachment command using unsupported shell syntax.");
    } else {
      token += character;
    }
  }
  if (quote) throw new Error("Jira MCP returned an attachment command with unmatched quotes.");
  if (token) tokens.push(token);
  return tokens;
}

export function validateUploadCommand(command, expectedFilePath) {
  const tokens = tokenizeUploadCommand(command);
  const executable = path.basename(tokens.shift() || "").toLowerCase();
  if (executable !== "curl" && executable !== "curl.exe") {
    throw new Error("Jira MCP returned an unsupported upload command; only curl is allowed.");
  }

  const valueOptions = new Set([
    "-X", "--request",
    "-H", "--header",
    "-F", "--form",
    "--data-binary",
    "--url",
    "-u", "--user",
  ]);
  const flagOptions = new Set([
    "-L", "--location",
    "-s", "--silent",
    "--show-error",
    "--fail",
    "--fail-with-body",
  ]);
  const args = [];
  const uploadedPaths = [];
  let hasHttpsUrl = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const argument = tokens[index];
    if (valueOptions.has(argument)) {
      const value = tokens[++index];
      if (!value) throw new Error("Jira MCP returned an incomplete curl upload command.");
      args.push(argument, value);
      if (argument === "-F" || argument === "--form" || argument === "--data-binary") {
        const fileMatch = value.match(/(?:^|=)@(.+?)(?:;[^/]*)?$/);
        if (fileMatch) uploadedPaths.push(fileMatch[1]);
      }
    } else if (flagOptions.has(argument)) {
      args.push(argument);
    } else if (/^https:\/\//i.test(argument)) {
      args.push(argument);
      hasHttpsUrl = true;
    } else {
      throw new Error("Jira MCP returned a curl upload command with an unsupported option.");
    }
  }

  const expected = path.resolve(expectedFilePath).toLowerCase();
  if (!uploadedPaths.length || uploadedPaths.some((filePath) => path.resolve(filePath).toLowerCase() !== expected)) {
    throw new Error("Jira MCP upload command does not target only the generated report file.");
  }
  if (!hasHttpsUrl) throw new Error("Jira MCP upload command does not use an HTTPS endpoint.");
  return args;
}

function extractFileId(stdout) {
  const text = stdout.trim();
  if (!text) throw new Error("Jira MCP upload command returned no file ID.");

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    if (/^[A-Za-z0-9_-]{16,}$/.test(text)) return text;
    throw new Error("Jira MCP upload command returned an unrecognized file ID response.");
  }

  const pending = [payload];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    for (const [key, nested] of Object.entries(value)) {
      if (["fileId", "mediaFileId", "id"].includes(key) && typeof nested === "string" && nested.trim()) {
        return nested.trim();
      }
      if (nested && typeof nested === "object") pending.push(nested);
    }
  }
  throw new Error("Jira MCP upload command response did not contain a file ID.");
}

async function runUploadCommand(command, filePath) {
  const args = validateUploadCommand(command, filePath);
  try {
    const { stdout } = await execFileAsync("curl.exe", args, {
      cwd: path.dirname(filePath),
      windowsHide: true,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
    return extractFileId(stdout);
  } catch (error) {
    if (error?.code === "ERR_INVALID_ARG_TYPE") throw error;
    throw new Error("Jira attachment byte upload failed. Sensitive command output was suppressed.");
  }
}

function getAttachmentList(issueData, issueKey) {
  const issue = issueData.issue || issueData;
  if (issue.key !== issueKey && issue.issueKey !== issueKey) {
    throw new Error(`Jira attachment verification returned the wrong issue for ${issueKey}.`);
  }
  return issue.fields?.attachment || issue.attachment || [];
}

function findAttachment(attachments, filename, expectedSize) {
  const matches = attachments.filter((attachment) => attachment.filename === filename);
  if (!matches.length) return null;
  const matchingSize = matches.find((attachment) => Number(attachment.size) === expectedSize);
  if (!matchingSize) {
    throw new Error(`An attachment named ${filename} already exists with unexpected content size.`);
  }
  return matchingSize;
}

async function readAttachments(callTool, client, cloudId, issueKey) {
  const response = await callTool(client, "getJiraIssue", {
    cloudId,
    issueIdOrKey: issueKey,
    fields: ["attachment"],
    view: "full",
  });
  return getAttachmentList(response, issueKey);
}

export async function uploadAndVerifyAttachment({
  client,
  cloudId,
  issueKey,
  filePath,
  filename,
  size,
  callTool,
  executeUpload = runUploadCommand,
}) {
  if (typeof callTool !== "function") throw new Error("callTool is required for Jira attachment operations.");
  if (!client || !cloudId || !issueKey || !filePath || !filename || !Number.isInteger(size) || size < 0) {
    throw new Error("Jira attachment upload requires a client, issue, file, filename, and valid size.");
  }

  const existing = findAttachment(
    await readAttachments(callTool, client, cloudId, issueKey),
    filename,
    size
  );
  if (existing) return { attachment: existing, alreadyExists: true };

  const prepared = await callTool(client, uploadToolName, {
    cloudId,
    issueIdOrKey: issueKey,
    filePath,
  });
  if (typeof prepared.uploadCommand !== "string") {
    throw new Error("Jira MCP did not return the required uploadCommand for the report.");
  }

  const fileId = await executeUpload(prepared.uploadCommand, filePath);
  await callTool(client, uploadToolName, {
    cloudId,
    issueIdOrKey: issueKey,
    fileId,
  });

  const attachment = findAttachment(
    await readAttachments(callTool, client, cloudId, issueKey),
    filename,
    size
  );
  if (!attachment) {
    throw new Error(`Jira did not verify attachment ${filename} on ${issueKey}.`);
  }
  return { attachment, alreadyExists: false };
}

export async function readAttachmentUploadState(stateFilePath) {
  try {
    const raw = await readFile(stateFilePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.entries === "object") {
      return {
        version: typeof parsed.version === "number" ? parsed.version : 1,
        entries: parsed.entries,
      };
    }
  } catch {
    // Return empty state if file does not exist or is invalid JSON
  }
  return { version: 1, entries: {} };
}

export async function saveAttachmentUploadState(stateFilePath, state) {
  await mkdir(path.dirname(stateFilePath), { recursive: true });
  await writeFile(stateFilePath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export async function recordAttachmentUpload(stateFilePath, {
  filename,
  attachmentId,
  size,
  uploadedAt = new Date().toISOString(),
  status = "verified",
}) {
  const state = await readAttachmentUploadState(stateFilePath);
  state.entries[filename] = {
    attachmentId: String(attachmentId),
    filename,
    size,
    uploadedAt,
    status,
  };
  await saveAttachmentUploadState(stateFilePath, state);
  return state.entries[filename];
}

export async function getAttachmentUploadEntry(stateFilePath, filename) {
  const state = await readAttachmentUploadState(stateFilePath);
  return state.entries[filename] || null;
}

export function appendAttachmentStatus(
  analysisMarkdown,
  { status, attachmentId, filename, uploadedAt } = {}
) {
  const withoutAttachment = analysisMarkdown
    .replace(/\n## Jira Attachment Status[\s\S]*?(?=\n## Jira Comment Status|\s*$)/i, "")
    .trimEnd();

  const attachmentBlock = `

## Jira Attachment Status

- **Status:** ${status || "Attached"}
- **Attachment ID:** ${attachmentId || "Not assigned"}
- **Filename:** ${filename || "requirement-analysis.md"}
- **Uploaded At:** ${uploadedAt || "Not recorded"}
`;

  const commentIndex = withoutAttachment.indexOf("\n## Jira Comment Status");
  if (commentIndex >= 0) {
    return withoutAttachment.slice(0, commentIndex) + attachmentBlock + withoutAttachment.slice(commentIndex);
  }
  return withoutAttachment + attachmentBlock;
}

export async function assertAttachmentToolAvailable(client) {
  const listed = await client.listTools();
  const tools = (listed.tools || []).map((tool) => tool.name);
  if (!tools.includes(uploadToolName) && !tools.includes("executeWrite")) {
    throw new Error(`The configured Jira MCP server does not expose "${uploadToolName}" or "executeWrite".`);
  }
}
