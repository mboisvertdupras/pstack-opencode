# pstack in OpenCode verification map

This folder is the maintained source for verifying what a pstack user sees in OpenCode. Read the index, then use the matching feature file as the recipe.

## Baseline preconditions

- `$H up` ran after the last change to `src/` or `scripts/`.
- `$H up` printed `ready`, and `$H doctor` reports every line `ok`.
- The test project is the seeded git repo with one file, `math.js`, which exports `add`.
- The test config has no `pstack-models.md` until a recipe writes one.

## Driving conventions

- `H=.opencode/skills/verify-pstack/scripts/harness.mjs`, run from the repo root.
- Each recipe starts a fresh session unless it says to continue one. Carry the `session <sid>` that `run` and `command` print.
- Prompts in recipes are literal. Keep them unchanged, because they tell the model not to do real work.
- Never drive a server this run did not start.
- A recipe that edits, delegates, or commits under `--agent poteto-mode` or `/poteto-mode` meets the [gates](./gates.md). Recipes outside the gates file run under `build` to stay clear of them.

## Proof and skip reporting

- A slash command proof is a `command-*.txt` showing the attached skill and the reply.
- A mode or role proof includes `entries-*.json` next to the transcript.
- A delegate proof includes the child session from `$H children` and its `export`.
- Record the feature ID with every artifact you cite.
- Report an unreachable path with the command you ran and the precondition it lacked. Do not report it as verified through another path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with harness.mjs` starts with `Preconditions:` and uses labeled bullets that pair each action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a run.

## Features

- [Slash commands](./slash-commands.md) covers `/<skill>` attaching its skill, principles and playbooks having no command, and the path fallback when a user skill shadows a pstack ID.
- [poteto-mode agent](./poteto-mode-agent.md) covers the persistent mode, its instruction entry, switching away, and `/poteto-mode` keeping the mode on.
- [Model roles](./model-roles.md) covers `pstack-models.md` reaching every session, following edits and deletion, the code-delegate ladder, and the cross-family pool.
- [Subagents](./subagents.md) covers `poteto-agent` loading poteto-mode by ID, `comment-sicko` reporting without editing, and nested spawns.
- [Gates](./gates.md) covers playbooks loading as skills and the `deslop` commit gate.
- [Installer](./installer.md) covers linking, rerunning, retiring old agent links, refusing to overwrite, and uninstalling.
