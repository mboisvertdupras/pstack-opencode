#!/usr/bin/env node

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const SKILLS = join(ROOT, "src", "skills")

const REWRITES = [
  [/subagent_type: generalPurpose/g, 'agent: "general"'],
  [/subagent_type: "([\w-]+)"/g, 'agent: "$1"'],
  [/`generalPurpose`/g, "`general`"],
  [/run_in_background: true/g, "background: true"],
  [/`AskQuestion`/g, "`question`"],
  [/Prefer AskQuestion over free text/g, "Prefer the `question` tool over free text"],
  [/Open a todolist/g, "Open a todo list with `todowrite`"],
  [/the todolist/g, "the todo list"],
  [/the Task tool/g, "the `subagent` tool"],
  [/a Task subagent/g, "a `subagent` call"],
  [/omit Task `model`/g, "omit `model`"],
  [/a `Task` subagent/g, "a `subagent` call"],
  [/Spawn `Task` with/g, "Call `subagent` with"],
  [/with `Task`\./g, "with the `subagent` tool."],
  [/`Task`/g, "`subagent`"],
  [/line in `~\/\.cursor\/rules\/pstack-models\.mdc`/g, "line in the `pstack-models` instruction entry"],
  [/the `pstack-models\.mdc` rule/g, "the `pstack-models` instruction entry"],
  [/If the rule or that line is missing/g, "If the entry or that line is missing"],
  [/~\/\.cursor\/rules\/pstack-models\.mdc/g, "~/.config/opencode/pstack-models.md"],
  [/~\/\.cursor\/skills\//g, "~/.config/opencode/skills/"],
  [/(?<![~\w/])\.cursor\/skills\//g, ".opencode/skills/"],
  [/ from the `cursor-team-kit` plugin \(`\/deslop`\)/g, ""],
  [/ \(from `cursor-team-kit`\)/g, ""],
  [/ from `cursor-team-kit`/g, ""],
  [/\b((?:claude|grok|gpt|gemini|composer)-[a-z0-9.]+(?:-[a-z0-9.]+)*?)-(max|xhigh|high|medium|low)(?:-fast)?\b/g, "$1#$2"],
]

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })

const counts = REWRITES.map(() => 0)
const changed = new Map()
for (const path of walk(SKILLS).filter((path) => path.endsWith(".md"))) {
  const before = readFileSync(path, "utf8")
  const after = REWRITES.reduce((text, [pattern, replacement], index) => {
    counts[index] += text.match(pattern)?.length ?? 0
    return text.replace(pattern, replacement)
  }, before)
  if (after !== before) changed.set(path, after)
}

REWRITES.forEach(([pattern], index) => console.log(`${String(counts[index]).padStart(4)} ${pattern}`))
const dead = REWRITES.filter((_, index) => counts[index] === 0)
if (dead.length > 0) {
  for (const [pattern] of dead) console.log(`FAIL ${pattern} matches nothing`)
  console.log("Nothing written.")
  process.exit(1)
}
for (const [path, text] of changed) writeFileSync(path, text)
console.log(`rewrote ${changed.size} files under ${relative(ROOT, SKILLS)}`)
