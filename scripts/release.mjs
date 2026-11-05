#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const MANIFEST = join(REPO, "src", "package.json")
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

const run = (cmd, args) => execFileSync(cmd, args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim()
const fail = (message) => {
  console.error(`release: ${message}`)
  process.exit(1)
}

const version = process.argv[2]
if (!version || !SEMVER.test(version)) fail(`usage: npm run release -- <version>, such as 0.15.39-opencode (got ${JSON.stringify(version ?? "")})`)

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"))
if (manifest.version === version) fail(`src/package.json is already at ${version}`)
if (run("git", ["branch", "--show-current"]) !== "main") fail("run releases from main")
if (run("git", ["status", "--porcelain"])) fail("the working tree has uncommitted changes")
run("git", ["fetch", "--quiet", "origin", "main", "--tags"])
if (run("git", ["rev-parse", "HEAD"]) !== run("git", ["rev-parse", "origin/main"])) fail("main is not the same commit as origin/main")
if (run("git", ["tag", "--list", `v${version}`])) fail(`tag v${version} already exists`)

execFileSync("npm", ["test"], { cwd: REPO, stdio: "inherit" })
execFileSync("npm", ["run", "lint", "--", "src/skills", "src/agents"], { cwd: REPO, stdio: "inherit" })

writeFileSync(MANIFEST, JSON.stringify({ ...manifest, version }, null, 2) + "\n")
run("git", ["commit", "--quiet", "-m", `Release ${version}`, "--", "src/package.json"])
run("git", ["tag", "-a", `v${version}`, "-m", `Release ${version}`])
run("git", ["push", "--quiet", "--atomic", "origin", "main", `v${version}`])
console.log(`pushed v${version}. The release workflow publishes it to npm.`)
