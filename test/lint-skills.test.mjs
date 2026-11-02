import assert from "node:assert/strict"
import { test } from "node:test"
import { lint } from "../scripts/lint-skills.mjs"

const SKILL = "src/skills/how/SKILL.md"
const HEAD = "---\nname: how\ndescription: How.\n---\n\n"
const nothingExists = () => false
const found = (text, file = SKILL, exists = nothingExists) =>
  lint([{ file, text: file === SKILL ? HEAD + text : text }], exists).map(({ rule, text }) => `${rule} ${text}`)

test("product names in markdown are findings", () => {
  assert.deepEqual(found("Built for Cursor and OpenCode."), ["product Cursor", "product OpenCode"])
  assert.deepEqual(found("Edit ~/.cursor/skills and .cursor-plugin."), ["product .cursor", "product .cursor"])
  assert.deepEqual(found("From cursor-team-kit at github.com/cursor/plugins."), ["product cursor-team-kit", "product github.com/cursor"])
  assert.deepEqual(found("Restart opencode first."), ["product opencode"])
})

test("lowercase opencode in a backticked span, the generic word cursor, and non-markdown code are not findings", () => {
  assert.deepEqual(found("Run `opencode session export <id>` or read `~/.config/opencode/pstack-models.md`."), [])
  assert.deepEqual(found("```sh\nopencode session list --format json\n```\n"), [])
  assert.deepEqual(found("Move the pagination cursor to endCursor."), [])
  assert.deepEqual(found("const { endCursor } = page.pageInfo // Cursor\n", "src/skills/how/scripts/github.ts"), [])
})

test("product strings in a package name are findings outside markdown too", () => {
  assert.deepEqual(found('{\n  "name": "@cursor-skill/statechart",\n  "private": true\n}\n', "src/skills/statechart/scripts/package.json"), [
    "product cursor",
  ])
  assert.deepEqual(found('{\n  "name": "@pstack/statechart",\n  "main": "cursor.js"\n}\n', "src/skills/statechart/scripts/package.json"), [])
})

test("Cursor-only vocabulary is a finding", () => {
  assert.deepEqual(found("Spawn a `Task` with `subagent_type: generalPurpose` and `run_in_background: true`."), [
    "vocab `Task`",
    "vocab subagent_type",
    "vocab generalPurpose",
    "vocab run_in_background",
  ])
  assert.deepEqual(found("If the Task tool rejects it, omit Task `model`."), ["vocab Task tool", "vocab Task `"])
  assert.deepEqual(found('Use `readonly: true`, `environment: "cloud"`, and `AskQuestion`.'), ["vocab readonly:", 'vocab environment: "', "vocab AskQuestion"])
  assert.deepEqual(found("Open a todolist. Write the .mdc rule. Run /loop until green."), ["vocab todolist", "vocab .mdc", "vocab /loop"])
  assert.deepEqual(found("Default to `claude-opus-5-5-xhigh` and `grok-4.7-xhigh-fast`."), ["vocab claude-opus-5-5-xhigh", "vocab grok-4.7-xhigh-fast"])
  assert.deepEqual(found("Read agent-transcripts. Use as Custom Mode. Run create-skill. Call update_state, SendToUser, or Automations."), [
    "vocab agent-transcripts",
    "vocab Custom Mode",
    "vocab create-skill",
    "vocab update_state",
    "vocab SendToUser",
    "vocab Automations",
  ])
})

test("the generic words those terms share are not findings", () => {
  assert.deepEqual(found("## <Task as a verb phrase>\n\nTask: finish the task list. Open a todo list with `todowrite`."), [])
  assert.deepEqual(found("Pass `claude-opus-5-5#xhigh` or `grok-4.7`. Loop on src/loop until done."), [])
})

test("a relative link must point at a file that exists", () => {
  const exists = (path) => path.endsWith("src/skills/why/SKILL.md")
  assert.deepEqual(found("See [why](../why/SKILL.md) and [gone](../gone/SKILL.md#top).", SKILL, exists), ["link ../gone/SKILL.md#top"])
  assert.deepEqual(found("See [docs](https://example.com/x), [below](#usage), and [root](/etc/hosts).", SKILL, exists), [])
  assert.deepEqual(found("An example: `[PR](missing.md)`.", SKILL, exists), [])
})

test("a named skill must be an ID the skill tool can load", () => {
  const exists = (path) => path.endsWith("src/skills/why/SKILL.md")
  assert.deepEqual(found("Use the `why` skill, the `skill-creator` skill, and the `gone` skill.", SKILL, exists), ["skill-id the `gone` skill"])
  assert.deepEqual(found("Use the **why** skill and the **prove-it-works** principle skill.", SKILL, exists), [
    "skill-id the **why** skill",
    "skill-id the **prove-it-works** principle skill",
  ])
})

test("a poteto-mode playbook stem is a skill ID too", () => {
  const exists = (path) => path.endsWith("src/skills/poteto-mode/playbooks/bug-fix.md")
  assert.deepEqual(found("Load the `bug-fix` skill, not the `bug-fixes` skill.", SKILL, exists), ["skill-id the `bug-fixes` skill"])
})

test("a SKILL.md names its folder and has a description", () => {
  assert.deepEqual(
    lint([{ file: SKILL, text: "---\nname: what\n---\n\n# How\n" }]).map(({ line, rule, text }) => `${line} ${rule} ${text}`),
    ['1 frontmatter name "what" is not the folder "how"', "1 frontmatter description is missing"],
  )
  assert.deepEqual(found("# How\n"), [])
  assert.deepEqual(found("---\nname: other\n---\n", "src/skills/how/references/notes.md"), [])
})
