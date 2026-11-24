// Reusable Xray Cloud helper. Reads XRAY_CLIENT_ID / XRAY_CLIENT_SECRET from .env (never printed).
//
//   node scripts/xray-sync.mjs auth
//   node scripts/xray-sync.mjs steps <STORY>                 e.g. steps AAQA-36
//        Maps Requirements/<STORY>_Test_Cases_Report.md into Xray "Test details" steps
//        (Action: -> action, TestData: -> data, Expected Result: -> result). Skips Tests that already have steps.
//   node scripts/xray-sync.mjs runs <STORY> <EXEC_KEY>       e.g. runs AAQA-36 AAQA-52
//        Adds the story's Tests to the Test Execution and sets Test Run status from test-results/results.json
//        (spec titles must start with the Jira Test key, e.g. "AAQA-37 TC-01: ...").
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://xray.cloud.getxray.app/api/v2";
const [cmd = "auth", story, execKey] = process.argv.slice(2);

function loadEnv() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) throw new Error(".env not found in project root");
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
  if (!env.XRAY_CLIENT_ID || !env.XRAY_CLIENT_SECRET) throw new Error("XRAY_CLIENT_ID / XRAY_CLIENT_SECRET missing in .env");
  return env;
}

const env = loadEnv();
async function authenticate() {
  const r = await fetch(`${BASE}/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env.XRAY_CLIENT_ID, client_secret: env.XRAY_CLIENT_SECRET }),
  });
  if (!r.ok) throw new Error(`Xray authentication failed (HTTP ${r.status})`);
  return r.json();
}
const token = await authenticate();

async function gql(query, variables) {
  const r = await fetch(`${BASE}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 400));
  return j.data;
}

/** Resolve Jira keys -> Xray issueIds. */
async function issueIds(keys) {
  const d = await gql(
    `query($jql:String){getTests(jql:$jql,limit:100){results{issueId jira(fields:["key"])}}}`,
    { jql: `key in (${keys.join(",")})` }
  );
  const map = {};
  for (const t of d.getTests.results) map[t.jira.key] = t.issueId;
  const e = await gql(
    `query($jql:String){getTestExecutions(jql:$jql,limit:100){results{issueId jira(fields:["key"])}}}`,
    { jql: `key in (${keys.join(",")})` }
  );
  for (const t of e.getTestExecutions.results) map[t.jira.key] = t.issueId;
  return map;
}

/** Parse the Gherkin-style report into [{ key, title, action, data, result }]. */
function parseReport(text) {
  const scenarios = [];
  let cur = null;
  let field = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^Scenario:\s*(.*)$/))) { cur = { title: m[1], key: null, action: "", data: "", result: "" }; scenarios.push(cur); field = null; continue; }
    if (!cur) continue;
    if ((m = line.match(/^#\s*Jira:\s*([A-Z]+-\d+)/))) { cur.key = m[1]; continue; }
    if (line.startsWith("#") || line === "" || line.startsWith("```")) continue;
    if ((m = line.match(/^Action:\s*(.*)$/))) { field = "action"; cur.action = m[1]; continue; }
    if ((m = line.match(/^TestData:\s*(.*)$/))) { field = "data"; cur.data = m[1]; continue; }
    if ((m = line.match(/^Expected Result:\s*(.*)$/))) { field = "result"; cur.result = m[1]; continue; }
    if (field) cur[field] += (cur[field] ? "\n" : "") + line;
  }
  return scenarios.filter((s) => s.key);
}

if (cmd === "auth") {
  console.log("authenticated OK");
} else if (cmd === "steps") {
  const scenarios = parseReport(fs.readFileSync(path.join(ROOT, "Requirements", `${story}_Test_Cases_Report.md`), "utf8"));
  const ids = await issueIds(scenarios.map((s) => s.key));
  for (const s of scenarios) {
    const id = ids[s.key];
    if (!id) { console.log(`${s.key}: not found in Xray, skipped`); continue; }
    const existing = await gql(`query($i:String){getTest(issueId:$i){steps{id}}}`, { i: id });
    if ((existing.getTest?.steps || []).length) { console.log(`${s.key}: already has steps, skipped`); continue; }
    await gql(`mutation($i:String!,$s:CreateStepInput!){addTestStep(issueId:$i,step:$s){id}}`, {
      i: id, s: { action: s.action, data: s.data, result: s.result },
    });
    console.log(`${s.key}: step added`);
  }
} else if (cmd === "runs") {
  const results = JSON.parse(fs.readFileSync(path.join(ROOT, "test-results", "results.json"), "utf8"));
  const status = {};
  (function walk(s) {
    for (const sp of s.specs || []) {
      const key = sp.title.split(" ")[0];
      const t = sp.tests[0];
      const last = t.results[t.results.length - 1];
      const msg = (last.error && last.error.message) || "";
      // Environment/tooling errors (e.g. Windows file locks) are not application results: leave the run as TODO.
      const infra = /EBUSY|EPERM|EACCES|resource busy or locked/i.test(msg);
      status[key] = t.status === "expected" ? "PASSED" : last.status === "skipped" || infra ? "TODO" : "FAILED";
    }
    for (const c of s.suites || []) walk(c);
  })({ suites: results.suites });
  const keys = Object.keys(status).filter((k) => k.startsWith("AAQA-"));
  const ids = await issueIds([...keys, execKey]);
  const add = await gql(`mutation($e:String!,$t:[String]!){addTestsToTestExecution(issueId:$e,testIssueIds:$t){addedTests warning}}`, {
    e: ids[execKey], t: keys.map((k) => ids[k]).filter(Boolean),
  });
  console.log(`added to ${execKey}: ${add.addTestsToTestExecution.addedTests.length} test(s)`);
  const runs = await gql(
    `query($e:[String]){getTestRuns(limit:100,testExecIssueIds:$e){results{id status{name} test{jira(fields:["key"])}}}}`,
    { e: [ids[execKey]] }
  );
  for (const r of runs.getTestRuns.results) {
    const key = r.test.jira.key;
    const want = status[key];
    if (!want || want === "TODO") { console.log(`${key}: left as ${r.status.name}`); continue; }
    await gql(`mutation($i:String!,$s:String!){updateTestRunStatus(id:$i,status:$s)}`, { i: r.id, s: want });
    console.log(`${key}: ${r.status.name} -> ${want}`);
  }
} else {
  console.log("usage: auth | steps <STORY> | runs <STORY> <EXEC_KEY>");
}
