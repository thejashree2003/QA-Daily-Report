import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
export { parseJiraInputMarkdown } from "./input.js";
export {
  appendAttachmentStatus,
  assertAttachmentToolAvailable,
  getAttachmentUploadEntry,
  readAttachmentUploadState,
  recordAttachmentUpload,
  saveAttachmentUploadState,
  uploadAndVerifyAttachment,
} from "./attachments.js";

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredReadTools = [
  "getAccessibleAtlassianResources",
  "getJiraIssue",
  "listJiraIssueComments",
];

export function redactSensitiveText(value) {
  return String(value)
    .replace(/\b(authorization\s*[:=]\s*bearer\s+)\S+/gi, "$1[REDACTED]")
    .replace(/\b(gh[pousr]_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,})\b/g, "[REDACTED]")
    .replace(/\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g, "[REDACTED]")
    .replace(
      /\b(password|passwd|username|user\s+name|api[_ -]?token|access[_ -]?token|api[_ -]?key|client[_ -]?secret|secret)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|`[^`]*`|[^\s,;]+)/gi,
      "$1$2[REDACTED]"
    )
    .replace(/\b(https?:\/\/[^\s"'<>?#]+)\?[^\s"'<>#]*/gi, "$1?[REDACTED]")
    .replace(
      /([?&](?:access_token|refresh_token|token|client_secret|secret|password|authorization|api_key|signature)=)[^&\s"'<>]*/gi,
      "$1[REDACTED]"
    );
}

export function redactObject(value) {
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(redactObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        /password|passwd|username|user.?name|secret|token|authorization/i.test(key)
          ? "[REDACTED]"
          : redactObject(nestedValue),
      ])
    );
  }
  return value;
}

export function expandEnvironmentValues(environment = {}, processEnvironment = process.env) {
  const expanded = {};
  for (const [name, rawValue] of Object.entries(environment)) {
    if (typeof rawValue !== "string") {
      throw new Error(`MCP environment value "${name}" must be a string.`);
    }
    if (
      /token|password|secret|authorization/i.test(name)
      && !/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(rawValue)
    ) {
      throw new Error(
        `Credential-like MCP value "${name}" must reference an environment variable, not contain a literal secret.`
      );
    }
    const variableMatch = rawValue.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
    if (variableMatch) {
      const value = processEnvironment[variableMatch[1]];
      if (value === undefined) {
        throw new Error(`Required environment variable ${variableMatch[1]} is not set.`);
      }
      expanded[name] = value;
    } else {
      expanded[name] = rawValue;
    }
  }
  return expanded;
}

export function readServerDefinition(config, configPath, environment = process.env) {
  if (!config || typeof config !== "object" || !config.servers || typeof config.servers !== "object") {
    throw new Error(`MCP configuration must contain a "servers" object: ${configPath}`);
  }

  const names = Object.keys(config.servers);
  const serverName = environment.JIRA_MCP_SERVER
    || names.find((name) => /jira|atlassian/i.test(name))
    || (names.length === 1 ? names[0] : null);
  const server = serverName && config.servers[serverName];

  if (!server) {
    throw new Error(
      `Could not select the Jira MCP server in ${configPath}. Set JIRA_MCP_SERVER to its server name.`
    );
  }
  if (typeof server.command !== "string" || !Array.isArray(server.args)) {
    throw new Error(`MCP server "${serverName}" must define a stdio command and args.`);
  }
  if (server.type && server.type !== "stdio") {
    throw new Error(`MCP server "${serverName}" must use type "stdio"; received "${server.type}".`);
  }
  expandEnvironmentValues(server.env, environment);
  for (const argument of server.args) {
    if (typeof argument !== "string") {
      throw new Error(`MCP server "${serverName}" args must contain only strings.`);
    }
    if (
      /\b(?:authorization\s*[:=]\s*bearer|(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key)\s*[:=])/i
        .test(argument)
    ) {
      throw new Error(
        `MCP server "${serverName}" has an inline credential in args; move it to a protected environment variable.`
      );
    }
    if (/^https?:\/\//i.test(argument)) {
      let url;
      try {
        url = new URL(argument);
      } catch {
        throw new Error(`MCP server "${serverName}" contains an invalid URL argument.`);
      }
      if ([...url.searchParams.keys()].some((key) =>
        /^(?:access_token|refresh_token|token|client_secret|secret|password|authorization|api_key)$/i.test(key)
      )) {
        throw new Error(
          `MCP server "${serverName}" URL args must not contain credential query parameters.`
        );
      }
    }
  }

  return { serverName, server };
}

export function getJiraMcpConfigPath(projectRoot, environment = process.env) {
  const configuredPath = environment.JIRA_MCP_CONFIG_PATH;
  if (configuredPath) {
    const absolutePath = path.resolve(configuredPath);
    if (!existsSync(absolutePath)) {
      throw new Error(`JIRA_MCP_CONFIG_PATH does not exist: ${absolutePath}`);
    }
    return absolutePath;
  }

  const defaultPath = path.join(projectRoot, ".vscode", "mcp.json");
  return existsSync(defaultPath) ? defaultPath : null;
}

export async function validateJiraMcpConfig(configPath, environment = process.env) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  return readServerDefinition(config, configPath, environment);
}

function normalizeMcpLaunch(server, serverName, environment) {
  const args = [...server.args];
  const commandName = path.basename(server.command).toLowerCase();
  let command = server.command;
  let launchArgs = args;

  if (commandName === "npx" || commandName === "npx.cmd") {
    const remoteIndex = args.indexOf("mcp-remote");
    if (remoteIndex < 0) {
      throw new Error(
        `MCP server "${serverName}" launches npx but not mcp-remote; this adapter only normalizes the configured Atlassian mcp-remote server.`
      );
    }
    const proxyPath = require.resolve("mcp-remote/dist/proxy.js", {
      paths: [packageRoot],
    });
    command = process.execPath;
    launchArgs = [proxyPath, ...args.slice(remoteIndex + 1)];
  }

  return {
    command,
    args: launchArgs,
    env: expandEnvironmentValues(server.env, environment),
    stderr: "pipe",
  };
}

function logRedactedStderr(stream) {
  if (!stream) return;
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    for (const line of lines) {
      if (line) console.error(`Jira MCP: ${redactSensitiveText(line)}`);
    }
  });
  stream.on("end", () => {
    if (pending) console.error(`Jira MCP: ${redactSensitiveText(pending)}`);
  });
}

export function parseMcpResponse(result, toolName) {
  if (result?.isError) {
    const message = (result.content || []).map((item) => item.text || "").join("\n");
    throw new Error(`${toolName} failed: ${redactSensitiveText(message)}`);
  }
  if (result?.structuredContent) return result.structuredContent;

  const text = (result?.content || [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
  if (!text) throw new Error(`${toolName} returned no content.`);

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${toolName} returned a response that was not valid JSON.`);
  }
  if (parsed?.error) {
    throw new Error(`${toolName} failed: ${redactSensitiveText(JSON.stringify(parsed.error))}`);
  }
  return parsed.data ?? parsed;
}

export async function callJiraTool(client, toolName, args) {
  const result = await client.callTool({ name: toolName, arguments: args });
  if (result?.isError && (result.content || []).some((item) => /Tool .* not found/i.test(item.text || ""))) {
    const executeArgs = {
      name: "executeWrite",
      arguments: {
        cloudId: args.cloudId,
        name: toolName,
        inputs: { ...args },
      },
    };
    if (executeArgs.arguments.inputs) {
      delete executeArgs.arguments.inputs.cloudId;
    }
    const fallbackResult = await client.callTool(executeArgs);
    return parseMcpResponse(fallbackResult, toolName);
  }
  return parseMcpResponse(result, toolName);
}

export async function connectToJiraMcp({
  projectRoot,
  configPath = getJiraMcpConfigPath(projectRoot),
  environment = process.env,
} = {}) {
  if (!projectRoot) throw new Error("projectRoot is required to resolve the Jira MCP configuration.");
  if (!configPath) {
    throw new Error(
      "Jira MCP is not configured. Set JIRA_MCP_CONFIG_PATH to the existing config or add .vscode/mcp.json."
    );
  }

  const config = JSON.parse(await readFile(configPath, "utf8"));
  const { serverName, server } = readServerDefinition(config, configPath, environment);
  const launch = normalizeMcpLaunch(server, serverName, environment);
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js"),
  ]);
  const transport = new StdioClientTransport(launch);
  logRedactedStderr(transport.stderr);
  const client = new Client({ name: "jira-requirement-analysis", version: "1.0.0" });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const available = new Set((listed.tools || []).map((tool) => tool.name));
    for (const toolName of requiredReadTools) {
      if (!available.has(toolName)) {
        throw new Error(`The configured MCP server does not expose required read tool "${toolName}".`);
      }
    }
    return { client, configPath, serverName };
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}

export async function getJiraCloudId(client, environment = process.env) {
  const resourcesResponse = await callJiraTool(client, "getAccessibleAtlassianResources", {});
  const resources = resourcesResponse.resources || [];
  const jiraResources = resources.filter((resource) =>
    (resource.products || []).some((product) => product.id === "jira")
  );
  const configuredCloudId = environment.JIRA_CLOUD_ID;

  if (configuredCloudId) {
    return {
      cloudId: configuredCloudId,
      siteUrl: jiraResources.find((resource) => resource.cloudId === configuredCloudId)?.url || "",
    };
  }
  if (jiraResources.length !== 1) {
    throw new Error(
      `Expected one accessible Jira site; found ${jiraResources.length}. Set JIRA_CLOUD_ID to select one.`
    );
  }
  return { cloudId: jiraResources[0].cloudId, siteUrl: jiraResources[0].url };
}

export async function getJiraIssue(client, cloudId, story) {
  const issueData = await callJiraTool(client, "getJiraIssue", {
    cloudId,
    issueIdOrKey: story.issueKey,
    view: "full",
    responseContentFormat: "markdown",
  });
  const issue = issueData.issue || issueData;
  const fields = issue.fields || {};
  const returnedKey = issue.key || issue.issueKey;
  const returnedProject = fields.project?.key || issue.project?.key;

  if (returnedKey !== story.issueKey) {
    throw new Error(`Jira returned ${returnedKey || "no issue key"} for configured issue ${story.issueKey}.`);
  }
  if (returnedProject !== story.projectKey) {
    throw new Error(
      `Configured project ${story.projectKey} does not match Jira project ${returnedProject || "(missing)"} for ${story.issueKey}.`
    );
  }

  return { issue, fields };
}

export async function listJiraIssueComments(client, cloudId, issueKey) {
  const comments = [];
  let startAt = 0;
  for (;;) {
    const response = await callJiraTool(client, "listJiraIssueComments", {
      cloudId,
      issueIdOrKey: issueKey,
      startAt,
      maxResults: 100,
      responseContentFormat: "markdown",
      view: "full",
    });
    const page = response.comments || [];
    comments.push(...page);
    if (response.isLast || page.length === 0) return comments;
    startAt += page.length;
  }
}
