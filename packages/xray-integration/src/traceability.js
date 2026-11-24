/**
 * @fileoverview traceability.js
 *
 * Builds a Requirements Traceability Matrix (RTM) from parsed requirements
 * and test cases. Maps each acceptance criterion to covering test cases.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a Requirements Traceability Matrix.
 *
 * @param {import("./requirements-parser.js").ParsedRequirements} req
 * @param {import("./test-case-builder.js").TestCase[]} testCases
 * @returns {TraceabilityMatrix}
 */
export function buildTraceabilityMatrix(req, testCases) {
  const rows = [];

  // --- AC-level rows ---
  for (const ac of req.acceptanceCriteria) {
    const coveringTests = testCases.filter(
      (tc) => tc.relatedAc === ac.id || tc.scenarioId.includes(ac.id)
    );
    rows.push({
      requirementId: ac.id,
      requirementTitle: ac.title,
      requirementType: "Acceptance Criterion",
      coveringTests: coveringTests.map((tc) => tc.testCaseId),
      coveringJiraKeys: coveringTests.map((tc) => tc.jiraTestKey).filter(Boolean),
      coverageStatus: coveringTests.length > 0 ? "Covered" : "Not Covered",
      riskLevel: coveringTests.length === 0 ? "High" : "Low",
      notes: coveringTests.length === 0 ? "No test case maps to this AC — add test coverage" : "",
    });
  }

  // --- Gap-level rows (missing functionalities) ---
  for (let i = 0; i < req.missingFunctionalities.length; i++) {
    const gapId = `GAP-${String(i + 1).padStart(2, "0")}`;
    const coveringTests = testCases.filter((tc) => tc.scenarioId.includes("GAP"));
    rows.push({
      requirementId: gapId,
      requirementTitle: req.missingFunctionalities[i].slice(0, 100),
      requirementType: "Gap / Missing Functionality",
      coveringTests: coveringTests.map((tc) => tc.testCaseId),
      coveringJiraKeys: [],
      coverageStatus: "Gap — Pending Clarification",
      riskLevel: "High",
      notes: "Missing functionality identified during requirements analysis",
    });
  }

  // --- Coverage summary ---
  const covered = rows.filter((r) => r.coverageStatus === "Covered").length;
  const total = rows.length;
  const coveragePercent = total > 0 ? Math.round((covered / total) * 100) : 0;

  return {
    storyId: req.storyId,
    projectKey: req.projectKey,
    rows,
    summary: {
      totalRequirements: total,
      covered,
      notCovered: total - covered,
      coveragePercent,
      status: coveragePercent === 100 ? "Full Coverage" : coveragePercent >= 70 ? "Partial Coverage" : "Low Coverage",
    },
  };
}

/**
 * @typedef {Object} TraceabilityRow
 * @property {string} requirementId
 * @property {string} requirementTitle
 * @property {string} requirementType
 * @property {string[]} coveringTests
 * @property {string[]} coveringJiraKeys
 * @property {string} coverageStatus
 * @property {string} riskLevel
 * @property {string} notes
 */

/**
 * @typedef {Object} TraceabilityMatrix
 * @property {string} storyId
 * @property {string} projectKey
 * @property {TraceabilityRow[]} rows
 * @property {{ totalRequirements:number, covered:number, notCovered:number, coveragePercent:number, status:string }} summary
 */
