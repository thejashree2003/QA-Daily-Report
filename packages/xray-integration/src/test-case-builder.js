/**
 * @fileoverview test-case-builder.js
 *
 * Transforms a ParsedRequirements object into structured test scenarios and
 * detailed test cases.
 *
 * Design decisions:
 *  - IDs are deterministic: TC-{storyId}-{n:03d}
 *  - Priority is derived from AC category and coverage type
 *  - Steps use numbered action/expected pairs suitable for Xray
 *  - No hardcoded project keys or story IDs
 *  - No live Jira calls
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pad a number to a fixed width with leading zeros.
 * @param {number} n
 * @param {number} width
 * @returns {string}
 */
function pad(n, width = 3) {
  return String(n).padStart(width, "0");
}

/**
 * Derive test priority from scenario type.
 * @param {"positive"|"negative"|"boundary"|"edge"} type
 * @returns {"Critical"|"High"|"Medium"|"Low"}
 */
function derivePriority(type) {
  switch (type) {
    case "positive": return "High";
    case "negative": return "Medium";
    case "boundary": return "Medium";
    case "edge":     return "Low";
    default:         return "Medium";
  }
}

/**
 * Build a simple step array from given/when/then arrays.
 * @param {string[]} given
 * @param {string[]} when
 * @param {string[]} then
 * @returns {Array<{step:number, action:string, expectedResult:string, testData:string}>}
 */
function buildGwtSteps(given, when, then) {
  const steps = [];
  let stepNum = 1;

  for (const g of given) {
    steps.push({ step: stepNum++, action: `Precondition: ${g}`, expectedResult: "State established", testData: "" });
  }
  for (const w of when) {
    steps.push({ step: stepNum++, action: w, expectedResult: "", testData: "" });
  }
  for (let i = 0; i < then.length; i++) {
    if (steps[steps.length - 1 - (then.length - 1 - i)]?.expectedResult === "") {
      steps[steps.length - (then.length - i)].expectedResult = then[i];
    } else {
      steps.push({ step: stepNum++, action: "Verify", expectedResult: then[i], testData: "" });
    }
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Scenario builders
// ---------------------------------------------------------------------------

/**
 * Build test scenarios from parsed requirements.
 * Returns an array of scenario objects.
 *
 * @param {import("./requirements-parser.js").ParsedRequirements} req
 * @returns {TestScenario[]}
 */
export function buildTestScenarios(req) {
  const scenarios = [];

  // --- Positive scenarios from each acceptance criterion ---
  for (const ac of req.acceptanceCriteria) {
    scenarios.push({
      scenarioId: `TS-${req.storyId}-${ac.id}-POS`,
      type: "positive",
      title: `[Positive] ${ac.id}: ${ac.title}`,
      description: `Verify the happy-path behaviour described in ${ac.id}.`,
      relatedAc: ac.id,
      priority: "High",
      labels: ["positive", "acceptance-criteria", req.storyId],
    });
  }

  // --- Negative / boundary scenarios ---
  if (req.negativeScenarios.length > 0) {
    for (let i = 0; i < req.negativeScenarios.length; i++) {
      scenarios.push({
        scenarioId: `TS-${req.storyId}-NEG-${pad(i + 1)}`,
        type: "negative",
        title: `[Negative] ${req.negativeScenarios[i].slice(0, 80)}`,
        description: req.negativeScenarios[i],
        relatedAc: "",
        priority: "Medium",
        labels: ["negative", "boundary", req.storyId],
      });
    }
  }

  // --- Gap-driven scenarios ---
  if (req.missingFunctionalities.length > 0) {
    for (let i = 0; i < req.missingFunctionalities.length; i++) {
      scenarios.push({
        scenarioId: `TS-${req.storyId}-GAP-${pad(i + 1)}`,
        type: "edge",
        title: `[Gap] ${req.missingFunctionalities[i].slice(0, 80)}`,
        description: `Gap scenario: ${req.missingFunctionalities[i]}`,
        relatedAc: "",
        priority: "Low",
        labels: ["gap", "needs-clarification", req.storyId],
      });
    }
  }

  // --- Minimum: if no ACs and no negatives, add a placeholder ---
  if (scenarios.length === 0) {
    scenarios.push({
      scenarioId: `TS-${req.storyId}-001`,
      type: "positive",
      title: `[Positive] Verify core story behaviour`,
      description: `Verify the basic behaviour described in ${req.storyId}.`,
      relatedAc: "",
      priority: "High",
      labels: ["positive", req.storyId],
    });
  }

  return scenarios;
}

/**
 * Build detailed test cases from parsed requirements and scenarios.
 *
 * @param {import("./requirements-parser.js").ParsedRequirements} req
 * @param {TestScenario[]} scenarios
 * @returns {TestCase[]}
 */
export function buildTestCases(req, scenarios) {
  const testCases = [];
  let tcNum = 1;

  for (const scenario of scenarios) {
    // Find matching AC for GWT steps
    const ac = req.acceptanceCriteria.find((a) => a.id === scenario.relatedAc);

    // Build steps
    let steps;
    if (ac && (ac.given.length > 0 || ac.when.length > 0 || ac.then.length > 0)) {
      steps = buildGwtSteps(ac.given, ac.when, ac.then);
    } else {
      // Generic steps derived from description
      steps = [
        { step: 1, action: `Set up preconditions for: ${scenario.title}`, expectedResult: "Preconditions are met", testData: "" },
        { step: 2, action: `Execute the action described in scenario: ${scenario.scenarioId}`, expectedResult: "System responds as described in the requirement", testData: "" },
        { step: 3, action: "Verify the system state matches the expected result", expectedResult: scenario.description, testData: "" },
      ];
    }

    // Add a cleanup step for certain negative/edge scenarios
    if (scenario.type === "negative" || scenario.type === "edge") {
      steps.push({ step: steps.length + 1, action: "Verify error/edge state is handled gracefully and system recovers", expectedResult: "No data corruption; system is stable", testData: "" });
    }

    testCases.push({
      testCaseId: `TC-${req.storyId}-${pad(tcNum)}`,
      scenarioId: scenario.scenarioId,
      title: scenario.title,
      description: scenario.description,
      type: scenario.type,
      priority: derivePriority(scenario.type),
      relatedAc: scenario.relatedAc,
      relatedStory: req.storyId,
      labels: scenario.labels.join(", "),
      precondition: ac?.given.join("; ") || `${req.storyId} requirements are understood`,
      steps,
      testData: req.applicationUrl ? `Application URL: ${req.applicationUrl}` : "",
      expectedOutcome: ac?.then.join("; ") || scenario.description,
      automationStatus: "Manual",
      jiraTestKey: "", // Populated after Jira creation
    });
    tcNum++;
  }

  return testCases;
}

/**
 * @typedef {Object} TestScenario
 * @property {string} scenarioId
 * @property {"positive"|"negative"|"boundary"|"edge"} type
 * @property {string} title
 * @property {string} description
 * @property {string} relatedAc
 * @property {string} priority
 * @property {string[]} labels
 */

/**
 * @typedef {Object} TestCase
 * @property {string} testCaseId
 * @property {string} scenarioId
 * @property {string} title
 * @property {string} description
 * @property {string} type
 * @property {string} priority
 * @property {string} relatedAc
 * @property {string} relatedStory
 * @property {string} labels
 * @property {string} precondition
 * @property {Array<{step:number, action:string, expectedResult:string, testData:string}>} steps
 * @property {string} testData
 * @property {string} expectedOutcome
 * @property {string} automationStatus
 * @property {string} jiraTestKey
 */
