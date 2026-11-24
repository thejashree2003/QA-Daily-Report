/**
 * Unit tests: excel-generator.js and excel-validator.js
 * Run with: node --test packages/xray-integration/test/excel-generator.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateExcelWorkbook } from "../src/excel-generator.js";
import { validateWorkbook } from "../src/excel-validator.js";
import { buildTestScenarios, buildTestCases } from "../src/test-case-builder.js";
import { buildTraceabilityMatrix } from "../src/traceability.js";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const SAMPLE_REQ = {
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
      when: ["I enter valid credentials and click Login"],
      then: ["I am redirected to the dashboard"],
      raw: "GIVEN I am on the login page WHEN I enter valid credentials THEN dashboard",
    },
    {
      id: "AC2",
      title: "Cart Review",
      given: ["I have items in my cart"],
      when: ["I navigate to /cart"],
      then: ["I see item details", "I see Continue Shopping button"],
      raw: "GIVEN items in cart WHEN navigate to cart THEN see details",
    },
  ],
  functionalities: ["Login form"],
  missingFunctionalities: ["Error handling"],
  ambiguities: ["Session timeout unclear"],
  businessRules: [],
  negativeScenarios: ["Login with empty fields"],
  dependencies: [],
  clarifications: [],
  recommendations: [],
  gherkinBlock: "",
  _userStoryText: "",
  _analysisText: "",
};

// ---------------------------------------------------------------------------
// Tests: generateExcelWorkbook
// ---------------------------------------------------------------------------

describe("generateExcelWorkbook", () => {
  it("creates a workbook with 5 sheets", async () => {
    const scenarios = buildTestScenarios(SAMPLE_REQ);
    const testCases = buildTestCases(SAMPLE_REQ, scenarios);
    const matrix = buildTraceabilityMatrix(SAMPLE_REQ, testCases);
    const wb = await generateExcelWorkbook(SAMPLE_REQ, scenarios, testCases, matrix);

    assert.equal(wb.worksheets.length, 5, "Should have exactly 5 worksheets");
  });

  it("includes all required sheet names", async () => {
    const scenarios = buildTestScenarios(SAMPLE_REQ);
    const testCases = buildTestCases(SAMPLE_REQ, scenarios);
    const matrix = buildTraceabilityMatrix(SAMPLE_REQ, testCases);
    const wb = await generateExcelWorkbook(SAMPLE_REQ, scenarios, testCases, matrix);

    const sheetNames = wb.worksheets.map((ws) => ws.name);
    for (const name of ["Test Scenarios", "Test Cases", "Test Steps", "Traceability Matrix", "Summary"]) {
      assert.ok(sheetNames.includes(name), `Sheet "${name}" should exist`);
    }
  });

  it("Test Scenarios sheet has data rows", async () => {
    const scenarios = buildTestScenarios(SAMPLE_REQ);
    const testCases = buildTestCases(SAMPLE_REQ, scenarios);
    const matrix = buildTraceabilityMatrix(SAMPLE_REQ, testCases);
    const wb = await generateExcelWorkbook(SAMPLE_REQ, scenarios, testCases, matrix);

    const sheet = wb.getWorksheet("Test Scenarios");
    const rows = [];
    sheet.eachRow((row, num) => { if (num > 1) rows.push(row); });
    assert.ok(rows.length >= 1, "Test Scenarios sheet should have data rows");
  });

  it("Test Cases sheet has correct column count", async () => {
    const scenarios = buildTestScenarios(SAMPLE_REQ);
    const testCases = buildTestCases(SAMPLE_REQ, scenarios);
    const matrix = buildTraceabilityMatrix(SAMPLE_REQ, testCases);
    const wb = await generateExcelWorkbook(SAMPLE_REQ, scenarios, testCases, matrix);

    const sheet = wb.getWorksheet("Test Cases");
    const headerRow = sheet.getRow(1);
    let colCount = 0;
    headerRow.eachCell(() => colCount++);
    assert.ok(colCount >= 10, "Test Cases sheet should have at least 10 columns");
  });

  it("Test Steps sheet has flat step rows", async () => {
    const scenarios = buildTestScenarios(SAMPLE_REQ);
    const testCases = buildTestCases(SAMPLE_REQ, scenarios);
    const matrix = buildTraceabilityMatrix(SAMPLE_REQ, testCases);
    const wb = await generateExcelWorkbook(SAMPLE_REQ, scenarios, testCases, matrix);

    const sheet = wb.getWorksheet("Test Steps");
    const rows = [];
    sheet.eachRow((row, num) => { if (num > 1) rows.push(row); });
    const totalSteps = testCases.reduce((sum, tc) => sum + (tc.steps?.length || 0), 0);
    assert.equal(rows.length, totalSteps, "Test Steps sheet row count should match total steps");
  });

  it("Summary sheet contains story ID and project key", async () => {
    const scenarios = buildTestScenarios(SAMPLE_REQ);
    const testCases = buildTestCases(SAMPLE_REQ, scenarios);
    const matrix = buildTraceabilityMatrix(SAMPLE_REQ, testCases);
    const wb = await generateExcelWorkbook(SAMPLE_REQ, scenarios, testCases, matrix);

    const sheet = wb.getWorksheet("Summary");
    let found = false;
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (String(cell.value).includes("TEST-1")) found = true;
      });
    });
    assert.ok(found, "Summary sheet should contain the story ID");
  });

  it("workbook does not contain credentials", async () => {
    const scenarios = buildTestScenarios(SAMPLE_REQ);
    const testCases = buildTestCases(SAMPLE_REQ, scenarios);
    const matrix = buildTraceabilityMatrix(SAMPLE_REQ, testCases);
    const wb = await generateExcelWorkbook(SAMPLE_REQ, scenarios, testCases, matrix);

    let credFound = false;
    const credPattern = /password\s*[:=]\s*\S+|api[_-]?key\s*[:=]/i;
    for (const sheet of wb.worksheets) {
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (credPattern.test(String(cell.value ?? ""))) credFound = true;
        });
      });
    }
    assert.ok(!credFound, "Workbook must not contain credential-like patterns");
  });
});

// ---------------------------------------------------------------------------
// Tests: validateWorkbook
// ---------------------------------------------------------------------------

describe("validateWorkbook", () => {
  it("passes validation for a correctly generated workbook", async () => {
    const scenarios = buildTestScenarios(SAMPLE_REQ);
    const testCases = buildTestCases(SAMPLE_REQ, scenarios);
    const matrix = buildTraceabilityMatrix(SAMPLE_REQ, testCases);
    const wb = await generateExcelWorkbook(SAMPLE_REQ, scenarios, testCases, matrix);

    const report = validateWorkbook(wb);
    assert.ok(report.passed, `Validation should pass. Errors: ${report.errors.join("; ")}`);
  });

  it("reports error for missing sheet", async () => {
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Test Scenarios"); // only one of the required sheets

    const report = validateWorkbook(wb);
    assert.ok(!report.passed, "Validation should fail for missing sheets");
    assert.ok(report.errors.some((e) => e.includes("Missing required sheet")));
  });

  it("reports error for empty data sheet", async () => {
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    // Add all required sheets but leave them empty
    for (const name of ["Test Scenarios", "Test Cases", "Test Steps", "Traceability Matrix", "Summary"]) {
      const sheet = wb.addWorksheet(name);
      // Add header row only
      sheet.addRow(["ID", "Title", "Type", "Priority", "Related Story"]);
    }

    const report = validateWorkbook(wb);
    assert.ok(!report.passed, "Should fail — no data rows");
    assert.ok(report.errors.some((e) => /no data rows/i.test(e)));
  });

  it("detects duplicate test case IDs", async () => {
    const scenarios = buildTestScenarios(SAMPLE_REQ);
    const testCases = buildTestCases(SAMPLE_REQ, scenarios);
    const matrix = buildTraceabilityMatrix(SAMPLE_REQ, testCases);
    const wb = await generateExcelWorkbook(SAMPLE_REQ, scenarios, testCases, matrix);

    // Inject a duplicate row
    const sheet = wb.getWorksheet("Test Cases");
    const firstDataRow = sheet.getRow(2);
    const id = firstDataRow.getCell(1).value;
    const dupRow = sheet.addRow([id, "dup-scenario", "Duplicate Title", "positive", "High", "", "TEST-1", "", "", "", "Manual", "", ""]);
    dupRow.commit();

    const report = validateWorkbook(wb);
    assert.ok(report.errors.some((e) => /Duplicate Test Case ID/i.test(e)));
  });

  it("returns structured report with errors, warnings, info arrays", async () => {
    const scenarios = buildTestScenarios(SAMPLE_REQ);
    const testCases = buildTestCases(SAMPLE_REQ, scenarios);
    const matrix = buildTraceabilityMatrix(SAMPLE_REQ, testCases);
    const wb = await generateExcelWorkbook(SAMPLE_REQ, scenarios, testCases, matrix);
    const report = validateWorkbook(wb);

    assert.ok(Array.isArray(report.errors));
    assert.ok(Array.isArray(report.warnings));
    assert.ok(Array.isArray(report.info));
    assert.ok(typeof report.summary === "string");
    assert.ok(typeof report.passed === "boolean");
  });
});
