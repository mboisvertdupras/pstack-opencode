import { readFileSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  MODE_AGENT,
  MODE_KEY,
  MODELS_KEY,
  actGate,
  commandDescription,
  commandPrompt,
  commitGate,
  entryOps,
  isCodeAction,
  isReadAction,
  isSkillEvent,
  modeEntry,
  modelsEntry,
  readAgents,
  readSkills,
  withEvent,
} from "./lib.js"

const ROOT = dirname(dirname(realpathSync(fileURLToPath(import.meta.url))))

const unwrap = (result) => result?.data ?? result

export default {
  id: "pstack",
  async setup(ctx) {
    const skills = readSkills(join(ROOT, "skills"))
    const agents = readAgents(join(ROOT, "agents"))
    const configDir = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode")
    const modelsFile = ctx.options?.modelsFile ?? join(configDir, "pstack-models.md")

    let models = { mtimeMs: -1, text: undefined }
    const readModels = () => {
      let stat
      try {
        stat = statSync(modelsFile)
      } catch {
        return undefined
      }
      if (stat.mtimeMs !== models.mtimeMs) models = { mtimeMs: stat.mtimeMs, text: readFileSync(modelsFile, "utf8").trim() }
      return modelsEntry(modelsFile, models.text)
    }

    const modeKey = (sessionID) => `mode/${sessionID}`
    const commandedMode = async (sessionID) => Boolean(await ctx.storage.get(modeKey(sessionID)))

    const inOrder = () => {
      const queues = new Map()
      return (sessionID, task) => {
        const next = (queues.get(sessionID) ?? Promise.resolve()).then(task)
        queues.set(sessionID, next.catch(() => {}))
        return next
      }
    }

    const catalog = new Map(skills.map((skill) => [skill.id, skill]))
    const skillsKey = (sessionID) => `skills/${sessionID}`
    const skillsInOrder = inOrder()
    const sessionState = (sessionID) =>
      skillsInOrder(sessionID, async () => {
        const { playbook, skip, loaded = [], ran = [] } = (await ctx.storage.get(skillsKey(sessionID))) ?? {}
        return { mode: await commandedMode(sessionID), playbook, skip, loaded, ran }
      })
    const record = (sessionID, event) =>
      skillsInOrder(sessionID, async () => {
        const before = await ctx.storage.get(skillsKey(sessionID))
        const after = withEvent(before, event, catalog)
        if (after !== before) await ctx.storage.set(skillsKey(sessionID), after)
      })

    const synced = new Map()
    const reconcileNow = async (sessionID, agent) => {
      const mode = agent === MODE_AGENT || (await commandedMode(sessionID))
      const want = { [MODELS_KEY]: readModels(), [MODE_KEY]: mode ? modeEntry(ROOT) : undefined }
      let have = synced.get(sessionID)
      if (!have) {
        const entries = unwrap(await ctx.session.instructions.entry.list({ sessionID })) ?? []
        have = Object.fromEntries(entries.filter((entry) => entry.key in want).map((entry) => [entry.key, entry.value]))
        synced.set(sessionID, have)
      }
      for (const { key, value } of entryOps(want, have)) {
        if (value === undefined) {
          await ctx.session.instructions.entry.remove({ sessionID, key })
          delete have[key]
        } else {
          await ctx.session.instructions.entry.put({ sessionID, key, value })
          have[key] = value
        }
      }
    }
    const reconcileInOrder = inOrder()
    const reconcile = (sessionID, agent) => reconcileInOrder(sessionID, () => reconcileNow(sessionID, agent))
    const guarded = (name, hook) => async (event) => {
      try {
        await hook(event)
      } catch (error) {
        console.error(`pstack: ${name} hook failed`, error)
      }
    }

    const shadowingPath = async (sessionID, skill) => {
      const session = unwrap(await ctx.session.get({ sessionID }))
      const directory = session?.location?.directory
      const registered = unwrap(await ctx.skill.list(directory ? { location: { directory } } : undefined)) ?? []
      const path = registered.find((entry) => entry.id === skill.id)?.path
      return path && path !== skill.path ? path : undefined
    }

    await ctx.skill.transform((editor) => {
      for (const skill of skills) editor.add(skill)
    })

    await ctx.command.transform((editor) => {
      for (const skill of skills) {
        if (skill.kind === "playbook" || skill.id.startsWith("principle-")) continue
        editor.add({
          name: skill.id,
          description: commandDescription(skill.description),
          execute: async ({ sessionID, prompt, delivery }) => {
            if (skill.id === MODE_AGENT) await ctx.storage.set(modeKey(sessionID), true)
            const { text, attach } = commandPrompt(skill, prompt.text ?? "", await shadowingPath(sessionID, skill))
            const attached = attach ? [...(prompt.skills ?? []), { id: skill.id }] : prompt.skills
            await ctx.session.prompt({ ...prompt, sessionID, delivery, text, ...(attached ? { skills: attached } : {}) })
          },
        })
      }
    })

    await ctx.agent.transform((editor) => {
      for (const agent of agents) {
        if (editor.get(agent.id)) continue
        editor.update(agent.id, (draft) => {
          draft.description = agent.description
          draft.mode = agent.mode
          if (agent.color) draft.color = agent.color
          if (agent.system) draft.system = agent.system
        })
      }
    })

    await ctx.session.hook(
      "prompt",
      guarded("prompt", async (event) => {
        const session = unwrap(await ctx.session.get({ sessionID: event.sessionID }))
        await reconcile(event.sessionID, session?.agent)
        if (session?.agent !== MODE_AGENT) return
        const attachedKey = `attached/${event.sessionID}`
        if (await ctx.storage.get(attachedKey)) return
        event.prompt.skills ??= []
        if (!event.prompt.skills.some((skill) => skill.id === MODE_AGENT)) event.prompt.skills.push({ id: MODE_AGENT })
        await ctx.storage.set(attachedKey, true)
      }),
    )

    await ctx.session.hook(
      "context",
      guarded("context", (event) => reconcile(event.sessionID, event.agent)),
    )

    const real = (path) => {
      try {
        return realpathSync(path)
      } catch {
        return path
      }
    }
    const within = (path, dir) => {
      const rel = relative(dir, path)
      return !rel.startsWith("..") && !isAbsolute(rel)
    }
    const readsProject = async ({ sessionID, input }) => {
      const directory = unwrap(await ctx.session.get({ sessionID }))?.location?.directory
      const target = real(resolve(directory ?? "", input.path ?? input.filePath ?? "."))
      return !within(target, ROOT) && (!directory || within(target, real(directory)))
    }

    await ctx.tool.hook("execute.before", async (event) => {
      let blocked
      try {
        if (isCodeAction(event) || isReadAction(event)) {
          const session = await sessionState(event.sessionID)
          blocked = actGate(session, event, catalog) ?? commitGate(session, event)
          if (blocked && isReadAction(event) && !(await readsProject(event))) blocked = undefined
        }
      } catch (error) {
        console.error("pstack: execute.before hook failed", error)
      }
      if (blocked) throw new Error(blocked)
    })

    await ctx.tool.hook(
      "execute.after",
      guarded("execute.after", async (event) => {
        if (isSkillEvent(event, catalog)) await record(event.sessionID, event)
      }),
    )
  },
}
