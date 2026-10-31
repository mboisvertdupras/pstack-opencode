#!/usr/bin/env node

import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { report, scenarios, summarize } from "./routing-score.mjs"

const HARNESS = join(import.meta.dirname, "harness.mjs")
const SEED = join(import.meta.dirname, "..", "fixtures", "invoicing")
const MODELS = join(homedir(), ".config", "opencode", "pstack-models.md")
const TIMED_OUT = 124

const { values: options } = parseArgs({
  options: {
    label: { type: "string" },
    runs: { type: "string", default: "1" },
    scenarios: { type: "string", default: Object.keys(scenarios).join(",") },
    parallel: { type: "string", default: "1" },
    model: { type: "string", default: "claude-agent/haiku" },
    out: { type: "string", default: join(import.meta.dirname, "..", "..", "..", "..", "verify-evidence", "routing") },
    timeout: { type: "string" },
    rescore: { type: "string" },
  },
})

const drives = {
  run: ({ agent }, model, prompt) => ["run", "--agent", agent, "--model", model, prompt],
  command: ({ command, agent }, model, prompt) => ["command", command, "--agent", agent, "--model", model, prompt],
}

function harness(args, env) {
  return new Promise((done) => {
    const child = spawn("node", [HARNESS, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    child.stdout.on("data", (chunk) => (out += chunk))
    child.stderr.on("data", (chunk) => (out += chunk))
    child.on("close", (code) => done({ code, out }))
  })
}

// Transcripts are echoed before the harness's own trailer, so the last match is the harness's.
const lastField = (out, name) => [...out.matchAll(new RegExp(`^${name} +(\\S+)`, "gm"))].at(-1)?.[1]
const tail = (out) => out.trim().split("\n").slice(-5).join(" | ")

async function runOne(scenario, index, { label, model, timeoutMs, runsDir }) {
  const spec = scenarios[scenario]
  const id = `${scenario}-${index + 1}-${Date.now().toString(36)}`
  const started = Date.now()
  const deadline = started + (timeoutMs ?? spec.timeoutMs)
  const remaining = () => String(Math.max(1000, deadline - Date.now()))
  const record = { id, scenario, label, model, sessionTree: undefined, exit: undefined }
  console.log(`start ${id}`)

  const up = await harness(["up"], { PSTACK_VERIFY_SEED: SEED, ...(existsSync(MODELS) ? { PSTACK_VERIFY_MODELS: MODELS } : {}) })
  const runDir = lastField(up.out, "run")
  try {
    if (up.code !== 0) throw new Error(`up exited ${up.code}: ${tail(up.out)}`)
    const drive = await harness(drives[spec.drive.via](spec.drive, model, spec.prompt), { PSTACK_VERIFY_RUN: runDir, PSTACK_VERIFY_TIMEOUT: remaining() })
    record.exit = drive.code
    if (drive.code === TIMED_OUT) record.error = `timeout after ${Date.now() - started}ms while driving`
    else if (drive.code !== 0) record.error = `${spec.drive.via} exited ${drive.code}: ${tail(drive.out)}`
    const sessionID = lastField(drive.out, "session")
    if (!sessionID || sessionID === "unknown") throw new Error(`no session id from ${spec.drive.via}: ${tail(drive.out)}`)
    const tree = await harness(["tree", sessionID], { PSTACK_VERIFY_RUN: runDir, PSTACK_VERIFY_TIMEOUT: remaining() })
    const proof = lastField(tree.out, "proof")
    if (proof && existsSync(proof)) record.sessionTree = JSON.parse(readFileSync(proof, "utf8"))
    if (tree.code === TIMED_OUT) record.error ??= `timeout after ${Date.now() - started}ms waiting for the session tree to settle`
    else if (tree.code !== 0) record.error ??= `tree exited ${tree.code}: ${tail(tree.out)}`
  } catch (error) {
    record.error ??= error.message
  } finally {
    if (runDir) {
      const down = await harness(["down"], { PSTACK_VERIFY_RUN: runDir })
      if (down.code !== 0) record.error ??= `down exited ${down.code}: ${tail(down.out)}`
    } else record.error ??= `up printed no run folder: ${tail(up.out)}`
  }

  record.durationMs = Date.now() - started
  writeFileSync(join(runsDir, `${id}.json`), `${JSON.stringify(record)}\n`)
  const sessions = record.sessionTree ? 1 + record.sessionTree.children.length : 0
  console.log(`done  ${id} exit=${record.exit} sessions=${sessions} ${Math.round(record.durationMs / 1000)}s${record.error ? ` error=${JSON.stringify(record.error)}` : ""}`)
  return record
}

function readRecords(dir) {
  const runsDir = existsSync(join(dir, "runs")) ? join(dir, "runs") : dir
  return readdirSync(runsDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(runsDir, name), "utf8")))
}

function finish(dir, records, planned, meta) {
  const summary = summarize(records, planned)
  writeFileSync(join(dir, "summary.json"), `${JSON.stringify({ ...meta, ...summary }, null, 2)}\n`)
  console.log(report(summary))
}

if (options.rescore) {
  const dir = resolve(options.rescore)
  const records = readRecords(dir)
  finish(dir, records, records.length, { rescored: new Date().toISOString(), labels: [...new Set(records.map((record) => record.label))] })
} else {
  if (!options.label) throw new Error("--label <arm> is required")
  const names = options.scenarios.split(",").map((name) => name.trim())
  const unknown = names.filter((name) => !scenarios[name])
  if (unknown.length) throw new Error(`unknown scenarios ${unknown.join(", ")}. Known: ${Object.keys(scenarios).join(", ")}`)
  if (!existsSync(MODELS)) console.log(`warn  ${MODELS} is missing, so runs use the skill default models`)

  const dir = join(resolve(options.out), options.label)
  const runsDir = join(dir, "runs")
  mkdirSync(runsDir, { recursive: true })
  const settings = { label: options.label, model: options.model, timeoutMs: options.timeout ? Number(options.timeout) : undefined, runsDir }
  const jobs = Array.from({ length: Number(options.runs) }, (_, index) => names.map((name) => [name, index])).flat()
  const records = []
  let next = 0
  await Promise.all(
    Array.from({ length: Math.max(1, Number(options.parallel)) }, async () => {
      while (next < jobs.length) {
        const [name, index] = jobs[next++]
        records.push(await runOne(name, index, settings))
      }
    }),
  )
  finish(dir, records, jobs.length, { label: options.label, model: options.model, scenarios: names, runs: Number(options.runs) })
}
