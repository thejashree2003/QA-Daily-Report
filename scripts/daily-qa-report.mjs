// Daily QA report for ONE Jira story. READ-ONLY: only search/GET calls to Jira and read-only GraphQL queries to Xray.
//
// Target story: STORY_KEY (env / .env / --story=AAQA-36). Default: AAQA-36.
// Env (process environment or local .env; values are never printed or written to generated files):
//   JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, XRAY_CLIENT_ID, XRAY_CLIENT_SECRET
//   SMTP_USER, SMTP_PASS, REPORT_TO (comma-separated)   optional: SMTP_HOST, SMTP_PORT (default: Gmail)
//   PAGES_BASE_URL (e.g. https://<owner>.github.io/<repo>)  used for the links in the manager email
//
// Output: reports/test-execution-ui-<STORY>.html, reports/defect-report-ui-<STORY>.html, reports/index.html,
//         reports/history-<STORY>.json (run snapshots for trends)
// Usage:  node scripts/daily-qa-report.mjs [--story=AAQA-36] [--no-email]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
const need = (names) => {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) throw new Error(`Missing environment variable(s): ${missing.join(", ")}`);
};
need(["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "XRAY_CLIENT_ID", "XRAY_CLIENT_SECRET"]);

const argStory = process.argv.find((a) => a.startsWith("--story="))?.split("=")[1];
const STORY = (argStory || process.env.STORY_KEY || "AAQA-36").trim().toUpperCase();
if (!/^[A-Z][A-Z0-9]+-\d+$/.test(STORY)) throw new Error("STORY_KEY must look like AAQA-36");
const PROJECT = STORY.split("-")[0];

const JIRA = process.env.JIRA_BASE_URL.replace(/\/+$/, "");
const PAGES = (process.env.PAGES_BASE_URL || "").replace(/\/+$/, "");
const JIRA_AUTH = "Basic " + Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64");

// ---------- Jira (read-only) ----------
async function jiraGet(pathAndQuery) {
  const r = await fetch(`${JIRA}${pathAndQuery}`, { headers: { Authorization: JIRA_AUTH, Accept: "application/json" } });
  if (!r.ok) throw new Error(`Jira GET failed (HTTP ${r.status}) ${pathAndQuery.split("?")[0]}`);
  return r.json();
}
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
const FIELDS = ["summary", "status", "priority", "issuetype", "issuelinks", "created", "parent", "subtasks"];

function simplify(issue) {
  const f = issue.fields || {};
  const links = [];
  for (const l of f.issuelinks || []) {
    const other = l.inwardIssue || l.outwardIssue;
    if (!other) continue;
    links.push({ key: other.key, type: other.fields?.issuetype?.name || "", linkType: l.type?.name || "" });
  }
  return {
    key: issue.key,
    summary: f.summary || "",
    type: f.issuetype?.name || "",
    status: f.status?.name || "",
    category: f.status?.statusCategory?.key || "new", // new | indeterminate | done
    priority: f.priority?.name || "-",
    created: (f.created || "").slice(0, 10),
    links,
  };
}

function adfText(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text") return node.text || "";
  return (node.content || []).map(adfText).join(node.type === "paragraph" ? "\n" : " ");
}
async function failureNote(key) {
  try {
    const j = await jiraGet(`/rest/api/3/issue/${encodeURIComponent(key)}/comment?orderBy=-created&maxResults=10`);
    for (const c of j.comments || []) {
      const t = adfText(c.body).replace(/\s+/g, " ").trim();
      if (/automated result/i.test(t)) return t.length > 320 ? t.slice(0, 317) + "..." : t;
    }
  } catch {
    /* notes are optional */
  }
  return "";
}

// ---------- Xray (read-only GraphQL) ----------
async function xrayRuns(execKeys) {
  const r = await fetch(`${XRAY}/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: process.env.XRAY_CLIENT_ID, client_secret: process.env.XRAY_CLIENT_SECRET }),
  });
  if (!r.ok) throw new Error(`Xray authentication failed (HTTP ${r.status})`);
  const token = await r.json();
  const gql = async (query, variables) => {
    const res = await fetch(`${XRAY}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }),
    });
    const j = await res.json();
    if (j.errors) throw new Error(`Xray GraphQL error: ${JSON.stringify(j.errors).slice(0, 300)}`);
    return j.data;
  };
  const out = {}; // execKey -> [{ test, status, comment }]
  if (!execKeys.length) return out;
  const q = `query($jql:String){getTestExecutions(jql:$jql,limit:100){results{issueId jira(fields:["key"]) testRuns(limit:100){total results{status{name} comment test{jira(fields:["key"])}}}}}}`;
  const d = (await gql(q, { jql: `key in (${execKeys.join(",")})` })).getTestExecutions;
  for (const ex of d.results) {
    let runs = ex.testRuns.results;
    for (let s = 100; ex.testRuns.total > s; s += 100) {
      const more = await gql(
        `query($e:[String],$s:Int){getTestRuns(testExecIssueIds:$e,limit:100,start:$s){results{status{name} comment test{jira(fields:["key"])}}}}`,
        { e: [ex.issueId], s }
      );
      runs = runs.concat(more.getTestRuns.results);
    }
    out[ex.jira.key] = runs.map((r) => ({ test: r.test.jira.key, status: (r.status?.name || "").toUpperCase(), comment: r.comment || "" }));
  }
  return out;
}
const runLabel = (s) => (s === "PASSED" ? "Passed" : s === "FAILED" ? "Failed" : s === "EXECUTING" ? "In Progress" : s === "TO DO" || s === "TODO" ? "To Do" : s ? "Other" : "Not run");

// ---------- helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const jiraLink = (key) => `<a href="${esc(JIRA)}/browse/${esc(key)}">${esc(key)}</a>`;
const dateIST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const date = dateIST();
const statusCls = (cat) => (cat === "done" ? "ok" : cat === "indeterminate" ? "warn" : "idle");
const runCls = (l) => (l === "Passed" ? "ok" : l === "Failed" ? "bad" : l === "In Progress" ? "warn" : "idle");
const prioCls = (p) => (/highest|high/i.test(p) ? "bad" : /medium/i.test(p) ? "warn" : "idle");
const badge = (t, c) => `<span class="b ${c}">${esc(t)}</span>`;
const tile = (label, value, cls = "") => `<div class="tile ${cls}"><div class="v">${esc(value)}</div><div class="l">${esc(label)}</div></div>`;

// ---------- collect data ----------
const [storyArr, linked, allBugs] = await Promise.all([
  jiraSearch(`key = ${STORY}`, FIELDS),
  jiraSearch(`issue in linkedIssues(${STORY}) OR parent = ${STORY} ORDER BY key ASC`, FIELDS),
  jiraSearch(`project = ${PROJECT} AND issuetype = Bug ORDER BY key ASC`, FIELDS),
]);
if (!storyArr.length) throw new Error(`${STORY} not found in Jira`);
const story = simplify(storyArr[0]);
const items = linked.map(simplify);
const tests = items.filter((i) => i.type === "Test");
const execs = items.filter((i) => i.type === "Test Execution");
const testKeys = new Set(tests.map((t) => t.key));

// Bugs: linked to the story itself, or to any of its tests (also picks up linked Bugs found via the story).
const bugMap = new Map();
for (const b of [...allBugs.map(simplify), ...items.filter((i) => i.type === "Bug")]) {
  if (b.links.some((l) => l.key === STORY || testKeys.has(l.key)) || items.some((i) => i.key === b.key)) bugMap.set(b.key, b);
}
const bugs = [...bugMap.values()];

const runsByExec = await xrayRuns(execs.map((e) => e.key));
const latest = {}; // test key -> run
const execRows = execs.map((e) => {
  const runs = runsByExec[e.key] || [];
  const c = { passed: 0, failed: 0, inProgress: 0, todo: 0, other: 0 };
  for (const r of runs) {
    latest[r.test] = r;
    const l = runLabel(r.status);
    if (l === "Passed") c.passed++;
    else if (l === "Failed") c.failed++;
    else if (l === "In Progress") c.inProgress++;
    else if (l === "To Do") c.todo++;
    else c.other++;
  }
  return { ...e, runs: runs.length, ...c, rate: pct(c.passed, c.passed + c.failed) };
});

const sum = (k) => execRows.reduce((s, e) => s + e[k], 0);
const kpi = {
  totalTests: tests.length,
  runs: sum("runs"),
  executed: sum("passed") + sum("failed"),
  passed: sum("passed"),
  failed: sum("failed"),
  inProgress: sum("inProgress"),
  todo: sum("todo"),
  rate: pct(sum("passed"), sum("passed") + sum("failed")),
  totalDefects: bugs.length,
  openDefects: bugs.filter((b) => b.category !== "done").length,
};

// Failure notes from the latest "Automated result" Jira comment (failed and still-to-do runs only).
const noteTargets = tests.filter((t) => ["Failed", "To Do"].includes(runLabel(latest[t.key]?.status))).slice(0, 40);
const notes = {};
await Promise.all(noteTargets.map(async (t) => { notes[t.key] = latest[t.key]?.comment || (await failureNote(t.key)); }));

const testRows = tests.map((t) => {
  const run = latest[t.key];
  return { ...t, run: runLabel(run?.status), note: notes[t.key] || "" };
});

// Creation history from Jira created dates (available from day one).
const byDay = {};
for (const t of tests) byDay[t.created] = (byDay[t.created] || 0) + 1;
let cumulative = 0;
const creation = Object.keys(byDay).sort().map((d) => ({ date: d, created: byDay[d], total: (cumulative += byDay[d]) }));

// Run snapshots for trends.
const historyFile = path.join(ROOT, "reports", `history-${STORY}.json`);
fs.mkdirSync(path.dirname(historyFile), { recursive: true });
let history = [];
try { history = JSON.parse(fs.readFileSync(historyFile, "utf8")); if (!Array.isArray(history)) history = []; } catch { history = []; }
history = history.filter((h) => h.date !== date);
history.push({ date, generatedAt: new Date().toISOString(), tests: kpi.totalTests, runs: kpi.runs, passed: kpi.passed, failed: kpi.failed, inProgress: kpi.inProgress, todo: kpi.todo, passRate: kpi.rate, totalDefects: kpi.totalDefects, openDefects: kpi.openDefects });
history = history.slice(-365);
fs.writeFileSync(historyFile, JSON.stringify(history, null, 2), "utf8");

// ---------- HTML ----------
const CSS = `body{margin:0;background:#f4f6f8;font-family:Segoe UI,Arial,sans-serif;color:#1f2937}
.wrap{max-width:1040px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 10px}
.sub{color:#6b7280;font-size:13px;margin-bottom:18px}.nav{margin:6px 0 16px;font-size:13px}.nav a{margin-right:14px}
.tiles{display:flex;flex-wrap:wrap;gap:10px}.tile{flex:1 1 120px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:14px;text-align:center}
.tile .v{font-size:26px;font-weight:700}.tile .l{font-size:12px;color:#6b7280;margin-top:2px}
.tile.ok .v{color:#15803d}.tile.bad .v{color:#b91c1c}.tile.warn .v{color:#b45309}
.filters{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px}.filters input,.filters select{padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;font-size:13px}
th{background:#f3f4f6;text-align:left;padding:8px 10px;border-bottom:1px solid #e5e7eb}td{padding:8px 10px;border-bottom:1px solid #f0f1f3;vertical-align:top}
td.n,th.n{text-align:right}td.empty{text-align:center;color:#6b7280;padding:16px}.note{color:#6b7280;font-size:12px}
.b{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px}.b.ok{background:#dcfce7;color:#166534}.b.warn{background:#fef3c7;color:#92400e}.b.bad{background:#fee2e2;color:#991b1b}.b.idle{background:#e5e7eb;color:#374151}
a{color:#2563eb;text-decoration:none}.foot{margin-top:24px;font-size:12px;color:#9ca3af}`;

const FILTER_JS = `<script>
function applyFilters(id){var t=document.getElementById(id);var q=(document.getElementById(id+'-q').value||'').toLowerCase();
var sels=t.parentNode.querySelectorAll('select[data-col]');var rows=t.tBodies[0].rows;
for(var i=0;i<rows.length;i++){var r=rows[i];if(r.cells.length<2)continue;var ok=r.textContent.toLowerCase().indexOf(q)>-1;
for(var s=0;s<sels.length&&ok;s++){var v=sels[s].value;if(v&&r.cells[+sels[s].dataset.col].textContent.trim()!==v)ok=false;}
r.style.display=ok?'':'none';}}
</script>`;
const filterBar = (id, selects) =>
  `<div class="filters"><input id="${id}-q" placeholder="Search..." oninput="applyFilters('${id}')">` +
  selects.map(([col, label, opts]) => `<select data-col="${col}" onchange="applyFilters('${id}')"><option value="">${esc(label)}: all</option>${[...new Set(opts)].sort().map((o) => `<option>${esc(o)}</option>`).join("")}</select>`).join("") + `</div>`;

const nav = `<div class="nav"><a href="index.html">Home</a><a href="test-execution-ui-${esc(STORY)}.html">Test Execution UI</a><a href="defect-report-ui-${esc(STORY)}.html">Defect Report UI</a><a href="${esc(JIRA)}/browse/${esc(STORY)}">Jira Story ${esc(STORY)}</a></div>`;
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="wrap">${body}${FILTER_JS}</div></body></html>`;

function trendSvg() {
  if (history.length < 2) return `<p class="note">Trend chart appears after two or more daily snapshots (${history.length} so far).</p>`;
  const w = 520, h = 120, pad = 24;
  const pts = history.map((s, i) => `${pad + (i * (w - 2 * pad)) / (history.length - 1)},${h - pad - ((h - 2 * pad) * s.passRate) / 100}`).join(" ");
  return `<svg width="${w}" height="${h}" role="img" aria-label="Pass rate trend"><rect width="${w}" height="${h}" fill="#fff" stroke="#e5e7eb"/><polyline fill="none" stroke="#2563eb" stroke-width="2" points="${pts}"/><text x="4" y="14" font-size="10" fill="#6b7280">pass % (0-100)</text></svg>`;
}

const execTable = execRows.length
  ? execRows.map((e) => `<tr><td>${jiraLink(e.key)}</td><td>${esc(e.summary)}</td><td>${badge(e.status, statusCls(e.category))}</td><td class="n">${e.runs}</td><td class="n">${e.passed}</td><td class="n">${e.failed}</td><td class="n">${e.inProgress}</td><td class="n">${e.todo}</td><td class="n">${e.rate}%</td></tr>`).join("")
  : `<tr><td colspan="9" class="empty">No Test Executions linked to ${esc(STORY)}.</td></tr>`;
const testTable = testRows.length
  ? testRows.map((t) => `<tr><td>${jiraLink(t.key)}</td><td>${esc(t.summary)}</td><td>${esc(t.priority)}</td><td>${badge(t.status, statusCls(t.category))}</td><td>${badge(t.run, runCls(t.run))}</td><td class="note">${esc(t.note)}</td></tr>`).join("")
  : `<tr><td colspan="6" class="empty">No Test issues linked to ${esc(STORY)}.</td></tr>`;
const creationTable = creation.length
  ? creation.map((c) => `<tr><td>${esc(c.date)}</td><td class="n">${c.created}</td><td class="n">${c.total}</td></tr>`).join("")
  : `<tr><td colspan="3" class="empty">No test cases yet.</td></tr>`;
const historyTable = [...history].reverse().slice(0, 30).map((s) => `<tr><td>${esc(s.date)}</td><td class="n">${s.tests}</td><td class="n">${s.passed}</td><td class="n">${s.failed}</td><td class="n">${s.passRate}%</td><td class="n">${s.openDefects}</td></tr>`).join("");

const testUi = page(`${STORY} Test Execution`, `
<h1>${esc(STORY)} — Test Case &amp; Execution</h1>
<div class="sub">${esc(story.summary)} · ${esc(date)} (IST) · read-only snapshot from Jira and Xray</div>${nav}
<div class="tiles">${tile("Test Cases", kpi.totalTests)}${tile("Execution Runs", kpi.runs)}${tile("Passed", kpi.passed, "ok")}${tile("Failed", kpi.failed, kpi.failed ? "bad" : "")}${tile("In Progress", kpi.inProgress, kpi.inProgress ? "warn" : "")}${tile("To Do", kpi.todo)}${tile("Pass Rate", kpi.rate + "%", kpi.rate >= 90 ? "ok" : kpi.rate >= 70 ? "warn" : "bad")}</div>
<h2>Test Executions</h2><table><thead><tr><th>Execution</th><th>Summary</th><th>Status</th><th class="n">Runs</th><th class="n">Passed</th><th class="n">Failed</th><th class="n">In Progress</th><th class="n">To Do</th><th class="n">Pass %</th></tr></thead><tbody>${execTable}</tbody></table>
<h2>Test Cases</h2>${filterBar("tests", [[3, "Jira status", testRows.map((t) => t.status)], [4, "Run result", testRows.map((t) => t.run)], [2, "Priority", testRows.map((t) => t.priority)]])}
<table id="tests"><thead><tr><th>Test</th><th>Summary</th><th>Priority</th><th>Jira status</th><th>Run result</th><th>Failure / run note</th></tr></thead><tbody>${testTable}</tbody></table>
<h2>Creation history</h2><table><thead><tr><th>Date created</th><th class="n">Created</th><th class="n">Cumulative</th></tr></thead><tbody>${creationTable}</tbody></table>
<h2>Daily trend</h2>${trendSvg()}
<table style="margin-top:10px"><thead><tr><th>Date</th><th class="n">Tests</th><th class="n">Passed</th><th class="n">Failed</th><th class="n">Pass %</th><th class="n">Open defects</th></tr></thead><tbody>${historyTable}</tbody></table>
<div class="foot">Pass rate = Passed ÷ (Passed + Failed). Failure notes come from the latest “Automated result” comment in Jira.</div>`);

const bugRows = bugs.map((b) => ({ ...b, tests: b.links.filter((l) => testKeys.has(l.key)).map((l) => l.key) }));
const prioCount = (p) => bugs.filter((b) => b.priority === p).length;
const bugTable = bugRows.length
  ? bugRows.map((b) => `<tr><td>${jiraLink(b.key)}</td><td>${esc(b.summary)}</td><td>${badge(b.priority, prioCls(b.priority))}</td><td>${badge(b.status, statusCls(b.category))}</td><td>${b.tests.map(jiraLink).join(", ") || "-"}</td><td>${esc(b.created)}</td></tr>`).join("")
  : `<tr><td colspan="6" class="empty">No defects linked to ${esc(STORY)}.</td></tr>`;
const defectUi = page(`${STORY} Defects`, `
<h1>${esc(STORY)} — Defect Report</h1>
<div class="sub">${esc(story.summary)} · ${esc(date)} (IST) · read-only snapshot from Jira</div>${nav}
<div class="tiles">${tile("Total Defects", kpi.totalDefects)}${tile("Open", kpi.openDefects, kpi.openDefects ? "bad" : "ok")}${tile("Closed", kpi.totalDefects - kpi.openDefects, "ok")}${tile("High / Highest", prioCount("High") + prioCount("Highest"), prioCount("High") + prioCount("Highest") ? "bad" : "")}${tile("Medium", prioCount("Medium"), prioCount("Medium") ? "warn" : "")}</div>
<h2>Defects</h2>${filterBar("bugs", [[2, "Priority", bugRows.map((b) => b.priority)], [3, "Status", bugRows.map((b) => b.status)]])}
<table id="bugs"><thead><tr><th>Bug</th><th>Summary</th><th>Priority</th><th>Status</th><th>Linked tests</th><th>Created</th></tr></thead><tbody>${bugTable}</tbody></table>
<div class="foot">Defects are those linked to ${esc(STORY)} or to any of its test cases.</div>`);

const indexUi = page(`${STORY} QA Reports`, `<h1>${esc(STORY)} QA Reports</h1><div class="sub">${esc(date)} (IST)</div>${nav}<p>Pass rate ${kpi.rate}% · ${kpi.passed} passed · ${kpi.failed} failed · ${kpi.openDefects} open defects</p>`);

// Safety net: refuse to write anything that contains a secret value.
const secretValues = ["JIRA_API_TOKEN", "XRAY_CLIENT_SECRET", "XRAY_CLIENT_ID", "SMTP_PASS", "JIRA_EMAIL", "SMTP_USER", "REPORT_TO"]
  .map((n) => process.env[n]).filter((v) => v && v.length >= 6);
const outputs = { [`test-execution-ui-${STORY}.html`]: testUi, [`defect-report-ui-${STORY}.html`]: defectUi, "index.html": indexUi, [`history-${STORY}.json`]: fs.readFileSync(historyFile, "utf8") };
for (const [name, content] of Object.entries(outputs)) {
  if (secretValues.some((v) => content.includes(v))) throw new Error(`Refusing to write ${name}: it would contain a secret value`);
}
for (const [name, content] of Object.entries(outputs)) if (name.endsWith(".html")) fs.writeFileSync(path.join(ROOT, "reports", name), content, "utf8");
console.log(`Reports saved in reports/: test-execution-ui-${STORY}.html, defect-report-ui-${STORY}.html, index.html, history-${STORY}.json`);
console.log(`${STORY}: tests ${kpi.totalTests} | executions ${execs.length} | passed ${kpi.passed} | failed ${kpi.failed} | pass rate ${kpi.rate}% | defects ${kpi.totalDefects} (open ${kpi.openDefects})`);

// ---------- manager email ----------
if (process.argv.includes("--no-email")) {
  console.log("Email skipped (--no-email).");
} else {
  need(["SMTP_USER", "SMTP_PASS", "REPORT_TO"]);
  const testUrl = `${PAGES || "."}/test-execution-ui-${STORY}.html`;
  const defectUrl = `${PAGES || "."}/defect-report-ui-${STORY}.html`;
  const storyUrl = `${JIRA}/browse/${STORY}`;
  const btn = (href, label, bg) => `<a href="${esc(href)}" style="display:inline-block;margin:4px 6px 4px 0;padding:10px 16px;background:${bg};color:#fff;text-decoration:none;border-radius:6px;font-size:14px">${esc(label)}</a>`;
  const kv = (l, v, color = "#111827") => `<td style="padding:10px 14px;text-align:center;border:1px solid #e5e7eb"><div style="font-size:22px;font-weight:700;color:${color}">${esc(v)}</div><div style="font-size:12px;color:#6b7280">${esc(l)}</div></td>`;
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;color:#1f2937">
<h2 style="margin:0 0 4px">${esc(STORY)} — QA Summary</h2><div style="color:#6b7280;font-size:13px;margin-bottom:14px">${esc(story.summary)} · ${esc(date)} (IST)</div>
<table style="border-collapse:collapse;width:100%"><tr>${kv("Test cases", kpi.totalTests)}${kv("Passed", kpi.passed, "#15803d")}${kv("Failed", kpi.failed, kpi.failed ? "#b91c1c" : "#111827")}${kv("Pass rate", kpi.rate + "%")}${kv("Open defects", kpi.openDefects, kpi.openDefects ? "#b91c1c" : "#15803d")}</tr></table>
<p style="font-size:14px">${kpi.passed} of ${kpi.executed} executed runs passed across ${execs.length} execution(s); ${kpi.totalDefects} defect(s) logged, ${kpi.openDefects} still open.</p>
<div>${btn(testUrl, "Test Execution UI", "#2563eb")}${btn(defectUrl, "Defect Report UI", "#b91c1c")}${btn(storyUrl, "Jira Story " + STORY, "#374151")}</div>
${PAGES ? "" : `<p style="font-size:12px;color:#9ca3af">Report pages are not published (PAGES_BASE_URL not set).</p>`}</div>`;
  const transport = nodemailer.createTransport(
    process.env.SMTP_HOST
      ? { host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: Number(process.env.SMTP_PORT) === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
      : { service: "gmail", auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
  );
  const subject = `[AAQA] ${STORY} QA Summary (${date}) — ${kpi.passed}/${kpi.executed} Passed | ${kpi.openDefects} Open Defects`;
  await transport.sendMail({ from: process.env.SMTP_USER, to: process.env.REPORT_TO.split(",").map((s) => s.trim()).filter(Boolean), subject, html });
  console.log(`Email sent: ${subject}`);
}
