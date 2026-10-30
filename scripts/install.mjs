#!/usr/bin/env node

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const SRC = join(REPO, "src")
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const projectIndex = args.indexOf("--project")
const project = projectIndex >= 0 ? resolve(args[projectIndex + 1] ?? ".") : undefined
const configDir = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode")
const target = project ? join(project, ".opencode") : configDir
const dryRun = flag("--dry-run")

const links = [
  { at: join(target, "plugins", "pstack"), to: SRC },
  ...readdirSync(join(SRC, "agents")).map((name) => ({ at: join(target, "agents", name), to: join(SRC, "agents", name) })),
]

const REMOVED_DIST = "dist"
const ownedFolders = [...new Set([REPO, realpathSync(REPO)])].flatMap((root) => [join(root, "src"), join(root, REMOVED_DIST)])
const linkTextPointsIntoOwnedFolder = (points) => ownedFolders.some((folder) => points === folder || points.startsWith(folder + sep))

function linkState(at, to) {
  let stat
  try {
    stat = lstatSync(at)
  } catch {
    return "missing"
  }
  if (!stat.isSymbolicLink()) return "foreign"
  const points = resolve(dirname(at), readlinkSync(at))
  if (points === to) return "current"
  return linkTextPointsIntoOwnedFolder(points) ? "moved" : "foreign"
}

const problems = []
for (const { at, to } of links) {
  const state = linkState(at, to)
  if (flag("--uninstall")) {
    if (state === "missing") continue
    if (state === "foreign") {
      console.log(`keep    ${at} (not a pstack link)`)
      continue
    }
    if (!dryRun) unlinkSync(at)
    console.log(`removed ${at}`)
    continue
  }
  if (state === "current") {
    console.log(`ok      ${at}`)
    continue
  }
  if (state === "foreign") {
    problems.push(`${at} already exists and is not this pstack's link. Move it aside, then rerun.`)
    continue
  }
  if (!dryRun) {
    mkdirSync(dirname(at), { recursive: true })
    if (state === "moved") unlinkSync(at)
    symlinkSync(to, at)
  }
  console.log(`${state === "moved" ? "moved " : "linked"}  ${at} -> ${to}`)
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
const pstackSkills = new Set(readdirSync(join(SRC, "skills")))
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
