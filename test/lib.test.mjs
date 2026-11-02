import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { actGate, commandDescription, commandPrompt, entryOps, loadedSkill, parseFrontmatter, playbookDescriptions, playbookSkills, readSkills, withEvent } from "../src/plugin/lib.js"

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
  writeFileSync(join(mode, "playbooks", "bug-fix.md"), "---\nrequires: how,  why\n---\n\n### Bug fix\n\n1. Load the `how` skill with the `skill` tool. See [the mode](../SKILL.md).\n")
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
    requires: ["how", "why"],
  })
  assert.deepEqual(byId.get("untitled")[0].requires, [])
  assert.equal(
    bugFix.content,
    `This is the \`poteto-mode\` Bug fix playbook. Copy its numbered steps verbatim into the todo list, and when a step names a skill, load that skill with the \`skill\` tool.\n\n### Bug fix\n\n1. Load the \`how\` skill with the \`skill\` tool. See [the mode](${mode}/SKILL.md).\n`,
  )
  assert.equal(byId.get("untitled")[0].description, "Untitled")
  rmSync(root, { recursive: true, force: true })
})

test("every shipped playbook registers under its stem with its Playbooks list entry", () => {
  const dir = join(import.meta.dirname, "..", "src", "skills")
  const stems = readdirSync(join(dir, "poteto-mode", "playbooks")).map((name) => name.replace(/\.md$/, ""))
  const playbooks = readSkills(dir).filter((skill) => skill.kind === "playbook")
  assert.deepEqual(playbooks.map((playbook) => playbook.id).sort(), stems.sort())
  for (const playbook of playbooks) assert.match(playbook.description, /\.$/, `${playbook.id} has a Playbooks list entry`)
  const gated = Object.fromEntries(playbooks.filter((playbook) => playbook.requires.length > 0).map((playbook) => [playbook.id, playbook.requires]))
  assert.deepEqual(gated, {
    "bug-fix": ["how", "why"],
    feature: ["how", "architect"],
    hillclimb: ["how"],
    "perf-issue": ["benchmark-checklist", "how"],
    refactoring: ["how"],
  })
})

const CATALOG = new Map([
  ["perf", { kind: "playbook", id: "perf", title: "Perf issue", requires: ["bench", "how", "why"] }],
  ["notes", { kind: "playbook", id: "notes", title: "Notes", requires: [] }],
  ["how", { kind: "skill", id: "how" }],
])
const editBy = (agent) => ({ tool: "edit", agent, input: { path: "a.js" } })
const spawn = (agent) => ({ tool: "subagent", agent: "build", input: { agent }, status: "completed" })

test("the act gate names each unfinished required skill in order with how to finish it, only for code actions in poteto mode", () => {
  const session = { mode: true, playbook: "perf", loaded: ["how"], ran: [] }
  assert.equal(
    actGate(session, editBy("build"), CATALOG),
    "pstack: the Perf issue playbook runs the `bench`, `how` and `why` skills before any code change. Load `bench` with the `skill` tool and run it, then `how` is loaded but hasn't run: spawn its `explore` subagents as the skill says, then load `why` with the `skill` tool and run it, then retry this call.",
  )
  assert.equal(
    actGate({ ...session, loaded: ["bench", "how", "why"], ran: ["why"] }, editBy("build"), CATALOG),
    "pstack: the Perf issue playbook runs the `how` skill before any code change. `how` is loaded but hasn't run: spawn its `explore` subagents as the skill says, then retry this call.",
  )
  assert.equal(actGate({ ...session, loaded: ["bench", "how", "why"], ran: ["how", "why"] }, editBy("build"), CATALOG), undefined)
  assert.equal(actGate({ ...session, mode: false }, editBy("build"), CATALOG), undefined)
  assert.ok(actGate({ ...session, mode: false }, editBy("poteto-mode"), CATALOG))
  assert.equal(actGate(session, { tool: "subagent", agent: "build", input: { agent: "explore" } }, CATALOG), undefined)
  assert.equal(actGate(session, { tool: "shell", agent: "build", input: { command: "echo > a.js" } }, CATALOG), undefined)
  assert.equal(actGate({ ...session, playbook: "notes" }, editBy("build"), CATALOG), undefined)
  assert.equal(actGate({ ...session, playbook: "gone" }, editBy("build"), CATALOG), undefined)
})

test("a general spawn waits for the required loads but not the runs, so why can spawn its investigators", () => {
  const general = { tool: "subagent", agent: "build", input: { agent: "general" } }
  const delegate = { tool: "subagent", agent: "build", input: { agent: "poteto-agent" } }
  const loadedOnly = { mode: true, playbook: "perf", loaded: ["bench", "how", "why"], ran: [] }
  assert.equal(actGate(loadedOnly, general, CATALOG), undefined)
  assert.match(actGate(loadedOnly, delegate, CATALOG), /`how` is loaded but hasn't run/)
  assert.match(actGate({ ...loadedOnly, loaded: ["how"] }, general, CATALOG), /Load `bench` with the `skill` tool/)
})

test("a completed skill load or pstack skill file read is a load", () => {
  assert.equal(loadedSkill({ tool: "skill", input: { id: "how" }, status: "completed" }, CATALOG), "how")
  assert.equal(loadedSkill({ tool: "skill", input: { id: "how" }, status: "error" }, CATALOG), undefined)
  assert.equal(loadedSkill({ tool: "read", input: { path: "/x/skills/poteto-mode/playbooks/perf.md" }, status: "completed" }, CATALOG), "perf")
  assert.equal(loadedSkill({ tool: "read", input: { path: "/x/skills/how/SKILL.md" }, status: "completed" }, CATALOG), "how")
  assert.equal(loadedSkill({ tool: "read", input: { path: "/x/skills/mine/SKILL.md" }, status: "completed" }, CATALOG), undefined)
})

test("a skill runs only on matching evidence after its load, and a newer playbook replaces the older one", () => {
  const load = (id) => ({ tool: "skill", input: { id }, status: "completed" })
  const shell = (command, status = "completed") => ({ tool: "shell", input: { command }, status })
  const apply = (...events) => events.reduce((record, event) => withEvent(record, event, CATALOG), undefined)

  assert.equal(apply(spawn("explore")), undefined)
  assert.deepEqual(apply(spawn("explore"), load("how")), { loaded: ["how"], ran: [] })
  assert.deepEqual(apply(load("how"), spawn("general"), spawn("explore")), { loaded: ["how"], ran: ["how"] })
  assert.deepEqual(apply(load("why"), shell("git log -p src/a.js", "error"), shell("git status")), { loaded: ["why"], ran: [] })
  assert.deepEqual(apply(load("why"), shell("cd src && git blame a.js")), { loaded: ["why"], ran: ["why"] })
  assert.deepEqual(apply(load("interrogate"), spawn("poteto-agent")), { loaded: ["interrogate"], ran: ["interrogate"] })

  const started = apply(load("how"))
  assert.equal(withEvent(started, load("how"), CATALOG), started)
  assert.equal(withEvent(started, spawn("poteto-agent"), CATALOG), started)
  assert.deepEqual(apply(load("how"), load("perf"), load("notes")), { loaded: ["how"], ran: [], playbook: "notes" })
})
