import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

export const MODE_AGENT = "poteto-mode"
export const MODELS_KEY = "pstack-models"
export const MODE_KEY = "pstack-mode"
const MODE_AGENTS = [MODE_AGENT, "poteto-agent"]
const COMMIT_GATE =
  "pstack: load the `deslop` skill with the `skill` tool and follow it on the staged diff before you commit. Then rerun `git commit` as its own command, because this whole shell command was rejected and nothing in it ran."

const GIT_COMMIT = /(?:^|[;&|(\n])\s*git(?:\s+-\S+(?:\s+[^-\s;&|]\S*)?)*\s+commit(?=$|[\s;&|)])/

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const LINK = /\]\(([^)\s]+)\)/g

function scalar(raw, continuation) {
  const value = raw.trim()
  if (value.startsWith('"')) return JSON.parse(value)
  if (value.startsWith("'")) return value.slice(1, -1).replaceAll("''", "'")
  if (/^[>|][+-]?$/.test(value)) {
    const lines = continuation.map((line) => line.trim())
    return value.startsWith(">") ? lines.filter(Boolean).join(" ") : lines.join("\n").trim()
  }
  return value
}

export function parseFrontmatter(text) {
  const match = text.match(FRONTMATTER)
  if (!match) return { data: {}, body: text }
  const lines = match[1].split(/\r?\n/)
  const data = {}
  for (let i = 0; i < lines.length; i++) {
    const field = lines[i].match(/^([A-Za-z][\w-]*):(.*)$/)
    if (!field) continue
    const continuation = []
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) continuation.push(lines[++i])
    data[field[1]] = scalar(field[2], continuation)
  }
  return { data, body: text.slice(match[0].length).replace(/^\s+/, "") }
}

function absoluteLinks(text, dir) {
  return text.replace(LINK, (link, href) => {
    const target = href.replace(/[#?].*/, "")
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return link
    const path = resolve(dir, target)
    return existsSync(path) ? `](${path}${href.slice(target.length)})` : link
  })
}

export function readSkills(skillsDir) {
  return readdirSync(skillsDir)
    .filter((id) => existsSync(join(skillsDir, id, "SKILL.md")))
    .sort()
    .map((id) => {
      const path = join(skillsDir, id, "SKILL.md")
      const { data, body } = parseFrontmatter(readFileSync(path, "utf8"))
      return {
        id,
        name: data.name || id,
        description: data.description ?? "",
        path,
        content: absoluteLinks(body, dirname(path)),
        autoinvoke: data["disable-model-invocation"] !== "true",
      }
    })
}

export function commandDescription(description, max = 120) {
  const sentence = description.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? description
  if (sentence.length <= max) return sentence
  return `${sentence.slice(0, sentence.lastIndexOf(" ", max - 3))}...`
}

export function commandPrompt(skill, text, shadowedBy) {
  const task = text.trim() || `Run the ${skill.id} skill.`
  if (!shadowedBy) return { text: task, attach: true }
  return {
    text: `Read the pstack \`${skill.id}\` skill at \`${skill.path}\` and follow it. The user skill at \`${shadowedBy}\` has the same ID, so do not load \`${skill.id}\` with the skill tool.\n\n${task}`,
    attach: false,
  }
}

export function modeEntry(root) {
  return [
    "poteto mode is on. The user selected the `poteto-mode` agent, so every task in this session follows the `poteto-mode` skill.",
    `If the skill's instructions are not in this conversation, at the start or after compaction, load it with the \`skill\` tool (ID \`poteto-mode\`, file \`${join(root, "skills", "poteto-mode", "SKILL.md")}\`) before you act.`,
    'When the user says "new task", match a fresh playbook.',
  ].join(" ")
}

export function modelsEntry(file, text) {
  if (!text) return undefined
  return `pstack per-role model choices, written by /setup-pstack to \`${file}\`. Each role line overrides that role's default model in pstack skills.\n\n${text}`
}

export function commitGate(session = {}, { tool, agent, input }) {
  if (tool !== "shell" || !GIT_COMMIT.test(input.command)) return undefined
  if (session.deslop || !(session.mode || MODE_AGENTS.includes(agent))) return undefined
  return COMMIT_GATE
}

export function entryOps(want, have) {
  return Object.entries(want)
    .filter(([key, value]) => value !== have[key])
    .map(([key, value]) => ({ key, value }))
}
