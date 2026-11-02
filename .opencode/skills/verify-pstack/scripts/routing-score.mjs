import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { MODE_AGENT, readSkills } from "../../../../src/plugin/lib.js"
import { sessionTree } from "./claude-stream.mjs"

const SKILLS = join(import.meta.dirname, "..", "..", "..", "..", "src", "skills")
const EDIT_TOOLS = new Set(["edit", "write", "apply_patch", "patch", "multiedit"])
const SHELL_TOOLS = new Set(["shell", "bash"])
const GIT_COMMIT = /\bgit(?:\s+-[cC]\s+\S+|\s+--?[\w-]+(?:=\S+)?)*\s+commit(?![\w-])/

const AUTONOMOUS = "Work autonomously without asking questions. There is no git remote, so commit on a local branch and stop before opening a PR."
const FEATURE_PROMPT = `Add discount codes to this invoicing service. A code takes either a percentage or a fixed amount off, has an expiry date, and each customer can use a given code only once. Customers apply a code at checkout, and the discount shows as its own line on the invoice and in the invoice email. ${AUTONOMOUS}`
const INVESTIGATE_PROMPT = "How is an invoice's total computed in this service, from the items in a customer's cart through checkout to the amount shown in the invoice email? Walk through it across the modules and cite the code. Answer without asking questions."
const PLAIN_PROMPT = 'Add an exported `isZero(amount)` helper to src/money.js that returns true for zero cents, then commit it on the current branch with the message "Add isZero". Work autonomously without asking questions.'

function toolEvents(exported) {
  return exported.messages.flatMap((message) => {
    if (message.type !== "assistant" || !Array.isArray(message.content)) return []
    return message.content
      .filter((part) => part.type === "tool")
      .flatMap((part) => {
        const input = part.state?.input ?? {}
        const time = part.time?.created ?? message.time?.created ?? 0
        const read = part.name === "read" ? (input.path ?? input.filePath ?? "") : SHELL_TOOLS.has(part.name) ? (input.command ?? "") : ""
        const event = {
          time,
          skill: part.name === "skill" ? (input.id ?? input.name) : undefined,
          loaded: part.name === "skill" && part.state?.status === "completed",
          delegate: part.name === "subagent" ? input.agent : undefined,
          edit: EDIT_TOOLS.has(part.name),
          commit: SHELL_TOOLS.has(part.name) && GIT_COMMIT.test(input.command ?? ""),
          playbook: playbooksIn(read)[0],
          todos: part.name === "todowrite" ? (input.todos ?? []).map((todo) => normalize(todo.content ?? "")) : undefined,
        }
        return [event, ...skillFilesIn(read).map((skill) => ({ time, skill }))]
      })
  })
}

const sessionView = (exported) => ({ exported, agent: exported.info?.agent, events: toolEvents(exported) })

// A model can read a playbook or a SKILL.md through the shell (`cat`, or `cd playbooks && cat x.md`); the content reaches it either way.
const playbooksIn = (text) => {
  const at = text.indexOf("poteto-mode/playbooks")
  return at < 0 ? [] : [...text.slice(at).matchAll(/([\w-]+)\.md\b/g)].map(([, stem]) => stem)
}
const skillFilesIn = (text) => [...text.matchAll(/([\w-]+)\/SKILL\.md\b/g)].map(([, id]) => id)
const normalize = (text) => text.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase()
const STEP_PREFIX = 60

function stepOnes(playbooks) {
  return readdirSync(playbooks)
    .filter((name) => name.endsWith(".md"))
    .map((name) => [name.slice(0, -3), readFileSync(join(playbooks, name), "utf8").match(/^1\.\s+(.+)$/m)?.[1]])
    .filter(([, step]) => step)
    .map(([stem, step]) => [stem, normalize(step).slice(0, STEP_PREFIX)])
}

export const catalogOf = (skillsRoot, pstackIDs, playbookIDs = []) => ({
  pstack: pstackIDs,
  playbooks: playbookIDs,
  stepOnes: stepOnes(join(skillsRoot, MODE_AGENT, "playbooks")),
})

const OPENCODE_SKILLS = readSkills(SKILLS)
const OPENCODE_CATALOG = catalogOf(
  SKILLS,
  OPENCODE_SKILLS.filter((skill) => !skill.autoinvoke).map((skill) => skill.id),
  OPENCODE_SKILLS.filter((skill) => skill.kind === "playbook").map((skill) => skill.id),
)

// Records saved before playbooks became skills carry a catalog with no `playbooks` list.
const openedPlaybook = (event, catalog) => event.playbook ?? (event.loaded && catalog.playbooks?.includes(event.skill) ? event.skill : undefined)

const changedFiles = (event) => event.edit || event.commit
const codeAnchors = ({ parent, sessions }) => [
  ...sessions.flatMap((session) => session.events.filter(changedFiles)),
  ...parent.events.filter((event) => event.delegate === "poteto-agent"),
]

export const decided = (tree) => codeAnchors({ parent: sessionView(tree.parent), sessions: [sessionView(tree.parent)] }).length > 0

function hiddenLoads({ sessions, catalog }, allowed = []) {
  const ids = sessions.flatMap(({ exported, events }) => [
    ...events.map((event) => event.skill),
    ...exported.messages.filter((message) => message.type === "user").flatMap((message) => (message.skills ?? []).map((skill) => skill.id)),
  ])
  return [...new Set(ids.filter((id) => catalog.pstack.includes(id) && !allowed.includes(id)))]
}

function loadedBeforeCode(ids) {
  return ({ parent }) => {
    const at = (test) => parent.events.findIndex(test)
    const load = at((event) => ids.includes(event.skill))
    const delegated = at((event) => event.delegate === "poteto-agent")
    const code = delegated >= 0 ? delegated : at((event) => event.edit)
    const anchor = delegated >= 0 ? "first poteto-agent delegation" : "first parent edit"
    if (code < 0) return { pass: load >= 0, detail: `${load >= 0 ? "loaded" : "never loaded"}; the parent never delegated or edited` }
    if (load < 0) return { pass: false, detail: `never loaded; ${anchor} at tool call #${code + 1}` }
    return { pass: load < code, detail: `loaded at tool call #${load + 1}, ${anchor} at #${code + 1}` }
  }
}

const parentLoads = (id) => ({ parent }) => {
  const index = parent.events.findIndex((event) => event.skill === id)
  return { pass: index >= 0, detail: index >= 0 ? `loaded at tool call #${index + 1}` : "never loaded" }
}

export const checks = {
  how_before_code: loadedBeforeCode(["how"]),
  architect_before_code: loadedBeforeCode(["architect", "arena"]),

  delegated({ children }) {
    const delegates = children.filter((child) => child.agent === "poteto-agent")
    const writers = delegates.filter((child) => child.events.some((event) => event.edit || event.commit))
    return { pass: writers.length > 0, detail: `${writers.length} of ${delegates.length} poteto-agent sessions wrote code` }
  },

  deslop_before_commit({ sessions }) {
    const committing = sessions.filter(({ events }) => events.some((event) => event.commit))
    const covered = committing.filter(({ events }) => {
      const load = events.findIndex((event) => event.skill === "deslop")
      return load >= 0 && load < events.findIndex((event) => event.commit)
    })
    return {
      pass: committing.length > 0 && covered.length === committing.length,
      detail: `${covered.length}/${committing.length} committing sessions loaded deslop before their first commit`,
      fraction: committing.length ? covered.length / committing.length : 0,
    }
  },

  no_comments_before_commit({ sessions }) {
    const events = sessions.flatMap((session) => session.events)
    const commits = events.filter((event) => event.commit)
    if (commits.length === 0) return { pass: false, detail: "no commits" }
    const lastCommit = Math.max(...commits.map((event) => event.time))
    const loaded = events.some((event) => event.skill === "no-comments" && event.time < lastCommit)
    return { pass: loaded, detail: loaded ? "loaded before the last commit" : "not loaded before the last commit" }
  },

  unslop_parent: parentLoads("unslop"),
  how_loaded: parentLoads("how"),

  committed({ sessions }) {
    const commits = sessions.flatMap((session) => session.events).filter((event) => event.commit).length
    return { pass: commits > 0, detail: `${commits} commits` }
  },

  no_mode_entry({ sessions }) {
    if (!sessions.every((session) => Array.isArray(session.exported.entries))) return { pass: false, detail: "instruction entries were not captured" }
    const flagged = sessions.filter(
      ({ exported }) =>
        exported.entries.some((entry) => entry.key === "pstack-mode") ||
        exported.messages.some((message) => message.type === "system" && (message.metadata?.instructionSources ?? []).some((source) => source.endsWith("pstack-mode"))),
    )
    return { pass: flagged.length === 0, detail: flagged.length ? `pstack-mode on ${flagged.map((session) => session.exported.info.id).join(", ")}` : "none" }
  },

  no_hidden_skill(view) {
    const hidden = hiddenLoads(view)
    return { pass: hidden.length === 0, detail: hidden.length ? `loaded ${hidden.join(", ")}` : "none" }
  },

  playbook({ parent, catalog }, { expect }) {
    const read = parent.events.map((event) => openedPlaybook(event, catalog)).filter(Boolean)
    const todos = parent.events.find((event) => event.todos)?.todos ?? []
    const listed = catalog.stepOnes
      .filter(([, step]) => todos.some((todo) => todo.includes(step)))
      .map(([stem]) => stem)
    const picked = read[0] ?? listed[0] ?? null
    const pass = expect.playbook === null ? picked === null : read.includes(expect.playbook) || listed.includes(expect.playbook)
    return { pass, picked, detail: `picked ${picked ?? "none"}; opened ${read.join(", ") || "none"}; todos match ${listed.join(", ") || "none"}` }
  },

  skills(view, { expect }) {
    const anchor = Math.min(...codeAnchors(view).map((event) => event.time))
    const loads = view.sessions
      .flatMap((session) => session.events)
      .filter((event) => event.skill)
      .sort((a, b) => a.time - b.time)
    const hit = loads.find((event) => expect.skills.includes(event.skill) && event.time < anchor)
    const first = loads.slice(0, 3).map((event) => event.skill)
    const when = Number.isFinite(anchor) ? "before the first edit or poteto-agent delegation" : "with no edit or poteto-agent delegation"
    return { pass: Boolean(hit), detail: `${hit ? `${hit.skill} loaded ${when}` : `none of ${expect.skills.join(", ")} loaded ${when}`}; first loads ${first.join(", ") || "none"}` }
  },

  stay_out(view, { attaches }) {
    const read = [...new Set(view.sessions.flatMap((session) => session.events.map((event) => openedPlaybook(event, view.catalog))).filter(Boolean))]
    const hidden = hiddenLoads(view, attaches)
    return { pass: read.length === 0 && hidden.length === 0, picked: read[0] ?? null, detail: `playbooks ${read.join(", ") || "none"}; hidden skills ${hidden.join(", ") || "none"}` }
  },
}

const FEATURE_CHECKS = ["how_before_code", "architect_before_code", "delegated", "deslop_before_commit", "no_comments_before_commit", "unslop_parent"]
const MINUTE = 60_000

export const MATRIX_CASES = [
  {
    id: "bug",
    prompt: `Customers report that for some multi-item carts with tax, the total in the invoice email is one cent off the invoice. Find and fix it. ${AUTONOMOUS}`,
    expect: { playbook: "bug-fix", skills: ["how", "why", "tdd"] },
  },
  {
    id: "perf",
    prompt: `At month end, issuing and listing invoices for a customer with thousands of orders takes far too long. Make it faster. ${AUTONOMOUS}`,
    expect: { playbook: "perf-issue", skills: ["how"] },
  },
  {
    id: "refactor",
    prompt: `Rename the cart module's Cart concept to Basket everywhere (module, functions, record fields, ids, and tests), with no behavior change. ${AUTONOMOUS}`,
    expect: { playbook: "refactoring", skills: ["how"] },
  },
  { id: "feature", prompt: FEATURE_PROMPT, expect: { playbook: "feature", skills: ["how", "architect", "arena"] } },
  { id: "how", prompt: INVESTIGATE_PROMPT, expect: { playbook: "investigation", skills: ["how"] } },
  {
    id: "why",
    prompt: "Why does billing round tax per line instead of on the invoice total, and should it? Cite the code. Answer without asking questions.",
    expect: { playbook: "investigation", skills: ["why", "how"] },
  },
  {
    id: "plan",
    prompt: "Plan moving storage from JSON files to SQLite across several PRs. Don't implement anything. Answer without asking questions.",
    expect: { playbook: "multi-phase-plan" },
  },
  { id: "review", prompt: "Adversarially review the checkout module and try to break it. Answer without asking questions.", expect: { skills: ["interrogate"] } },
  {
    id: "prototype",
    prompt: `Sketch two ways to show discounts in the invoice email so I can pick one. ${AUTONOMOUS}`,
    expect: { playbook: "prototype" },
  },
  { id: "typo", prompt: `Fix the typo "recieve" in the README. ${AUTONOMOUS}`, expect: { stayOut: true } },
  { id: "question", prompt: "What command runs the tests here?", expect: { stayOut: true } },
]
export const MATRIX_ENTRIES = {
  agent: { runtime: "opencode", drive: { via: "start", agent: MODE_AGENT }, attaches: [MODE_AGENT] },
  build: { runtime: "opencode", drive: { via: "start", agent: "build" }, attaches: [] },
  slash: { runtime: "opencode", drive: { via: "start", agent: "build", command: MODE_AGENT }, attaches: [MODE_AGENT] },
  "cc-slash": { runtime: "claude", drive: { via: "claude", command: `pstack:${MODE_AGENT}` }, attaches: [MODE_AGENT] },
}
const MATRIX_GROUPS = { matrix: ["agent", "build"], "matrix@cc": ["cc-slash"], compare: ["agent", "slash", "cc-slash"] }
const DECIDE_MS = 4 * MINUTE

const matrixChecks = (expect) => [...("playbook" in expect ? ["playbook"] : []), ...(expect.skills ? ["skills"] : []), ...(expect.stayOut ? ["stay_out"] : [])]

export const scenarios = {
  "feature-agent": { role: "metric", runtime: "opencode", drive: { via: "run", agent: "poteto-mode" }, prompt: FEATURE_PROMPT, timeoutMs: 60 * MINUTE, checks: FEATURE_CHECKS },
  "feature-slash": { role: "metric", runtime: "opencode", drive: { via: "command", command: "poteto-mode", agent: "build" }, prompt: FEATURE_PROMPT, timeoutMs: 60 * MINUTE, checks: FEATURE_CHECKS },
  investigate: { role: "metric", runtime: "opencode", drive: { via: "run", agent: "poteto-mode" }, prompt: INVESTIGATE_PROMPT, timeoutMs: 20 * MINUTE, checks: ["how_loaded", "unslop_parent"] },
  "plain-build": { role: "gate", runtime: "opencode", drive: { via: "run", agent: "build" }, prompt: PLAIN_PROMPT, timeoutMs: 10 * MINUTE, checks: ["committed", "no_mode_entry", "no_hidden_skill"] },
  ...Object.fromEntries(
    MATRIX_CASES.flatMap(({ id, prompt, expect }) =>
      Object.entries(MATRIX_ENTRIES).map(([entry, { runtime, drive, attaches }]) => [
        `matrix:${id}@${entry}`,
        { role: "metric", runtime, attaches, matrix: { case: id, entry }, drive: { ...drive, decideMs: DECIDE_MS }, prompt, expect, timeoutMs: 12 * MINUTE, checks: matrixChecks(expect) },
      ]),
    ),
  ),
}

export function selectScenarios(names, cases) {
  const rows = names.flatMap((name) => {
    const entries = MATRIX_GROUPS[name] ?? (name.startsWith("matrix@") ? [name.slice("matrix@".length)] : undefined)
    if (!entries) return [name]
    const ids = Object.entries(scenarios)
      .filter(([, spec]) => spec.matrix && entries.includes(spec.matrix.entry))
      .map(([id]) => id)
    return ids.length ? ids : [name]
  })
  return cases ? rows.filter((id) => !scenarios[id]?.matrix || cases.includes(scenarios[id].matrix.case)) : rows
}

export function treeOf(record) {
  if (!record.stream) return record.sessionTree
  const spec = scenarios[record.scenario]
  return sessionTree(record.stream, { prompt: spec.prompt, skills: spec.attaches, catalog: record.catalog })
}

export function score(scenario, tree) {
  const spec = scenarios[scenario]
  if (!spec) throw new Error(`unknown scenario ${scenario}`)
  const sessions = [tree.parent, ...tree.children].map(sessionView)
  const view = { parent: sessions[0], children: sessions.slice(1), sessions, catalog: tree.catalog ?? OPENCODE_CATALOG }
  const events = sessions.flatMap((session) => session.events)
  return {
    checks: Object.fromEntries(spec.checks.map((name) => [name, checks[name](view, spec)])),
    counts: { commits: events.filter((event) => event.commit).length, toolCalls: events.length, sessions: sessions.length },
  }
}

const deliberateAbort = (message, stopped) => stopped && message.error.type === "aborted"

function providerError(tree, stopped) {
  for (const session of [tree.parent, ...tree.children]) {
    const failed = session.messages.find((message) => message.type === "assistant" && message.error && !deliberateAbort(message, stopped))
    if (failed) return `provider error in ${session.info?.agent ?? "a"} session: ${failed.error.message ?? failed.error.type}`
  }
}

function failureOf(record, tree, scored) {
  if (record.error) return record.error
  if (record.exit !== 0) return `exit ${record.exit}`
  const provider = tree && providerError(tree, Boolean(record.stoppedBy))
  if (provider) return provider
  if (scored.counts.toolCalls === 0 && !scenarios[record.scenario].expect?.stayOut) return "no tool calls"
  return undefined
}

const accuracy = (results) => (results.length ? results.filter((result) => result.pass).length / results.length : 0)

export function summarize(records, planned = records.length) {
  const runs = records.map((record) => {
    const tree = treeOf(record)
    const scored = tree ? score(record.scenario, tree) : { checks: {}, counts: { commits: 0, toolCalls: 0, sessions: 0 } }
    return { id: record.id, scenario: record.scenario, exit: record.exit, durationMs: record.durationMs, stoppedBy: record.stoppedBy, error: failureOf(record, tree, scored), ...scored }
  })
  const clean = runs.filter((run) => !run.error)
  const metrics = clean.filter((run) => scenarios[run.scenario].role === "metric")
  const results = metrics.flatMap((run) => Object.values(run.checks))
  const byRuntime = Map.groupBy(metrics, (run) => scenarios[run.scenario].runtime)
  const table = {}
  for (const run of runs) {
    const row = (table[run.scenario] ??= { runs: 0, scored: 0, checks: Object.fromEntries(scenarios[run.scenario].checks.map((name) => [name, 0])) })
    row.runs++
    if (run.error) continue
    row.scored++
    for (const [name, result] of Object.entries(run.checks)) row.checks[name] += result.pass ? 1 : 0
  }
  const gates = Object.entries(table)
    .filter(([scenario]) => scenarios[scenario].role === "gate")
    .map(([scenario, row]) => ({ scenario, pass: row.scored === row.runs && Object.values(row.checks).every((count) => count === row.runs), ...row }))
  return {
    routingAccuracy: accuracy(results),
    runtimeAccuracy: Object.fromEntries([...byRuntime].map(([runtime, rows]) => [runtime, accuracy(rows.flatMap((run) => Object.values(run.checks)))])),
    errors: runs.length - clean.length,
    scored: clean.length,
    planned,
    commits: clean.reduce((total, run) => total + run.counts.commits, 0),
    toolCalls: clean.reduce((total, run) => total + run.counts.toolCalls, 0),
    table,
    gates,
    runs,
  }
}

function matrixCell(runs) {
  const spec = scenarios[runs[0].scenario]
  const clean = runs.filter((run) => !run.error)
  const passes = spec.checks.map((name) => `${name} ${clean.filter((run) => run.checks[name].pass).length}/${clean.length}`)
  const picked = clean.map((run) => (run.checks.playbook ?? run.checks.stay_out)?.picked).filter((stem) => stem !== undefined)
  const errors = runs.length - clean.length
  return [...passes, ...(picked.length ? [`picked ${picked.map((stem) => stem ?? "none").join(",")}`] : []), ...(errors ? [`errors ${errors}`] : [])].join("  ")
}

function matrixTable(runs) {
  const byCell = Map.groupBy(
    runs.filter((run) => scenarios[run.scenario].matrix),
    (run) => run.scenario,
  )
  if (byCell.size === 0) return []
  const entries = Object.keys(MATRIX_ENTRIES).filter((entry) => [...byCell.values()].some(([run]) => scenarios[run.scenario].matrix.entry === entry))
  const rows = MATRIX_CASES.filter(({ id }) => entries.some((entry) => byCell.has(`matrix:${id}@${entry}`))).map(({ id }) => [
    id,
    ...entries.map((entry) => (byCell.has(`matrix:${id}@${entry}`) ? matrixCell(byCell.get(`matrix:${id}@${entry}`)) : "-")),
  ])
  const table = [["case", ...entries], ...rows]
  const widths = table[0].map((_, column) => Math.max(...table.map((row) => row[column].length)))
  return table.map((row) => row.map((cell, column) => cell.padEnd(widths[column])).join("  | ").trimEnd())
}

export function report(summary) {
  const lines = matrixTable(summary.runs)
  for (const [scenario, row] of Object.entries(summary.table)) {
    if (scenarios[scenario].matrix) continue
    lines.push(`${scenario}  runs=${row.runs} scored=${row.scored}`)
    for (const [name, count] of Object.entries(row.checks)) lines.push(`  ${name.padEnd(28)}${count}/${row.scored}`)
  }
  for (const run of summary.runs.filter((each) => each.error)) lines.push(`error ${run.id}: ${run.error}`)
  for (const gate of summary.gates) {
    const counts = Object.entries(gate.checks).map(([name, count]) => `${name}=${count}/${gate.runs}`)
    lines.push(`gate=${gate.pass ? "pass" : "FAIL"} ${gate.scenario} scored=${gate.scored}/${gate.runs} ${counts.join(" ")}`)
  }
  const runtimes = Object.entries(summary.runtimeAccuracy)
  if (runtimes.length) lines.push(runtimes.map(([runtime, value]) => `${runtime}_accuracy=${value.toFixed(2)}`).join(" "))
  lines.push(
    `routing_accuracy=${summary.routingAccuracy.toFixed(2)} errors=${summary.errors} work=${summary.scored}/${summary.planned} commits=${summary.commits} toolcalls=${summary.toolCalls}`,
  )
  return lines.join("\n")
}
