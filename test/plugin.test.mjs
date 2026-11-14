import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import plugin from "../src/plugin/index.js"
import { parseFrontmatter } from "../src/plugin/lib.js"

const SRC = join(import.meta.dirname, "..", "src")
const BUNDLED_AGENTS = readdirSync(join(SRC, "agents")).filter((name) => name.endsWith(".md")).length

// A fake OpenCode plugin context that records what the plugin registers and what it sends.
function fakeContext({ modelsFile, sessions = {}, registered = [], storage = {}, agents = {} } = {}) {
  const state = { skills: [], commands: [], hooks: {}, prompts: [], entries: {}, storage, agents: new Map(Object.entries(agents)) }
  const entriesOf = (sessionID) => (state.entries[sessionID] ??= {})
  const agentEditor = {
    list: () => [...state.agents.values()],
    get: (id) => state.agents.get(id),
    update: (id, fn) => {
      const draft = structuredClone(state.agents.get(id) ?? coreAgent(id))
      fn(draft)
      state.agents.set(id, draft)
    },
    remove: (id) => state.agents.delete(id),
  }
  const ctx = {
    options: { modelsFile: modelsFile ?? join(mkdtempSync(join(tmpdir(), "pstack-")), "missing.md") },
    agent: { transform: async (fn) => fn(agentEditor) },
    skill: {
      transform: async (fn) => fn({ add: (skill) => state.skills.push(skill) }),
      list: async () => ({ data: [...state.skills, ...registered].reverse() }),
    },
    command: { transform: async (fn) => fn({ add: (command) => state.commands.push(command) }) },
    tool: {
      hook: async (name, fn) => {
        state.hooks[name] = fn
      },
    },
    session: {
      hook: async (name, fn) => {
        state.hooks[name] = fn
      },
      get: async ({ sessionID }) => sessions[sessionID],
      prompt: async (input) => {
        state.prompts.push(input)
      },
      instructions: {
        entry: {
          list: async ({ sessionID }) => Object.entries(entriesOf(sessionID)).map(([key, value]) => ({ key, value })),
          put: async ({ sessionID, key, value }) => {
            entriesOf(sessionID)[key] = value
          },
          remove: async ({ sessionID, key }) => {
            delete entriesOf(sessionID)[key]
          },
        },
      },
    },
    storage: {
      get: async (key) => state.storage[key],
      set: async (key, value) => {
        state.storage[key] = value
      },
    },
  }
  return { ctx, state, agentEditor }
}

const coreAgent = (id) => ({ id, name: id, mode: "primary", hidden: false, permissions: [{ permission: "*", pattern: "*", action: "allow" }], request: { temperature: 0 } })

const bundledBody = (name) => parseFrontmatter(readFileSync(join(SRC, "agents", `${name}.md`), "utf8")).body

test("registers poteto-mode as a primary agent and poteto-agent, comment-sicko, and the thermo reviewers as subagents, with their shipped prompts", async () => {
  const { ctx, state } = fakeContext()
  await plugin.setup(ctx)
  assert.deepEqual([...state.agents.keys()].sort(), ["comment-sicko", "poteto-agent", "poteto-mode", "thermo-nuclear-code-quality-review-subagent", "thermo-nuclear-review-subagent"])
  const mode = state.agents.get("poteto-mode")
  assert.equal(mode.mode, "primary")
  assert.equal(mode.color, "#e5c07b")
  assert.match(mode.description, /^poteto's agent style as a persistent mode\./)
  assert.equal(mode.system, undefined, "poteto-mode ships no prompt body")
  const delegate = state.agents.get("poteto-agent")
  assert.equal(delegate.mode, "subagent")
  assert.equal(delegate.color, "#e5c07b")
  assert.equal(delegate.system, bundledBody("poteto-agent"))
  assert.match(delegate.system, /^# Poteto subagent/)
  const sicko = state.agents.get("comment-sicko")
  assert.equal(sicko.mode, "subagent")
  assert.equal(sicko.color, undefined)
  assert.equal(sicko.system, bundledBody("comment-sicko"))
  for (const id of ["thermo-nuclear-review-subagent", "thermo-nuclear-code-quality-review-subagent"]) {
    assert.equal(state.agents.get(id).mode, "subagent")
    assert.equal(state.agents.get(id).system, bundledBody(id))
  }
  for (const id of state.agents.keys()) {
    assert.equal(state.agents.get(id).name, id)
    assert.equal(state.agents.get(id).hidden, false)
    assert.deepEqual(state.agents.get(id).permissions, coreAgent(id).permissions, `${id} keeps the core permissions`)
    assert.deepEqual(state.agents.get(id).request, coreAgent(id).request, `${id} keeps the core request settings`)
  }
})

test("an agent already registered under a pstack ID is left as it was", async () => {
  const mine = { id: "poteto-agent", name: "poteto-agent", description: "mine", mode: "all", hidden: true }
  const { ctx, state } = fakeContext({ agents: { "poteto-agent": mine, build: coreAgent("build") } })
  await plugin.setup(ctx)
  assert.deepEqual(state.agents.get("poteto-agent"), mine)
  assert.deepEqual(state.agents.get("build"), coreAgent("build"))
  assert.equal(state.agents.size, BUNDLED_AGENTS + 1)
})

test("setting up twice on the same agents changes nothing the second time", async () => {
  const { ctx, state } = fakeContext()
  await plugin.setup(ctx)
  const first = structuredClone([...state.agents])
  await plugin.setup(ctx)
  assert.equal(state.agents.size, BUNDLED_AGENTS)
  assert.deepEqual([...state.agents], first)
})

test("a user agent file loaded after the plugin wins on the fields it sets and keeps pstack's others", async () => {
  const { ctx, state, agentEditor } = fakeContext()
  await plugin.setup(ctx)
  agentEditor.update("poteto-mode", (draft) => {
    draft.description = "my mode"
    draft.color = "#000000"
  })
  const mode = state.agents.get("poteto-mode")
  assert.equal(mode.description, "my mode")
  assert.equal(mode.color, "#000000")
  assert.equal(mode.mode, "primary")
  assert.equal(state.agents.size, BUNDLED_AGENTS)
})

test("registers every bundled skill and every poteto-mode playbook, hidden unless its frontmatter lets the model invoke it", async () => {
  const { ctx, state } = fakeContext()
  await plugin.setup(ctx)
  const folders = readdirSync(join(SRC, "skills")).sort()
  const stems = readdirSync(join(SRC, "skills", "poteto-mode", "playbooks")).map((name) => name.replace(/\.md$/, ""))
  assert.deepEqual(state.skills.filter((skill) => skill.kind === "skill").map((skill) => skill.id), folders)
  assert.deepEqual(state.skills.filter((skill) => skill.kind === "playbook").map((skill) => skill.id).sort(), stems.sort())
  const byId = Object.fromEntries(state.skills.map((skill) => [skill.id, skill]))
  assert.equal(byId["poteto-mode"].autoinvoke, false)
  assert.equal(byId["setup-pstack"].autoinvoke, true)
  assert.ok(byId.deslop && byId["control-cli"] && byId["control-ui"])
  for (const skill of state.skills) {
    assert.ok(skill.description, `${skill.id} has a description`)
    assert.ok(!skill.content.startsWith("---"), `${skill.id} content has no frontmatter`)
  }
})

test("adds a slash command for every skill except the principles and the playbooks", async () => {
  const { ctx, state } = fakeContext()
  await plugin.setup(ctx)
  const names = state.commands.map((command) => command.name)
  assert.ok(names.includes("poteto-mode") && names.includes("how") && names.includes("deslop"))
  assert.equal(names.filter((name) => name.startsWith("principle-")).length, 0)
  assert.ok(!names.includes("bug-fix"))
  assert.equal(names.length, state.skills.filter((skill) => skill.kind === "skill" && !skill.id.startsWith("principle-")).length)
})

test("/how attaches the how skill to the user's message", async () => {
  const { ctx, state } = fakeContext({ sessions: { s1: { agent: "build", location: { directory: "/repo" } } } })
  await plugin.setup(ctx)
  await state.commands.find((command) => command.name === "how").execute({ sessionID: "s1", prompt: { text: "how do runs cancel?" }, delivery: "steer" })
  assert.deepEqual(state.prompts, [{ sessionID: "s1", delivery: "steer", text: "how do runs cancel?", skills: [{ id: "how" }] }])
})

test("/tdd sends the pstack file path when a user skill owns the tdd ID", async () => {
  const user = { id: "tdd", path: "/home/me/.agents/skills/tdd/SKILL.md" }
  const { ctx, state } = fakeContext({ sessions: { s1: { agent: "build" } }, registered: [user] })
  await plugin.setup(ctx)
  await state.commands.find((command) => command.name === "tdd").execute({ sessionID: "s1", prompt: { text: "add a parser" }, delivery: "steer" })
  const [sent] = state.prompts
  assert.equal(sent.skills, undefined)
  assert.match(sent.text, /src\/skills\/tdd\/SKILL.md/)
  assert.match(sent.text, /add a parser$/)
})

test("the poteto-mode agent gets the mode entry and the skill on its first message only", async () => {
  const sessions = { s1: { agent: "poteto-mode" } }
  const { ctx, state } = fakeContext({ sessions })
  await plugin.setup(ctx)
  const first = { sessionID: "s1", prompt: { text: "fix the drift" } }
  await state.hooks.prompt(first)
  assert.deepEqual(first.prompt.skills, [{ id: "poteto-mode" }])
  assert.match(state.entries.s1["pstack-mode"], /poteto mode is on/)
  const second = { sessionID: "s1", prompt: { text: "and the tests" } }
  await state.hooks.prompt(second)
  assert.equal(second.prompt.skills, undefined)

  sessions.s1.agent = "build"
  await state.hooks.context({ sessionID: "s1", agent: "build" })
  assert.equal(state.entries.s1["pstack-mode"], undefined)
})

test("other agents get neither the mode entry nor the skill", async () => {
  const { ctx, state } = fakeContext({ sessions: { s1: { agent: "build" } } })
  await plugin.setup(ctx)
  const event = { sessionID: "s1", prompt: { text: "hi" } }
  await state.hooks.prompt(event)
  assert.equal(event.prompt.skills, undefined)
  assert.deepEqual(state.entries.s1 ?? {}, {})
})

test("the /setup-pstack model file becomes a session entry and follows edits and deletion", async () => {
  const modelsFile = join(mkdtempSync(join(tmpdir(), "pstack-")), "pstack-models.md")
  const { ctx, state } = fakeContext({ modelsFile })
  await plugin.setup(ctx)
  await state.hooks.context({ sessionID: "s1", agent: "build" })
  assert.equal(state.entries.s1["pstack-models"], undefined)

  writeFileSync(modelsFile, "# budget: large (xhigh)\nswarm workers: xai/grok-4.7#xhigh\n")
  await state.hooks.context({ sessionID: "s1", agent: "build" })
  assert.match(state.entries.s1["pstack-models"], /swarm workers: xai\/grok-4\.7#xhigh/)

  rmSync(modelsFile)
  await state.hooks.context({ sessionID: "s1", agent: "build" })
  assert.equal(state.entries.s1["pstack-models"], undefined)
})

test("a failing OpenCode call never breaks the user's prompt", async () => {
  const { ctx, state } = fakeContext()
  ctx.session.get = async () => {
    throw new Error("server hiccup")
  }
  await plugin.setup(ctx)
  const errors = []
  const original = console.error
  console.error = (...args) => errors.push(args)
  try {
    await state.hooks.prompt({ sessionID: "s1", prompt: { text: "hi" } })
  } finally {
    console.error = original
  }
  assert.equal(errors.length, 1)
})

const shell = (sessionID, agent, command) => ({ tool: "shell", sessionID, agent, input: { command } })
const loaded = (sessionID, agent, id) => ({ tool: "skill", sessionID, agent, input: { id }, status: "completed" })

test("a poteto-agent commit is blocked until deslop loads, then every commit passes", async () => {
  const { ctx, state } = fakeContext()
  await plugin.setup(ctx)
  const commit = shell("s1", "poteto-agent", 'printf x > a && git commit -m "a"')
  await assert.rejects(async () => state.hooks["execute.before"](commit), /load the `deslop` skill.*rerun `git commit` as its own command/s)

  await state.hooks["execute.after"]({ tool: "skill", sessionID: "s1", agent: "poteto-agent", input: { id: "deslop" }, status: "error" })
  await assert.rejects(async () => state.hooks["execute.before"](commit))

  await state.hooks["execute.after"]({ tool: "skill", sessionID: "s1", agent: "poteto-agent", input: { id: "deslop" }, status: "completed" })
  await state.hooks["execute.before"](commit)
  await state.hooks["execute.before"](shell("s1", "poteto-agent", "git commit --amend --no-edit"))
  await assert.rejects(async () => state.hooks["execute.before"](shell("s2", "poteto-mode", "git commit -m b")))
})

const spawn = (sessionID, agent, input) => ({ tool: "subagent", sessionID, agent, input: { description: "d", prompt: "p", ...input } })

test("after Perf issue loads, a poteto-agent delegation waits for the skills its steps always run", async () => {
  const { ctx, state } = fakeContext()
  await plugin.setup(ctx)
  await state.hooks["execute.after"](loaded("s1", "poteto-mode", "perf-issue"))
  const fix = spawn("s1", "poteto-mode", { agent: "poteto-agent" })
  await assert.rejects(async () => state.hooks["execute.before"](fix), /Perf issue.*`benchmark-checklist`, `how`, and `principle-sequence-verifiable-units`/s)
  await state.hooks["execute.before"](spawn("s1", "poteto-mode", { agent: "explore" }))

  for (const id of ["benchmark-checklist", "how"]) await state.hooks["execute.after"](loaded("s1", "poteto-mode", id))
  await assert.rejects(async () => state.hooks["execute.before"](fix), /`principle-sequence-verifiable-units`/)
  await state.hooks["execute.after"](loaded("s1", "poteto-mode", "principle-sequence-verifiable-units"))
  await state.hooks["execute.before"](fix)
})

test("a commit waits for the loaded playbook's skills as well as deslop", async () => {
  const { ctx, state } = fakeContext()
  await plugin.setup(ctx)
  for (const id of ["feature", "deslop"]) await state.hooks["execute.after"](loaded("s1", "poteto-mode", id))
  const commit = shell("s1", "poteto-mode", "git commit -m a")
  await assert.rejects(async () => state.hooks["execute.before"](commit), /Feature.*`principle-model-the-domain`.*rerun `git commit` as its own command/s)
  await state.hooks["execute.after"](loaded("s1", "poteto-mode", "principle-model-the-domain"))
  await state.hooks["execute.before"](commit)
})

test("with no playbook, or one whose steps make every skill conditional, nothing waits on a playbook", async () => {
  const { ctx, state } = fakeContext()
  await plugin.setup(ctx)
  await state.hooks["execute.before"](spawn("s1", "poteto-mode", { agent: "poteto-agent" }))
  await state.hooks["execute.after"](loaded("s2", "poteto-mode", "bug-fix"))
  await state.hooks["execute.before"](spawn("s2", "poteto-mode", { agent: "poteto-agent" }))
})

test("a pstack delegate's subagent calls run in the foreground, so its report waits for its children", async () => {
  const sessions = { root: { agent: "poteto-mode" }, child: { agent: "poteto-agent", parentID: "root" }, other: { agent: "general", parentID: "root" } }
  const { ctx, state } = fakeContext({ sessions })
  await plugin.setup(ctx)
  const fromChild = spawn("child", "poteto-agent", { agent: "comment-sicko", background: true, model: "m" })
  await state.hooks["execute.before"](fromChild)
  assert.deepEqual(fromChild.input, { description: "d", prompt: "p", agent: "comment-sicko", background: false, model: "m" })

  const fromRoot = spawn("root", "poteto-mode", { agent: "poteto-agent", background: true })
  await state.hooks["execute.before"](fromRoot)
  assert.equal(fromRoot.input.background, true)
  const fromOther = spawn("other", "general", { agent: "explore", background: true })
  await state.hooks["execute.before"](fromOther)
  assert.equal(fromOther.input.background, true)
})

test("a pstack delegate cannot start a background shell job, because its parent takes its first turn end as the report", async () => {
  const sessions = { root: { agent: "poteto-mode" }, child: { agent: "poteto-agent", parentID: "root" }, other: { agent: "general", parentID: "root" } }
  const { ctx, state } = fakeContext({ sessions })
  await plugin.setup(ctx)
  const job = (sessionID, agent, input) => ({ tool: "shell", sessionID, agent, input: { command: "npm test", ...input } })
  await assert.rejects(
    async () => state.hooks["execute.before"](job("child", "poteto-agent", { background: true })),
    /^Error: pstack: .*foreground with `timeout: 0`.*nohup <command> > <log> 2>&1 &/s,
  )
  await state.hooks["execute.before"](job("child", "poteto-agent", { background: false }))
  await state.hooks["execute.before"](job("child", "poteto-agent", {}))
  await state.hooks["execute.before"](job("root", "poteto-mode", { background: true }))
  await state.hooks["execute.before"](job("other", "general", { background: true }))
})

test("a session a pstack delegate spawned, at any depth, cannot start a background shell job either", async () => {
  const sessions = {
    root: { agent: "poteto-mode" },
    delegate: { agent: "poteto-agent", parentID: "root" },
    helper: { agent: "general", parentID: "delegate" },
    deeper: { agent: "general", parentID: "helper" },
    plain: { agent: "general", parentID: "root" },
    plainer: { agent: "general", parentID: "plain" },
  }
  const { ctx, state } = fakeContext({ sessions })
  await plugin.setup(ctx)
  const job = (sessionID, agent) => ({ tool: "shell", sessionID, agent, input: { command: "npm test", background: true } })
  for (const [sessionID, agent] of [["helper", "general"], ["deeper", "general"]]) {
    await assert.rejects(async () => state.hooks["execute.before"](job(sessionID, agent)), /pstack: a subagent under a pstack delegate cannot start a background shell job/, sessionID)
  }
  for (const [sessionID, agent] of [["plain", "general"], ["plainer", "general"]]) await state.hooks["execute.before"](job(sessionID, agent))
})

test("a subagent in a poteto-mode tree cannot start an untracked session with opencode run", async () => {
  const sessions = {
    root: { agent: "poteto-mode" },
    reviewer: { agent: "general", parentID: "root" },
    helper: { agent: "general", parentID: "reviewer" },
    commanded: { agent: "build" },
    commandedChild: { agent: "general", parentID: "commanded" },
    plain: { agent: "build" },
    delegate: { agent: "poteto-agent", parentID: "plain" },
    delegateChild: { agent: "general", parentID: "delegate" },
    plainChild: { agent: "general", parentID: "plain" },
  }
  const { ctx, state } = fakeContext({ sessions, storage: { "mode/commanded": true } })
  await plugin.setup(ctx)
  const run = (sessionID, command, background) => ({ tool: "shell", sessionID, agent: sessions[sessionID].agent, input: { command, background } })
  const blocked = [
    ["reviewer", "opencode run --model m --title t --auto 'review it'", true],
    ["reviewer", "opencode run --help", false],
    ["helper", "cd /tmp/x && opencode run 'reply OK'", false],
    ["commandedChild", "/x/bin/opencode run 'reply OK'", false],
    ["delegate", "FOO=1 nohup opencode run 'reply OK' > log 2>&1 &", false],
    ["delegateChild", "opencode   run 'reply OK'", false],
  ]
  for (const [sessionID, command, background] of blocked) {
    await assert.rejects(
      async () => state.hooks["execute.before"](run(sessionID, command, background)),
      /^Error: pstack: .*no parent, so nothing tracks it or receives its result.*`subagent` tool/s,
      `${sessionID}: ${command}`,
    )
  }
  const allowed = [
    ["root", "opencode run 'reply OK'"],
    ["plain", "opencode run 'reply OK'"],
    ["plainChild", "opencode run 'reply OK'"],
    ["reviewer", "node .opencode/skills/verify-pstack/scripts/harness.mjs run --agent poteto-mode 'hi'"],
    ["reviewer", "git commit -m 'fix: reject opencode run from a subagent'"],
    ["reviewer", "grep -n 'opencode run' README.md"],
    ["reviewer", "opencode session list"],
  ]
  for (const [sessionID, command] of allowed) await state.hooks["execute.before"](run(sessionID, command, false))
})

test("a build session commits freely", async () => {
  const { ctx, state } = fakeContext()
  await plugin.setup(ctx)
  await state.hooks["execute.before"](shell("s1", "build", "git add -A && git commit -m a"))
})

const potetoMode = (state, sessionID) =>
  state.commands.find((command) => command.name === "poteto-mode").execute({ sessionID, prompt: { text: "fix it" }, delivery: "steer" })

test("/poteto-mode gates commits in its build session", async () => {
  const { ctx, state } = fakeContext({ sessions: { s1: { agent: "build" } } })
  await plugin.setup(ctx)
  await potetoMode(state, "s1")
  await assert.rejects(async () => state.hooks["execute.before"](shell("s1", "build", "git commit -m a")))
  await state.hooks["execute.before"](shell("s2", "build", "git commit -m a"))
})

test("/poteto-mode keeps its build session in poteto mode, and other build sessions stay plain", async () => {
  const sessions = { s1: { agent: "build" }, s2: { agent: "build" } }
  const { ctx, state } = fakeContext({ sessions })
  await plugin.setup(ctx)
  await potetoMode(state, "s1")
  await state.hooks.prompt({ sessionID: "s1", prompt: state.prompts[0] })
  await state.hooks.prompt({ sessionID: "s2", prompt: { text: "hi" } })
  assert.match(state.entries.s1["pstack-mode"], /poteto mode is on/)
  assert.equal(state.entries.s2?.["pstack-mode"], undefined)

  await state.hooks.context({ sessionID: "s1", agent: "build" })
  assert.match(state.entries.s1["pstack-mode"], /poteto mode is on/)
})

test("a /poteto-mode session stays in poteto mode after the plugin restarts", async () => {
  const sessions = { s1: { agent: "build" } }
  const first = fakeContext({ sessions })
  await plugin.setup(first.ctx)
  await potetoMode(first.state, "s1")

  const { ctx, state } = fakeContext({ sessions, storage: first.state.storage })
  await plugin.setup(ctx)
  await state.hooks.context({ sessionID: "s1", agent: "build" })
  assert.match(state.entries.s1["pstack-mode"], /poteto mode is on/)
  await assert.rejects(async () => state.hooks["execute.before"](shell("s1", "build", "git commit -m a")))
})

test("a plugin bug in the tool hooks never blocks a tool call", async () => {
  const { ctx, state } = fakeContext()
  ctx.storage.get = async () => {
    throw new Error("storage hiccup")
  }
  await plugin.setup(ctx)
  const errors = []
  const original = console.error
  console.error = (...args) => errors.push(args)
  try {
    await state.hooks["execute.before"](shell("s1", "poteto-agent", "git commit -m a"))
    await state.hooks["execute.after"](loaded("s1", "poteto-agent", "deslop"))
  } finally {
    console.error = original
  }
  assert.equal(errors.length, 2)
})

test("the gate matches git commit behind global flags and nothing that only mentions it", async () => {
  const { ctx, state } = fakeContext()
  await plugin.setup(ctx)
  const gated = ["git -C repo commit -m a", "git -c user.name=me --no-pager commit", "cd repo && git commit", "true; git commit"]
  for (const command of gated) await assert.rejects(async () => state.hooks["execute.before"](shell("s1", "poteto-agent", command)), command)
  const free = ["git commit-tree HEAD^{tree}", 'echo "git commit"', "git log --grep commit", "git status"]
  for (const command of free) await state.hooks["execute.before"](shell("s1", "poteto-agent", command))
  await state.hooks["execute.before"]({ tool: "edit", sessionID: "s1", agent: "poteto-agent", input: { command: "git commit" } })
})

const edit = (sessionID, agent = "build") => ({ tool: "edit", sessionID, agent, input: { path: "src/money.js" } })
const delegate = (sessionID, subagent, agent = "build") => ({ tool: "subagent", sessionID, agent, input: { agent: subagent, prompt: "fix it" } })
const COMMIT = "git commit -m a"

async function potetoSession(storage) {
  const { ctx, state } = fakeContext({ sessions: { s1: { agent: "build" } }, storage })
  await plugin.setup(ctx)
  await potetoMode(state, "s1")
  return state
}

test("poteto mode never holds an edit or a delegation with no playbook loaded, and holds a commit until deslop loads", async () => {
  const commanded = await potetoSession()
  const { ctx, state: agent } = fakeContext({ sessions: { s1: { agent: "poteto-mode" } } })
  await plugin.setup(ctx)
  for (const [state, name] of [
    [commanded, "build"],
    [agent, "poteto-mode"],
  ]) {
    for (const action of [edit("s1", name), delegate("s1", "poteto-agent", name), delegate("s1", "general", name)]) await state.hooks["execute.before"](action)
    await assert.rejects(async () => state.hooks["execute.before"](shell("s1", name, COMMIT)), /load the `deslop` skill/)
    await state.hooks["execute.after"](loaded("s1", name, "deslop"))
    await state.hooks["execute.before"](shell("s1", name, COMMIT))
  }
})

test("reading the deslop skill file lifts the commit hold, and a failed read does not", async () => {
  const state = await potetoSession()
  const read = (status) => ({ tool: "read", sessionID: "s1", agent: "build", input: { path: "/home/me/pstack/src/skills/deslop/SKILL.md" }, status })
  await state.hooks["execute.after"](read("error"))
  await assert.rejects(async () => state.hooks["execute.before"](shell("s1", "build", COMMIT)), /load the `deslop` skill/)
  await state.hooks["execute.after"](read("completed"))
  await state.hooks["execute.before"](shell("s1", "build", COMMIT))
})

test("a loaded playbook does not lift the commit hold", async () => {
  const state = await potetoSession()
  await state.hooks["execute.after"](loaded("s1", "build", "bug-fix"))
  await assert.rejects(async () => state.hooks["execute.before"](shell("s1", "build", COMMIT)), /load the `deslop` skill/)
})

test("the deslop load survives a plugin restart on the same storage", async () => {
  const first = await potetoSession()
  await assert.rejects(async () => first.hooks["execute.before"](shell("s1", "build", COMMIT)), /load the `deslop` skill/)
  await first.hooks["execute.after"](loaded("s1", "build", "deslop"))

  const { ctx, state } = fakeContext({ sessions: { s1: { agent: "build" } }, storage: first.storage })
  await plugin.setup(ctx)
  await state.hooks["execute.before"](shell("s1", "build", COMMIT))
})

test("loads that finish together all land in storage", async () => {
  const state = await potetoSession()
  await Promise.all(["bug-fix", "deslop"].map((id) => state.hooks["execute.after"](loaded("s1", "build", id))))
  await state.hooks["execute.before"](shell("s1", "build", COMMIT))
})

test("a storage error during the gate lookup lets a commit through", async () => {
  const state = await potetoSession()
  state.storage = new Proxy(state.storage, {
    get() {
      throw new Error("storage hiccup")
    },
  })
  const errors = []
  const original = console.error
  console.error = (...args) => errors.push(args)
  try {
    await state.hooks["execute.before"](shell("s1", "build", COMMIT))
  } finally {
    console.error = original
  }
  assert.equal(errors.length, 1)
})
