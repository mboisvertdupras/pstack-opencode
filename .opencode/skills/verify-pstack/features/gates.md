# Gates

In a poteto-mode session, the plugin rejects some tool calls until pstack's routing has happened, and the rejection message tells the model what to do next. A code change (an edit tool, a `poteto-agent` or `general` spawn, or a `git commit`) waits until a playbook is loaded, or until a todo starts `no playbook:`. Every commit in poteto mode, and every commit by a `poteto-agent`, waits until `deslop` has loaded. Plain sessions and other delegates are never held. Once a playbook loads, no gate waits on `how`, `why`, `architect`, `arena`, or `interrogate`. The model decides when a task needs them.

## Sub-features

- `gate-playbook-first` holds code changes until a playbook loads or a `no playbook:` todo is written.
- `gate-playbook-skill` registers each playbook as a hidden skill under its stem, so `skill bug-fix` loads the Bug fix playbook.
- `gate-skip` lets code changes through after a completed todo whose content starts `no playbook:`.
- `gate-commit` holds `git commit` until `deslop` has loaded, and asks for the commit to be rerun as its own command.

## How to get to it (user POV)

- Select the `poteto-mode` agent or send `/poteto-mode`, then give a task that edits, delegates, or commits.
- Spawn a `poteto-agent` that commits.

## Driving it with harness.mjs

Preconditions:

- `$H doctor` reports every line `ok`, including the playbook count.
- `eval "$($H env)"` ran, and `$PSTACK_VERIFY_PROJECT` has a clean tree at the seed commit.

The model's replies do not show tool errors. For each step, run `$H export <sid>` and read each tool part's `state.status` and `state.error.message` in the saved `session-<sid>.json`.

- **Playbook first.** Run `$H run --agent poteto-mode "Do not load a playbook and do not write a todo. Use the edit tool once to add export const subtract = (a, b) => a - b to math.js, then stop, whatever the tool says."`. The `edit` part has status `error` and a message starting `pstack: poteto mode runs every task through a playbook`. `git -C "$PSTACK_VERIFY_PROJECT" diff` is empty. Carry `<sid1>`.
- **Playbook lifts the hold.** Run `$H run --agent poteto-mode --session <sid1> "Load bug-fix with the skill tool, then retry that one edit. Stop at the next rejection."`. `skill bug-fix` completes, and the `edit` completes too, with no `how` or `why` load.
- **Skip, then commit gate.** Run `$H run --agent poteto-mode "First add one todo whose content is exactly 'no playbook: one-line edit', then use the edit tool to add export const subtract = (a, b) => a - b to math.js, then run git commit -am verify as one shell call, then stop whatever happens."`. `todowrite` and `edit` complete. The `shell` part errors with `pstack: load the \`deslop\` skill with the \`skill\` tool`, and `git -C "$PSTACK_VERIFY_PROJECT" log --oneline -1` still shows `seed`.
- **Restore.** Run `git -C "$PSTACK_VERIFY_PROJECT" checkout .` after the playbook step and after the skip step.

## Gotchas

- Shell writes (`printf >`, `sed -i`) are not held. Use the `edit` tool to trip a gate.
- A loaded playbook and a loaded `deslop` carry over within a session. Use a fresh session for each check.
- Your own coordinating session may be in poteto mode too. Editing the map from it meets the playbook-first gate. Record a `no playbook:` todo, which is what it exists for.
