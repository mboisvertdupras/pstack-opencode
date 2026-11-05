import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { commandDescription, commandPrompt, entryOps, loadedSkill, parseFrontmatter, playbookDescriptions, playbookSkills, readAgents, readSkills, withEvent } from "../src/plugin/lib.js"

test("frontmatter reads double-quoted, single-quoted, plain, and folded descriptions", () => {
  const quoted = parseFrontmatter('---\nname: how\ndescription: "Use for \\"how does X work\\"."\ndisable-model-invocation: true\n---\n\n# How\n')
  assert.deepEqual(quoted.data, { name: "how", description: 'Use for "how does X work".', "disable-model-invocation": "true" })
  assert.equal(quoted.body, "# How\n")
  assert.equal(parseFrontmatter("---\ndescription: 'it''s fine'\n---\n").data.description, "it's fine")
  assert.equal(parseFrontmatter("---\ndescription: Plain words, no quotes.\n---\n").data.description, "Plain words, no quotes.")
  const folded = parseFrontmatter("---\nname: bot\ndescription: >-\n  First line\n  second line.\nother: x\n---\nBody")
  assert.equal(folded.data.description, "First line second line.")
  assert.equal(folded.data.other, "x")
})

test("a file without frontmatter is all body", () => {
  assert.deepEqual(parseFrontmatter("# Title\n"), { data: {}, body: "# Title\n" })
})

test("command descriptions keep the first sentence and cut long ones at a word", () => {
  assert.equal(commandDescription("Remove AI slop. Then more."), "Remove AI slop.")
  const long = commandDescription(`${"word ".repeat(40)}end.`, 40)
  assert.ok(long.length <= 40 && long.endsWith("..."), long)
})

test("a command attaches its skill, and points at the file when a user skill shadows the ID", () => {
  const skill = { id: "tdd", path: "/pstack/skills/tdd/SKILL.md" }
  assert.deepEqual(commandPrompt(skill, "  fix the parser  ", undefined), { text: "fix the parser", attach: true })
  assert.deepEqual(commandPrompt(skill, "", undefined), { text: "Run the tdd skill.", attach: true })
  const shadowed = commandPrompt(skill, "fix it", "/home/me/.agents/skills/tdd/SKILL.md")
  assert.equal(shadowed.attach, false)
  assert.match(shadowed.text, /Read the pstack `tdd` skill at `\/pstack\/skills\/tdd\/SKILL.md`/)
  assert.match(shadowed.text, /fix it$/)
})

test("entry ops put changed values and remove values that are no longer wanted", () => {
  assert.deepEqual(entryOps({ a: "1", b: undefined, c: "3" }, { a: "1", b: "old", c: "2" }), [
    { key: "b", value: undefined },
    { key: "c", value: "3" },
  ])
  assert.deepEqual(entryOps({ a: undefined }, {}), [])
})

test("skill content links to files on disk by absolute path, and leaves URLs, anchors, and missing targets alone", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pstack-skills-")))
  mkdirSync(join(root, "skills", "how", "references"), { recursive: true })
  mkdirSync(join(root, "shared"))
  writeFileSync(join(root, "shared", "glossary.md"), "")
  writeFileSync(join(root, "skills", "how", "references", "explorer.md"), "")
  const body = [
    "Read [the glossary](../../shared/glossary.md) first.",
    "See [the explorer](references/explorer.md#prompt).",
    "Visit [the site](https://example.com/pstack) or [below](#usage).",
    "Skip [the gone file](references/missing.md).",
  ].join("\n")
  writeFileSync(join(root, "skills", "how", "SKILL.md"), `---\nname: how\ndescription: How.\n---\n\n${body}\n`)
  const [skill] = readSkills(join(root, "skills"))
  assert.equal(
    skill.content,
    [
      `Read [the glossary](${root}/shared/glossary.md) first.`,
      `See [the explorer](${root}/skills/how/references/explorer.md#prompt).`,
      "Visit [the site](https://example.com/pstack) or [below](#usage).",
      "Skip [the gone file](references/missing.md).",
    ].join("\n") + "\n",
  )
  rmSync(root, { recursive: true, force: true })
})

test("a playbook's skills are the skills its numbered steps name, in step order, once each", () => {
  const body = [
    "### Bug fix",
    "",
    "Intro naming the `intro` skill.",
    "",
    "1. Load the `how` skill with the `skill` tool, then the `why` skill.",
    "2. Plan it.",
    "   Continue with the `principle-sequence-verifiable-units` skill and the `how` skill again.",
    "3. Load `bare` without the article, then load the `tdd` skill.",
    "",
    "After the list, the `after` skill.",
    "",
    "**Reply:** Load the `unslop` skill with the `skill` tool.",
  ].join("\n")
  assert.deepEqual(playbookSkills(body), ["how", "why", "principle-sequence-verifiable-units", "tdd"])
  assert.deepEqual(playbookSkills("### Empty\n\nNo steps, only the `how` skill.\n"), [])
})

test("playbook descriptions come from the poteto-mode Playbooks list, keyed by kebab title or the entry's ID", () => {
  const descriptions = playbookDescriptions(
    ["## Principles", "", "- **Not a playbook.** Ignored.", "", "## Playbooks", "", "- **Bug fix.** A defect to fix.", "- **Multi-phase or multi-PR plan.** Work across PRs. ID: `multi-phase-plan`."].join("\n"),
  )
  assert.deepEqual([...descriptions], [
    ["bug-fix", "A defect to fix."],
    ["multi-phase-plan", "Work across PRs."],
  ])
})

test("each playbook loads as a hidden skill under its stem, and a real skill with the same ID wins", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pstack-skills-")))
  const mode = join(root, "skills", "poteto-mode")
  mkdirSync(join(mode, "playbooks"), { recursive: true })
  mkdirSync(join(root, "skills", "babysit"))
  writeFileSync(join(mode, "SKILL.md"), "---\nname: poteto-mode\ndescription: Mode.\n---\n\n## Playbooks\n\n- **Bug fix.** A defect to fix.\n")
  writeFileSync(join(mode, "playbooks", "bug-fix.md"), "---\nrequires: how, tdd\n---\n\n### Bug fix\n\n1. Load the `how` skill with the `skill` tool. See [the mode](../SKILL.md).\n")
  writeFileSync(join(mode, "playbooks", "untitled.md"), "### Untitled\n\n1. Do it.\n")
  writeFileSync(join(mode, "playbooks", "babysit.md"), "### Babysit\n\n1. Watch.\n")
  writeFileSync(join(root, "skills", "babysit", "SKILL.md"), "---\nname: babysit\ndescription: A user-facing babysit skill.\n---\n\nBody\n")
  const skills = readSkills(join(root, "skills"))
  const byId = Map.groupBy(skills, (skill) => skill.id)
  assert.deepEqual(byId.get("babysit").map((skill) => skill.kind), ["skill"])
  const [bugFix] = byId.get("bug-fix")
  assert.deepEqual({ ...bugFix, content: undefined }, {
    kind: "playbook",
    id: "bug-fix",
    name: "bug-fix",
    title: "Bug fix",
    description: "A defect to fix.",
    path: join(mode, "playbooks", "bug-fix.md"),
    content: undefined,
    autoinvoke: false,
    skills: ["how"],
    requires: ["how", "tdd"],
  })
  assert.equal(
    bugFix.content,
    `This is the \`poteto-mode\` Bug fix playbook. Keep the todo list as the Playbooks section of the \`poteto-mode\` skill says, and when you run a step that names a skill, load that skill with the \`skill\` tool.\n\n### Bug fix\n\n1. Load the \`how\` skill with the \`skill\` tool. See [the mode](${mode}/SKILL.md).\n`,
  )
  assert.equal(byId.get("untitled")[0].description, "Untitled")
  assert.deepEqual(byId.get("untitled")[0].requires, [])
  rmSync(root, { recursive: true, force: true })
})

test("agents load by filename in order, with their mode, optional color, and body as the prompt", () => {
  const dir = mkdtempSync(join(tmpdir(), "pstack-agents-"))
  writeFileSync(join(dir, "b-mode.md"), "---\ndescription: A mode.\nmode: primary\ncolor: \"#e5c07b\"\n---\n")
  writeFileSync(join(dir, "a-helper.md"), "---\nname: other\ndescription: \"A helper.\"\nmode: 'subagent'\n---\n\n# Helper\n\nDo it.\n")
  writeFileSync(join(dir, "notes.txt"), "not an agent")
  assert.deepEqual(readAgents(dir), [
    { id: "a-helper", description: "A helper.", mode: "subagent", system: "# Helper\n\nDo it.\n" },
    { id: "b-mode", description: "A mode.", mode: "primary", color: "#e5c07b" },
  ])
  rmSync(dir, { recursive: true, force: true })
})

test("an agent with no description or a mode outside primary, subagent, and all fails naming its file", () => {
  const dir = mkdtempSync(join(tmpdir(), "pstack-agents-"))
  const path = join(dir, "broken.md")
  writeFileSync(path, "---\nmode: subagent\n---\nBody\n")
  assert.throws(() => readAgents(dir), (error) => error.message.includes(path) && /no description/.test(error.message))
  writeFileSync(path, "---\ndescription: Broken.\nmode: helper\n---\nBody\n")
  assert.throws(() => readAgents(dir), (error) => error.message.includes(path) && /mode "helper"/.test(error.message))
  writeFileSync(path, "---\ndescription: Broken.\n---\nBody\n")
  assert.throws(() => readAgents(dir), (error) => error.message.includes(path) && /mode undefined/.test(error.message))
  rmSync(dir, { recursive: true, force: true })
})

test("every shipped playbook registers under its stem with its Playbooks list entry", () => {
  const dir = join(import.meta.dirname, "..", "src", "skills")
  const stems = readdirSync(join(dir, "poteto-mode", "playbooks")).map((name) => name.replace(/\.md$/, ""))
  const playbooks = readSkills(dir).filter((skill) => skill.kind === "playbook")
  assert.deepEqual(playbooks.map((playbook) => playbook.id).sort(), stems.sort())
  for (const playbook of playbooks) assert.match(playbook.description, /\.$/, `${playbook.id} has a Playbooks list entry`)
})

const CATALOG = new Map([
  ["perf", { kind: "playbook", id: "perf", title: "Perf issue" }],
  ["notes", { kind: "playbook", id: "notes", title: "Notes" }],
  ["how", { kind: "skill", id: "how" }],
])
const spawn = (agent) => ({ tool: "subagent", agent: "build", input: { agent }, status: "completed" })

test("a completed skill load or pstack skill file read is a load", () => {
  assert.equal(loadedSkill({ tool: "skill", input: { id: "how" }, status: "completed" }, CATALOG), "how")
  assert.equal(loadedSkill({ tool: "skill", input: { id: "how" }, status: "error" }, CATALOG), undefined)
  assert.equal(loadedSkill({ tool: "read", input: { path: "/x/skills/poteto-mode/playbooks/perf.md" }, status: "completed" }, CATALOG), "perf")
  assert.equal(loadedSkill({ tool: "read", input: { path: "/x/skills/how/SKILL.md" }, status: "completed" }, CATALOG), "how")
  assert.equal(loadedSkill({ tool: "read", input: { path: "/x/skills/mine/SKILL.md" }, status: "completed" }, CATALOG), undefined)
})

test("loads are recorded once in load order, playbooks included, and other events record nothing", () => {
  const load = (id) => ({ tool: "skill", input: { id }, status: "completed" })
  const apply = (...events) => events.reduce((record, event) => withEvent(record, event, CATALOG), undefined)

  assert.equal(apply(spawn("explore")), undefined)
  assert.deepEqual(apply(spawn("explore"), load("how")), { loaded: ["how"] })
  assert.equal(apply({ tool: "skill", input: { id: "how" }, status: "error" }), undefined)

  const started = apply(load("how"))
  assert.equal(withEvent(started, load("how"), CATALOG), started)
  assert.equal(withEvent(started, spawn("general"), CATALOG), started)
  assert.deepEqual(apply(load("how"), load("perf"), load("notes")), { loaded: ["how", "perf", "notes"] })
})
