---
name: verify-pstack
description: Drive the pstack OpenCode plugin in a real, isolated OpenCode server and prove a change to src/ works the way a user sees it. Covers slash commands, the poteto-mode agent, /setup-pstack model roles, pstack subagents, and the installer. Use after changing src/ or scripts/, or when asked to verify, smoke-test, or reproduce a pstack-in-OpenCode bug.
---

# Verify pstack in OpenCode

pstack's user is a person typing in OpenCode. They run `/how`, switch to the `poteto-mode` agent, and let skills spawn `poteto-agent`. Unit tests in `test/` drive the plugin against a fake context. This skill drives `src/` inside a real OpenCode server, with real models. Use it as the proof step for any change that ships.

Every command below runs from the repo root. `H` is the harness.

```sh
H=.opencode/skills/verify-pstack/scripts/harness.mjs
```

## Launch

1. Run the unit tests first. The harness serves `src/` directly, with no build step.

   ```sh
   npm test
   ```

2. Start a private server.

   ```sh
   $H up
   ```

   It makes a run folder under `$TMPDIR/opencode/pstack-verify/run-*`, with its own OpenCode config folder and a seeded git project holding `math.js`. It installs pstack into that config with `scripts/install.mjs`, sets `experimental.todo` and `experimental.subagent_depth: 2`, and starts `opencode serve` on a free port. It prints `ready` only after every skill in `src/skills` is registered at the project, which takes a few seconds after the port answers.

   `PSTACK_VERIFY_SEED=<dir>` seeds the project with a copy of that folder instead of `math.js`. `PSTACK_VERIFY_MODELS=<file>` copies a model file to the run's `pstack-models.md`. `up` prints the run folder on its first line. A script that runs several servers passes it as `PSTACK_VERIFY_RUN` to every later call, because the shared `latest` pointer belongs to whichever `up` ran last.

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

It checks that the server this run started is alive, that `/api/info` answers, that every `src/skills` skill is registered from `src/`, that the three agents have the right modes, and that every non-principle skill has a command. Every line must read `ok`. A count short of the total means a user skill shadows a pstack ID. See Gotchas.

## Drive

Each subcommand saves its evidence and prints the path on a `proof` line. Turns cost real tokens. The default model is `claude-agent/haiku`. Set `PSTACK_VERIFY_MODEL` or pass `--model` to change it.

| Goal | Command |
| --- | --- |
| A user prompt, optionally under an agent | `$H run [--agent poteto-mode] "<prompt>"` |
| A follow-up in the same session | `$H run --session <sid> "<prompt>"` |
| A slash command, as the TUI sends it | `$H command <name> [--agent <id>] "<text>"` |
| Which skills each user message carried, plus tool calls and replies | `$H export <sid>` |
| A session and every descendant, with instruction entries, once all of them stay idle | `$H tree <sid>` |
| A prompt sent without waiting for the reply | `$H start [--agent <id>] "<prompt>"` |
| The tree as it stands now, with a busy count | `$H snapshot <sid>` |
| Interrupt a session and every descendant until all stay idle | `$H stop <sid>` |
| The session's instruction entries | `$H entries <sid>` |
| Subagent sessions a session spawned | `$H children <sid>` |
| Where a skill ID resolves | `$H skill <id>` |

`opencode run` has no way to invoke a slash command, so `$H command` creates a session and calls the `session.command` API, which is the same path the TUI uses. `run` prints `session <sid>` at the end. Pass it to the inspection commands.

`run`, `command`, and `tree` stop after `PSTACK_VERIFY_TIMEOUT` milliseconds, 600000 by default, and exit 124 when they do.

## Routing eval

The routing eval measures whether pstack loads the skill a playbook step names, at that step. It drives scenarios against the `fixtures/invoicing` project, then scores the exported session tree.

```sh
node .opencode/skills/verify-pstack/scripts/routing-eval.mjs --label <arm> --runs 3 --scenarios feature-agent,feature-slash,investigate,plain-build --parallel 2 --model claude-agent/opus#medium
```

Each run starts its own server with the fixture as the seed and `~/.config/opencode/pstack-models.md` as the model file. It drives one scenario, waits for the parent and every descendant to settle, saves the tree, and always runs `down`. Records go to `verify-evidence/routing/<label>/runs/`, and the scores go to `summary.json` next to them. Pass `--out <dir>` to write elsewhere, `--models <file>` to use another model file, and `--timeout <ms>` to cap every run below its scenario's default.

`scripts/routing-score.mjs` holds the scenario registry and the checks.

- **Feature scenarios.** `feature-agent` runs under the `poteto-mode` agent, and `feature-slash` sends `/poteto-mode` under `build`. Both check that the parent loads `how` and `architect` or `arena` before its first `poteto-agent` delegation, that a `poteto-agent` wrote code, that `deslop` loads in each committing session before its first commit, that `no-comments` loads before the last commit, and that the parent loads `unslop`.
- **Investigate.** The parent loads `how` and `unslop`.
- **The `plain-build` gate.** A small change under `build` commits, gets no `pstack-mode` entry, and loads no hidden pstack skill.

The output is a scenario-by-check pass table, a `gate=` line per gate, and a last line of `routing_accuracy=<0.xx> errors=<n> work=<scored>/<planned> commits=<n> toolcalls=<n>`. A run with a harness failure, a nonzero exit, a timeout, or no tool calls counts as an error and is left out of the accuracy. To change a check and score the saved runs again without new turns, use `--rescore verify-evidence/routing/<label>`.

**Routing matrix.** The matrix asks whether each kind of task reaches the right playbook and first skill, and whether small tasks stay out of pstack. `MATRIX_CASES` in `routing-score.mjs` holds one row per case (`bug`, `perf`, `refactor`, `feature`, `how`, `why`, `plan`, `review`, `prototype`, `typo`, `question`), each with a prompt and an `expect` of `playbook`, `skills`, or `stayOut`. Each row runs as `matrix:<case>@agent` under `poteto-mode` and `matrix:<case>@build` under plain `build`. Select them with `--scenarios matrix`, `matrix@agent`, `matrix@build`, or a single row id. `playbook` passes when the parent reads `poteto-mode/playbooks/<stem>.md` or its first `todowrite` carries that playbook's step 1, and the table shows the playbook it actually picked. `skills` passes when a listed skill loads anywhere in the tree before the first edit, commit, or `poteto-agent` delegation. `stay_out` passes when no playbook is read and no hidden pstack skill loads, apart from the skill the `poteto-mode` agent attaches to its own first message. Matrix rows never finish the task. The driver sends the prompt with `$H start`, takes `$H snapshot` every 10 seconds, and stops at the parent's first edit, commit, or `poteto-agent` delegation, an idle tree, or the `--decide <ms>` budget (240000 by default). `$H stop` then calls `session.interrupt` on every busy session until the tree stays idle, and the record notes `stoppedBy`. An early stop is not an error. The output is a case by entry table, then the usual last line.

```sh
node .opencode/skills/verify-pstack/scripts/routing-eval.mjs --label <arm> --scenarios matrix --runs 3 --parallel 4 --model claude-agent/opus#medium
```

Every run spends real tokens. One real Opus feature session with a single delegate took about 12 minutes and 3.2 million cache-read tokens across its two sessions, and a full arm multiplies that by runs times feature scenarios. `--model` sets only the parent. Delegates take their models from the model file, so a haiku parent on your own `pstack-models.md` still spawns Opus and GPT architect runners and an Opus `poteto-agent`. Validate a change to the eval itself with `--model claude-agent/haiku --models .opencode/skills/verify-pstack/fixtures/pstack-models-inherit.md` and one run per scenario, which keeps every delegate on the parent model, before you spend a paid model on it.

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

`scripts/harness.mjs` drives one server. Run it with no arguments for usage. `scripts/routing-eval.mjs` runs the routing eval on top of it, and `scripts/routing-score.mjs` scores the records it saves. It needs `opencode`, `node`, and `git` on `PATH`, plus the user's own OpenCode credentials, because models come from the real data folder.

## Gotchas

- Sessions are written to the user's real OpenCode database. The server isolates config but not data, because isolating data drops the user's model credentials. `down` deletes this run's sessions. A session the harness filed elsewhere would survive it.
- `opencode run` files its session under `$PWD`, not the process directory. The harness sets `PWD` to the test project. Never run `opencode run --server` by hand from the repo, or the session and every file it touches land in this repo.
- User skills in `~/.claude/skills` and `~/.agents/skills` still load in the test server. One with a pstack ID replaces pstack's. `doctor` then reports fewer than the full count, and `up` times out. Check with `$H skill <id>`.
- OpenCode caches the plugin module and its skills per server. After a change to `src/`, run `$H down` and `$H up`. A running server keeps the old plugin.
- `opencode api` output is cut at 64 KiB when piped. The harness writes it to a file first. Do the same in any one-off call.
