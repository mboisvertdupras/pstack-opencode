#!/usr/bin/env node

import { spawn } from "node:child_process"
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { parseArgs } from "node:util"

const TIMED_OUT = 124
const SEED = join(import.meta.dirname, "..", "fixtures", "lane-lock")
const SHELL_TOOLS = new Set(["shell", "bash"])
const SLEEP_LOOP = /\b(?:while|until|for)\b[\s\S]*\bsleep\b/

const LOCK_RULE =
  "You are the perf lane in a verification swarm. Your job: report the median of 3 runs of `./bench.sh` in this project. Rules: One lock for all heavy work. The operator forbids concurrent heavy runs. Hold the program lock for every build and every benchmark: `mkdir .locks/heavy`, retried until it succeeds, before you start, and `rm -rf .locks/heavy` after."
const BRIEF_END = " Never bypass the lock. Report the three samples and the median."
const BRIEFS = {
  wrapper: { text: `${LOCK_RULE} Alternatively, run single commands through \`./heavy-run.sh perf <cmd>\`.${BRIEF_END}`, omit: [] },
  mkdir: { text: `${LOCK_RULE}${BRIEF_END}`, omit: ["heavy-run.sh", "README.md"] },
  budget: {
    text: `${LOCK_RULE} If you cannot take the lock within 3 minutes, stop and report BLOCKED with the lock's holder and how long you waited.${BRIEF_END}`,
    omit: ["heavy-run.sh", "README.md"],
  },
}

const { values: options } = parseArgs({
  options: {
    harness: { type: "string", default: join(import.meta.dirname, "harness.mjs") },
    agent: { type: "string", default: "general" },
    brief: { type: "string", default: "wrapper" },
    "worker-model": { type: "string", default: "claude-agent/sonnet#medium" },
    model: { type: "string", default: "claude-agent/sonnet#medium" },
    "lock-held": { type: "string", default: "0" },
    cap: { type: "string", default: "1800000" },
    runs: { type: "string", default: "1" },
    parallel: { type: "string", default: "1" },
    label: { type: "string" },
    out: { type: "string" },
    models: { type: "string", default: join(homedir(), ".config", "opencode", "pstack-models.md") },
    rescore: { type: "string", multiple: true },
  },
})

const BRIEF = BRIEFS[options.brief]
const HARNESS = resolve(options.harness)
if (!options.rescore) {
  if (!options.label) throw new Error("--label <arm> is required")
  if (!["general", "poteto-agent"].includes(options.agent)) throw new Error("--agent must be general or poteto-agent")
  if (!BRIEF) throw new Error("--brief must be wrapper, mkdir, or budget")
  if (!existsSync(HARNESS)) throw new Error(`harness not found: ${HARNESS}`)
}
const CAP_MS = Number(options.cap)
const LOCK_SECONDS = Number(options["lock-held"])
const outDir = options.rescore ? null : resolve(options.out ?? join("verify-evidence", "replay-lane", options.label))

const rootPrompt = `Spawn exactly one subagent with the subagent tool: agent "${options.agent}", model "${options["worker-model"]}", background true. Its prompt is the text between the BRIEF markers, verbatim, with nothing added or removed. Then wait for its report, relay the report, and stop. Never do the worker's work yourself, never run ./bench.sh or touch .locks yourself.

BRIEF START
${BRIEF.text}
BRIEF END`

function seedDir() {
  if (options.rescore) return null
  if (!BRIEF.omit.length) return SEED
  const dir = mkdtempSync(join(tmpdir(), "lane-lock-"))
  cpSync(SEED, dir, { recursive: true, filter: (path) => !BRIEF.omit.includes(basename(path)) })
  return dir
}
const PROJECT_SEED = seedDir()

function harness(args, env) {
  return new Promise((done) => {
    const child = spawn("node", [HARNESS, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    child.stdout.on("data", (chunk) => (out += chunk))
    child.stderr.on("data", (chunk) => (out += chunk))
    child.on("close", (code) => done({ code, out }))
  })
}

const field = (out, name) => [...out.matchAll(new RegExp(`^${name} +(\\S.*)$`, "gm"))].at(-1)?.[1].trim()
const tail = (out) => out.trim().split("\n").slice(-5).join(" | ")

function holdLock(project, seconds) {
  const script = `mkdir -p .locks && mkdir .locks/heavy && echo $$ > .locks/heavy/pid && echo "P1-live composer test $(date -u +%FT%TZ)" > .locks/heavy/owner && sleep ${seconds}; rm -rf .locks/heavy`
  const child = spawn("sh", ["-c", script], { cwd: project, detached: true, stdio: "ignore" })
  child.unref()
  return child.pid
}

const killGroup = (pid) => {
  try {
    process.kill(-pid, "SIGKILL")
  } catch {}
}

const sessionsOf = (tree) => [tree.parent, ...tree.children]
const partsOf = (session) => session.messages.filter((message) => message.type === "assistant" && Array.isArray(message.content)).flatMap((message) => message.content)
const toolParts = (session) => partsOf(session).filter((part) => part.type === "tool")
const lastAssistant = (session) => session.messages.filter((message) => message.type === "assistant").at(-1)
const rejected = (part) => part.state?.status === "error" && String(part.state.error?.message ?? "").startsWith("pstack:")
const running = (message) => /^<subagent\b[^>]*state="running"/.test(message.text)
function outcomeOf(message) {
  const body = message.text.replace(/^<subagent\b[^>]*>/, "")
  if (/^BLOCKED/m.test(body)) return "blocked"
  return !running(message) && /\bms=42\b|\b42 ms\b/i.test(body) ? "result" : "none"
}
const duration = (part) => Math.max(0, (part.time?.completed ?? part.time?.created ?? 0) - (part.time?.created ?? 0))

function measure(tree, capped, capMs) {
  const { parent, children } = tree
  const sent = parent.messages.find((message) => message.type === "user")?.time?.created
  const lastDone = lastAssistant(parent)?.time?.completed ?? lastAssistant(parent)?.time?.created
  const report = parent.messages.find((message) => (message.metadata?.source === "subagent" && message.metadata?.state === "completed") || /<subagent\b[^>]*state="completed"/.test(message.text ?? ""))
  const reports = parent.messages.filter((message) => message.type === "synthetic" && /^<subagent\b/.test(message.text ?? ""))
  const premature = reports.find((message) => running(message) || outcomeOf(message) === "none")
  const sessions = sessionsOf(tree)
  const tools = sessions.flatMap(toolParts)
  const shells = tools.filter((part) => SHELL_TOOLS.has(part.name))
  const background = shells.filter((part) => [true, "true"].includes(part.state?.input?.background))
  const loops = shells.filter((part) => SLEEP_LOOP.test(part.state?.input?.command ?? ""))
  const tokens = (session) => ({
    id: session.info.id,
    agent: session.info.agent,
    output: session.info.tokens?.output ?? 0,
    cache_read: session.info.tokens?.cache?.read ?? 0,
    input: session.info.tokens?.input ?? 0,
  })
  const perSession = sessions.map(tokens)
  const sum = (key) => perSession.reduce((total, row) => total + row[key], 0)
  return {
    capped,
    wall_ms: capped ? capMs : sent && lastDone ? lastDone - sent : null,
    first_report_ms: sent && report?.time?.created ? report.time.created - sent : null,
    reports_to_root: reports.length,
    premature_report_ms: sent && premature?.time?.created ? premature.time.created - sent : null,
    worker_outcome: reports.length ? outcomeOf(reports.at(-1)) : "none",
    spawns: children.length,
    bg_shell_calls: background.length,
    bg_shell_rejected: background.filter(rejected).length,
    sleep_loop_calls: loops.length,
    sleep_loop_minutes: Math.round((loops.reduce((total, part) => total + duration(part), 0) / 60000) * 100) / 100,
    sleep_loop_rejected: loops.filter(rejected).length,
    tool_errors: tools.filter((part) => part.state?.status === "error").length,
    tokens_output: sum("output"),
    tokens_cache_read: sum("cache_read"),
    tokens_input: sum("input"),
    sessions: perSession,
  }
}

async function runOne(index) {
  const id = `${options.label}-${index + 1}`
  const record = { id, label: options.label, agent: options.agent, brief: options.brief, worker_model: options["worker-model"], model: options.model, lock_held_s: LOCK_SECONDS }
  console.log(`start ${id}`)
  const up = await harness(["up"], { PSTACK_VERIFY_SEED: PROJECT_SEED, PSTACK_VERIFY_MODELS: options.models })
  const runDir = field(up.out, "run")
  let holder
  try {
    if (up.code !== 0) throw new Error(`up exited ${up.code}: ${tail(up.out)}`)
    const env = { PSTACK_VERIFY_RUN: runDir, PSTACK_VERIFY_TIMEOUT: String(CAP_MS) }
    if (LOCK_SECONDS > 0) holder = holdLock(field(up.out, "project"), LOCK_SECONDS)
    const start = await harness(["start", "--agent", "poteto-mode", "--model", options.model, rootPrompt], env)
    const sessionID = field(start.out, "session")
    if (start.code !== 0 || !sessionID) throw new Error(`start exited ${start.code}: ${tail(start.out)}`)
    const tree = await harness(["tree", sessionID], env)
    const proof = field(tree.out, "proof")
    if (!proof || !existsSync(proof)) throw new Error(`tree exited ${tree.code} with no saved tree: ${tail(tree.out)}`)
    const saved = join(outDir, "trees", `${id}.json`)
    mkdirSync(join(outDir, "trees"), { recursive: true })
    copyFileSync(proof, saved)
    Object.assign(record, measure(JSON.parse(readFileSync(proof, "utf8")), tree.code === TIMED_OUT, CAP_MS), { tree: saved })
    if (tree.code !== 0 && tree.code !== TIMED_OUT) record.error = `tree exited ${tree.code}: ${tail(tree.out)}`
  } catch (error) {
    record.error = error.message
  } finally {
    if (holder) killGroup(holder)
    if (runDir) {
      const down = await harness(["down"], { PSTACK_VERIFY_RUN: runDir })
      if (down.code !== 0) record.error ??= `down exited ${down.code}: ${tail(down.out)}`
    } else record.error ??= `up printed no run folder: ${tail(up.out)}`
  }
  appendFileSync(join(outDir, "runs.jsonl"), `${JSON.stringify(record)}\n`)
  console.log(`done  ${id} ${JSON.stringify({ ...record, sessions: undefined })}`)
  return record
}

function stats(values) {
  const sorted = values.filter((value) => typeof value === "number").sort((a, b) => a - b)
  if (!sorted.length) return null
  const middle = sorted.length >> 1
  return {
    n: sorted.length,
    mean: Math.round(sorted.reduce((total, value) => total + value, 0) / sorted.length),
    median: sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2),
    min: sorted[0],
    max: sorted.at(-1),
  }
}

const NUMERIC = ["wall_ms", "first_report_ms", "reports_to_root", "premature_report_ms", "spawns", "bg_shell_calls", "bg_shell_rejected", "sleep_loop_calls", "sleep_loop_minutes", "sleep_loop_rejected", "tool_errors", "tokens_output", "tokens_cache_read", "tokens_input"]

function summarize(records, meta) {
  const count = (test) => records.filter(test).length
  return {
    ...meta,
    runs: records.length,
    errors: count((record) => record.error),
    capped: count((record) => record.capped),
    outcomes: { result: count((record) => record.worker_outcome === "result"), blocked: count((record) => record.worker_outcome === "blocked"), none: count((record) => record.worker_outcome === "none") },
    ...Object.fromEntries(NUMERIC.map((key) => [key, stats(records.map((record) => record[key]))])),
  }
}

const readJsonl = (path) => readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))

function rescore(dir) {
  const old = new Map(readJsonl(join(dir, "runs.jsonl")).map((record) => [record.id, record]))
  const { label, agent, brief, worker_model, model, lock_held_s, cap_ms } = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"))
  const records = readdirSync(join(dir, "trees"))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const tree = join(dir, "trees", name)
      const record = old.get(basename(name, ".json"))
      return { ...record, ...measure(JSON.parse(readFileSync(tree, "utf8")), record.capped, cap_ms), tree }
    })
  writeFileSync(join(dir, "runs.jsonl"), records.map((record) => `${JSON.stringify(record)}\n`).join(""))
  const summary = summarize(records, { label, agent, brief, worker_model, model, lock_held_s, cap_ms })
  writeFileSync(join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`)
  const sumOf = (key) => records.reduce((sum, record) => sum + (record[key] ?? 0), 0)
  return [
    `${basename(dirname(dir))}/${summary.label}`,
    summary.runs,
    `r${summary.outcomes.result}/b${summary.outcomes.blocked}/n${summary.outcomes.none}`,
    summary.first_report_ms?.median ?? "n/a",
    records.filter((record) => record.premature_report_ms !== null).length,
    (sumOf("reports_to_root") / records.length).toFixed(2),
    sumOf("bg_shell_calls"),
    sumOf("bg_shell_rejected"),
    Math.round(sumOf("sleep_loop_minutes") * 100) / 100,
    summary.tokens_cache_read?.median ?? "n/a",
    summary.tokens_output?.median ?? "n/a",
  ]
}

if (options.rescore) {
  const header = ["arm", "runs", "outcomes", "first_report_ms_med", "premature", "reports_mean", "bg_calls", "bg_rejected", "sleep_loop_min", "cache_read_med", "output_med"]
  const rows = [header, ...options.rescore.map((dir) => rescore(resolve(dir)).map(String))]
  const widths = header.map((_, column) => Math.max(...rows.map((row) => row[column].length)))
  for (const row of rows) console.log(row.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd())
} else {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "runs.jsonl"), "")
  const runs = Number(options.runs)
  const records = []
  let next = 0
  await Promise.all(
    Array.from({ length: Math.max(1, Number(options.parallel)) }, async () => {
      while (next < runs) records.push(await runOne(next++))
    }),
  )
  const summary = summarize(records, { label: options.label, agent: options.agent, brief: options.brief, worker_model: options["worker-model"], model: options.model, lock_held_s: LOCK_SECONDS, cap_ms: CAP_MS })
  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`)
  const line = (key) => `${key}=${summary[key]?.median ?? "n/a"}`
  console.log(`summary ${options.label} runs=${summary.runs} errors=${summary.errors} capped=${summary.capped} outcomes=${JSON.stringify(summary.outcomes)} median: ${["wall_ms", "first_report_ms", "reports_to_root", "premature_report_ms", "spawns", "sleep_loop_calls", "tool_errors", "tokens_output", "tokens_cache_read"].map(line).join(" ")}\nproof   ${outDir}`)
}
