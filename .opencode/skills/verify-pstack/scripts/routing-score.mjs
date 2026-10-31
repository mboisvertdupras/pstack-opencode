import { join } from "node:path"
import { readSkills } from "../../../../src/plugin/lib.js"

const HIDDEN = new Set(
  readSkills(join(import.meta.dirname, "..", "..", "..", "..", "src", "skills"))
    .filter((skill) => !skill.autoinvoke)
    .map((skill) => skill.id),
)
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
      .map((part) => {
        const input = part.state?.input ?? {}
        return {
          time: part.time?.created ?? message.time?.created ?? 0,
          skill: part.name === "skill" ? (input.id ?? input.name) : undefined,
          delegate: part.name === "subagent" ? input.agent : undefined,
          edit: EDIT_TOOLS.has(part.name),
          commit: SHELL_TOOLS.has(part.name) && GIT_COMMIT.test(input.command ?? ""),
        }
      })
  })
}

const sessionView = (exported) => ({ exported, agent: exported.info?.agent, events: toolEvents(exported) })

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

  deslop_before_each_commit({ sessions }) {
    let commits = 0
    let covered = 0
    for (const { events } of sessions) {
      let deslopped = false
      for (const event of events) {
        if (event.skill === "deslop") deslopped = true
        if (!event.commit) continue
        commits++
        if (deslopped) covered++
        deslopped = false
      }
    }
    return { pass: commits > 0 && covered === commits, detail: `${covered}/${commits} commits preceded by deslop in their session`, fraction: commits ? covered / commits : 0 }
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

  no_hidden_skill({ sessions }) {
    const ids = sessions.flatMap(({ exported, events }) => [
      ...events.map((event) => event.skill),
      ...exported.messages.filter((message) => message.type === "user").flatMap((message) => (message.skills ?? []).map((skill) => skill.id)),
    ])
    const hidden = [...new Set(ids.filter((id) => HIDDEN.has(id)))]
    return { pass: hidden.length === 0, detail: hidden.length ? `loaded ${hidden.join(", ")}` : "none" }
  },
}

const FEATURE_CHECKS = ["how_before_code", "architect_before_code", "delegated", "deslop_before_each_commit", "no_comments_before_commit", "unslop_parent"]
const MINUTE = 60_000

export const scenarios = {
  "feature-agent": { role: "metric", drive: { via: "run", agent: "poteto-mode" }, prompt: FEATURE_PROMPT, timeoutMs: 60 * MINUTE, checks: FEATURE_CHECKS },
  "feature-slash": { role: "metric", drive: { via: "command", command: "poteto-mode", agent: "build" }, prompt: FEATURE_PROMPT, timeoutMs: 60 * MINUTE, checks: FEATURE_CHECKS },
  investigate: { role: "metric", drive: { via: "run", agent: "poteto-mode" }, prompt: INVESTIGATE_PROMPT, timeoutMs: 20 * MINUTE, checks: ["how_loaded", "unslop_parent"] },
  "plain-build": { role: "gate", drive: { via: "run", agent: "build" }, prompt: PLAIN_PROMPT, timeoutMs: 10 * MINUTE, checks: ["committed", "no_mode_entry", "no_hidden_skill"] },
}

export function score(scenario, tree) {
  const spec = scenarios[scenario]
  if (!spec) throw new Error(`unknown scenario ${scenario}`)
  const sessions = [tree.parent, ...tree.children].map(sessionView)
  const view = { parent: sessions[0], children: sessions.slice(1), sessions }
  const events = sessions.flatMap((session) => session.events)
  return {
    checks: Object.fromEntries(spec.checks.map((name) => [name, checks[name](view)])),
    counts: { commits: events.filter((event) => event.commit).length, toolCalls: events.length, sessions: sessions.length },
  }
}

function failureOf(record, scored) {
  if (record.error) return record.error
  if (record.exit !== 0) return `exit ${record.exit}`
  if (scored.counts.toolCalls === 0) return "no tool calls"
  return undefined
}

export function summarize(records, planned = records.length) {
  const runs = records.map((record) => {
    const scored = record.sessionTree ? score(record.scenario, record.sessionTree) : { checks: {}, counts: { commits: 0, toolCalls: 0, sessions: 0 } }
    return { id: record.id, scenario: record.scenario, exit: record.exit, durationMs: record.durationMs, error: failureOf(record, scored), ...scored }
  })
  const clean = runs.filter((run) => !run.error)
  const results = clean.filter((run) => scenarios[run.scenario].role === "metric").flatMap((run) => Object.values(run.checks))
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
    routingAccuracy: results.length ? results.filter((result) => result.pass).length / results.length : 0,
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

export function report(summary) {
  const lines = []
  for (const [scenario, row] of Object.entries(summary.table)) {
    lines.push(`${scenario}  runs=${row.runs} scored=${row.scored}`)
    for (const [name, count] of Object.entries(row.checks)) lines.push(`  ${name.padEnd(28)}${count}/${row.scored}`)
  }
  for (const run of summary.runs.filter((each) => each.error)) lines.push(`error ${run.id}: ${run.error}`)
  for (const gate of summary.gates) {
    const counts = Object.entries(gate.checks).map(([name, count]) => `${name}=${count}/${gate.runs}`)
    lines.push(`gate=${gate.pass ? "pass" : "FAIL"} ${gate.scenario} scored=${gate.scored}/${gate.runs} ${counts.join(" ")}`)
  }
  lines.push(
    `routing_accuracy=${summary.routingAccuracy.toFixed(2)} errors=${summary.errors} work=${summary.scored}/${summary.planned} commits=${summary.commits} toolcalls=${summary.toolCalls}`,
  )
  return lines.join("\n")
}
