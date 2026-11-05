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

const PLAYBOOK_ENTRY = /^- \*\*(.+?)\.\*\* (.+)$/gm
const ENTRY_ID = / ID: `([a-z0-9-]+)`\.$/
const STEP = /^\d+\.\s/
const NAMED_SKILL = /the `([a-z0-9-]+)` skill\b/g

const kebab = (title) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")

export function playbookDescriptions(modeBody) {
  const section = modeBody.slice(modeBody.indexOf("## Playbooks"))
  return new Map(
    [...section.matchAll(PLAYBOOK_ENTRY)].map(([, title, text]) => [text.match(ENTRY_ID)?.[1] ?? kebab(title), text.replace(ENTRY_ID, "")]),
  )
}

export function playbookSkills(body) {
  const lines = body.split("\n")
  const start = lines.findIndex((line) => STEP.test(line))
  if (start < 0) return []
  const end = lines.findIndex((line, index) => index > start && /^\S/.test(line) && !STEP.test(line))
  const steps = lines.slice(start, end < 0 ? undefined : end).join("\n")
  return [...new Set([...steps.matchAll(NAMED_SKILL)].map(([, id]) => id))]
}

function readPlaybooks(modeDir) {
  const dir = join(modeDir, "playbooks")
  if (!existsSync(dir)) return []
  const descriptions = playbookDescriptions(readFileSync(join(modeDir, "SKILL.md"), "utf8"))
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => {
      const id = name.slice(0, -".md".length)
      const path = join(dir, name)
      const { body } = parseFrontmatter(readFileSync(path, "utf8"))
      const title = body.match(/^### (.+)$/m)?.[1] ?? id
      const frame = `This is the \`${MODE_AGENT}\` ${title} playbook. Keep the todo list as the Playbooks section of the \`${MODE_AGENT}\` skill says, and when you run a step that names a skill, load that skill with the \`skill\` tool.`
      return {
        kind: "playbook",
        id,
        name: id,
        title,
        description: descriptions.get(id) ?? title,
        path,
        content: `${frame}\n\n${absoluteLinks(body, dir)}`,
        autoinvoke: false,
        skills: playbookSkills(body),
      }
    })
}

export function readSkills(skillsDir) {
  const skills = readdirSync(skillsDir)
    .filter((id) => existsSync(join(skillsDir, id, "SKILL.md")))
    .sort()
    .map((id) => {
      const path = join(skillsDir, id, "SKILL.md")
      const { data, body } = parseFrontmatter(readFileSync(path, "utf8"))
      return {
        kind: "skill",
        id,
        name: data.name || id,
        description: data.description ?? "",
        path,
        content: absoluteLinks(body, dirname(path)),
        autoinvoke: data["disable-model-invocation"] !== "true",
      }
    })
  const ids = new Set(skills.map((skill) => skill.id))
  return [...skills, ...readPlaybooks(join(skillsDir, MODE_AGENT)).filter((playbook) => !ids.has(playbook.id))]
}

const AGENT_MODES = ["primary", "subagent", "all"]

export function readAgents(agentsDir) {
  return readdirSync(agentsDir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => {
      const path = join(agentsDir, name)
      const { data, body } = parseFrontmatter(readFileSync(path, "utf8"))
      if (!data.description) throw new Error(`pstack: ${path} has no description`)
      if (!AGENT_MODES.includes(data.mode)) throw new Error(`pstack: ${path} has mode ${JSON.stringify(data.mode)}, expected one of ${AGENT_MODES.join(", ")}`)
      return {
        id: name.slice(0, -".md".length),
        description: data.description,
        mode: data.mode,
        ...(data.color ? { color: data.color } : {}),
        ...(body ? { system: body } : {}),
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
    "poteto mode is on. The user turned it on, so every task in this session follows the `poteto-mode` skill.",
    `If the skill's instructions are not in this conversation, at the start or after compaction, load it with the \`skill\` tool (ID \`poteto-mode\`, file \`${join(root, "skills", "poteto-mode", "SKILL.md")}\`) before you act.`,
    'When the user says "new task", match a fresh playbook.',
  ].join(" ")
}

export function modelsEntry(file, text) {
  if (!text) return undefined
  return `pstack per-role model choices, written by /setup-pstack to \`${file}\`. Each role line overrides that role's default model in pstack skills.\n\n${text}`
}

export const isCommit = ({ tool, input }) => tool === "shell" && GIT_COMMIT.test(input.command)

export function commitGate(session, event) {
  if (!isCommit(event)) return undefined
  if (session.loaded.includes("deslop") || !(session.mode || MODE_AGENTS.includes(event.agent))) return undefined
  return COMMIT_GATE
}

const SKILL_FILE = /\/skills\/(?:poteto-mode\/playbooks\/([a-z0-9-]+)\.md|([a-z0-9-]+)\/SKILL\.md)$/

export function loadedSkill({ tool, input, status }, skills) {
  if (status !== "completed") return undefined
  if (tool === "skill") return input.id
  if (tool !== "read") return undefined
  const [, playbook, skill] = input.path?.match(SKILL_FILE) ?? []
  const id = playbook ?? skill
  return skills.has(id) ? id : undefined
}

export const isSkillEvent = (event, skills) => Boolean(loadedSkill(event, skills))

export function withEvent(record, event, skills) {
  const session = { loaded: [], ...record }
  const id = loadedSkill(event, skills)
  if (!id || session.loaded.includes(id)) return record
  return { ...session, loaded: [...session.loaded, id] }
}

export function entryOps(want, have) {
  return Object.entries(want)
    .filter(([key, value]) => value !== have[key])
    .map(([key, value]) => ({ key, value }))
}
