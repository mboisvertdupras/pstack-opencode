#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseFrontmatter } from "../src/plugin/lib.js"

const LINK = /\]\(([^)\s]+)\)/g
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

const RULES = [
  { rule: "product", scope: "markdown", pattern: /\b(?:Cursor|OpenCode)\b/g },
  { rule: "product", scope: "markdown", pattern: /(?<![\w.])\.cursor\b/g },
  { rule: "product", scope: "markdown", pattern: /cursor-team-kit|cursor\.sh|cursor\.com|github\.com\/cursor\b/g },
  { rule: "product", scope: "prose", pattern: /\bopencode\b/g },
  { rule: "product", scope: "package-name", pattern: /\b(?:cursor|opencode)\b/gi },
  { rule: "vocab", scope: "markdown", pattern: /`Task`|\bTask (?:tool|calls?|subagents?|errors?|response|prompt|`)/g },
  { rule: "vocab", scope: "markdown", pattern: /\bsubagent_type\b|\bgeneralPurpose\b|\breadonly:|\brun_in_background\b/g },
  { rule: "vocab", scope: "markdown", pattern: /environment: "|\bcloud_base_branch\b|\bfile_attachments\b|\bAskQuestion\b/g },
  { rule: "vocab", scope: "markdown", pattern: /\btodolist\b|\.mdc\b|(?<![\w/.])\/loop\b|\bagent-transcripts\b/g },
  { rule: "vocab", scope: "markdown", pattern: /\b[Cc]ustom [Mm]ode\b|\bcreate-skill\b|\bupdate_state\b|\bSendToUser\b|\bAutomations\b/g },
  { rule: "vocab", scope: "markdown", pattern: /\b(?:claude|grok|gpt|gemini|composer)-[\w.-]*?-(?:max|xhigh|high|medium|low|fast)(?:-fast)?\b/g },
]

const isMarkdown = (file) => file.endsWith(".md")
const isPackageName = (file, line) => /\.(?:json|lock)$/.test(file) && /"name"\s*:/.test(line)

function scanLines(file, text) {
  if (!isMarkdown(file)) return text.split("\n").map((raw) => ({ "package-name": isPackageName(file, raw) ? raw : "" }))
  let fenced = false
  return text.split("\n").map((raw) => {
    const fence = /^\s*(```|~~~)/.test(raw)
    const inCode = fenced || fence
    if (fence) fenced = !fenced
    return { markdown: raw, prose: inCode ? "" : raw.replace(/`+[^`]*`+/g, " ") }
  })
}

function frontmatterFindings(file, text) {
  if (basename(file) !== "SKILL.md") return []
  const { data } = parseFrontmatter(text)
  const folder = basename(dirname(file))
  const findings = []
  if (data.name !== folder) findings.push(`name ${JSON.stringify(data.name ?? "")} is not the folder ${JSON.stringify(folder)}`)
  if (!data.description) findings.push("description is missing")
  return findings.map((message) => ({ file, line: 1, rule: "frontmatter", text: message }))
}

function linkFindings(file, lines, exists) {
  return lines.flatMap(({ prose }, index) =>
    [...(prose ?? "").matchAll(LINK)]
      .map(([, href]) => href)
      .filter((href) => {
        const target = href.replace(/[#?].*/, "")
        if (!target || SCHEME.test(target) || target.startsWith("/")) return false
        return !exists(resolve(dirname(file), target))
      })
      .map((href) => ({ file, line: index + 1, rule: "link", text: href })),
  )
}

export function lint(files, exists = existsSync) {
  return files.flatMap(({ file, text }) => {
    const lines = scanLines(file, text)
    const matches = lines.flatMap((line, index) =>
      RULES.flatMap(({ rule, scope, pattern }) =>
        [...(line[scope] ?? "").matchAll(pattern)].map(([match]) => ({ file, line: index + 1, rule, text: match })),
      ),
    )
    return [...frontmatterFindings(file, text), ...matches, ...(isMarkdown(file) ? linkFindings(file, lines, exists) : [])]
  })
}

function walk(path) {
  if (!statSync(path).isDirectory()) return [path]
  return readdirSync(path).flatMap((name) => (name === ".DS_Store" || name === "node_modules" ? [] : walk(join(path, name))))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const roots = process.argv.slice(2)
  const paths = (roots.length > 0 ? roots : ["src/skills"]).flatMap(walk)
  const findings = lint(paths.map((path) => ({ file: relative(process.cwd(), path), text: readFileSync(path, "utf8") })))
  for (const { file, line, rule, text } of findings) console.log(`${file}:${line} ${rule} ${text}`)
  console.log(`findings=${findings.length} files=${new Set(findings.map(({ file }) => file)).size}`)
  process.exit(findings.length > 0 ? 1 : 0)
}
