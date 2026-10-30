import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { commandDescription, commandPrompt, entryOps, parseFrontmatter, readSkills } from "../src/plugin/lib.js"

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
