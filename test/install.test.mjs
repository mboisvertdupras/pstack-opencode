import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..")
const SRC = join(REPO, "src")
const AGENTS = ["comment-sicko.md", "poteto-agent.md", "poteto-mode.md"]

function sandbox() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "pstack-install-")))
  const opencode = join(home, ".config", "opencode")
  mkdirSync(join(opencode, "plugins"), { recursive: true })
  mkdirSync(join(opencode, "agents"))
  writeFileSync(join(opencode, "opencode.jsonc"), '{ "experimental": { "todo": true, "subagent_depth": 2 } }')
  writeFileSync(join(opencode, "pstack-models.md"), "")
  const install = (...args) => {
    const run = spawnSync(process.execPath, [join(REPO, "scripts", "install.mjs"), ...args], {
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      encoding: "utf8",
    })
    return { status: run.status, lines: run.stdout.split("\n").filter((line) => /^(ok|linked|moved|removed|keep|FAIL)\b/.test(line)) }
  }
  const linkOf = (path) => {
    try {
      return lstatSync(join(opencode, path)).isSymbolicLink() ? readlinkSync(join(opencode, path)) : "file"
    } catch {
      return undefined
    }
  }
  return { home, opencode, install, linkOf }
}

test("an install linked into the old dist/ moves to src/ and retires the agent links it made", () => {
  const { home, opencode, install, linkOf } = sandbox()
  symlinkSync(join(REPO, "dist"), join(opencode, "plugins", "pstack"))
  symlinkSync(join(SRC, "agents", "comment-sicko.md"), join(opencode, "agents", "comment-sicko.md"))
  for (const name of ["poteto-agent.md", "poteto-mode.md"]) symlinkSync(join(REPO, "dist", "agents", name), join(opencode, "agents", name))

  const dry = install("--dry-run")
  assert.equal(dry.status, 0)
  assert.deepEqual(dry.lines.map((line) => line.split(/\s+/)[0]), ["moved", "removed", "removed", "removed"])
  assert.equal(linkOf("plugins/pstack"), join(REPO, "dist"), "a dry run changes nothing")
  assert.equal(linkOf("agents/poteto-mode.md"), join(REPO, "dist", "agents", "poteto-mode.md"), "a dry run keeps the agent links")

  assert.deepEqual(install().lines.map((line) => line.split(/\s+/)[0]), ["moved", "removed", "removed", "removed"])
  assert.equal(linkOf("plugins/pstack"), SRC)
  for (const name of AGENTS) assert.equal(linkOf(`agents/${name}`), undefined, `${name} link retired`)
  assert.deepEqual(install().lines, [`ok      ${join(opencode, "plugins", "pstack")}`], "a rerun finds the plugin link in place and nothing to retire")
  rmSync(home, { recursive: true, force: true })
})

test("install keeps the user's own agent files and links under pstack's names", () => {
  const { home, opencode, install, linkOf } = sandbox()
  writeFileSync(join(opencode, "agents", "poteto-mode.md"), "mine")
  symlinkSync(join(home, "elsewhere.md"), join(opencode, "agents", "poteto-agent.md"))

  const first = install()
  assert.equal(first.status, 0)
  assert.deepEqual(first.lines.map((line) => line.split(/\s+/)[0]), ["linked", "keep", "keep"])
  assert.equal(linkOf("plugins/pstack"), SRC)
  assert.equal(linkOf("agents/poteto-mode.md"), "file")
  assert.equal(linkOf("agents/poteto-agent.md"), join(home, "elsewhere.md"))
  assert.deepEqual(install().lines.map((line) => line.split(/\s+/)[0]), ["ok", "keep", "keep"])
  rmSync(home, { recursive: true, force: true })
})

test("uninstall removes links into src/ or the old dist/ and keeps everything else", () => {
  const { home, opencode, install, linkOf } = sandbox()
  symlinkSync(SRC, join(opencode, "plugins", "pstack"))
  symlinkSync(join(REPO, "dist", "agents", "poteto-mode.md"), join(opencode, "agents", "poteto-mode.md"))
  symlinkSync(join(home, "elsewhere.md"), join(opencode, "agents", "poteto-agent.md"))
  writeFileSync(join(opencode, "agents", "comment-sicko.md"), "mine")

  const { status, lines } = install("--uninstall")
  assert.equal(status, 0)
  assert.deepEqual(lines.map((line) => line.split(/\s+/)[0]), ["removed", "keep", "keep", "removed"])
  assert.equal(linkOf("plugins/pstack"), undefined)
  assert.equal(linkOf("agents/poteto-mode.md"), undefined)
  assert.equal(linkOf("agents/poteto-agent.md"), join(home, "elsewhere.md"))
  assert.equal(linkOf("agents/comment-sicko.md"), "file")
  rmSync(home, { recursive: true, force: true })
})

test("install refuses to replace a plugin folder it did not create", () => {
  const { home, opencode, install, linkOf } = sandbox()
  mkdirSync(join(opencode, "plugins", "pstack"))
  symlinkSync(join(SRC, "agents", "poteto-mode.md"), join(opencode, "agents", "poteto-mode.md"))
  const { status, lines } = install()
  assert.equal(status, 1)
  assert.match(lines.at(-1), /^FAIL .*plugins\/pstack already exists/)
  assert.equal(linkOf("agents/poteto-mode.md"), join(SRC, "agents", "poteto-mode.md"), "a failed install retires nothing")
  rmSync(home, { recursive: true, force: true })
})
