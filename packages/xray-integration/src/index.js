/**
 * @fileoverview Jira Xray Integration Library — public API barrel.
 *
 * Re-exports every public function from the sub-modules so callers can
 * import everything from "@agentic-ai/xray-integration" without deep paths.
 */

export { parseRequirementsDocuments } from "./requirements-parser.js";
export { buildTestScenarios, buildTestCases } from "./test-case-builder.js";
export { generateExcelWorkbook, saveWorkbook } from "./excel-generator.js";
export { validateWorkbook } from "./excel-validator.js";
export { buildTraceabilityMatrix } from "./traceability.js";
export {
  createXrayTestIssue,
  createXrayTestExecution,
  linkTestToStory,
  detectDuplicateTests,
} from "./jira-xray-creator.js";
