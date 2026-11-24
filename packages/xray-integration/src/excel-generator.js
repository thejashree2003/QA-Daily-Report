/**
 * @fileoverview excel-generator.js
 *
 * Generates a multi-sheet Excel workbook (.xlsx) using exceljs.
 * The workbook contains 5 worksheets:
 *
 *  Sheet 1: Test Scenarios     — high-level scenario catalogue
 *  Sheet 2: Test Cases         — full detailed test cases with steps
 *  Sheet 3: Test Steps         — flat step table (Xray-compatible import format)
 *  Sheet 4: Traceability       — RTM mapping requirements to test cases
 *  Sheet 5: Summary            — coverage and generation metadata
 *
 * Design decisions:
 *  - Column widths auto-fit to a sensible maximum
 *  - Header rows are frozen and styled
 *  - No credentials or sensitive data are written
 *  - Story ID in filename is passed as a parameter — never hardcoded
 */

import path from "node:path";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const HEADER_FILL = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F3864" }, // dark navy
};
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
const HEADER_ALIGNMENT = { horizontal: "center", vertical: "middle", wrapText: true };

const ALT_ROW_FILL = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF2F7FF" }, // very light blue
};

const POSITIVE_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD6F5D6" } }; // light green
const NEGATIVE_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFD6D6" } }; // light red
const BOUNDARY_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3CD" } }; // light amber
const GAP_FILL      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8D5F5" } }; // light purple

function typeFill(type) {
  if (type === "positive") return POSITIVE_FILL;
  if (type === "negative") return NEGATIVE_FILL;
  if (type === "boundary") return BOUNDARY_FILL;
  return GAP_FILL;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyHeaderRow(sheet, headers) {
  const row = sheet.getRow(1);
  row.height = 30;
  headers.forEach((header, i) => {
    const cell = row.getCell(i + 1);
    cell.value = header.label;
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = HEADER_ALIGNMENT;
    cell.border = { bottom: { style: "medium", color: { argb: "FF1F3864" } } };
  });
  row.commit();
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  headers.forEach((header, i) => {
    sheet.getColumn(i + 1).width = header.width || 20;
  });
}

function styleDataRow(row, fill) {
  row.eachCell((cell) => {
    cell.fill = fill;
    cell.alignment = { vertical: "top", wrapText: true };
  });
  row.commit();
}

// ---------------------------------------------------------------------------
// Sheet builders
// ---------------------------------------------------------------------------

/**
 * Sheet 1 — Test Scenarios
 */
function buildScenariosSheet(wb, scenarios, storyId) {
  const sheet = wb.addWorksheet("Test Scenarios");
  const headers = [
    { label: "Scenario ID",   width: 28 },
    { label: "Type",          width: 14 },
    { label: "Title",         width: 55 },
    { label: "Description",   width: 60 },
    { label: "Related AC",    width: 14 },
    { label: "Priority",      width: 14 },
    { label: "Labels",        width: 36 },
  ];
  applyHeaderRow(sheet, headers);

  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i];
    const row = sheet.addRow([
      s.scenarioId,
      s.type,
      s.title,
      s.description,
      s.relatedAc,
      s.priority,
      Array.isArray(s.labels) ? s.labels.join(", ") : s.labels,
    ]);
    styleDataRow(row, i % 2 === 0 ? ALT_ROW_FILL : { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } });
    // Type-based colour for type column
    row.getCell(2).fill = typeFill(s.type);
  }

  return sheet;
}

/**
 * Sheet 2 — Test Cases
 */
function buildTestCasesSheet(wb, testCases) {
  const sheet = wb.addWorksheet("Test Cases");
  const headers = [
    { label: "Test Case ID",      width: 22 },
    { label: "Scenario ID",       width: 30 },
    { label: "Title",             width: 60 },
    { label: "Type",              width: 14 },
    { label: "Priority",          width: 14 },
    { label: "Related AC",        width: 14 },
    { label: "Related Story",     width: 16 },
    { label: "Precondition",      width: 50 },
    { label: "Test Data",         width: 36 },
    { label: "Expected Outcome",  width: 60 },
    { label: "Automation Status", width: 20 },
    { label: "Jira Test Key",     width: 18 },
    { label: "Labels",            width: 36 },
  ];
  applyHeaderRow(sheet, headers);

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const row = sheet.addRow([
      tc.testCaseId,
      tc.scenarioId,
      tc.title,
      tc.type,
      tc.priority,
      tc.relatedAc,
      tc.relatedStory,
      tc.precondition,
      tc.testData,
      tc.expectedOutcome,
      tc.automationStatus,
      tc.jiraTestKey,
      tc.labels,
    ]);
    styleDataRow(row, i % 2 === 0 ? ALT_ROW_FILL : { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } });
    row.getCell(4).fill = typeFill(tc.type);
  }

  return sheet;
}

/**
 * Sheet 3 — Test Steps (flat, Xray-compatible)
 */
function buildTestStepsSheet(wb, testCases) {
  const sheet = wb.addWorksheet("Test Steps");
  const headers = [
    { label: "Test Case ID",     width: 22 },
    { label: "Step #",           width: 10 },
    { label: "Action",           width: 70 },
    { label: "Expected Result",  width: 70 },
    { label: "Test Data",        width: 36 },
  ];
  applyHeaderRow(sheet, headers);

  let rowIdx = 0;
  for (const tc of testCases) {
    for (const step of tc.steps || []) {
      const row = sheet.addRow([
        tc.testCaseId,
        step.step,
        step.action,
        step.expectedResult,
        step.testData,
      ]);
      styleDataRow(row, rowIdx % 2 === 0 ? ALT_ROW_FILL : { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } });
      rowIdx++;
    }
  }

  return sheet;
}

/**
 * Sheet 4 — Traceability Matrix
 */
function buildTraceabilitySheet(wb, matrix) {
  const sheet = wb.addWorksheet("Traceability Matrix");
  const headers = [
    { label: "Requirement ID",     width: 20 },
    { label: "Requirement Title",  width: 55 },
    { label: "Type",               width: 28 },
    { label: "Covering Tests",     width: 36 },
    { label: "Jira Test Keys",     width: 30 },
    { label: "Coverage Status",    width: 28 },
    { label: "Risk Level",         width: 14 },
    { label: "Notes",              width: 50 },
  ];
  applyHeaderRow(sheet, headers);

  const { rows } = matrix;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const row = sheet.addRow([
      r.requirementId,
      r.requirementTitle,
      r.requirementType,
      r.coveringTests.join(", "),
      r.coveringJiraKeys.join(", "),
      r.coverageStatus,
      r.riskLevel,
      r.notes,
    ]);
    styleDataRow(row, i % 2 === 0 ? ALT_ROW_FILL : { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } });
    // Colour coverage status cell
    const statusCell = row.getCell(6);
    if (r.coverageStatus === "Covered") {
      statusCell.fill = POSITIVE_FILL;
    } else if (r.coverageStatus.startsWith("Gap")) {
      statusCell.fill = GAP_FILL;
    } else {
      statusCell.fill = NEGATIVE_FILL;
    }
    // Colour risk cell
    const riskCell = row.getCell(7);
    riskCell.fill = r.riskLevel === "High" ? NEGATIVE_FILL : POSITIVE_FILL;
  }

  // Summary row
  const summaryRow = sheet.addRow([
    "SUMMARY", "", "",
    `Total: ${matrix.summary.totalRequirements}`,
    "",
    `${matrix.summary.coveragePercent}% Coverage — ${matrix.summary.status}`,
    "", "",
  ]);
  summaryRow.font = { bold: true };
  summaryRow.commit();

  return sheet;
}

/**
 * Sheet 5 — Summary
 */
function buildSummarySheet(wb, req, scenarios, testCases, matrix) {
  const sheet = wb.addWorksheet("Summary");
  sheet.getColumn(1).width = 36;
  sheet.getColumn(2).width = 60;

  const generatedAt = new Date().toISOString();

  const rows = [
    ["Field", "Value"],
    ["Jira Project Key", req.projectKey],
    ["Jira User Story ID", req.storyId],
    ["Story Summary", req.summary],
    ["Jira URL", req.jiraUrl || "(see user-story.md)"],
    ["Application Under Test", req.applicationUrl || "(not specified)"],
    ["Acceptance Criteria Count", req.acceptanceCriteria.length],
    ["Total Test Scenarios", scenarios.length],
    ["Total Test Cases", testCases.length],
    ["Positive Test Cases", testCases.filter((t) => t.type === "positive").length],
    ["Negative Test Cases", testCases.filter((t) => t.type === "negative").length],
    ["Boundary / Edge Cases", testCases.filter((t) => t.type === "boundary" || t.type === "edge").length],
    ["Total Test Steps", testCases.reduce((sum, tc) => sum + (tc.steps?.length || 0), 0)],
    ["Coverage Percentage", `${matrix.summary.coveragePercent}%`],
    ["Coverage Status", matrix.summary.status],
    ["Missing Functionalities", req.missingFunctionalities.length],
    ["Identified Gaps", matrix.rows.filter((r) => r.requirementType === "Gap / Missing Functionality").length],
    ["Generated At", generatedAt],
    ["Generated By", "Jira Xray Excel Test Case Generator Agent"],
    ["Xray Test Issue Type", "Test (ID: 10010)"],
    ["Xray Link Type", "Test (ID: 10006) — outward: 'tests'"],
    ["Import Status", "Pending — requires APPROVE command"],
  ];

  for (let i = 0; i < rows.length; i++) {
    const row = sheet.addRow(rows[i]);
    if (i === 0) {
      row.font = HEADER_FONT;
      row.getCell(1).fill = HEADER_FILL;
      row.getCell(2).fill = HEADER_FILL;
      row.getCell(1).alignment = HEADER_ALIGNMENT;
      row.getCell(2).alignment = HEADER_ALIGNMENT;
    } else {
      row.getCell(1).font = { bold: true };
      row.fill = i % 2 === 0 ? ALT_ROW_FILL : { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
    }
    row.commit();
  }

  // Important disclaimer
  sheet.addRow([]);
  const disclaimer = sheet.addRow(["⚠ IMPORTANT", "This workbook is a planning and import-preparation artifact. No credentials or secrets are included. Import to Jira requires explicit user approval."]);
  disclaimer.font = { bold: true, color: { argb: "FFCC0000" } };
  disclaimer.commit();

  return sheet;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a complete Excel workbook with 5 worksheets.
 *
 * @param {import("./requirements-parser.js").ParsedRequirements} req
 * @param {import("./test-case-builder.js").TestScenario[]} scenarios
 * @param {import("./test-case-builder.js").TestCase[]} testCases
 * @param {import("./traceability.js").TraceabilityMatrix} matrix
 * @returns {Promise<import("exceljs").Workbook>}
 */
export async function generateExcelWorkbook(req, scenarios, testCases, matrix) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();

  wb.creator = "Jira Xray Excel Test Case Generator Agent";
  wb.lastModifiedBy = "Antigravity AI";
  wb.created = new Date();
  wb.modified = new Date();
  wb.properties.date1904 = false;

  buildScenariosSheet(wb, scenarios, req.storyId);
  buildTestCasesSheet(wb, testCases);
  buildTestStepsSheet(wb, testCases);
  buildTraceabilitySheet(wb, matrix);
  buildSummarySheet(wb, req, scenarios, testCases, matrix);

  return wb;
}

/**
 * Save a workbook to disk.
 *
 * @param {import("exceljs").Workbook} workbook
 * @param {string} outputPath  Absolute path for the .xlsx file
 * @returns {Promise<string>}  Resolved output path
 */
export async function saveWorkbook(workbook, outputPath) {
  const dir = path.dirname(outputPath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await workbook.xlsx.writeFile(outputPath);
  return outputPath;
}
