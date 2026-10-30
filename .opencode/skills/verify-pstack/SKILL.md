---
name: verify-pstack
description: Drive the pstack OpenCode plugin in a real, isolated OpenCode server and prove a change to dist/ works the way a user sees it. Covers slash commands, the poteto-mode agent, /setup-pstack model roles, pstack subagents, and the installer. Use after changing src/, scripts/, or the upstream pin, or when asked to verify, smoke-test, or reproduce a pstack-in-OpenCode bug.
---

# Verify pstack in OpenCode

pstack's user is a person typing in OpenCode. They run `/how`, switch to the `poteto-mode` agent, and let skills spawn `poteto-agent`. Unit tests in `test/` drive the plugin against a fake context. This skill drives the built `dist/` inside a real OpenCode server, with real models. Use it as the proof step for any change that ships.

Every command below runs from the repo root. `H` is the harness.

```sh
H=.opencode/skills/verify-pstack/scripts/harness.mjs
```

## Launch

1. Build first. The harness serves `dist/`, not `src/`.

   ```sh
   npm run build && npm test
   ```

2. Start a private server.

   ```sh
   $H up
   ```

   It makes a run folder under `$TMPDIR/opencode/pstack-verify/run-*`, with its own OpenCode config folder and a seeded git project holding `math.js`. It installs pstack into that config with `scripts/install.mjs`, sets `experimental.todo` and `experimental.subagent_depth: 2`, and starts `opencode serve` on a free port. It prints `ready` only after every skill in `dist/skills` is registered at the project, which takes a few seconds after the port answers.

3. Load the run's paths when a step needs them.

   ```sh
   eval "$($H env)"   # PSTACK_VERIFY_RUN, PSTACK_VERIFY_PROJECT, PSTACK_VERIFY_CONFIG, PSTACK_VERIFY_EVIDENCE
   ```

Teardown is `$H down`. See Cleanup.

## Doctor

Run this first, and again whenever anything looks off. It is read-only.

```sh
$H doctor
```

It checks that the server this run started is alive, that `/api/info` answers, that every `dist/skills` skill is registered from `dist/`, that the three agents have the right modes, and that every non-principle skill has a command. Every line must read `ok`. A count short of the total means a user skill shadows a pstack ID. See Gotchas.

## Drive

Each subcommand saves its evidence and prints the path on a `proof` line. Turns cost real tokens. The default model is `claude-agent/haiku`. Set `PSTACK_VERIFY_MODEL` or pass `--model` to change it.

| Goal | Command |
| --- | --- |
| A user prompt, optionally under an agent | `$H run [--agent poteto-mode] "<prompt>"` |
| A follow-up in the same session | `$H run --session <sid> "<prompt>"` |
| A slash command, as the TUI sends it | `$H command <name> [--agent <id>] "<text>"` |
| Which skills each user message carried, plus tool calls and replies | `$H export <sid>` |
| The session's instruction entries | `$H entries <sid>` |
| Subagent sessions a session spawned | `$H children <sid>` |
| Where a skill ID resolves | `$H skill <id>` |

`opencode run` has no way to invoke a slash command, so `$H command` creates a session and calls the `session.command` API, which is the same path the TUI uses. `run` prints `session <sid>` at the end. Pass it to the inspection commands.

Features and their recipes live in [`features/`](features/README.md). Read the index, then follow the feature file that matches the change.

## Evidence

Proof goes to `verify-evidence/<timestamp>/` in this repo, which git ignores. Each `run` saves the full transcript with its exit code. Each `command`, `export`, and `entries` saves the session JSON or entry list it read.

Proof standards for this plugin:

- Drive the user path. A slash command goes through `$H command`, a mode through `--agent poteto-mode`, and a delegate through a prompt that asks the model to spawn it. Never call the plugin's functions directly. That is what `test/` is for.
- Prove the mechanism and the outcome. A reply that quotes the playbook is the outcome. The `skills=["poteto-mode"]` on the first user message and the `pstack-mode` entry are the mechanism. Show both.
- Check what a feature must not do as well. The skill attaches to the first message only, and other agents get no mode entry.
- A model can answer right by reading files. When a claim rests on the plugin, find it in `export` or `entries`, not only in the reply.

## Cleanup

```sh
$H down
```

It deletes every session filed under this run's project, stops the server process this run started, and removes the run folder. It never kills anything by name. Evidence stays in `verify-evidence/`, and `down` prints the path and file count. Run `down` after every failed attempt too, so a broken run does not strand a server.

To stop a run whose state is lost, find its `pid` in `$TMPDIR/opencode/pstack-verify/run-*/state.json` and pass that folder as `PSTACK_VERIFY_RUN=<folder> $H down`.

## Helpers

`scripts/harness.mjs` is the only helper. Run it with no arguments for usage. It needs `opencode`, `node`, and `git` on `PATH`, plus the user's own OpenCode credentials, because models come from the real data folder.

## Gotchas

- Sessions are written to the user's real OpenCode database. The server isolates config but not data, because isolating data drops the user's model credentials. `down` deletes this run's sessions. A session the harness filed elsewhere would survive it.
- `opencode run` files its session under `$PWD`, not the process directory. The harness sets `PWD` to the test project. Never run `opencode run --server` by hand from the repo, or the session and every file it touches land in this repo.
- User skills in `~/.claude/skills` and `~/.agents/skills` still load in the test server. One with a pstack ID replaces pstack's. `doctor` then reports fewer than the full count, and `up` times out. Check with `$H skill <id>`.
- OpenCode caches the plugin module per server. After `npm run build`, run `$H down` and `$H up`. A running server keeps the old plugin.
- `opencode api` output is cut at 64 KiB when piped. The harness writes it to a file first. Do the same in any one-off call.
- `dist/` is generated. Fix the source in `src/` or `scripts/`, rebuild, then verify.
