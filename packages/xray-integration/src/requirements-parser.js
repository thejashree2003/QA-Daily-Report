/**
 * @fileoverview requirements-parser.js
 *
 * Parses user-story.md and requirement-analysis.md for a given Jira issue
 * into a structured object used by the test-case-builder.
 *
 * Rules:
 *  - Never throws on missing sections — returns empty arrays / strings instead.
 *  - Does not modify the source files.
 *  - Project key and story ID are always taken from the parsed content
 *    or the caller-supplied defaults; nothing is hardcoded.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the first markdown heading value that matches a pattern.
 * @param {string} text
 * @param {RegExp} pattern
 * @returns {string}
 */
function extractHeading(text, pattern) {
  const m = text.match(pattern);
  return m ? m[1].trim() : "";
}

/**
 * Extract a bullet-list section between two headings.
 * Returns an array of non-empty trimmed strings.
 * @param {string} text
 * @param {string|RegExp} startHeading
 * @param {string|RegExp} [stopHeading]
 * @returns {string[]}
 */
function extractBulletSection(text, startHeading, stopHeading) {
  const startPattern = typeof startHeading === "string"
    ? new RegExp(`^#{1,6}[^\\n]*${startHeading}`, "im")
    : startHeading;

  const startMatch = startPattern.exec(text);
  if (!startMatch) return [];

  const afterStart = text.slice(startMatch.index + startMatch[0].length);

  let slice;
  if (stopHeading) {
    const stopPattern = typeof stopHeading === "string"
      ? new RegExp(`^#{1,6}[^\\n]*${stopHeading}`, "im")
      : stopHeading;
    const stopMatch = stopPattern.exec(afterStart);
    slice = stopMatch ? afterStart.slice(0, stopMatch.index) : afterStart;
  } else {
    slice = afterStart;
  }

  return slice
    .split("\n")
    .map((l) => l.replace(/^[-*+]\s+/, "").trim())
    .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("|"));
}

/**
 * Extract the section body (all text) between two headings.
 * @param {string} text
 * @param {string|RegExp} startHeading
 * @param {string|RegExp} [stopHeading]
 * @returns {string}
 */
function extractSection(text, startHeading, stopHeading) {
  const startPattern = typeof startHeading === "string"
    ? new RegExp(`^#{1,6}[^\\n]*${startHeading}[^\\n]*$`, "im")
    : startHeading;
  const startMatch = startPattern.exec(text);
  if (!startMatch) return "";

  const after = text.slice(startMatch.index + startMatch[0].length).trimStart();
  if (!stopHeading) return after;

  const stopPattern = typeof stopHeading === "string"
    ? new RegExp(`^#{1,6}[^\\n]*${stopHeading}`, "im")
    : stopHeading;
  const stopMatch = stopPattern.exec(after);
  return stopMatch ? after.slice(0, stopMatch.index).trim() : after.trim();
}

/**
 * Parse Gherkin-style acceptance criteria blocks.
 * Returns an array of { id, title, given, when, then } objects.
 * @param {string} text
 * @returns {Array<{id:string, title:string, given:string[], when:string[], then:string[]}>}
 */
function parseAcceptanceCriteria(text) {
  // Match ### AC<n>: Title patterns
  const acPattern = /###\s+(AC\d+)[:\s]+([^\n]+)/g;
  const acs = [];
  let match;
  while ((match = acPattern.exec(text)) !== null) {
    const id = match[1].trim();
    const title = match[2].trim();
    // Extract the body of this AC until the next heading
    const bodyStart = match.index + match[0].length;
    const nextHeadingMatch = /^#{1,6}\s+/m.exec(text.slice(bodyStart));
    const body = nextHeadingMatch
      ? text.slice(bodyStart, bodyStart + nextHeadingMatch.index)
      : text.slice(bodyStart);

    const given = body.match(/GIVEN\s+([^\n]+)/gi)?.map((l) => l.replace(/^GIVEN\s+/i, "").trim()) || [];
    const when  = body.match(/WHEN\s+([^\n]+)/gi)?.map((l) => l.replace(/^WHEN\s+/i, "").trim()) || [];
    const then  = body.match(/(THEN|AND)\s+([^\n]+)/gi)?.map((l) => l.replace(/^(THEN|AND)\s+/i, "").trim()) || [];

    acs.push({ id, title, given, when, then, raw: body.trim() });
  }
  return acs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the paths to user-story.md and requirement-analysis.md for a given
 * story ID under the project root.
 *
 * @param {string} projectRoot  Absolute path to the project root.
 * @param {string} storyId      e.g. "AAQA-1"
 * @returns {{ userStoryPath: string, requirementAnalysisPath: string }}
 */
export function resolveDocumentPaths(projectRoot, storyId) {
  const storyDir = path.join(projectRoot, "user-stories", storyId);
  return {
    userStoryPath: path.join(storyDir, "user-story.md"),
    requirementAnalysisPath: path.join(storyDir, "requirement-analysis.md"),
  };
}

/**
 * Read and parse both input documents for a user story.
 *
 * @param {string} projectRoot
 * @param {string} projectKey  e.g. "AAQA"
 * @param {string} storyId     e.g. "AAQA-1"
 * @returns {Promise<ParsedRequirements>}
 */
export async function parseRequirementsDocuments(projectRoot, projectKey, storyId) {
  const { userStoryPath, requirementAnalysisPath } = resolveDocumentPaths(projectRoot, storyId);

  if (!existsSync(userStoryPath)) {
    throw new Error(
      `User story file not found: ${userStoryPath}\n` +
      `Please run the Requirements Analysis agent for ${storyId} first.`
    );
  }
  if (!existsSync(requirementAnalysisPath)) {
    throw new Error(
      `Requirement analysis file not found: ${requirementAnalysisPath}\n` +
      `Please run the Requirements Analysis agent for ${storyId} first.`
    );
  }

  const [userStoryText, analysisText] = await Promise.all([
    readFile(userStoryPath, "utf8"),
    readFile(requirementAnalysisPath, "utf8"),
  ]);

  return parseDocuments(userStoryText, analysisText, projectKey, storyId);
}

/**
 * Parse raw document strings (useful for unit testing without touching the
 * filesystem).
 *
 * @param {string} userStoryText
 * @param {string} analysisText
 * @param {string} projectKey
 * @param {string} storyId
 * @returns {ParsedRequirements}
 */
export function parseDocuments(userStoryText, analysisText, projectKey, storyId) {
  // --- User story fields ---
  const jiraUrl = extractHeading(userStoryText, /\*\*Jira URL:\*\*\s+(\S+)/);
  const summary = extractHeading(userStoryText, /##\s+Summary\s*\n+([^\n]+)/);
  const appUrl  = extractHeading(userStoryText, /##\s+Application URL\s*\n+(\S+)/);
  if (!appUrl) {
    // Try inside description block
    const descSection = extractSection(userStoryText, "Description");
    var appUrlFallback = extractHeading(descSection, /https?:\/\/\S+/);
  }
  const applicationUrl = appUrl || appUrlFallback || "";

  // Parse acceptance criteria from both user story and analysis
  const acceptanceCriteria = [
    ...parseAcceptanceCriteria(userStoryText),
    ...parseAcceptanceCriteria(analysisText),
  ];
  // De-duplicate by ID
  const acMap = new Map();
  for (const ac of acceptanceCriteria) {
    if (!acMap.has(ac.id)) acMap.set(ac.id, ac);
  }
  const uniqueACs = [...acMap.values()];

  // --- Analysis fields ---
  const functionalities = extractBulletSection(analysisText, "Functionalities Covered", "Missing Functionalities");
  const missingFunctionalities = extractBulletSection(analysisText, "Missing Functionalities", "Identified Requirement Gaps");
  const ambiguities = extractBulletSection(analysisText, "Ambiguities", "Business Rules");
  const businessRules = extractBulletSection(analysisText, "Business Rules", "Negative");
  const negativeScenarios = extractBulletSection(analysisText, "Negative", "Dependencies");
  const dependencies = extractBulletSection(analysisText, "Dependencies", "Clarification");
  const clarifications = extractBulletSection(analysisText, "Clarification", "Recommendation");
  const recommendations = extractBulletSection(analysisText, "Recommendation", "Gherkin");

  // Extract the gherkin scenarios block
  const gherkinBlock = extractSection(analysisText, /gherkin/i, /---/);

  return {
    projectKey,
    storyId,
    jiraUrl,
    summary: summary || `${storyId} – Requirements Analysis`,
    applicationUrl,
    acceptanceCriteria: uniqueACs,
    functionalities,
    missingFunctionalities,
    ambiguities,
    businessRules,
    negativeScenarios,
    dependencies,
    clarifications,
    recommendations,
    gherkinBlock,
    // Raw texts — available for downstream consumers
    _userStoryText: userStoryText,
    _analysisText: analysisText,
  };
}

/**
 * @typedef {Object} ParsedRequirements
 * @property {string} projectKey
 * @property {string} storyId
 * @property {string} jiraUrl
 * @property {string} summary
 * @property {string} applicationUrl
 * @property {Array<{id:string,title:string,given:string[],when:string[],then:string[],raw:string}>} acceptanceCriteria
 * @property {string[]} functionalities
 * @property {string[]} missingFunctionalities
 * @property {string[]} ambiguities
 * @property {string[]} businessRules
 * @property {string[]} negativeScenarios
 * @property {string[]} dependencies
 * @property {string[]} clarifications
 * @property {string[]} recommendations
 * @property {string} gherkinBlock
 * @property {string} _userStoryText
 * @property {string} _analysisText
 */
