#!/usr/bin/env node
/**
 * scripts/jira-xray-test-case-generator.js
 *
 * Main orchestrator for the Jira Xray Excel Test Case Generator Agent.
 *
 * Usage:
 *   node scripts/jira-xray-test-case-generator.js --project AAQA --story AAQA-1
 *   node scripts/jira-xray-test-case-generator.js --project AAQA --story AAQA-1 --check
 *   node scripts/jira-xray-test-case-generator.js --project AAQA --story AAQA-1 --import
 *
 * Phases:
 *  1.  Validate CLI arguments and resolve input file paths
 *  2.  Parse requirements documents
 *  3.  Generate test scenarios → test-scenarios.md
 *  4.  Generate test cases → test-cases.md
 *  5.  Build Requirements Traceability Matrix → requirements-test-traceability.md
 *  6.  Generate Excel workbook → jira-xray-test-cases-{STORY-ID}.xlsx
 *  7.  Validate Excel workbook → excel-validation-report.md
 *  8.  Present summary and await user approval (unless --import flag provided)
 *  9.  [After approval] Create Jira Test issues via MCP
 *  10. Verify created Test issues
 *  11. Create Jira Test Execution and link tests
 *  12. Update README index
 *
 * Important: Jira write operations (phases 9-11) require explicit APPROVE confirmation.
 * Never hardcodes project keys, story IDs, or cloud IDs.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";

// ---------------------------------------------------------------------------
// Bootstrap — resolve project root
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Lazy-load xray-integration modules (avoids bundling issues)
// ---------------------------------------------------------------------------

async function loadXray() {
  const base = path.join(PROJECT_ROOT, "packages", "xray-integration", "src");
  const [
    { parseRequirementsDocuments },
    { buildTestScenarios, buildTestCases },
    { generateExcelWorkbook, saveWorkbook },
    { validateWorkbook },
    { buildTraceabilityMatrix },
    { createXrayTestIssue, createXrayTestExecution, linkTestToStory, detectDuplicateTests },
  ] = await Promise.all([
    import(pathToFileURL(path.join(base, "requirements-parser.js")).href),
    import(pathToFileURL(path.join(base, "test-case-builder.js")).href),
    import(pathToFileURL(path.join(base, "excel-generator.js")).href),
    import(pathToFileURL(path.join(base, "excel-validator.js")).href),
    import(pathToFileURL(path.join(base, "traceability.js")).href),
    import(pathToFileURL(path.join(base, "jira-xray-creator.js")).href),
  ]);
  return {
    parseRequirementsDocuments, buildTestScenarios, buildTestCases,
    generateExcelWorkbook, saveWorkbook, validateWorkbook, buildTraceabilityMatrix,
    createXrayTestIssue, createXrayTestExecution, linkTestToStory, detectDuplicateTests,
  };
}

async function loadJira() {
  const indexUrl = pathToFileURL(
    path.join(PROJECT_ROOT, "packages", "jira-integration", "src", "index.js")
  ).href;
  return import(indexUrl);
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { project: "", story: "", check: false, import: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--project" && argv[i + 1]) args.project = argv[++i].toUpperCase();
    else if (argv[i] === "--story"   && argv[i + 1]) args.story   = argv[++i].toUpperCase();
    else if (argv[i] === "--check")  args.check  = true;
    else if (argv[i] === "--import") args.import = true;
  }
  return args;
}

// ---------------------------------------------------------------------------
// Markdown document generators
// ---------------------------------------------------------------------------

function scenariosToMarkdown(req, scenarios) {
  const lines = [
    `# Test Scenarios: ${req.storyId}`,
    "",
    `**Project:** ${req.projectKey}  `,
    `**Story:** ${req.storyId}  `,
    `**Story Summary:** ${req.summary}  `,
    `**Generated At:** ${new Date().toISOString()}`,
    "",
    `Total Scenarios: **${scenarios.length}**  `,
    `Positive: **${scenarios.filter((s) => s.type === "positive").length}** | ` +
    `Negative: **${scenarios.filter((s) => s.type === "negative").length}** | ` +
    `Gap/Edge: **${scenarios.filter((s) => s.type === "edge" || s.type === "boundary").length}**`,
    "",
    "---",
    "",
    "| Scenario ID | Type | Title | Related AC | Priority |",
    "|---|---|---|---|---|",
  ];
  for (const s of scenarios) {
    const labels = Array.isArray(s.labels) ? s.labels.join(", ") : s.labels;
    lines.push(`| ${s.scenarioId} | ${s.type} | ${s.title} | ${s.relatedAc || "—"} | ${s.priority} |`);
  }
  lines.push("", "---", "", "## Scenario Details", "");
  for (const s of scenarios) {
    lines.push(`### ${s.scenarioId}`, "", `**Type:** ${s.type}  `, `**Priority:** ${s.priority}  `, `**Related AC:** ${s.relatedAc || "—"}  `, "", s.description, "");
  }
  return lines.join("\n");
}

function testCasesToMarkdown(req, testCases) {
  const lines = [
    `# Test Cases: ${req.storyId}`,
    "",
    `**Project:** ${req.projectKey}  `,
    `**Story:** ${req.storyId}  `,
    `**Generated At:** ${new Date().toISOString()}`,
    "",
    `Total Test Cases: **${testCases.length}**`,
    "",
    "---",
    "",
  ];
  for (const tc of testCases) {
    lines.push(
      `## ${tc.testCaseId}`,
      "",
      `**Title:** ${tc.title}  `,
      `**Type:** ${tc.type}  `,
      `**Priority:** ${tc.priority}  `,
      `**Related AC:** ${tc.relatedAc || "—"}  `,
      `**Related Story:** ${tc.relatedStory}  `,
      `**Automation Status:** ${tc.automationStatus}  `,
      `**Jira Test Key:** ${tc.jiraTestKey || "_(pending import)_"}`,
      "",
      `**Precondition:**  `,
      tc.precondition || "_(none)_",
      "",
      `**Test Data:**  `,
      tc.testData || "_(none)_",
      "",
      "**Steps:**",
      "",
      "| Step | Action | Expected Result | Test Data |",
      "|---|---|---|---|",
    );
    for (const step of tc.steps) {
      lines.push(`| ${step.step} | ${step.action} | ${step.expectedResult} | ${step.testData || "—"} |`);
    }
    lines.push("", `**Expected Outcome:**  `, tc.expectedOutcome, "", "---", "");
  }
  return lines.join("\n");
}

function traceabilityToMarkdown(req, matrix) {
  const lines = [
    `# Requirements Test Traceability Matrix: ${req.storyId}`,
    "",
    `**Project:** ${req.projectKey}  `,
    `**Story:** ${req.storyId}  `,
    `**Generated At:** ${new Date().toISOString()}`,
    "",
    `**Coverage:** ${matrix.summary.coveragePercent}% — ${matrix.summary.status}`,
    "",
    "---",
    "",
    "| Requirement ID | Title | Type | Covering Tests | Coverage Status | Risk | Notes |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const r of matrix.rows) {
    lines.push(
      `| ${r.requirementId} | ${r.requirementTitle.slice(0, 60)} | ${r.requirementType} | ${r.coveringTests.join(", ") || "—"} | ${r.coverageStatus} | ${r.riskLevel} | ${r.notes} |`
    );
  }
  lines.push(
    "", "---", "",
    "## Coverage Summary", "",
    `- **Total Requirements:** ${matrix.summary.totalRequirements}`,
    `- **Covered:** ${matrix.summary.covered}`,
    `- **Not Covered:** ${matrix.summary.notCovered}`,
    `- **Coverage:** ${matrix.summary.coveragePercent}%`,
    `- **Status:** ${matrix.summary.status}`,
  );
  return lines.join("\n");
}

function validationReportToMarkdown(req, report, excelPath) {
  const lines = [
    `# Excel Workbook Validation Report: ${req.storyId}`,
    "",
    `**Generated At:** ${new Date().toISOString()}`,
    `**Workbook:** \`${path.basename(excelPath)}\``,
    "",
    `## Result: ${report.passed ? "✅ PASSED" : "❌ FAILED"}`,
    "",
    `${report.summary}`,
    "",
  ];
  if (report.errors.length > 0) {
    lines.push("## Errors", "");
    for (const e of report.errors) lines.push(`- ❌ ${e}`);
    lines.push("");
  }
  if (report.warnings.length > 0) {
    lines.push("## Warnings", "");
    for (const w of report.warnings) lines.push(`- ⚠ ${w}`);
    lines.push("");
  }
  if (report.info.length > 0) {
    lines.push("## Info", "");
    for (const i of report.info) lines.push(`- ℹ ${i}`);
    lines.push("");
  }
  return lines.join("\n");
}

function creationReportToMarkdown(req, results, duration) {
  const lines = [
    `# Jira Test Creation Report: ${req.storyId}`,
    "",
    `**Generated At:** ${new Date().toISOString()}`,
    `**Story:** ${req.storyId}`,
    `**Duration:** ${duration}ms`,
    "",
    `**Tests Created:** ${results.created.length}  `,
    `**Tests Skipped (Duplicates):** ${results.skipped.length}  `,
    `**Tests Failed:** ${results.failed.length}`,
    "",
    "---",
    "",
    "## Created Test Issues",
    "",
    "| Local TC ID | Jira Test Key | Title |",
    "|---|---|---|",
  ];
  for (const r of results.created) {
    lines.push(`| ${r.testCaseId} | ${r.jiraKey} | ${r.title.slice(0, 60)} |`);
  }
  if (results.skipped.length > 0) {
    lines.push("", "## Skipped (Duplicate) Test Cases", "");
    for (const s of results.skipped) lines.push(`- ${s}`);
  }
  if (results.failed.length > 0) {
    lines.push("", "## Failed Creations", "");
    for (const f of results.failed) lines.push(`- ${f.testCaseId}: ${f.error}`);
  }
  return lines.join("\n");
}

function executionReportToMarkdown(req, executionKey, testKeys, storyKey) {
  return [
    `# Test Execution Report: ${req.storyId}`,
    "",
    `**Generated At:** ${new Date().toISOString()}`,
    `**Story:** ${storyKey}`,
    `**Test Execution Issue:** ${executionKey}`,
    "",
    `**Initial Execution Status:** TODO / Not Executed`,
    `**Tests Linked:** ${testKeys.length}`,
    "",
    "| Jira Test Key | Execution Status |",
    "|---|---|",
    ...testKeys.map((k) => `| ${k} | TODO |`),
    "",
    "> ⚠ All tests start in **TODO** state. No test has been marked Passed or Failed.",
    "> Test execution must be performed and results updated manually or via Xray automation.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Approval prompt
// ---------------------------------------------------------------------------

async function waitForApproval(storyId) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve, reject) => {
    rl.question(
      `\n⚠  Ready to import test cases to Jira.\nType APPROVE ${storyId} to proceed (or anything else to cancel): `,
      (answer) => {
        rl.close();
        if (answer.trim().toUpperCase() === `APPROVE ${storyId}`) {
          resolve(true);
        } else {
          resolve(false);
        }
      }
    );
    rl.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// README updater
// ---------------------------------------------------------------------------

async function updateReadme(projectRoot, storyId, testCases, executionKey) {
  const readmePath = path.join(projectRoot, "user-stories", "README.md");
  if (!existsSync(readmePath)) return;

  let content = await readFile(readmePath, "utf8");
  const marker = `## ${storyId}`;
  const xraySection = [
    "",
    "### Xray Test Cases",
    "",
    `- **Test Cases Generated:** ${testCases.length}`,
    `- **Test Execution Issue:** ${executionKey || "_(not yet created)_"}`,
    `- **Excel Workbook:** \`jira-xray-test-cases-${storyId}.xlsx\``,
    `- **Generated At:** ${new Date().toISOString()}`,
    "",
  ].join("\n");

  if (content.includes(marker)) {
    // Insert after the existing section heading
    const idx = content.indexOf(marker) + marker.length;
    content = content.slice(0, idx) + xraySection + content.slice(idx);
  } else {
    content += `\n${marker}\n${xraySection}`;
  }

  await writeFile(readmePath, content, "utf8");
}

// ---------------------------------------------------------------------------
// Main workflow
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║   Jira Xray Excel Test Case Generator Agent                  ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // Phase 1: Validate inputs
  console.log("📋 Phase 1: Validating inputs...");
  if (!args.project || !args.story) {
    console.error("❌ Usage: node scripts/jira-xray-test-case-generator.js --project <KEY> --story <STORY-ID>");
    console.error("   Example: node scripts/jira-xray-test-case-generator.js --project AAQA --story AAQA-1");
    process.exit(1);
  }

  const storyId = args.story;
  const projectKey = args.project;
  const storyDir = path.join(PROJECT_ROOT, "user-stories", storyId);

  if (!existsSync(storyDir)) {
    console.error(`❌ Story directory not found: ${storyDir}`);
    console.error(`   Please run the Requirements Analysis agent for ${storyId} first.`);
    process.exit(1);
  }

  console.log(`   ✅ Project Key: ${projectKey}`);
  console.log(`   ✅ Story ID: ${storyId}`);
  console.log(`   ✅ Story directory: ${storyDir}`);

  if (args.check) {
    console.log("\n✅ --check mode: inputs are valid. Run without --check to generate test cases.");
    return;
  }

  // Load modules
  const xray = await loadXray();

  // Phase 2: Parse requirements
  console.log("\n📖 Phase 2: Parsing requirements documents...");
  const req = await xray.parseRequirementsDocuments(PROJECT_ROOT, projectKey, storyId);
  console.log(`   ✅ Story summary: ${req.summary}`);
  console.log(`   ✅ Acceptance criteria: ${req.acceptanceCriteria.length}`);
  console.log(`   ✅ Missing functionalities: ${req.missingFunctionalities.length}`);
  console.log(`   ✅ Negative scenarios: ${req.negativeScenarios.length}`);

  // Phase 3: Generate test scenarios
  console.log("\n🎯 Phase 3: Generating test scenarios...");
  const scenarios = xray.buildTestScenarios(req);
  console.log(`   ✅ Generated ${scenarios.length} test scenarios`);

  const scenariosPath = path.join(storyDir, "test-scenarios.md");
  await writeFile(scenariosPath, scenariosToMarkdown(req, scenarios), "utf8");
  console.log(`   ✅ Saved: ${scenariosPath}`);

  // Phase 4: Generate test cases
  console.log("\n🧪 Phase 4: Generating detailed test cases...");
  const testCases = xray.buildTestCases(req, scenarios);
  console.log(`   ✅ Generated ${testCases.length} test cases`);
  console.log(`   ✅ Positive: ${testCases.filter((t) => t.type === "positive").length}`);
  console.log(`   ✅ Negative: ${testCases.filter((t) => t.type === "negative").length}`);
  console.log(`   ✅ Edge/Gap: ${testCases.filter((t) => t.type === "edge" || t.type === "boundary").length}`);

  const testCasesPath = path.join(storyDir, "test-cases.md");
  await writeFile(testCasesPath, testCasesToMarkdown(req, testCases), "utf8");
  console.log(`   ✅ Saved: ${testCasesPath}`);

  // Phase 5: Build RTM
  console.log("\n📊 Phase 5: Building Requirements Traceability Matrix...");
  const matrix = xray.buildTraceabilityMatrix(req, testCases);
  console.log(`   ✅ ${matrix.summary.totalRequirements} requirements mapped`);
  console.log(`   ✅ Coverage: ${matrix.summary.coveragePercent}% — ${matrix.summary.status}`);

  const traceabilityPath = path.join(storyDir, "requirements-test-traceability.md");
  await writeFile(traceabilityPath, traceabilityToMarkdown(req, matrix), "utf8");
  console.log(`   ✅ Saved: ${traceabilityPath}`);

  // Phase 6: Generate Excel
  console.log("\n📗 Phase 6: Generating Excel workbook...");
  const workbook = await xray.generateExcelWorkbook(req, scenarios, testCases, matrix);
  const excelFilename = `jira-xray-test-cases-${storyId}.xlsx`;
  const excelPath = path.join(storyDir, excelFilename);
  await xray.saveWorkbook(workbook, excelPath);
  console.log(`   ✅ Saved: ${excelPath}`);
  console.log(`   ✅ Sheets: Test Scenarios, Test Cases, Test Steps, Traceability Matrix, Summary`);

  // Phase 7: Validate Excel
  console.log("\n🔍 Phase 7: Validating Excel workbook...");
  const validationReport = xray.validateWorkbook(workbook);
  console.log(`   ${validationReport.summary}`);
  if (validationReport.errors.length > 0) {
    for (const e of validationReport.errors) console.error(`   ❌ ${e}`);
  }
  if (validationReport.warnings.length > 0) {
    for (const w of validationReport.warnings) console.warn(`   ⚠ ${w}`);
  }

  const validationReportPath = path.join(storyDir, "excel-validation-report.md");
  await writeFile(validationReportPath, validationReportToMarkdown(req, validationReport, excelPath), "utf8");
  console.log(`   ✅ Saved: ${validationReportPath}`);

  if (!validationReport.passed) {
    console.error("\n❌ Excel validation failed. Fix errors before importing to Jira.");
    process.exit(1);
  }

  // Phase 8: Present summary and await approval
  console.log("\n" + "═".repeat(66));
  console.log("📋 GENERATION SUMMARY");
  console.log("═".repeat(66));
  console.log(`  Story:            ${storyId}`);
  console.log(`  Project:          ${projectKey}`);
  console.log(`  Test Scenarios:   ${scenarios.length}`);
  console.log(`  Test Cases:       ${testCases.length}`);
  console.log(`  Total Steps:      ${testCases.reduce((s, tc) => s + (tc.steps?.length || 0), 0)}`);
  console.log(`  Coverage:         ${matrix.summary.coveragePercent}%`);
  console.log(`  Excel Workbook:   ${excelFilename}`);
  console.log("═".repeat(66));
  console.log("\nGenerated files:");
  console.log(`  📄 ${path.relative(PROJECT_ROOT, scenariosPath)}`);
  console.log(`  📄 ${path.relative(PROJECT_ROOT, testCasesPath)}`);
  console.log(`  📄 ${path.relative(PROJECT_ROOT, traceabilityPath)}`);
  console.log(`  📗 ${path.relative(PROJECT_ROOT, excelPath)}`);
  console.log(`  📄 ${path.relative(PROJECT_ROOT, validationReportPath)}`);

  if (!args.import) {
    console.log("\n💡 To import test cases to Jira, run:");
    console.log(`   node scripts/jira-xray-test-case-generator.js --project ${projectKey} --story ${storyId} --import`);
    console.log("\n✅ Local generation complete. No Jira write operations performed.");
    return;
  }

  // Phase 8 (import mode): Wait for explicit approval
  const approved = await waitForApproval(storyId);
  if (!approved) {
    console.log("\n❌ Import cancelled. No Jira write operations performed.");
    return;
  }

  // Phase 9: Create Jira Test issues
  console.log("\n🚀 Phase 9: Creating Jira Xray Test issues...");
  const jiraModule = await loadJira();
  const { client, serverName } = await jiraModule.connectToJiraMcp({ projectRoot: PROJECT_ROOT });
  console.log(`   ✅ Connected to Jira MCP server: ${serverName}`);

  const { cloudId, siteUrl } = await jiraModule.getJiraCloudId(client);
  console.log(`   ✅ Cloud ID: ${cloudId}`);
  console.log(`   ✅ Site: ${siteUrl}`);

  // Duplicate detection
  const { duplicates, safeToCreate } = await xray.detectDuplicateTests(
    client, cloudId, storyId, testCases, jiraModule.callJiraTool
  );
  if (duplicates.length > 0) {
    console.log(`   ⚠ Skipping ${duplicates.length} possible duplicate(s): ${duplicates.join(", ")}`);
  }

  const startMs = Date.now();
  const results = { created: [], skipped: duplicates, failed: [] };
  const createdJiraKeys = [];

  for (const tc of testCases) {
    if (duplicates.includes(tc.testCaseId)) continue;
    try {
      const { key } = await xray.createXrayTestIssue(client, cloudId, projectKey, tc, jiraModule.callJiraTool);
      tc.jiraTestKey = key;
      createdJiraKeys.push(key);
      results.created.push({ testCaseId: tc.testCaseId, jiraKey: key, title: tc.title });
      console.log(`   ✅ Created: ${key} ← ${tc.testCaseId} "${tc.title.slice(0, 50)}"`);

      // Link to story
      await xray.linkTestToStory(client, cloudId, key, storyId, jiraModule.callJiraTool);
      console.log(`      🔗 Linked ${key} → tests → ${storyId}`);
    } catch (err) {
      results.failed.push({ testCaseId: tc.testCaseId, error: err.message });
      console.error(`   ❌ Failed to create ${tc.testCaseId}: ${err.message}`);
    }
  }

  // Phase 10: Verify
  console.log("\n🔎 Phase 10: Verifying created Test issues...");
  for (const { key } of results.created) {
    try {
      const issue = await jiraModule.callJiraTool(client, "getJiraIssue", {
        cloudId,
        issueIdOrKey: key,
        view: "compact",
        responseContentFormat: "markdown",
      });
      console.log(`   ✅ Verified: ${key} exists in Jira`);
    } catch {
      console.warn(`   ⚠ Could not verify ${key}`);
    }
  }

  // Phase 11: Create Test Execution
  console.log("\n📋 Phase 11: Creating Jira Test Execution...");
  let executionKey = "";
  if (createdJiraKeys.length > 0) {
    try {
      const exec = await xray.createXrayTestExecution(
        client, cloudId, projectKey, storyId, createdJiraKeys, jiraModule.callJiraTool
      );
      executionKey = exec.key;
      console.log(`   ✅ Test Execution created: ${executionKey}`);
    } catch (err) {
      console.error(`   ❌ Could not create Test Execution: ${err.message}`);
    }
  } else {
    console.log("   ⚠ No tests were created — skipping Test Execution.");
  }

  await client.close();

  const duration = Date.now() - startMs;

  // Save reports
  const creationReportPath = path.join(storyDir, "jira-test-creation-report.md");
  await writeFile(creationReportPath, creationReportToMarkdown(req, results, duration), "utf8");
  console.log(`   ✅ Saved: ${creationReportPath}`);

  if (executionKey) {
    const executionReportPath = path.join(storyDir, "test-execution-report.md");
    await writeFile(executionReportPath, executionReportToMarkdown(req, executionKey, createdJiraKeys, storyId), "utf8");
    console.log(`   ✅ Saved: ${executionReportPath}`);
  }

  // Update test cases markdown with Jira keys
  await writeFile(testCasesPath, testCasesToMarkdown(req, testCases), "utf8");

  // Phase 12: Update README
  console.log("\n📝 Phase 12: Updating README index...");
  await updateReadme(PROJECT_ROOT, storyId, testCases, executionKey);
  console.log("   ✅ README.md updated");

  console.log("\n" + "═".repeat(66));
  console.log("✅ JIRA XRAY IMPORT COMPLETE");
  console.log("═".repeat(66));
  console.log(`  Tests Created:    ${results.created.length}`);
  console.log(`  Tests Skipped:    ${results.skipped.length}`);
  console.log(`  Tests Failed:     ${results.failed.length}`);
  if (executionKey) {
    console.log(`  Test Execution:   ${executionKey}`);
  }
  console.log("═".repeat(66) + "\n");
}

main().catch((err) => {
  console.error("\n❌ Fatal error:", err.message);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
