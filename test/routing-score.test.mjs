import assert from "node:assert/strict"
import { test } from "node:test"
import { report, score, summarize } from "../.opencode/skills/verify-pstack/scripts/routing-score.mjs"

let clock = 0
const tool = (name, input) => ({ type: "tool", name, state: { status: "completed", input }, time: { created: ++clock } })
const skill = (id) => tool("skill", { id })
const delegate = (agent = "poteto-agent") => tool("subagent", { agent, description: "build it", prompt: "..." })
const edit = () => tool("edit", { path: "src/money.js", oldString: "a", newString: "b" })
const commit = (command = "git add src/money.js && git commit -qm 'Add discounts'") => tool("shell", { command })
const read = () => tool("read", { path: "src/money.js" })

function session(agent, parts, { skills = [], entries } = {}) {
  return {
    info: { id: `ses_${agent}_${++clock}`, agent },
    messages: [
      { type: "user", text: "task", skills: skills.map((id) => ({ id })) },
      { type: "assistant", content: parts },
    ],
    ...(entries ? { entries } : {}),
  }
}

const tree = (parent, ...children) => ({ parent, children })
const check = (scenario, t, name) => score(scenario, t).checks[name]

test("how_before_code passes only when how loads before the first poteto-agent delegation", () => {
  assert.equal(check("feature-agent", tree(session("poteto-mode", [skill("how"), delegate()])), "how_before_code").pass, true)
  assert.equal(check("feature-agent", tree(session("poteto-mode", [delegate(), skill("how")])), "how_before_code").pass, false)
  assert.equal(check("feature-agent", tree(session("poteto-mode", [read(), delegate()])), "how_before_code").pass, false)
})

test("how_before_code anchors on the parent's first edit when it never delegates", () => {
  assert.equal(check("feature-agent", tree(session("poteto-mode", [edit(), skill("how"), edit()])), "how_before_code").pass, false)
  assert.equal(check("feature-agent", tree(session("poteto-mode", [skill("how"), edit()])), "how_before_code").pass, true)
  assert.equal(check("feature-agent", tree(session("poteto-mode", [delegate("explore"), skill("how"), edit()])), "how_before_code").pass, true)
})

test("architect_before_code accepts architect or arena and ignores a child's load", () => {
  assert.equal(check("feature-agent", tree(session("poteto-mode", [skill("arena"), delegate()])), "architect_before_code").pass, true)
  assert.equal(check("feature-agent", tree(session("poteto-mode", [skill("architect"), delegate()])), "architect_before_code").pass, true)
  assert.equal(check("feature-agent", tree(session("poteto-mode", [delegate()]), session("poteto-agent", [skill("architect"), edit()])), "architect_before_code").pass, false)
})

test("delegated needs a poteto-agent descendant that wrote code", () => {
  const parent = session("poteto-mode", [delegate()])
  assert.equal(check("feature-agent", tree(parent, session("poteto-agent", [read(), edit()])), "delegated").pass, true)
  assert.equal(check("feature-agent", tree(parent, session("poteto-agent", [read()])), "delegated").pass, false)
  assert.equal(check("feature-agent", tree(parent, session("general", [edit()])), "delegated").pass, false)
})

test("deslop_before_each_commit passes when every commit follows its own deslop", () => {
  const result = check("feature-agent", tree(session("poteto-mode", [delegate()]), session("poteto-agent", [edit(), skill("deslop"), commit(), edit(), skill("deslop"), commit()])), "deslop_before_each_commit")
  assert.deepEqual(result, { pass: true, detail: "2/2 commits preceded by deslop in their session", fraction: 1 })
})

test("deslop_before_each_commit fails on a commit before deslop and on deslop after the commit", () => {
  assert.equal(check("feature-agent", tree(session("poteto-mode", [edit(), commit(), skill("deslop")])), "deslop_before_each_commit").pass, false)
  const late = check("feature-agent", tree(session("poteto-mode", [skill("deslop"), commit(), edit(), commit(), skill("deslop")])), "deslop_before_each_commit")
  assert.equal(late.pass, false)
  assert.equal(late.fraction, 0.5)
})

test("deslop_before_each_commit does not let one session's deslop cover another's commit, and fails with no commits", () => {
  const crossed = tree(session("poteto-mode", [skill("deslop"), delegate()]), session("poteto-agent", [edit(), commit()]))
  assert.equal(check("feature-agent", crossed, "deslop_before_each_commit").pass, false)
  assert.deepEqual(check("feature-agent", tree(session("poteto-mode", [skill("deslop"), edit()])), "deslop_before_each_commit"), {
    pass: false,
    detail: "0/0 commits preceded by deslop in their session",
    fraction: 0,
  })
})

test("commit detection reads git flags before the subcommand and ignores look-alikes", () => {
  const commits = (command) => score("feature-agent", tree(session("poteto-mode", [commit(command)]))).counts.commits
  assert.equal(commits("git -C /tmp/proj -c user.name=x commit -m y"), 1)
  assert.equal(commits("git commit-tree HEAD^{tree}"), 0)
  assert.equal(commits("git log --grep commit"), 0)
})

test("no_comments_before_commit orders across sessions by time and fails with no commits", () => {
  const before = tree(session("poteto-mode", [delegate()]), session("poteto-agent", [skill("no-comments"), edit(), commit()]))
  assert.equal(check("feature-agent", before, "no_comments_before_commit").pass, true)
  const parent = session("poteto-mode", [delegate()])
  const child = session("poteto-agent", [edit(), commit()])
  parent.messages[1].content.push(skill("no-comments"))
  assert.equal(check("feature-agent", tree(parent, child), "no_comments_before_commit").pass, false)
  assert.equal(check("feature-agent", tree(session("poteto-mode", [skill("no-comments")])), "no_comments_before_commit").pass, false)
})

test("unslop_parent and how_loaded count only the parent's loads", () => {
  const childOnly = tree(session("poteto-mode", [delegate()]), session("poteto-agent", [skill("unslop"), skill("how")]))
  assert.equal(check("investigate", childOnly, "unslop_parent").pass, false)
  assert.equal(check("investigate", childOnly, "how_loaded").pass, false)
  const parent = tree(session("poteto-mode", [skill("how"), read(), skill("unslop")]))
  assert.equal(check("investigate", parent, "how_loaded").pass, true)
  assert.equal(check("investigate", parent, "unslop_parent").pass, true)
})

test("the plain-build gate wants a commit, no mode entry, and no hidden pstack skill", () => {
  const clean = score("plain-build", tree(session("build", [skill("deslop"), edit(), commit()], { entries: [{ key: "pstack-models", value: "..." }] }))).checks
  assert.deepEqual(Object.fromEntries(Object.entries(clean).map(([name, result]) => [name, result.pass])), { committed: true, no_mode_entry: true, no_hidden_skill: true })

  const moded = score("plain-build", tree(session("build", [edit()], { entries: [{ key: "pstack-mode", value: "poteto mode is on" }], skills: ["poteto-mode"] }))).checks
  assert.equal(moded.committed.pass, false)
  assert.equal(moded.no_mode_entry.pass, false)
  assert.deepEqual(moded.no_hidden_skill, { pass: false, detail: "loaded poteto-mode" })

  assert.equal(score("plain-build", tree(session("build", [skill("how"), commit()], { entries: [] }))).checks.no_hidden_skill.pass, false)
  assert.deepEqual(score("plain-build", tree(session("build", [commit()]))).checks.no_mode_entry, { pass: false, detail: "instruction entries were not captured" })
})

test("summarize scores clean runs, counts failures as errors, and prints the metric line last", () => {
  const good = tree(session("poteto-mode", [skill("how"), read(), skill("unslop")]))
  const half = tree(session("poteto-mode", [read(), skill("unslop")]))
  const gate = tree(session("build", [edit(), commit()], { entries: [] }))
  const records = [
    { id: "a", scenario: "investigate", exit: 0, durationMs: 1, sessionTree: good },
    { id: "b", scenario: "investigate", exit: 0, durationMs: 1, sessionTree: half },
    { id: "c", scenario: "investigate", exit: null, error: "timeout after 1200000ms", durationMs: 1, sessionTree: good },
    { id: "d", scenario: "investigate", exit: 0, durationMs: 1, sessionTree: tree(session("poteto-mode", [])) },
    { id: "e", scenario: "plain-build", exit: 0, durationMs: 1, sessionTree: gate },
  ]
  const summary = summarize(records, 6)
  assert.equal(summary.routingAccuracy, 3 / 4)
  assert.equal(summary.errors, 2)
  assert.deepEqual(summary.table.investigate, { runs: 4, scored: 2, checks: { how_loaded: 1, unslop_parent: 2 } })
  assert.equal(summary.gates[0].pass, true)
  const lines = report(summary).split("\n")
  assert.ok(lines.includes("gate=pass plain-build scored=1/1 committed=1/1 no_mode_entry=1/1 no_hidden_skill=1/1"))
  assert.ok(lines.includes("error d: no tool calls"))
  assert.equal(lines.at(-1), "routing_accuracy=0.75 errors=2 work=3/6 commits=1 toolcalls=7")
})
