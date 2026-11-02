import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import plugin from "../src/plugin/index.js"

const SRC = join(import.meta.dirname, "..", "src")

// A fake OpenCode plugin context that records what the plugin registers and what it sends.
function fakeContext({ modelsFile, sessions = {}, registered = [], storage = {} } = {}) {
  const state = { skills: [], commands: [], hooks: {}, prompts: [], entries: {}, storage }
  const entriesOf = (sessionID) => (state.entries[sessionID] ??= {})
  const ctx = {
    options: { modelsFile: modelsFile ?? join(mkdtempSync(join(tmpdir(), "pstack-")), "missing.md") },
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
  return { ctx, state }
}

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
const spawned = (sessionID, subagent) => ({ ...delegate(sessionID, subagent), status: "completed" })
const ran = (sessionID, command) => ({ ...shell(sessionID, "build", command), status: "completed" })
const BUG_FIX_GATE =
  "pstack: the Bug fix playbook runs the `how` and `why` skills before any code change. Load `how` with the `skill` tool and run it, then load `why` with the `skill` tool and run it, then retry this call."

async function potetoSession(storage) {
  const { ctx, state } = fakeContext({ sessions: { s1: { agent: "build" } }, storage })
  await plugin.setup(ctx)
  await potetoMode(state, "s1")
  return state
}

test("a /poteto-mode Bug fix blocks code edits until how and why load and run", async () => {
  const state = await potetoSession()
  await state.hooks["execute.after"](loaded("s1", "build", "bug-fix"))
  await assert.rejects(async () => state.hooks["execute.before"](edit("s1")), { message: BUG_FIX_GATE })

  await state.hooks["execute.after"](spawned("s1", "explore"))
  await state.hooks["execute.after"](loaded("s1", "build", "how"))
  await state.hooks["execute.after"](loaded("s1", "build", "why"))
  await assert.rejects(async () => state.hooks["execute.before"](edit("s1")), {
    message:
      "pstack: the Bug fix playbook runs the `how` and `why` skills before any code change. `how` is loaded but hasn't run: spawn its `explore` subagents as the skill says, then `why` is loaded but hasn't run: spawn its `general` subagents, or read the history with `git log` or `git blame`, as the skill says, then retry this call.",
  })

  await state.hooks["execute.after"](spawned("s1", "explore"))
  await assert.rejects(async () => state.hooks["execute.before"](edit("s1")), /runs the `why` skill before any code change\. `why` is loaded but hasn't run/)

  await state.hooks["execute.after"](ran("s1", "git log --oneline -- src/money.js"))
  await state.hooks["execute.before"](edit("s1"))
  for (const tool of ["write", "apply_patch", "patch", "multiedit"]) await state.hooks["execute.before"]({ ...edit("s1"), tool })
})

test("a Bug fix blocks a code delegation as its first action, and never an explore subagent or a read", async () => {
  const state = await potetoSession()
  await state.hooks["execute.after"](loaded("s1", "build", "bug-fix"))
  await assert.rejects(async () => state.hooks["execute.before"](delegate("s1", "poteto-agent")), { message: BUG_FIX_GATE })
  await assert.rejects(async () => state.hooks["execute.before"](delegate("s1", "general")), { message: BUG_FIX_GATE })
  await state.hooks["execute.before"](delegate("s1", "explore"))
  for (const tool of ["read", "grep", "glob", "skill", "todowrite"]) await state.hooks["execute.before"]({ tool, sessionID: "s1", agent: "build", input: {} })
  await state.hooks["execute.before"](shell("s1", "build", "printf x > src/money.js"))

  await state.hooks["execute.after"](loaded("s1", "build", "how"))
  await state.hooks["execute.after"](loaded("s1", "build", "why"))
  await state.hooks["execute.before"](delegate("s1", "general"))
  await assert.rejects(async () => state.hooks["execute.before"](delegate("s1", "poteto-agent")), /`how` is loaded but hasn't run/)

  await state.hooks["execute.after"](spawned("s1", "explore"))
  await state.hooks["execute.after"](spawned("s1", "general"))
  await state.hooks["execute.before"](delegate("s1", "poteto-agent"))
})

test("reading a playbook file records it as the session's playbook, and a failed load records nothing", async () => {
  const state = await potetoSession()
  const read = (path, status = "completed") => ({ tool: "read", sessionID: "s1", agent: "build", input: { path }, status })
  await state.hooks["execute.after"](read("/home/me/pstack/src/skills/poteto-mode/playbooks/feature.md", "error"))
  await state.hooks["execute.before"](edit("s1"))

  await state.hooks["execute.after"](read("/home/me/pstack/src/skills/poteto-mode/playbooks/feature.md"))
  await assert.rejects(async () => state.hooks["execute.before"](edit("s1")), /the Feature playbook runs the `how` and `architect` skills/)
  await state.hooks["execute.after"](read("/home/me/pstack/src/skills/how/SKILL.md"))
  await assert.rejects(async () => state.hooks["execute.before"](edit("s1")), /`how` is loaded but hasn't run: spawn its `explore` subagents as the skill says, then load `architect`/)
})

test("a playbook with no requires, and a poteto-mode session with no playbook, edit freely", async () => {
  const state = await potetoSession()
  await state.hooks["execute.before"](edit("s1"))
  await state.hooks["execute.after"](loaded("s1", "build", "prototype"))
  await state.hooks["execute.before"](edit("s1"))
  await state.hooks["execute.before"](delegate("s1", "poteto-agent"))
})

test("the poteto-mode agent is gated, and plain build sessions and delegates are not", async () => {
  const { ctx, state } = fakeContext({ sessions: { s1: { agent: "poteto-mode" }, s2: { agent: "build" }, s3: { agent: "poteto-agent" } } })
  await plugin.setup(ctx)
  await state.hooks["execute.after"](loaded("s1", "poteto-mode", "bug-fix"))
  await assert.rejects(async () => state.hooks["execute.before"](edit("s1", "poteto-mode")), { message: BUG_FIX_GATE })

  await state.hooks["execute.after"](loaded("s2", "build", "bug-fix"))
  await state.hooks["execute.before"](edit("s2"))
  await state.hooks["execute.before"](delegate("s2", "general"))
  await state.hooks["execute.after"](loaded("s3", "poteto-agent", "bug-fix"))
  await state.hooks["execute.before"](edit("s3", "poteto-agent"))
})

test("the playbook and the loaded and run skills survive a plugin restart on the same storage", async () => {
  const first = await potetoSession()
  await first.hooks["execute.after"](loaded("s1", "build", "bug-fix"))
  await first.hooks["execute.after"](loaded("s1", "build", "how"))
  await first.hooks["execute.after"](spawned("s1", "explore"))
  await first.hooks["execute.after"](loaded("s1", "build", "deslop"))

  const { ctx, state } = fakeContext({ sessions: { s1: { agent: "build" } }, storage: first.storage })
  await plugin.setup(ctx)
  await assert.rejects(async () => state.hooks["execute.before"](edit("s1")), /runs the `why` skill before any code change\. Load `why`/)
  await assert.rejects(async () => state.hooks["execute.before"](shell("s1", "build", "git commit -m a")), /runs the `why` skill.*as its own `git commit` command/)
  await state.hooks["execute.after"](loaded("s1", "build", "why"))
  await state.hooks["execute.after"](ran("s1", "git blame src/money.js"))
  await state.hooks["execute.before"](edit("s1"))
  await state.hooks["execute.before"](shell("s1", "build", "git commit -m a"))
})

test("loads that finish together all land in storage", async () => {
  const state = await potetoSession()
  await Promise.all(["bug-fix", "how"].map((id) => state.hooks["execute.after"](loaded("s1", "build", id))))
  await assert.rejects(async () => state.hooks["execute.before"](edit("s1")), /the Bug fix playbook runs the `how` and `why` skills before any code change\. `how` is loaded but hasn't run/)
})

test("a storage error during the gate lookup lets a code action through", async () => {
  const state = await potetoSession()
  await state.hooks["execute.after"](loaded("s1", "build", "bug-fix"))
  state.storage = new Proxy(state.storage, {
    get() {
      throw new Error("storage hiccup")
    },
  })
  const errors = []
  const original = console.error
  console.error = (...args) => errors.push(args)
  try {
    await state.hooks["execute.before"](edit("s1"))
  } finally {
    console.error = original
  }
  assert.equal(errors.length, 1)
})
