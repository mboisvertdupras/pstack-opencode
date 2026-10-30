#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { parseFrontmatter } from "../../src/plugin/lib.js"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const UPSTREAM = join(ROOT, ".upstream")
const SRC = join(ROOT, "src")
const VENDORED = { "cursor-team-kit": ["deslop", "control-cli", "control-ui"] }

const contract = readFileSync(join(ROOT, "scripts", "port", "CONTRACT.md"), "utf8")
const notPorted = new Set([...(contract.split(/^## Not ported$/m)[1] ?? "").matchAll(/^- `([^`]+)`/gm)].map(([, id]) => id))
const tracked = (path) =>
  execFileSync("git", ["ls-files", "-z", path], { cwd: UPSTREAM, encoding: "utf8" }).split("\0").filter(Boolean)

const sources = [
  ...[...new Set(tracked("pstack/skills").map((path) => path.split("/")[2]))].map((id) => ({ id, dir: `pstack/skills/${id}` })),
  ...Object.entries(VENDORED).flatMap(([plugin, ids]) => ids.map((id) => ({ id, dir: `${plugin}/skills/${id}` }))),
]

const writeOnce = (path, write) => {
  if (existsSync(path)) return console.log(`kept    ${relative(ROOT, path)}`)
  mkdirSync(dirname(path), { recursive: true })
  write(path)
  console.log(`wrote   ${relative(ROOT, path)}`)
}

for (const { id, dir } of sources) {
  if (notPorted.has(id)) {
    console.log(`skip    ${id} (Not ported)`)
    continue
  }
  writeOnce(join(SRC, "skills", id), (to) => {
    for (const path of tracked(dir)) {
      const from = join(UPSTREAM, path)
      const dest = join(to, relative(dir, path))
      mkdirSync(dirname(dest), { recursive: true })
      copyFileSync(from, dest)
      chmodSync(dest, statSync(from).mode & 0o777)
    }
  })
}

writeOnce(join(SRC, "agents", "comment-sicko.md"), (to) => {
  const { data, body } = parseFrontmatter(readFileSync(join(UPSTREAM, "pstack", "agents", "comment-sicko.md"), "utf8"))
  const frontmatter = { description: data.description, mode: "subagent" }
  const lines = Object.entries(frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
  writeFileSync(to, `---\n${lines.join("\n")}\n---\n\n${body.trim()}\n`)
})

writeOnce(join(SRC, "package.json"), (to) => {
  const { versions } = JSON.parse(readFileSync(join(ROOT, "upstream.json"), "utf8"))
  const manifest = {
    name: "pstack-opencode",
    version: `${versions.pstack}-opencode`,
    description: "pstack for OpenCode.",
    type: "module",
    license: "MIT",
    exports: { ".": "./plugin/index.js" },
  }
  writeFileSync(to, `${JSON.stringify(manifest, null, 2)}\n`)
})
