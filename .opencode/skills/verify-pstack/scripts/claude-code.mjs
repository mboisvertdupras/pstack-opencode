import { spawn, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { sessionTree } from "./claude-stream.mjs"
import { catalogOf, decided } from "./routing-score.mjs"

export const PIN = { repo: "https://github.com/michael-denyer/pstack-claude.git", sha: "513c0886b79abb04065293581a4ef7e70049e4f2" }
const VENDOR = join(import.meta.dirname, "..", "vendor", "pstack-claude")
const PLUGIN = join(VENDOR, "plugins", "pstack")
const KILL_GRACE_MS = 5000

const git = (args, cwd) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} exited ${result.status}: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

export function ensurePin() {
  if (!existsSync(join(VENDOR, ".git"))) {
    mkdirSync(VENDOR, { recursive: true })
    git(["init", "-q"], VENDOR)
    git(["remote", "add", "origin", PIN.repo], VENDOR)
  }
  if (spawnSync("git", ["rev-parse", "HEAD"], { cwd: VENDOR, encoding: "utf8" }).stdout.trim() !== PIN.sha) {
    git(["fetch", "-q", "--depth", "1", "origin", PIN.sha], VENDOR)
    git(["checkout", "-q", "--detach", "FETCH_HEAD"], VENDOR)
  }
  const version = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version
  const skills = join(PLUGIN, "skills")
  const ids = readdirSync(skills).filter((name) => existsSync(join(skills, name, "SKILL.md")))
  return { sha: git(["rev-parse", "HEAD"], VENDOR), version, plugin: PLUGIN, catalog: catalogOf(skills, ids) }
}

export function claudeModel(spec) {
  const [path, effort] = spec.split("#")
  const [provider, model] = path.split("/")
  if (provider !== "claude-agent" || !model) throw new Error(`--model ${spec} has no Claude Code equivalent; use claude-agent/<alias>[#effort]`)
  return { model, effort }
}

export function stopFor(stream, context) {
  if (decided(sessionTree(stream, context))) return "decision"
  const started = stream.filter((event) => event.subtype === "task_started").map((event) => event.task_id)
  const ended = new Set(stream.filter((event) => event.subtype === "task_notification").map((event) => event.task_id))
  if (stream.at(-1)?.type === "result" && started.every((id) => ended.has(id))) return "idle"
  return undefined
}

function isolation(init, pluginRoot) {
  if (!init) return "no init event"
  const plugins = init.plugins ?? []
  const foreign = plugins.filter((plugin) => !(plugin.source === "pstack@inline" && realpathSync(plugin.path) === pluginRoot) && !plugin.source.endsWith("@builtin"))
  const userSkills = existsSync(join(homedir(), ".claude", "skills")) ? readdirSync(join(homedir(), ".claude", "skills")) : []
  const leaked = (init.skills ?? []).filter((skill) => userSkills.includes(skill))
  if (!plugins.some((plugin) => plugin.source === "pstack@inline")) return "pstack plugin did not load"
  if (foreign.length) return `foreign plugins ${foreign.map((plugin) => plugin.source).join(", ")}`
  if (leaked.length) return `user skills loaded ${leaked.join(", ")}`
  return undefined
}

function seedProject(proj, seed) {
  cpSync(seed, proj, { recursive: true })
  for (const args of [["init", "-q"], ["add", "-A"], ["-c", "user.email=verify@pstack", "-c", "user.name=verify", "commit", "-qm", "seed"]]) git(args, proj)
}

const groupAlive = (pid) => {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

export async function driveClaude({ pin, seed, prompt, context, model, effort, budgetMs }) {
  const runDir = realpathSync(mkdtempSync(join(tmpdir(), "pstack-cc-")))
  const proj = join(runDir, "proj")
  // poteto-agent finds poteto-mode by searching the plugin cache, so the cache holds only the pin.
  const cache = join(runDir, "cache")
  const pluginRoot = join(cache, "pstack-claude", "pstack", pin.version)
  seedProject(proj, seed)
  cpSync(pin.plugin, pluginRoot, { recursive: true })

  const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-hook-events", "--model", model, ...(effort ? ["--effort", effort] : [])]
  args.push("--plugin-dir", pluginRoot, "--setting-sources", "", "--strict-mcp-config", "--no-session-persistence", "--permission-mode", "bypassPermissions", prompt)
  const env = { ...process.env, CLAUDE_CODE_PLUGIN_CACHE_DIR: cache, CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", CLAUDE_CODE_ENABLE_TODO_TOOLS: "1" }
  const child = spawn("claude", args, { cwd: proj, env, detached: true, stdio: ["ignore", "pipe", "pipe"] })

  const stream = []
  let stoppedBy
  let stderr = ""
  let buffered = ""
  const stop = (reason) => {
    if (stoppedBy) return
    stoppedBy = reason
    if (groupAlive(child.pid)) process.kill(-child.pid, "SIGTERM")
  }
  const budget = setTimeout(() => stop("budget"), budgetMs)
  child.stderr.on("data", (chunk) => (stderr += chunk))
  child.stdout.on("data", (chunk) => {
    buffered += chunk
    const lines = buffered.split("\n")
    buffered = lines.pop()
    for (const line of lines.filter(Boolean)) {
      stream.push(JSON.parse(line))
      const reason = !stoppedBy && stopFor(stream, context)
      if (reason) stop(reason)
    }
  })
  const exit = await new Promise((done) => child.on("close", (code, signal) => done(code ?? signal)))
  clearTimeout(budget)
  for (let waited = 0; groupAlive(child.pid) && waited < KILL_GRACE_MS; waited += 250) await new Promise((done) => setTimeout(done, 250))
  const leftover = groupAlive(child.pid)
  if (leftover) process.kill(-child.pid, "SIGKILL")

  const init = stream.find((event) => event.subtype === "init")
  const isolated = isolation(init, pluginRoot)
  const slug = proj.replace(/[^a-zA-Z0-9]/g, "-")
  const history = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects", slug)
  rmSync(join("/tmp", `claude-${process.getuid()}`, slug), { recursive: true, force: true })
  rmSync(runDir, { recursive: true, force: true })

  const error =
    isolated ??
    (leftover ? `claude process group ${child.pid} outlived the stop` : undefined) ??
    (existsSync(history) ? `the run wrote Claude history at ${history}` : undefined) ??
    (!stoppedBy && exit !== 0 ? `claude exited ${exit}: ${stderr.trim().slice(-400)}` : undefined)
  return {
    exit: stoppedBy ? 0 : exit,
    stoppedBy: stoppedBy ?? (stream.at(-1)?.type === "result" ? "idle" : undefined),
    error,
    stream,
    init: init && { model: init.model, plugins: init.plugins, skills: init.skills, slash_commands: init.slash_commands, agents: init.agents, tools: init.tools },
    sessionStart: stream.filter((event) => event.subtype === "hook_response" && event.hook_event === "SessionStart").map((event) => event.output),
  }
}
