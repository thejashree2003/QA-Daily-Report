/**
 * @fileoverview excel-validator.js
 *
 * Validates an exceljs Workbook before presenting it to the user or importing
 * to Jira. Returns a structured ValidationReport — never throws.
 *
 * Rules checked:
 *  1. Required sheets are present (Test Scenarios, Test Cases, Test Steps, Traceability Matrix, Summary)
 *  2. Each sheet has at least one data row (beyond the header)
 *  3. Test Case IDs are unique across the Test Cases sheet
 *  4. Required columns have no empty cells in data rows
 *  5. No credential-like patterns appear in cell values (security check)
 *  6. Steps reference known test case IDs
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REQUIRED_SHEETS = [
  "Test Scenarios",
  "Test Cases",
  "Test Steps",
  "Traceability Matrix",
  "Summary",
];

/** Columns that must be non-empty in every data row of each sheet. */
const REQUIRED_COLUMNS = {
  "Test Scenarios": ["Scenario ID", "Type", "Title", "Priority"],
  "Test Cases":     ["Test Case ID", "Title", "Type", "Priority", "Related Story"],
  "Test Steps":     ["Test Case ID", "Step #", "Action"],
};

/** Regex patterns that indicate leaked credentials. */
const CREDENTIAL_PATTERNS = [
  /\bpassword\s*[:=]\s*\S+/i,
  /\bapi[_-]?key\s*[:=]\s*\S+/i,
  /\baccess[_-]?token\s*[:=]\s*\S+/i,
  /\bauthorization\s*:\s*bearer\s+\S+/i,
  /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /glpat-[A-Za-z0-9_-]{20,}/,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getColumnIndex(sheet, headerName) {
  const headerRow = sheet.getRow(1);
  let found = -1;
  headerRow.eachCell((cell, colNum) => {
    if (String(cell.value).trim() === headerName) found = colNum;
  });
  return found;
}

function getCellValue(row, colNum) {
  return colNum > 0 ? String(row.getCell(colNum).value ?? "").trim() : "";
}

function containsCredential(value) {
  return CREDENTIAL_PATTERNS.some((p) => p.test(value));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a workbook and return a structured report.
 *
 * @param {import("exceljs").Workbook} workbook
 * @returns {ValidationReport}
 */
export function validateWorkbook(workbook) {
  const errors = [];
  const warnings = [];
  const info = [];

  // 1. Required sheets
  const sheetNames = workbook.worksheets.map((ws) => ws.name);
  for (const name of REQUIRED_SHEETS) {
    if (!sheetNames.includes(name)) {
      errors.push(`Missing required sheet: "${name}"`);
    } else {
      info.push(`Sheet found: "${name}"`);
    }
  }

  for (const sheetName of REQUIRED_SHEETS) {
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) continue;

    const dataRows = [];
    sheet.eachRow((row, rowNum) => {
      if (rowNum > 1) dataRows.push({ row, rowNum });
    });

    // 2. At least one data row
    if (dataRows.length === 0) {
      errors.push(`Sheet "${sheetName}" has no data rows.`);
      continue;
    }
    info.push(`Sheet "${sheetName}": ${dataRows.length} data row(s)`);

    // 3. Required columns not empty
    const requiredCols = REQUIRED_COLUMNS[sheetName] || [];
    for (const colName of requiredCols) {
      const colIdx = getColumnIndex(sheet, colName);
      if (colIdx < 0) {
        errors.push(`Sheet "${sheetName}" is missing required column: "${colName}"`);
        continue;
      }
      for (const { row, rowNum } of dataRows) {
        const val = getCellValue(row, colIdx);
        if (!val) {
          warnings.push(`Sheet "${sheetName}" row ${rowNum}: required column "${colName}" is empty`);
        }
      }
    }

    // 5. No credentials in any cell
    sheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      row.eachCell((cell) => {
        const val = String(cell.value ?? "");
        if (containsCredential(val)) {
          errors.push(`Sheet "${sheetName}" row ${rowNum}: potential credential detected — remove before import`);
        }
      });
    });
  }

  // 3. Unique Test Case IDs
  const tcSheet = workbook.getWorksheet("Test Cases");
  if (tcSheet) {
    const tcIdCol = getColumnIndex(tcSheet, "Test Case ID");
    if (tcIdCol > 0) {
      const ids = [];
      tcSheet.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const id = getCellValue(row, tcIdCol);
        if (id) ids.push(id);
      });
      const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
      for (const dup of [...new Set(duplicates)]) {
        errors.push(`Duplicate Test Case ID detected: "${dup}"`);
      }
    }
  }

  // 6. Steps reference known test case IDs
  const stepsSheet = workbook.getWorksheet("Test Steps");
  const tcSheetForRef = workbook.getWorksheet("Test Cases");
  if (stepsSheet && tcSheetForRef) {
    const tcIdColInSteps = getColumnIndex(stepsSheet, "Test Case ID");
    const tcIdColInCases = getColumnIndex(tcSheetForRef, "Test Case ID");
    if (tcIdColInSteps > 0 && tcIdColInCases > 0) {
      const knownIds = new Set();
      tcSheetForRef.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const id = getCellValue(row, tcIdColInCases);
        if (id) knownIds.add(id);
      });
      stepsSheet.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const id = getCellValue(row, tcIdColInSteps);
        if (id && !knownIds.has(id)) {
          warnings.push(`Test Steps row ${rowNum}: references unknown Test Case ID "${id}"`);
        }
      });
    }
  }

  const passed = errors.length === 0;

  return {
    passed,
    errors,
    warnings,
    info,
    summary: passed
      ? `✅ Workbook passed validation (${warnings.length} warning(s))`
      : `❌ Workbook failed validation: ${errors.length} error(s), ${warnings.length} warning(s)`,
  };
}

/**
 * @typedef {Object} ValidationReport
 * @property {boolean} passed
 * @property {string[]} errors
 * @property {string[]} warnings
 * @property {string[]} info
 * @property {string} summary
 */
