import { readFileSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  MODE_AGENT,
  MODE_KEY,
  MODELS_KEY,
  commandDescription,
  commandPrompt,
  entryOps,
  modeEntry,
  modelsEntry,
  readSkills,
} from "./lib.js"

const ROOT = dirname(dirname(realpathSync(fileURLToPath(import.meta.url))))

const unwrap = (result) => result?.data ?? result

export default {
  id: "pstack",
  async setup(ctx) {
    const skills = readSkills(join(ROOT, "skills"))
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

    const synced = new Map()
    const reconcileNow = async (sessionID, agent) => {
      const want = { [MODELS_KEY]: readModels(), [MODE_KEY]: agent === MODE_AGENT ? modeEntry(ROOT) : undefined }
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
    const queues = new Map()
    const reconcile = (sessionID, agent) => {
      const next = (queues.get(sessionID) ?? Promise.resolve()).then(() => reconcileNow(sessionID, agent))
      queues.set(sessionID, next.catch(() => {}))
      return next
    }
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
        if (skill.id.startsWith("principle-")) continue
        editor.add({
          name: skill.id,
          description: commandDescription(skill.description),
          execute: async ({ sessionID, prompt, delivery }) => {
            const { text, attach } = commandPrompt(skill, prompt.text ?? "", await shadowingPath(sessionID, skill))
            const attached = attach ? [...(prompt.skills ?? []), { id: skill.id }] : prompt.skills
            await ctx.session.prompt({ ...prompt, sessionID, delivery, text, ...(attached ? { skills: attached } : {}) })
          },
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
  },
}
