import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import plugin from "../dist/plugin/index.js"

const DIST = join(import.meta.dirname, "..", "dist")

// A fake OpenCode plugin context that records what the plugin registers and what it sends.
function fakeContext({ modelsFile, sessions = {}, registered = [] } = {}) {
  const state = { skills: [], commands: [], hooks: {}, prompts: [], entries: {}, storage: {} }
  const entriesOf = (sessionID) => (state.entries[sessionID] ??= {})
  const ctx = {
    options: { modelsFile: modelsFile ?? join(mkdtempSync(join(tmpdir(), "pstack-")), "missing.md") },
    skill: {
      transform: async (fn) => fn({ add: (skill) => state.skills.push(skill) }),
      list: async () => ({ data: [...state.skills, ...registered].reverse() }),
    },
    command: { transform: async (fn) => fn({ add: (command) => state.commands.push(command) }) },
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

test("registers every bundled skill, hidden unless upstream lets the model invoke it", async () => {
  const { ctx, state } = fakeContext()
  await plugin.setup(ctx)
  const folders = readdirSync(join(DIST, "skills")).sort()
  assert.deepEqual(state.skills.map((skill) => skill.id), folders)
  const byId = Object.fromEntries(state.skills.map((skill) => [skill.id, skill]))
  assert.equal(byId["poteto-mode"].autoinvoke, false)
  assert.equal(byId["setup-pstack"].autoinvoke, true)
  assert.ok(byId.deslop && byId["control-cli"] && byId["control-ui"])
  for (const skill of state.skills) {
    assert.ok(skill.description, `${skill.id} has a description`)
    assert.ok(!skill.content.startsWith("---"), `${skill.id} content has no frontmatter`)
  }
})

test("adds a slash command for every skill except the principles", async () => {
  const { ctx, state } = fakeContext()
  await plugin.setup(ctx)
  const names = state.commands.map((command) => command.name)
  assert.ok(names.includes("poteto-mode") && names.includes("how") && names.includes("deslop"))
  assert.equal(names.filter((name) => name.startsWith("principle-")).length, 0)
  assert.equal(names.length, state.skills.length - state.skills.filter((skill) => skill.id.startsWith("principle-")).length)
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
  assert.match(sent.text, /dist\/skills\/tdd\/SKILL.md/)
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
