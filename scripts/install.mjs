#!/usr/bin/env node

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist")
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const projectIndex = args.indexOf("--project")
const project = projectIndex >= 0 ? resolve(args[projectIndex + 1] ?? ".") : undefined
const configDir = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode")
const target = project ? join(project, ".opencode") : configDir
const dryRun = flag("--dry-run")

if (!existsSync(join(DIST, "plugin", "index.js"))) {
  console.log("dist/ is missing. Run `npm run build` first.")
  process.exit(1)
}

const links = [
  { at: join(target, "plugins", "pstack"), to: DIST },
  ...readdirSync(join(DIST, "agents")).map((name) => ({ at: join(target, "agents", name), to: join(DIST, "agents", name) })),
]

const owned = (path) => {
  try {
    return lstatSync(path).isSymbolicLink() && realpathSync(path).startsWith(realpathSync(DIST))
  } catch {
    return false
  }
}

const problems = []
for (const { at, to } of links) {
  let stat
  try {
    stat = lstatSync(at)
  } catch {}
  if (flag("--uninstall")) {
    if (!stat) continue
    if (!owned(at)) {
      console.log(`keep    ${at} (not a pstack link)`)
      continue
    }
    if (!dryRun) unlinkSync(at)
    console.log(`removed ${at}`)
    continue
  }
  if (stat?.isSymbolicLink() && resolve(dirname(at), readlinkSync(at)) === to) {
    console.log(`ok      ${at}`)
    continue
  }
  if (stat) {
    problems.push(`${at} already exists and is not this pstack's link. Move it aside, then rerun.`)
    continue
  }
  if (!dryRun) {
    mkdirSync(dirname(at), { recursive: true })
    symlinkSync(to, at)
  }
  console.log(`linked  ${at} -> ${to}`)
}
for (const problem of problems) console.log(`FAIL ${problem}`)
if (problems.length > 0) process.exit(1)
if (flag("--uninstall")) process.exit(0)

// User skills load from directories, which OpenCode layers over plugin skills, so a same-named user skill keeps its ID.
const roots = [
  join(homedir(), ".claude", "skills"),
  join(homedir(), ".agents", "skills"),
  join(configDir, "skills"),
  ...(project ? [".claude", ".agents", ".opencode"].map((dir) => join(project, dir, "skills")) : []),
]
const pstackSkills = new Set(readdirSync(join(DIST, "skills")))
const shadows = roots.flatMap((root) =>
  existsSync(root)
    ? readdirSync(root)
        .filter((name) => pstackSkills.has(name) && existsSync(join(root, name, "SKILL.md")))
        .map((name) => join(root, name))
    : [],
)
if (shadows.length > 0) {
  console.log("\nThese user skills share an ID with a pstack skill, and they keep it.")
  for (const path of shadows) console.log(`  ${path}`)
  console.log("pstack still runs its own copy. Its skills read pstack's file by path, and its slash command of that name does too.")
}

const configs = ["opencode.jsonc", "opencode.json"].map((name) => join(target, name)).filter(existsSync)
const config = configs.map((path) => readFileSync(path, "utf8")).join("\n")
const missing = [
  ['"todo"', '"todo": true', "gives agents `todowrite`, the todo list every playbook opens"],
  ['"subagent_depth"', '"subagent_depth": 2', "lets delegates run skills that spawn their own subagents"],
].filter(([key]) => !config.includes(key))
if (missing.length > 0) {
  console.log(`\nRecommended. Add these to "experimental" in ${configs[0] ?? join(target, "opencode.jsonc")}:`)
  for (const [, line, why] of missing) console.log(`  ${line}   ${why}`)
}
if (!existsSync(join(configDir, "pstack-models.md"))) console.log("\nNext, run /setup-pstack once to choose a model per role.")
console.log(`\nDone. Start a task with /poteto-mode, or press Tab to the poteto-mode agent to keep the mode on.${dryRun ? " (dry run, nothing changed)" : ""}`)
