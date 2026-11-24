// Daily QA report for Jira project AAQA. READ-ONLY: only GET/search queries to Jira and read-only GraphQL queries to Xray.
//
// Env (from the process environment or a local .env file; values are never printed):
//   JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN
//   XRAY_CLIENT_ID, XRAY_CLIENT_SECRET
//   SMTP_USER, SMTP_PASS, REPORT_TO (comma-separated)   optional: SMTP_HOST, SMTP_PORT (default: Gmail)
//
// Usage: node scripts/daily-qa-report.mjs [--no-email]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = "AAQA";
const XRAY = "https://xray.cloud.getxray.app/api/v2";

// ---------- env ----------
function loadDotEnv() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
}
loadDotEnv();

function need(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) throw new Error(`Missing environment variable(s): ${missing.join(", ")}`);
}
need(["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "XRAY_CLIENT_ID", "XRAY_CLIENT_SECRET"]);

const JIRA = process.env.JIRA_BASE_URL.replace(/\/+$/, "");
const JIRA_AUTH = "Basic " + Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64");

// ---------- Jira (read-only search) ----------
async function jiraSearch(jql, fields) {
  const issues = [];
  let nextPageToken;
  do {
    const r = await fetch(`${JIRA}/rest/api/3/search/jql`, {
      method: "POST",
      headers: { Authorization: JIRA_AUTH, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ jql, fields, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) }),
    });
    if (!r.ok) throw new Error(`Jira search failed (HTTP ${r.status})`);
    const j = await r.json();
    issues.push(...(j.issues || []));
    nextPageToken = j.isLast ? undefined : j.nextPageToken;
  } while (nextPageToken);
  return issues;
}

function simplify(issue) {
  const f = issue.fields || {};
  const stories = [];
  for (const l of f.issuelinks || []) {
    const other = l.inwardIssue || l.outwardIssue;
    if (other?.fields?.issuetype?.name === "Story") stories.push(other.key);
  }
  return {
    key: issue.key,
    summary: f.summary || "",
    type: f.issuetype?.name || "",
    status: f.status?.name || "",
    category: f.status?.statusCategory?.key || "new", // new | indeterminate | done
    priority: f.priority?.name || "-",
    stories: [...new Set(stories)],
  };
}

// ---------- Xray (read-only GraphQL) ----------
async function xrayToken() {
  const r = await fetch(`${XRAY}/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: process.env.XRAY_CLIENT_ID, client_secret: process.env.XRAY_CLIENT_SECRET }),
  });
  if (!r.ok) throw new Error(`Xray authentication failed (HTTP ${r.status})`);
  return r.json();
}

async function xrayExecutionCounts() {
  const token = await xrayToken();
  const gql = async (query, variables) => {
    const r = await fetch(`${XRAY}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }),
    });
    const j = await r.json();
    if (j.errors) throw new Error(`Xray GraphQL error: ${JSON.stringify(j.errors).slice(0, 300)}`);
    return j.data;
  };
  const counts = {}; // key -> { PASSED, FAILED, other, total }
  const jql = `project = ${PROJECT} AND issuetype = "Test Execution"`;
  const q = `query($jql:String,$start:Int){getTestExecutions(jql:$jql,limit:100,start:$start){total results{issueId jira(fields:["key"]) testRuns(limit:100){total results{status{name}}}}}}`;
  for (let start = 0; ; ) {
    const d = (await gql(q, { jql, start })).getTestExecutions;
    for (const ex of d.results) {
      const key = ex.jira.key;
      const c = { PASSED: 0, FAILED: 0, other: 0, total: ex.testRuns.total };
      let runs = ex.testRuns.results;
      // More than 100 runs on one execution: page through the remaining runs (read-only query).
      for (let s = 100; ex.testRuns.total > s; s += 100) {
        const more = await gql(
          `query($e:[String],$s:Int){getTestRuns(testExecIssueIds:$e,limit:100,start:$s){results{status{name}}}}`,
          { e: [ex.issueId], s }
        );
        runs = runs.concat(more.getTestRuns.results);
      }
      for (const r of runs) {
        const n = (r.status?.name || "").toUpperCase();
        if (n === "PASSED") c.PASSED++;
        else if (n === "FAILED") c.FAILED++;
        else c.other++;
      }
      counts[key] = c;
    }
    start += d.results.length;
    if (!d.results.length || start >= d.total) break;
  }
  return counts;
}

// ---------- report ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const issueLink = (key) => `<a href="${esc(JIRA)}/browse/${esc(key)}">${esc(key)}</a>`;

function dateIST() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function buildHtml(date, data) {
  const { kpi, executions, bugs, repo } = data;
  const badge = (text, cls) => `<span class="b ${cls}">${esc(text)}</span>`;
  const statusCls = (cat) => (cat === "done" ? "ok" : cat === "indeterminate" ? "warn" : "idle");
  const prioCls = (p) => (/highest|high/i.test(p) ? "bad" : /medium/i.test(p) ? "warn" : "idle");
  const tile = (label, value, cls = "") => `<div class="tile ${cls}"><div class="v">${esc(value)}</div><div class="l">${esc(label)}</div></div>`;

  const execRows = executions.length
    ? executions.map((e) => `<tr><td>${issueLink(e.key)}</td><td>${esc(e.summary)}</td><td>${esc(e.stories.join(", ") || "-")}</td><td>${badge(e.status, statusCls(e.category))}</td><td class="n">${e.total}</td><td class="n ok-t">${e.PASSED}</td><td class="n bad-t">${e.FAILED}</td><td class="n">${e.other}</td><td class="n">${e.rate}%</td></tr>`).join("")
    : `<tr><td colspan="9" class="empty">No Test Executions found.</td></tr>`;
  const bugRows = bugs.length
    ? bugs.map((b) => `<tr><td>${issueLink(b.key)}</td><td>${esc(b.summary)}</td><td>${esc(b.stories.join(", ") || "-")}</td><td>${badge(b.priority, prioCls(b.priority))}</td><td>${badge(b.status, statusCls(b.category))}</td></tr>`).join("")
    : `<tr><td colspan="5" class="empty">No defects found.</td></tr>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AAQA Daily QA Report ${esc(date)}</title>
<style>
body{margin:0;background:#f4f6f8;font-family:Segoe UI,Arial,sans-serif;color:#1f2937}
.wrap{max-width:980px;margin:0 auto;padding:24px 16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 10px;color:#111827}
.sub{color:#6b7280;font-size:13px;margin-bottom:18px}
.tiles{display:flex;flex-wrap:wrap;gap:10px}
.tile{flex:1 1 130px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:14px;text-align:center}
.tile .v{font-size:26px;font-weight:700}.tile .l{font-size:12px;color:#6b7280;margin-top:2px}
.tile.ok .v{color:#15803d}.tile.bad .v{color:#b91c1c}.tile.warn .v{color:#b45309}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:8px;font-size:13px}
th{background:#f3f4f6;text-align:left;padding:8px 10px;border-bottom:1px solid #e5e7eb}
td{padding:8px 10px;border-bottom:1px solid #f0f1f3;vertical-align:top}
td.n,th.n{text-align:right}.ok-t{color:#15803d;font-weight:600}.bad-t{color:#b91c1c;font-weight:600}
td.empty{text-align:center;color:#6b7280;padding:16px}
.b{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px}
.b.ok{background:#dcfce7;color:#166534}.b.warn{background:#fef3c7;color:#92400e}.b.bad{background:#fee2e2;color:#991b1b}.b.idle{background:#e5e7eb;color:#374151}
a{color:#2563eb;text-decoration:none}.foot{margin-top:24px;font-size:12px;color:#9ca3af}
</style></head><body><div class="wrap">
<h1>AAQA Daily QA Report</h1>
<div class="sub">${esc(date)} (IST) · Project AAQA · <a href="${esc(JIRA)}">${esc(JIRA)}</a> · Read-only snapshot from Jira and Xray</div>

<h2>1. Executive KPI Summary</h2>
<div class="tiles">
${tile("Total Tests", kpi.totalTests)}${tile("Executed Runs", kpi.executed)}${tile("Passed", kpi.passed, "ok")}${tile("Failed", kpi.failed, kpi.failed ? "bad" : "")}
${tile("Pass Rate", kpi.rate + "%", kpi.rate >= 90 ? "ok" : kpi.rate >= 70 ? "warn" : "bad")}${tile("Total Defects", kpi.totalDefects)}${tile("Open Defects", kpi.openDefects, kpi.openDefects ? "bad" : "ok")}
</div>

<h2>2. Test Execution Breakdown</h2>
<table><thead><tr><th>Execution</th><th>Summary</th><th>Story</th><th>Status</th><th class="n">Runs</th><th class="n">Passed</th><th class="n">Failed</th><th class="n">Other</th><th class="n">Pass %</th></tr></thead><tbody>${execRows}</tbody></table>

<h2>3. Defect Report</h2>
<table><thead><tr><th>Bug</th><th>Summary</th><th>Story</th><th>Priority</th><th>Status</th></tr></thead><tbody>${bugRows}</tbody></table>

<h2>4. Test Repository Status</h2>
<div class="tiles">${tile("Done", repo.done, "ok")}${tile("In Progress", repo.inProgress, "warn")}${tile("To Do", repo.todo)}</div>

<div class="foot">Generated automatically. “Other” runs are TO DO / EXECUTING / ABORTED. Pass rate = Passed ÷ (Passed + Failed).</div>
</div></body></html>`;
}

// ---------- main ----------
const date = dateIST();
const [rawIssues, xray] = await Promise.all([
  jiraSearch(
    `project = ${PROJECT} AND issuetype in (Test, "Test Execution", Bug) ORDER BY key ASC`,
    ["summary", "status", "priority", "issuetype", "issuelinks"]
  ),
  xrayExecutionCounts(),
]);
const issues = rawIssues.map(simplify);
const tests = issues.filter((i) => i.type === "Test");
const bugs = issues.filter((i) => i.type === "Bug");
const executions = issues
  .filter((i) => i.type === "Test Execution")
  .map((e) => {
    const c = xray[e.key] || { PASSED: 0, FAILED: 0, other: 0, total: 0 };
    return { ...e, ...c, rate: pct(c.PASSED, c.PASSED + c.FAILED) };
  });

const passed = executions.reduce((s, e) => s + e.PASSED, 0);
const failed = executions.reduce((s, e) => s + e.FAILED, 0);
const kpi = {
  totalTests: tests.length,
  executed: passed + failed,
  passed,
  failed,
  rate: pct(passed, passed + failed),
  totalDefects: bugs.length,
  openDefects: bugs.filter((b) => b.category !== "done").length,
};
const repo = {
  done: tests.filter((t) => t.category === "done").length,
  inProgress: tests.filter((t) => t.category === "indeterminate").length,
  todo: tests.filter((t) => t.category === "new").length,
};

const html = buildHtml(date, { kpi, executions, bugs, repo });
const outDir = path.join(ROOT, "reports");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `daily-qa-report-${date}.html`);
fs.writeFileSync(outFile, html, "utf8");
console.log(`Report saved: reports/daily-qa-report-${date}.html`);
console.log(`Tests ${kpi.totalTests} | Runs ${kpi.executed} | Passed ${kpi.passed} | Failed ${kpi.failed} | Pass rate ${kpi.rate}% | Defects ${kpi.totalDefects} (open ${kpi.openDefects})`);

// ---------- email ----------
if (process.argv.includes("--no-email")) {
  console.log("Email skipped (--no-email).");
} else {
  need(["SMTP_USER", "SMTP_PASS", "REPORT_TO"]);
  const transport = nodemailer.createTransport(
    process.env.SMTP_HOST
      ? { host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: Number(process.env.SMTP_PORT) === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
      : { service: "gmail", auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
  );
  const subject = `[AAQA] Daily QA Report (${date}) — ${kpi.passed}/${kpi.executed} Passed | ${kpi.openDefects} Defects`;
  await transport.sendMail({
    from: process.env.SMTP_USER,
    to: process.env.REPORT_TO.split(",").map((s) => s.trim()).filter(Boolean),
    subject,
    html,
    attachments: [{ filename: path.basename(outFile), path: outFile }],
  });
  console.log(`Email sent: ${subject}`);
}
