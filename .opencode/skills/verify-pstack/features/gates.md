# Gates

In a poteto-mode session, the plugin rejects some tool calls until pstack's routing has happened, and the rejection message tells the model what to do next. A code change (an edit tool, a `poteto-agent` or `general` spawn, or a `git commit`) waits until a playbook is loaded, or until a todo starts `no playbook:`. Once a playbook is loaded, code changes wait until each skill in its `requires` front matter has loaded and run. Investigation and Review hold the parent's own reads of project files the same way. Every commit in poteto mode, and every commit by a `poteto-agent`, waits until `deslop` has loaded. Plain sessions and other delegates are never held.

## Sub-features

- `gate-playbook-first` holds code changes until a playbook loads or a `no playbook:` todo is written.
- `gate-playbook-skill` registers each playbook as a hidden skill under its stem, so `skill bug-fix` loads the Bug fix playbook.
- `gate-requires` holds code changes until the playbook's `requires` skills have loaded.
- `gate-ran` holds them until each required skill has run, by the evidence in `RAN` in `src/plugin/lib.js`: an `explore` spawn after `how` or `architect` loads, a `general` spawn or `git log`/`git blame` after `why` loads, a `general` spawn after `interrogate` loads.
- `gate-reads` holds the parent's `read`, `grep`, `glob`, and `list` on project files in a playbook marked `gates: reads` (Investigation, Review). Reads of pstack's own files and shell commands pass.
- `gate-skip` lets code changes through after a completed todo whose content starts `no playbook:`.
- `gate-commit` holds `git commit` until `deslop` has loaded, and asks for the commit to be rerun as its own command.

## How to get to it (user POV)

- Select the `poteto-mode` agent or send `/poteto-mode`, then give a task that edits, delegates, commits, or asks how code works.
- Spawn a `poteto-agent` that commits.

## Driving it with harness.mjs

Preconditions:

- `$H doctor` reports every line `ok`, including the playbook count.
- `eval "$($H env)"` ran, and `$PSTACK_VERIFY_PROJECT` has a clean tree at the seed commit.

The model's replies do not show tool errors. For each step, run `$H export <sid>` and read each tool part's `state.status` and `state.error.message` in the saved `session-<sid>.json`.

- **Playbook first.** Run `$H run --agent poteto-mode "Do not load a playbook and do not write a todo. Use the edit tool once to add export const subtract = (a, b) => a - b to math.js, then stop, whatever the tool says."`. The `edit` part has status `error` and a message starting `pstack: poteto mode runs every task through a playbook`. `git -C "$PSTACK_VERIFY_PROJECT" diff` is empty. Carry `<sid1>`.
- **Requires.** Run `$H run --agent poteto-mode --session <sid1> "Load bug-fix with the skill tool, then retry that one edit. Stop at the next rejection."`. `skill bug-fix` completes, and the next `edit` error starts `pstack: the Bug fix playbook runs the \`how\` and \`why\` skills before any code change`.
- **Loaded, not run.** Run `$H run --agent poteto-mode --session <sid1> "Load how with the skill tool but do not run it or spawn anyone, then retry the edit. Stop at the next rejection."`. The edit error now says `` `how` is loaded but hasn't run ``.
- **Run evidence.** Run `$H run --agent poteto-mode --session <sid1> "Spawn one explore subagent with the brief 'Reply only with OK. Do no work.' Then retry the edit. Stop at the next rejection."`. The `explore` spawn completes, and the edit error now names only `why`.
- **Skip, then commit gate.** Run `$H run --agent poteto-mode "First add one todo whose content is exactly 'no playbook: one-line edit', then use the edit tool to add export const subtract = (a, b) => a - b to math.js, then run git commit -am verify as one shell call, then stop whatever happens."`. `todowrite` and `edit` complete. The `shell` part errors with `pstack: load the \`deslop\` skill with the \`skill\` tool`, and `git -C "$PSTACK_VERIFY_PROJECT" log --oneline -1` still shows `seed`.
- **Read gate.** Run `$H run --agent poteto-mode "Load investigation with the skill tool, then use the read tool on math.js. One call each, then stop at the first rejection."`. The `read` error starts `pstack: the Investigation playbook reads the code through the \`how\` skill`. Repeat with `review`. The error names `interrogate`.
- **Restore.** Run `git -C "$PSTACK_VERIFY_PROJECT" checkout .` after the skip step.

## Gotchas

- Shell writes (`printf >`, `sed -i`) and shell reads (`cat`) are not held. Use the `edit` and `read` tools to trip a gate.
- One `explore` spawn after both loads counts as the run for `how` and `architect` together.
- A spawn that is a required skill's run evidence waits only for the loads, not the runs, so a passing `general` spawn under Bug fix does not mean `how` has run.
- Loads and runs carry over within a session. A second task in the same session is not held for skills it already ran. Use a fresh session for each check.
- An attached skill, such as the one `/how` attaches, is not a load. Only a `skill` call or a read of the skill's file counts.
- Your own coordinating session may be in poteto mode too. Editing the map from it meets the playbook-first gate. Record a `no playbook:` todo, which is what it exists for.
