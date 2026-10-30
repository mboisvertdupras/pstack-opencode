#!/usr/bin/env node

import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, posix, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { parseFrontmatter } from "../src/plugin/lib.js"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SRC = join(ROOT, "src")
const OUT = join(ROOT, "dist")
const CACHE = join(ROOT, ".upstream")
const UPSTREAM_FILE = join(ROOT, "upstream.json")
const PINS_FILE = join(SRC, "pins.json")
const ADAPTER = "docs/harness/opencode.md"
const GUIDE = "docs/guide"
const VENDORED = { "cursor-team-kit": ["deslop", "control-cli", "control-ui"] }
const AGENTS = ["poteto-agent", "poteto-mode"]
// Upstream files that src/ adapts by hand. A change to one fails the build until someone reviews it and reruns with --repin.
const PINNED = [
  "pstack/agents/poteto-agent.md",
  "pstack/agents/comment-sicko.md",
  "pstack/docs/harness/claude-code.md",
  "pstack/skills/setup-pstack/SKILL.md",
  "pstack/skills/poteto-help/SKILL.md",
]
const COMMAND = "npm run build"
const LINK = /\]\(([^)\s]+)\)/g
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)

const TERMS = [
  { key: "`Task`", re: /`Task`|\bTask (tool|subagent|call)/ },
  { key: "`AskQuestion`", re: /AskQuestion/ },
  { key: "todolist", re: /\btodo ?list\b/i },
  { key: "generalPurpose", re: /generalPurpose/ },
  { key: "poteto-agent", re: /poteto-agent/ },
  { key: "comment-sicko", re: /comment-sicko/ },
  { key: "`readonly: true`", re: /readonly: (true|false)|readonly\/Ask/ },
  { key: "`environment: \"cloud\"`", re: /environment: "(cloud|local)"/ },
  { key: "cloud_base_branch", re: /cloud_base_branch/ },
  { key: "`run_in_background: true`", re: /run_in_background/ },
  { key: "`resume`", re: /`resume`/ },
  { key: "`file_attachments`", re: /file_attachments/ },
  { key: "claude-", re: /\bclaude-[a-z]+-\d/ },
  { key: "grok-", re: /\bgrok-\d/ },
  { key: "gpt-", re: /\bgpt-\d/ },
  { key: "inherit-parent", re: /inherit-parent/ },
  { key: "pstack-models.mdc", re: /pstack-models\.mdc/ },
  { key: ".cursor/skills/", re: /\.cursor\/skills/ },
  { key: "~/.cursor/plugins/", re: /\.cursor\/plugins|\.cursor-plugin/ },
  { key: ".cursor/rules/", re: /\.cursor\/rules|always-applied rule/ },
  { key: "agent-transcripts", re: /agent-transcripts|\.cursor\/projects/ },
  { key: "Cursor-only features", re: /Bugbot|Cursor [Aa]utomation|cursor\.(sh|com)\/automations|[Cc]loud [Aa]gent|built-in PR tool/ },
  { key: "subagent_type", re: /subagent_type/ },
  { key: "update_state", re: /update_state|SendToUser/ },
  { key: "Custom Mode", re: /[Cc]ustom [Mm]ode|Use as Mode|[Oo]ption\+[Ee]nter/ },
  { key: "/loop", re: /\/loop\b/ },
  { key: "create-skill", re: /create-skill/ },
  { key: "deslop", re: /\bdeslop\b/, self: true },
  { key: "control-cli", re: /control-cli/, self: true },
  { key: "control-ui", re: /control-ui/, self: true },
]
const ROUTE_KEY = "Run another pstack skill"

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name === ".DS_Store" || name === "node_modules") return []
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")
const fail = (problems) => {
  for (const problem of problems) console.log(`FAIL ${problem}`)
  if (problems.length > 0) process.exit(1)
}

function git(...gitArgs) {
  return execFileSync("git", gitArgs, { cwd: CACHE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}

function checkout(upstream) {
  if (!existsSync(join(CACHE, ".git"))) {
    execFileSync("git", ["clone", "--quiet", "--filter=blob:none", "--no-checkout", upstream.repository, CACHE], { stdio: "inherit" })
    git("sparse-checkout", "set", "pstack", ...Object.keys(VENDORED))
  }
  if (flag("--update")) {
    git("fetch", "--quiet", "origin", "main")
    upstream.commit = git("rev-parse", "FETCH_HEAD")
  }
  try {
    git("cat-file", "-e", `${upstream.commit}^{commit}`)
  } catch {
    git("fetch", "--quiet", "origin", upstream.commit)
  }
  git("checkout", "--quiet", "--detach", upstream.commit)
  for (const plugin of ["pstack", ...Object.keys(VENDORED)]) {
    upstream.versions[plugin] = JSON.parse(readFileSync(join(CACHE, plugin, ".cursor-plugin", "plugin.json"), "utf8")).version
  }
  return upstream
}

const upstream = checkout(JSON.parse(readFileSync(UPSTREAM_FILE, "utf8")))
const PSTACK = join(CACHE, "pstack")
const blobUrl = (path, kind = "blob") => `${upstream.repository}/${kind}/${upstream.commit}/${path}`

// Every pinned upstream file must match the hash recorded when someone last reviewed src/ against it.
const pins = existsSync(PINS_FILE) ? JSON.parse(readFileSync(PINS_FILE, "utf8")) : {}
const currentPins = Object.fromEntries(PINNED.map((path) => [path, { sha256: sha256(readFileSync(join(CACHE, path))), commit: upstream.commit }]))
if (flag("--repin")) {
  writeFileSync(PINS_FILE, `${JSON.stringify(currentPins, null, 2)}\n`)
} else {
  fail(
    PINNED.filter((path) => pins[path]?.sha256 !== currentPins[path].sha256).map((path) =>
      pins[path]
        ? `${path} changed upstream. Review \`git -C .upstream diff ${pins[path].commit} ${upstream.commit} -- ${path}\`, update src/ to match, then rerun with --repin.`
        : `${path} has no pin. Review it against src/, then rerun with --repin.`,
    ),
  )
}

const sources = [
  ...readdirSync(join(PSTACK, "skills")).map((name) => ({ name, dir: join(PSTACK, "skills", name), plugin: "pstack" })),
  ...Object.entries(VENDORED).flatMap(([plugin, names]) => names.map((name) => ({ name, dir: join(CACHE, plugin, "skills", name), plugin }))),
].filter(({ dir }) => existsSync(join(dir, "SKILL.md")))
const skillNames = sources.map(({ name }) => name)
const adapter = readFileSync(join(SRC, "adapter.md"), "utf8")

function classify({ name, dir }) {
  const others = skillNames.filter((other) => other !== name).join("|")
  const route = new RegExp(`the \\*\\*(?<bold>${others})\\*\\* skill|\`/(?<command>${others})\``, "g")
  const namesBareSkill = (line) => [...line.matchAll(route)].some(({ groups }) => !line.includes(`(../${groups.bold ?? groups.command}/`))
  const usesCursorNames = new Set()
  for (const path of walk(dir).filter((path) => path.endsWith(".md"))) {
    const text = readFileSync(path, "utf8")
    for (const term of TERMS) if (!(term.self && term.key === name) && term.re.test(text)) usesCursorNames.add(term.key)
    if (text.split("\n").some(namesBareSkill)) usesCursorNames.add(ROUTE_KEY)
  }
  return { usesCursorNames, wrap: usesCursorNames.size > 0 && /^# /m.test(readFileSync(join(dir, "SKILL.md"), "utf8")) }
}

const problems = []
const users = new Map()
const classes = new Map()
if (new Set(skillNames).size !== skillNames.length) problems.push("a vendored skill has the same name as a pstack skill")
for (const source of sources) {
  const { name, dir } = source
  const { data } = parseFrontmatter(readFileSync(join(dir, "SKILL.md"), "utf8"))
  if (data.name !== name) problems.push(`${source.plugin}/skills/${name}/SKILL.md has name ${JSON.stringify(data.name ?? "")}, not its folder name`)
  if (!SKILL_NAME.test(name) || name.length > 64) problems.push(`${source.plugin}/skills/${name} is not lowercase words joined by hyphens, at most 64 characters`)
  if (!data.description) problems.push(`${source.plugin}/skills/${name}/SKILL.md has no description the plugin can parse`)
  const result = classify(source)
  classes.set(name, result)
  if (result.usesCursorNames.size > 0 && !result.wrap) problems.push(`${source.plugin}/skills/${name}/SKILL.md uses Cursor names but has no H1`)
  for (const key of result.usesCursorNames) users.set(key, [...(users.get(key) ?? []), name])
}
for (const [key, using] of users) if (!adapter.includes(key)) problems.push(`OpenCode adapter has no row for ${key}, used by ${using.join(", ")}`)
fail(problems)

function agentFile(frontmatter, body) {
  const lines = Object.entries(frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
  return `---\n${lines.join("\n")}\n---\n${body ? `\n${body.trim()}\n` : ""}`
}

function render() {
  // Each entry remembers where it came from upstream, so relative links resolve against the upstream tree.
  const files = new Map()
  const file = (path, origin) => ({ bytes: readFileSync(path), executable: (statSync(path).mode & 0o111) !== 0, origin })
  const copy = (dir, into) => {
    for (const path of walk(dir)) files.set(posix.join(into, relative(dir, path)), file(path, relative(CACHE, path)))
  }
  for (const { name, dir } of sources) copy(dir, `skills/${name}`)
  copy(join(PSTACK, GUIDE), GUIDE)
  files.set("README.md", file(join(PSTACK, "README.md"), "pstack/README.md"))
  files.set("plugin.json", file(join(PSTACK, "plugin.json"), "pstack/plugin.json"))
  files.set("LICENSE", file(join(PSTACK, "LICENSE"), "pstack/LICENSE"))
  for (const plugin of Object.keys(VENDORED)) files.set(`LICENSE-${plugin}`, file(join(CACHE, plugin, "LICENSE"), `${plugin}/LICENSE`))
  files.set(ADAPTER, { bytes: Buffer.from(adapter), executable: false, origin: `pstack/${ADAPTER}` })
  for (const name of AGENTS) files.set(`agents/${name}.md`, file(join(SRC, "agents", `${name}.md`), `pstack/agents/${name}.md`))
  const sicko = parseFrontmatter(readFileSync(join(PSTACK, "agents", "comment-sicko.md"), "utf8"))
  files.set("agents/comment-sicko.md", {
    bytes: Buffer.from(agentFile({ description: sicko.data.description, mode: "subagent" }, sicko.body)),
    executable: false,
    origin: "pstack/agents/comment-sicko.md",
  })
  for (const name of readdirSync(join(SRC, "plugin"))) files.set(`plugin/${name}`, file(join(SRC, "plugin", name), `pstack/plugin/${name}`))
  const manifest = {
    name: "pstack-opencode",
    version: `${upstream.versions.pstack}-opencode`,
    description: "pstack for OpenCode. Generated from cursor/plugins. Do not edit by hand.",
    type: "module",
    license: "MIT",
    exports: { ".": "./plugin/index.js" },
  }
  files.set("package.json", { bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), executable: false, origin: "pstack/package.json" })

  const line =
    `In OpenCode, read [the OpenCode adapter](../../${ADAPTER}) once per session before you follow this skill. ` +
    "It maps the Cursor names in pstack skills to OpenCode."
  for (const [name, { wrap }] of classes) {
    const entry = files.get(`skills/${name}/SKILL.md`)
    if (wrap) entry.bytes = Buffer.from(entry.bytes.toString("utf8").replace(/^(# .*)\n+/m, `$1\n\n${line}\n\n`))
  }

  // A relative link that leaves the generated tree points at the pinned upstream commit instead.
  const has = (path) => files.has(path) || [...files.keys()].some((key) => key.startsWith(`${path}/`))
  for (const [path, entry] of files) {
    if (!path.endsWith(".md")) continue
    entry.bytes = Buffer.from(
      entry.bytes.toString("utf8").replace(LINK, (link, href) => {
        const target = href.replace(/[#?].*/, "")
        if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return link
        if (has(posix.join(posix.dirname(path), target).replace(/\/$/, ""))) return link
        const upstreamPath = posix.join(posix.dirname(entry.origin), target).replace(/\/$/, "")
        if (!existsSync(join(CACHE, upstreamPath))) return link
        const kind = statSync(join(CACHE, upstreamPath)).isDirectory() ? "tree" : "blob"
        return `](${blobUrl(upstreamPath, kind)}${href.slice(href.search(/[#?]|$/))})`
      }),
    )
  }
  return files
}

const files = render()
const dangling = []
for (const [path, entry] of files) {
  if (!path.endsWith(".md")) continue
  for (const [, href] of entry.bytes.toString("utf8").matchAll(LINK)) {
    const target = href.replace(/[#?].*/, "")
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue
    const resolved = posix.join(posix.dirname(path), target).replace(/\/$/, "")
    if (files.has(resolved) || [...files.keys()].some((key) => key.startsWith(`${resolved}/`))) continue
    // Upstream templates hold placeholder links such as `[PR #123](url)`. Only files written here must resolve.
    const authored = !existsSync(join(CACHE, entry.origin))
    if (authored) dangling.push(`dist/${path} links to ${href}, which is not in the tree`)
  }
}
fail(dangling)

if (flag("--check")) {
  const onDisk = new Map(existsSync(OUT) ? walk(OUT).map((path) => [relative(OUT, path), path]) : [])
  const drifted = [...new Set([...files.keys(), ...onDisk.keys()])].sort().filter((path) => {
    const want = files.get(path)
    const have = onDisk.get(path)
    if (!want || !have) return true
    return !want.bytes.equals(readFileSync(have)) || want.executable !== ((statSync(have).mode & 0o111) !== 0)
  })
  for (const path of drifted.slice(0, 20)) console.log(`dist/${path}`)
  if (drifted.length > 0) {
    console.log(`dist is out of date. Run \`${COMMAND}\` and commit the result.`)
    process.exit(1)
  }
  console.log("dist is up to date.")
} else {
  rmSync(OUT, { recursive: true, force: true })
  for (const [path, { bytes, executable }] of files) {
    mkdirSync(dirname(join(OUT, path)), { recursive: true })
    writeFileSync(join(OUT, path), bytes)
    chmodSync(join(OUT, path), executable ? 0o755 : 0o644)
  }
  writeFileSync(UPSTREAM_FILE, `${JSON.stringify(upstream, null, 2)}\n`)
  const wrapped = [...classes.values()].filter(({ wrap }) => wrap).length
  console.log(`${sources.length} skills (${Object.values(VENDORED).flat().length} vendored), ${wrapped} SKILL.md files with the adapter line, ${AGENTS.length + 1} agents`)
}
