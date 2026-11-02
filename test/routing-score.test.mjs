import assert from "node:assert/strict"
import { join } from "node:path"
import { test } from "node:test"
import { catalogOf, decided, report, scenarios, score, selectScenarios, summarize } from "../.opencode/skills/verify-pstack/scripts/routing-score.mjs"

let clock = 0
const tool = (name, input) => ({ type: "tool", name, state: { status: "completed", input }, time: { created: ++clock } })
const skill = (id) => tool("skill", { id })
const failedSkill = (id) => ({ ...skill(id), state: { status: "error", input: { id }, error: `Unable to load skill ${id}` } })
const delegate = (agent = "poteto-agent") => tool("subagent", { agent, description: "build it", prompt: "..." })
const edit = () => tool("edit", { path: "src/money.js", oldString: "a", newString: "b" })
const commit = (command = "git add src/money.js && git commit -qm 'Add discounts'") => tool("shell", { command })
const read = (path = "src/money.js") => tool("read", { path })
const readPlaybook = (stem) => read(`/repo/src/skills/poteto-mode/playbooks/${stem}.md`)
const todos = (...contents) => tool("todowrite", { todos: contents.map((content) => ({ content, status: "pending" })) })

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

test("deslop_before_commit passes when each committing session loads deslop before its first commit", () => {
  const result = check("feature-agent", tree(session("poteto-mode", [delegate()]), session("poteto-agent", [edit(), skill("deslop"), commit(), edit(), commit()])), "deslop_before_commit")
  assert.deepEqual(result, { pass: true, detail: "1/1 committing sessions loaded deslop before their first commit", fraction: 1 })
})

test("deslop_before_commit fails on a commit before deslop", () => {
  assert.equal(check("feature-agent", tree(session("poteto-mode", [edit(), commit(), skill("deslop"), commit()])), "deslop_before_commit").pass, false)
})

test("deslop_before_commit does not let one session's deslop cover another's commit, and fails with no commits", () => {
  const crossed = tree(session("poteto-mode", [skill("deslop"), delegate()]), session("poteto-agent", [edit(), commit()]))
  assert.equal(check("feature-agent", crossed, "deslop_before_commit").pass, false)
  const parentCommits = tree(session("poteto-mode", [delegate(), commit()]), session("poteto-agent", [skill("deslop"), edit(), commit()]))
  assert.equal(check("feature-agent", parentCommits, "deslop_before_commit").detail, "1/2 committing sessions loaded deslop before their first commit")
  assert.deepEqual(check("feature-agent", tree(session("poteto-mode", [skill("deslop"), edit()])), "deslop_before_commit"), {
    pass: false,
    detail: "0/0 committing sessions loaded deslop before their first commit",
    fraction: 0,
  })
})

test("a provider error in any session makes the run an error, not a scored failure", () => {
  const child = session("poteto-agent", [edit()])
  child.messages.push({ type: "assistant", error: { type: "provider.unknown", message: "You've hit your 5-hour limit" }, content: [] })
  const summary = summarize([{ id: "r1", scenario: "feature-agent", exit: 0, sessionTree: tree(session("poteto-mode", [skill("how"), delegate()]), child) }])
  assert.equal(summary.errors, 1)
  assert.equal(summary.scored, 0)
  assert.match(summary.runs[0].error, /provider error in poteto-agent session: You've hit your 5-hour limit/)
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

test("the matrix playbook check passes on a read of the expected playbook", () => {
  const result = check("matrix:bug@agent", tree(session("poteto-mode", [readPlaybook("bug-fix"), skill("how")])), "playbook")
  assert.equal(result.pass, true)
  assert.equal(result.picked, "bug-fix")
})

test("a completed skill load of a playbook stem picks that playbook, and a failed load does not", () => {
  const loaded = check("matrix:bug@build", tree(session("build", [skill("bug-fix"), edit()])), "playbook")
  assert.deepEqual([loaded.pass, loaded.picked], [true, "bug-fix"])
  const failed = check("matrix:bug@build", tree(session("build", [failedSkill("bug-fix"), edit()])), "playbook")
  assert.deepEqual([failed.pass, failed.picked], [false, null])
})

test("a playbook stem counts as a pick only when the runtime catalog lists it as loadable", () => {
  const claude = { ...tree(session("claude", [skill("bug-fix"), edit()])), catalog: catalogOf(join(import.meta.dirname, "..", "src", "skills"), ["how"]) }
  assert.equal(check("matrix:bug@cc-slash", claude, "playbook").picked, null)
})

test("stay_out fails on a playbook loaded as a skill", () => {
  const result = check("matrix:typo@build", tree(session("build", [skill("bug-fix"), edit()])), "stay_out")
  assert.deepEqual([result.pass, result.picked], [false, "bug-fix"])
  assert.match(result.detail, /hidden skills bug-fix$/)
})

test("a playbook or SKILL.md read through the shell counts as a read or a load", () => {
  const root = "/tmp/pin/skills"
  const direct = check("matrix:feature@cc-slash", tree(session("build", [commit(`git ls-files; cat ${root}/poteto-mode/playbooks/feature.md`)])), "playbook")
  assert.deepEqual([direct.pass, direct.picked], [true, "feature"])
  const cd = check("matrix:feature@cc-slash", tree(session("build", [commit(`cd ${root}/poteto-mode/playbooks/ && cat feature.md`)])), "playbook")
  assert.equal(cd.pass, true)
  const loaded = check("matrix:feature@cc-slash", tree(session("build", [commit(`cd ${root} && cat how/SKILL.md`), edit()])), "skills")
  assert.equal(loaded.pass, true)
})

test("the matrix playbook check passes when the first todowrite carries step 1, whitespace and backticks aside", () => {
  const result = check("matrix:feature@build", tree(session("build", [todos("Load the how skill with the  skill tool\nand run it over the affected subsystem.", "Name the data shape")])), "playbook")
  assert.deepEqual([result.pass, result.picked], [true, "feature"])
})

test("the matrix playbook check fails on a wrong pick and names it", () => {
  const result = check("matrix:bug@agent", tree(session("poteto-mode", [readPlaybook("feature"), edit()])), "playbook")
  assert.equal(result.pass, false)
  assert.equal(result.picked, "feature")
  assert.match(result.detail, /^picked feature;/)
})

test("skills_ran wants the skill's own work between its load and the first code action", () => {
  const loadedOnly = tree(session("poteto-mode", [skill("how"), delegate()]))
  assert.equal(check("matrix:bug@agent", loadedOnly, "skills_ran").pass, false)
  const ran = tree(session("poteto-mode", [skill("how"), delegate("explore"), delegate()]))
  assert.equal(check("matrix:bug@agent", ran, "skills_ran").detail, "how ran before acting")
  const why = tree(session("poteto-mode", [skill("why"), commit("git log --oneline -- src/money.js"), edit()]))
  assert.equal(check("matrix:bug@agent", why, "skills_ran").pass, true)
})

test("a gate-rejected call is not the moment the session acted", () => {
  const rejected = { ...edit(), state: { status: "error", input: {} } }
  const run = tree(session("poteto-mode", [skill("feature"), rejected, skill("how"), delegate("explore"), edit()]))
  assert.equal(check("matrix:feature@agent", run, "skills_ran").pass, true)
  assert.equal(decided(tree(session("poteto-mode", [skill("feature"), rejected]))), false)
})

test("the matrix skills check fails when the skill loads only after the first edit", () => {
  const late = check("matrix:bug@agent", tree(session("poteto-mode", [read(), edit(), skill("how")])), "skills")
  assert.equal(late.pass, false)
  assert.match(late.detail, /first loads how$/)
  const childEdit = session("general", [edit()])
  assert.equal(check("matrix:bug@agent", tree(session("poteto-mode", [delegate("general"), skill("why")]), childEdit), "skills").pass, false)
  assert.equal(check("matrix:bug@agent", tree(session("poteto-mode", [skill("tdd"), skill("how"), delegate()])), "skills").pass, true)
})

test("stay_out fails on a hidden skill or a playbook read, and ignores the mode's own attachment", () => {
  assert.deepEqual(check("matrix:typo@build", tree(session("build", [skill("how"), edit()])), "stay_out").pass, false)
  assert.deepEqual(check("matrix:typo@build", tree(session("build", [readPlaybook("feature"), edit()])), "stay_out").pass, false)
  assert.equal(check("matrix:typo@build", tree(session("build", [skill("deslop"), edit(), commit()])), "stay_out").pass, true)
  assert.equal(check("matrix:typo@agent", tree(session("poteto-mode", [edit()], { skills: ["poteto-mode"] })), "stay_out").pass, true)
  assert.equal(check("matrix:typo@build", tree(session("build", [edit()], { skills: ["poteto-mode"] })), "stay_out").pass, false)
})

test("decided fires on the parent's first edit or poteto-agent delegation only", () => {
  assert.equal(decided(tree(session("poteto-mode", [read(), skill("how")]))), false)
  assert.equal(decided(tree(session("poteto-mode", [delegate("explore")]), session("explore", [edit()]))), false)
  assert.equal(decided(tree(session("poteto-mode", [delegate()]))), true)
  assert.equal(decided(tree(session("build", [edit()]))), true)
  assert.equal(decided(tree(session("poteto-mode", [tool("shell", { command: "git mv src/cart src/basket" }), commit()]))), true)
})

test("matrix shorthands expand to registry rows under both entries", () => {
  assert.equal(selectScenarios(["matrix"]).length, 22)
  assert.ok(selectScenarios(["matrix@build"]).every((name) => scenarios[name].drive.agent === "build"))
  assert.deepEqual(selectScenarios(["matrix:typo@agent", "investigate"]), ["matrix:typo@agent", "investigate"])
  assert.deepEqual(selectScenarios(["matrix@nope"]), ["matrix@nope"])
})

test("compare covers agent, slash and cc-slash, and a case filter keeps only those rows", () => {
  assert.deepEqual(selectScenarios(["compare"], ["typo"]), ["matrix:typo@agent", "matrix:typo@slash", "matrix:typo@cc-slash"])
  assert.deepEqual(selectScenarios(["matrix@cc"], ["how", "bug"]), ["matrix:bug@cc-slash", "matrix:how@cc-slash"])
  assert.deepEqual(selectScenarios(["matrix:typo@build", "investigate"], ["bug"]), ["investigate"])
  assert.equal(scenarios["matrix:typo@slash"].drive.command, "poteto-mode")
})

test("stay_out allows the poteto-mode attachment that /poteto-mode puts on the first message", () => {
  assert.equal(check("matrix:typo@slash", tree(session("build", [edit()], { skills: ["poteto-mode"] })), "stay_out").pass, true)
})

test("stay_out passes when the only pstack trace is a no playbook todo", () => {
  for (const id of ["matrix:typo@agent", "matrix:question@agent"]) {
    assert.equal(check(id, tree(session("poteto-mode", [todos("no playbook: one-line typo"), edit()], { skills: ["poteto-mode"] })), "stay_out").pass, true, id)
  }
  assert.equal(check("matrix:typo@build", tree(session("build", [todos("no playbook: one-line typo"), edit()])), "stay_out").pass, true)
})

test("an early-stopped matrix run is scored, and the table shows checks and the picked playbook", () => {
  const stopped = session("poteto-mode", [readPlaybook("feature"), edit()])
  stopped.messages.push({ type: "assistant", error: { type: "aborted", message: "Step interrupted" }, content: [] })
  const summary = summarize([
    { id: "a", scenario: "matrix:bug@agent", exit: 0, stoppedBy: "decision", durationMs: 1, sessionTree: tree(stopped) },
    { id: "b", scenario: "matrix:question@build", exit: 0, stoppedBy: "idle", durationMs: 1, sessionTree: tree(session("build", [])) },
  ])
  assert.equal(summary.errors, 0)
  const lines = report(summary).split("\n")
  assert.match(lines[0], /^case\s+\| agent\s+\| build$/)
  assert.match(lines[1], /^bug\s+\| playbook 0\/1 {2}skills 0\/1 {2}skills_ran 0\/1 {2}picked feature\s+\| -$/)
  assert.match(lines[2], /^question\s+\| -\s+\| stay_out 1\/1 {2}picked none$/)
  assert.equal(lines.at(-1), "routing_accuracy=0.25 errors=0 work=2/2 commits=0 toolcalls=2")
})
