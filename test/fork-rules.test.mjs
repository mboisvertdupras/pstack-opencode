import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "skills")

const FORK_RULES = {
  "poteto-mode/SKILL.md": ["**One owner per check per commit.**", "**Time every check.**"],
  "poteto-mode/worker.md": [
    "only when your kickoff names you their owner",
    "report the seconds each check takes",
  ],
  "poteto-mode/playbooks/autopilot-full.md": [
    "leave the full checks to the gates lane",
    "One gates lane runs the full checks at that SHA",
  ],
  "interrogate/SKILL.md": ["not the project's full checks"],
  "principle-prove-it-works/SKILL.md": ["reruns it only when the code changed"],
  "benchmark-checklist/SKILL.md": ["freeze the baseline"],
}

for (const [file, phrases] of Object.entries(FORK_RULES)) {
  test(`${file} keeps its fork-only rules`, () => {
    const text = readFileSync(join(SKILLS, file), "utf8")
    const missing = phrases.filter((phrase) => !text.includes(phrase))
    assert.deepEqual(
      missing,
      [],
      `${file} lost fork-only rules, most likely to an upstream port. Restore them, or delete the entry when the rule is retired on purpose.`,
    )
  })
}
