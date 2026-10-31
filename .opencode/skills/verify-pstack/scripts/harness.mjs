#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process"
import { closeSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = realpathSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".."))
const SRC = join(REPO, "src")
const BASE = join(existsSync(join(tmpdir(), "opencode")) ? join(tmpdir(), "opencode") : tmpdir(), "pstack-verify")
const LATEST = join(BASE, "latest")
const MODEL = process.env.PSTACK_VERIFY_MODEL ?? "claude-agent/haiku"
const TIMEOUT = Number(process.env.PSTACK_VERIFY_TIMEOUT ?? 600_000)
const SETTLE_MS = 10_000
const TIMED_OUT = 124
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function die(message) {
  console.log(`FAIL ${message}`)
  process.exit(1)
}

function loadState() {
  const runDir = process.env.PSTACK_VERIFY_RUN ?? (existsSync(LATEST) ? readFileSync(LATEST, "utf8").trim() : undefined)
  if (!runDir || !existsSync(join(runDir, "state.json"))) die("no running harness. Run `harness.mjs up` first.")
  return JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"))
}

// `opencode run` files its session under $PWD, not the process cwd, so PWD must name the test project too.
const envFor = (state) => ({ ...process.env, PWD: state.proj, XDG_CONFIG_HOME: state.config, OPENCODE_PASSWORD: state.password })

// `opencode api` output is cut at 64 KiB when piped, so every call writes to a file and reads it back.
function apiCall(state, args, timeout) {
  const out = join(state.runDir, `api-${process.pid}-${Date.now()}.json`)
  const fd = openSync(out, "w")
  const result = spawnSync("opencode", ["api", "--server", state.url, ...args], { cwd: state.proj, env: envFor(state), stdio: ["ignore", fd, "pipe"], encoding: "utf8", timeout })
  closeSync(fd)
  const text = readFileSync(out, "utf8")
  rmSync(out)
  return { status: result.status, text, stderr: result.stderr }
}

function api(state, args) {
  const { status, text, stderr } = apiCall(state, args)
  if (status !== 0) die(`opencode api ${args.join(" ")} exited ${status}: ${(stderr || text).trim().slice(0, 400)}`)
  const json = text.trim() ? JSON.parse(text) : undefined
  return json?.data ?? json
}

const sessionInfo = (state, sessionID) => api(state, ["session.get", "--param", `sessionID=${sessionID}`])
const isIdle = (info) => !info.time.busy || (info.time.idle ?? 0) >= info.time.busy
const descendants = (state, sessionID) => api(state, ["session.list", "--param", `parentID=${sessionID}`]).flatMap((child) => [child, ...descendants(state, child.id)])

async function waitIdle(state, sessionID, deadline) {
  while (Date.now() < deadline) {
    apiCall(state, ["experimental.session.wait", "--param", `sessionID=${sessionID}`], deadline - Date.now())
    if (isIdle(sessionInfo(state, sessionID))) return true
    await sleep(1000)
  }
  return false
}

// A background child's report wakes its parent after the child goes idle, so the tree is settled only once nothing in it changes across a quiet window.
async function settle(state, sessionID, deadline) {
  let quiet
  while (Date.now() < deadline) {
    const tree = [sessionInfo(state, sessionID), ...descendants(state, sessionID)]
    const busy = tree.find((info) => !isIdle(info))
    if (busy) {
      quiet = undefined
      await waitIdle(state, busy.id, deadline)
      continue
    }
    const mark = tree.map((info) => `${info.id}@${info.time.updated}`).join(" ")
    if (mark === quiet) return true
    quiet = mark
    await sleep(SETTLE_MS)
  }
  return false
}

const locationQuery = (state) => `location%5Bdirectory%5D=${encodeURIComponent(state.proj)}`
const srcSkills = () => readdirSync(join(SRC, "skills")).filter((name) => existsSync(join(SRC, "skills", name, "SKILL.md")))
const pstackSkills = (state) => api(state, ["GET", `/api/skill?${locationQuery(state)}`]).filter((skill) => skill.path.startsWith(join(SRC, "skills")))
const evidencePath = (state, name) => join(state.evidence, name)

function save(state, name, value) {
  const path = evidencePath(state, name)
  writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`)
  return path
}

function projectSessions(state) {
  const out = join(state.runDir, "sessions.json")
  const fd = openSync(out, "w")
  spawnSync("opencode", ["session", "list", "--server", state.url, "--format", "json", "-n", "200"], { cwd: state.proj, env: envFor(state), stdio: ["ignore", fd, "pipe"] })
  closeSync(fd)
  const sessions = JSON.parse(readFileSync(out, "utf8") || "[]")
  rmSync(out)
  return sessions.filter((session) => existsSync(session.directory) && realpathSync(session.directory) === state.proj)
}

function summarize(exported) {
  const lines = []
  for (const message of exported.messages) {
    if (message.type === "user") {
      lines.push(`user   skills=${JSON.stringify((message.skills ?? []).map((skill) => skill.id))} text=${JSON.stringify(message.text).slice(0, 300)}`)
      continue
    }
    if (message.type !== "assistant") {
      lines.push(message.type)
      continue
    }
    for (const part of Array.isArray(message.content) ? message.content : []) {
      if (part.type === "tool") lines.push(`tool   ${part.name} ${JSON.stringify(part.state?.input ?? {}).slice(0, 200)}`)
      if (part.type === "text") lines.push(`reply  ${part.text.replace(/\s+/g, " ").slice(0, 600)}`)
    }
  }
  return lines.join("\n")
}

function exportSession(state, sessionID) {
  const out = join(state.runDir, `export-${sessionID}.json`)
  const fd = openSync(out, "w")
  const result = spawnSync("opencode", ["session", "export", "--server", state.url, sessionID], { cwd: state.proj, env: envFor(state), stdio: ["ignore", fd, "pipe"], encoding: "utf8" })
  closeSync(fd)
  if (result.status !== 0) die(`session export ${sessionID} exited ${result.status}: ${result.stderr.trim()}`)
  const exported = JSON.parse(readFileSync(out, "utf8"))
  rmSync(out)
  save(state, `session-${sessionID}.json`, exported)
  return exported
}

function modelRef(spec) {
  const [path, variant] = spec.split("#")
  const slash = path.indexOf("/")
  return { providerID: path.slice(0, slash), id: path.slice(slash + 1), ...(variant ? { variant } : {}) }
}

function flagValue(args, name, fallback) {
  const index = args.indexOf(name)
  if (index < 0) return fallback
  const [value] = args.splice(index, 2).slice(1)
  return value
}

const commands = {
  async up() {
    mkdirSync(BASE, { recursive: true })
    const runDir = realpathSync(mkdtempSync(join(BASE, "run-")))
    const config = join(runDir, "config")
    const proj = join(runDir, "proj")
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const evidence = join(REPO, "verify-evidence", stamp)
    console.log(`run     ${runDir}`)
    mkdirSync(join(config, "opencode"), { recursive: true })
    mkdirSync(proj)
    mkdirSync(evidence, { recursive: true })

    const install = spawnSync("node", [join(REPO, "scripts", "install.mjs")], { env: { ...process.env, XDG_CONFIG_HOME: config }, encoding: "utf8" })
    if (install.status !== 0) die(`install.mjs exited ${install.status}: ${install.stdout}${install.stderr}`)
    writeFileSync(join(config, "opencode", "opencode.json"), `${JSON.stringify({ experimental: { todo: true, subagent_depth: 2 } }, null, 2)}\n`)
    if (process.env.PSTACK_VERIFY_MODELS) copyFileSync(process.env.PSTACK_VERIFY_MODELS, join(config, "opencode", "pstack-models.md"))

    // A repo with no commit shares one project ID with every other commitless repo, which mixes their sessions into ours.
    if (process.env.PSTACK_VERIFY_SEED) cpSync(process.env.PSTACK_VERIFY_SEED, proj, { recursive: true })
    else writeFileSync(join(proj, "math.js"), "export const add = (a, b) => a + b\n")
    for (const args of [["init", "-q"], ["add", "-A"], ["-c", "user.email=verify@pstack", "-c", "user.name=verify", "commit", "-qm", "seed"]]) {
      if (spawnSync("git", args, { cwd: proj }).status !== 0) die(`git ${args.join(" ")} failed in ${proj}`)
    }

    const log = openSync(join(runDir, "serve.log"), "w")
    const server = spawn("opencode", ["serve", "--hostname", "127.0.0.1", "--port", "0"], { cwd: proj, env: { ...process.env, PWD: realpathSync(proj), XDG_CONFIG_HOME: config }, stdio: ["ignore", log, log], detached: true })
    server.unref()
    closeSync(log)
    const state = { pid: server.pid, runDir, config, proj: realpathSync(proj), evidence, url: undefined, password: undefined }
    writeFileSync(join(runDir, "state.json"), JSON.stringify(state))
    writeFileSync(LATEST, runDir)

    for (let waited = 0; !state.password; waited += 250) {
      if (waited > 30_000) die(`server did not start in 30s. See ${join(runDir, "serve.log")}, then run \`harness.mjs down\`.`)
      await sleep(250)
      const text = readFileSync(join(runDir, "serve.log"), "utf8")
      state.url = text.match(/server listening on (\S+)/)?.[1]
      state.password = text.match(/server password (\S+)/)?.[1]
    }
    writeFileSync(join(runDir, "state.json"), JSON.stringify(state))

    // Ready means the plugin finished registering every skill at the project location, not that the port answers.
    const want = srcSkills().length
    let have = 0
    for (let waited = 0; have < want; waited += 1000) {
      if (waited > 60_000) die(`only ${have} of ${want} pstack skills registered after 60s. Run \`harness.mjs doctor\`, then \`harness.mjs down\`.`)
      await sleep(1000)
      have = pstackSkills(state).length
    }
    console.log(`ready   ${state.url} (pid ${state.pid}, ${have} pstack skills)`)
    console.log(`project ${state.proj}`)
    console.log(`config  ${join(config, "opencode")}`)
    console.log(`proof   ${evidence}`)
  },

  async doctor() {
    const state = loadState()
    const checks = []
    const check = (ok, label) => checks.push(`${ok ? "ok  " : "FAIL"} ${label}`)
    let alive = false
    try {
      process.kill(state.pid, 0)
      alive = true
    } catch {}
    check(alive, `server process ${state.pid} started by this run is alive`)
    if (alive) {
      const info = api(state, ["GET", "/api/info"])
      check(Boolean(info), `server ${state.url} answers /api/info${info?.version ? ` (OpenCode ${info.version})` : ""}`)
      const skills = pstackSkills(state)
      check(skills.length === srcSkills().length, `${skills.length} of ${srcSkills().length} pstack skills registered from ${join(SRC, "skills")}`)
      const agents = api(state, ["GET", `/api/agent?${locationQuery(state)}`])
      const modes = Object.fromEntries(agents.map((agent) => [agent.id, agent.mode]))
      check(modes["poteto-mode"] === "primary" && modes["poteto-agent"] === "subagent" && modes["comment-sicko"] === "subagent", `agents poteto-mode=${modes["poteto-mode"]} poteto-agent=${modes["poteto-agent"]} comment-sicko=${modes["comment-sicko"]}`)
      const names = new Set(api(state, ["GET", `/api/command?${locationQuery(state)}`]).map((command) => command.name))
      const expected = srcSkills().filter((name) => !name.startsWith("principle-"))
      const missing = expected.filter((name) => !names.has(name))
      check(missing.length === 0, `${expected.length - missing.length} of ${expected.length} pstack commands registered${missing.length ? `, missing ${missing.join(", ")}` : ""}`)
    }
    console.log(checks.join("\n"))
    if (checks.some((line) => line.startsWith("FAIL"))) process.exit(1)
  },

  async run(args) {
    const state = loadState()
    const before = new Set(projectSessions(state).map((session) => session.id))
    const model = args.includes("--model") || args.includes("-m") ? [] : ["--model", MODEL]
    const result = spawnSync("opencode", ["run", "--server", state.url, ...model, ...args], { cwd: state.proj, env: envFor(state), encoding: "utf8", timeout: TIMEOUT })
    const after = projectSessions(state)
    const created = after.find((session) => !before.has(session.id)) ?? [...after].sort((a, b) => b.updated - a.updated)[0]
    const exit = result.error?.code === "ETIMEDOUT" ? `timeout after ${TIMEOUT}ms` : result.status
    const output = `$ opencode run ${[...model, ...args].map((arg) => JSON.stringify(arg)).join(" ")}\nexit ${exit}\n\n${result.stdout}${result.stderr}`
    const file = save(state, `run-${created?.id ?? Date.now()}.txt`, output)
    console.log(output.trimEnd())
    console.log(`\nsession ${created?.id ?? "unknown"}\nproof   ${file}`)
    if (result.error?.code === "ETIMEDOUT") process.exit(TIMED_OUT)
    if (result.status !== 0) process.exit(result.status ?? 1)
  },

  async command(args) {
    const state = loadState()
    const agent = flagValue(args, "--agent", "build")
    const model = flagValue(args, "--model", MODEL)
    const [name, ...words] = args
    if (!name) die("usage: harness.mjs command <name> [--agent id] [--model provider/model#variant] <text...>")
    const session = api(state, ["session.create", "--data", JSON.stringify({ title: `verify /${name}`, agent, model: modelRef(model), location: { directory: state.proj } })])
    api(state, ["session.command", "--param", `sessionID=${session.id}`, "--data", JSON.stringify({ name, text: words.join(" ") })])
    const idle = await waitIdle(state, session.id, Date.now() + TIMEOUT)
    const summary = summarize(exportSession(state, session.id))
    save(state, `command-${name}-${session.id}.txt`, `/${name} ${words.join(" ")}\nagent ${agent} model ${model}\n${idle ? "" : `timeout after ${TIMEOUT}ms\n`}\n${summary}\n`)
    console.log(`session ${session.id}\n${summary}\nproof   ${evidencePath(state, `command-${name}-${session.id}.txt`)}`)
    if (!idle) process.exit(TIMED_OUT)
  },

  async tree([sessionID]) {
    const state = loadState()
    if (!sessionID) die("usage: harness.mjs tree <sessionID>")
    const settled = await settle(state, sessionID, Date.now() + TIMEOUT)
    const withEntries = (id) => ({ ...exportSession(state, id), entries: api(state, ["experimental.session.instructions.entry.list", "--param", `sessionID=${id}`]) })
    const parent = withEntries(sessionID)
    const children = descendants(state, sessionID).map((child) => withEntries(child.id))
    const file = save(state, `tree-${sessionID}.json`, { parent, children })
    console.log(`${settled ? "settled" : `timeout after ${TIMEOUT}ms`} ${1 + children.length} sessions\nproof   ${file}`)
    if (!settled) process.exit(TIMED_OUT)
  },

  async export([sessionID]) {
    const state = loadState()
    if (!sessionID) die("usage: harness.mjs export <sessionID>")
    console.log(`${summarize(exportSession(state, sessionID))}\nproof   ${evidencePath(state, `session-${sessionID}.json`)}`)
  },

  async entries([sessionID]) {
    const state = loadState()
    if (!sessionID) die("usage: harness.mjs entries <sessionID>")
    const entries = api(state, ["experimental.session.instructions.entry.list", "--param", `sessionID=${sessionID}`])
    const file = save(state, `entries-${sessionID}.json`, entries)
    for (const { key, value } of entries) console.log(`${key}\n${String(value).replace(/^/gm, "  ")}`)
    console.log(`${entries.length} entries\nproof   ${file}`)
  },

  async children([sessionID]) {
    const state = loadState()
    if (!sessionID) die("usage: harness.mjs children <sessionID>")
    const children = api(state, ["session.list", "--param", `parentID=${sessionID}`])
    for (const child of children) console.log(`${child.id} agent=${child.agent} title=${JSON.stringify(child.title)}`)
    console.log(`${children.length} children`)
  },

  async skill([id]) {
    const state = loadState()
    if (!id) die("usage: harness.mjs skill <id>")
    const skill = api(state, ["GET", `/api/skill?${locationQuery(state)}`]).find((entry) => entry.id === id)
    console.log(skill ? `${id} -> ${skill.path} autoinvoke=${skill.autoinvoke ?? true}` : `${id} is not registered`)
  },

  async env() {
    const state = loadState()
    console.log(`export PSTACK_VERIFY_RUN=${JSON.stringify(state.runDir)}`)
    console.log(`export PSTACK_VERIFY_PROJECT=${JSON.stringify(state.proj)}`)
    console.log(`export PSTACK_VERIFY_CONFIG=${JSON.stringify(join(state.config, "opencode"))}`)
    console.log(`export PSTACK_VERIFY_EVIDENCE=${JSON.stringify(state.evidence)}`)
  },

  async down() {
    const state = loadState()
    let alive = false
    try {
      process.kill(state.pid, 0)
      alive = true
    } catch {}
    if (alive && state.url) {
      // Sessions live in the shared OpenCode database, so remove the ones this run's project created.
      for (const session of projectSessions(state)) {
        api(state, ["session.remove", "--param", `sessionID=${session.id}`])
        console.log(`removed session ${session.id}`)
      }
    }
    if (alive) {
      process.kill(state.pid, "SIGTERM")
      for (let waited = 0; waited < 5000; waited += 250) {
        await sleep(250)
        try {
          process.kill(state.pid, 0)
        } catch {
          alive = false
          break
        }
      }
      if (alive) process.kill(state.pid, "SIGKILL")
      console.log(`stopped server ${state.pid}`)
    }
    rmSync(state.runDir, { recursive: true, force: true })
    if (existsSync(LATEST) && readFileSync(LATEST, "utf8").trim() === state.runDir) rmSync(LATEST)
    console.log(`removed ${state.runDir}`)
    const kept = existsSync(state.evidence) ? readdirSync(state.evidence).length : 0
    console.log(`proof   ${state.evidence} (${kept} files kept)`)
  },
}

const [name, ...args] = process.argv.slice(2)
if (!commands[name]) {
  console.log("usage: harness.mjs up | doctor | run <opencode run args> | command <name> [--agent a] [--model m] <text> | export <sid> | tree <sid> | entries <sid> | children <sid> | skill <id> | env | down")
  process.exit(name ? 1 : 0)
}
await commands[name](args)
