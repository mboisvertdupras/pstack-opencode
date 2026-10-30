import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { lint, walk } from "../scripts/lint-skills.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

test("every shipped skill and agent lints clean", () => {
  const files = ["src/skills", "src/agents"]
    .flatMap((root) => walk(join(ROOT, root)))
    .map((path) => ({ file: path, text: readFileSync(path, "utf8") }))
  const findings = lint(files).map(({ file, line, rule, text }) => `${relative(ROOT, file)}:${line} ${rule} ${text}`)
  assert.deepEqual(findings, [])
})
