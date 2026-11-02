import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { commandDescription, commandPrompt, entryOps, parseFrontmatter, playbookDescriptions, playbookSkills, readSkills } from "../src/plugin/lib.js"

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
  writeFileSync(join(mode, "playbooks", "bug-fix.md"), "### Bug fix\n\n1. Load the `how` skill with the `skill` tool. See [the mode](../SKILL.md).\n")
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
    description: "A defect to fix.",
    path: join(mode, "playbooks", "bug-fix.md"),
    content: undefined,
    autoinvoke: false,
    skills: ["how"],
  })
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
})
