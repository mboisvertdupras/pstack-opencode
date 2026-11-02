import assert from "node:assert/strict"
import { test } from "node:test"
import { stopFor } from "../.opencode/skills/verify-pstack/scripts/claude-code.mjs"
import { sessionTree } from "../.opencode/skills/verify-pstack/scripts/claude-stream.mjs"
import { report, score, summarize } from "../.opencode/skills/verify-pstack/scripts/routing-score.mjs"

const PIN = "/tmp/pstack-cc-x/cache/pstack-claude/pstack/0.9.120"
const catalog = {
  pstack: ["how", "why", "poteto-mode", "deslop"],
  stepOnes: [
    ["bug-fix", "reproduce it yourself on the matching surface via the driver"],
    ["investigation", "route through the how skill. for motivation questions, also"],
  ],
}
const context = { prompt: "task", skills: ["poteto-mode"], catalog }

let next = 0
const use = (name, input, parent) => ({ type: "assistant", parent_tool_use_id: parent ?? null, message: { content: [{ type: "tool_use", id: `toolu_${++next}`, name, input }] } })
const init = { type: "system", subtype: "init", session_id: "cc-session", plugins: [] }
const spawnAgent = (id) => ({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id, name: "Agent", input: { subagent_type: "pstack:poteto-agent", description: "fix", prompt: "..." } }] } })

const bugStream = [
  init,
  use("Skill", { skill: "pstack:how" }),
  use("Read", { file_path: `${PIN}/skills/poteto-mode/playbooks/bug-fix.md` }),
  use("TaskCreate", { subject: "Reproduce it yourself", description: "on the matching surface via the driver skill" }),
  use("TaskCreate", { subject: "Root-cause it" }),
  spawnAgent("toolu_child"),
  use("Read", { file_path: "src/money.js" }, "toolu_child"),
  use("Edit", { file_path: "src/money.js", old_string: "a", new_string: "b" }, "toolu_child"),
  use("Bash", { command: "git commit -qm fix" }, "toolu_child"),
]

test("the adapter strips the pstack skill prefix and counts a playbook read under the pin", () => {
  const tree = sessionTree(bugStream, context)
  const checks = score("matrix:bug@cc-slash", tree).checks
  assert.deepEqual([checks.playbook.pass, checks.playbook.picked], [true, "bug-fix"])
  assert.equal(checks.skills.pass, true)
  assert.match(checks.skills.detail, /^how loaded before/)
})

test("a run of TaskCreate calls is one todo list that carries the playbook's step 1", () => {
  const stream = [init, use("TaskCreate", { subject: "Route through the how skill.", description: "For motivation questions, also route through why." }), use("TaskCreate", { subject: "Write the answer" })]
  const tree = sessionTree(stream, context)
  const todos = tree.parent.messages.flatMap((message) => message.content ?? []).filter((part) => part.name === "todowrite")
  assert.equal(todos.length, 1)
  assert.equal(todos[0].state.input.todos.length, 2)
  assert.deepEqual(score("matrix:how@cc-slash", tree).checks.playbook.picked, "investigation")
})

test("an Agent child's tool calls land in the child session under its unprefixed agent", () => {
  const tree = sessionTree(bugStream, context)
  assert.equal(tree.children.length, 1)
  assert.equal(tree.children[0].info.agent, "poteto-agent")
  assert.deepEqual(
    tree.children[0].messages.flatMap((message) => message.content).map((part) => part.name),
    ["read", "edit", "shell"],
  )
  assert.deepEqual(
    tree.parent.messages.flatMap((message) => message.content ?? []).map((part) => part.name),
    ["skill", "read", "todowrite", "subagent"],
  )
  assert.equal(score("matrix:bug@cc-slash", tree).counts.commits, 1)
})

test("the driver stops on the parent's first Edit and on a poteto-agent spawn, not on a child's edit", () => {
  const parentEdit = [init, use("Read", { file_path: "README.md" }), use("Edit", { file_path: "README.md", old_string: "recieve", new_string: "receive" })]
  assert.equal(stopFor(parentEdit.slice(0, 2), context), undefined)
  assert.equal(stopFor(parentEdit, context), "decision")
  const explore = [init, { ...spawnAgent("toolu_e"), message: { content: [{ type: "tool_use", id: "toolu_e", name: "Agent", input: { subagent_type: "Explore" } }] } }, use("Edit", { file_path: "x" }, "toolu_e")]
  assert.equal(stopFor(explore, context), undefined)
  assert.equal(stopFor(bugStream.slice(0, 6), context), "decision")
})

test("the driver waits for background tasks before treating a result as idle", () => {
  const result = { type: "result", subtype: "success", is_error: false }
  const running = [init, { type: "system", subtype: "task_started", task_id: "t1" }, result]
  assert.equal(stopFor(running, context), undefined)
  assert.equal(stopFor([...running, { type: "system", subtype: "task_notification", task_id: "t1" }, result], context), "idle")
})

test("an early-stopped Claude Code record scores from its stream and shows beside OpenCode in the table", () => {
  const stopped = [init, use("Skill", { skill: "pstack:how" }), use("Edit", { file_path: "README.md" })]
  const summary = summarize([
    { id: "a", scenario: "matrix:typo@cc-slash", runtime: "claude", exit: 0, stoppedBy: "decision", durationMs: 1, stream: stopped, catalog },
    { id: "b", scenario: "matrix:typo@agent", runtime: "opencode", exit: 0, stoppedBy: "idle", durationMs: 1, sessionTree: { parent: { info: { agent: "poteto-mode" }, messages: [{ type: "user", skills: [{ id: "poteto-mode" }] }] }, children: [] } },
  ])
  assert.equal(summary.errors, 0)
  assert.equal(summary.runs[0].checks.stay_out.detail, "playbooks none; hidden skills how")
  const lines = report(summary).split("\n")
  assert.match(lines[0], /^case\s+\| agent\s+\| cc-slash$/)
  assert.equal(lines.at(-2), "claude_accuracy=0.00 opencode_accuracy=1.00")
})

test("a Claude Code error result makes the run an error", () => {
  const failed = [init, use("Read", { file_path: "README.md" }), { type: "result", subtype: "success", is_error: true, result: "API Error: overloaded" }]
  const summary = summarize([{ id: "a", scenario: "matrix:bug@cc-slash", exit: 0, durationMs: 1, stream: failed, catalog }])
  assert.match(summary.runs[0].error, /API Error: overloaded/)
})
