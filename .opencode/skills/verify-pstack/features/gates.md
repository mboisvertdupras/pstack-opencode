# Gates

In a poteto-mode session, the plugin rejects a `git commit` until `deslop` has loaded, and the rejection message tells the model what to do next. Every commit by a `poteto-agent` waits the same way. Edits and delegations are never held, with or without a playbook, and plain sessions and other delegates are never held at all. Routing comes from the `poteto-mode` skill's prose. The model decides when a task needs a playbook, and when it needs `how`, `why`, `architect`, `arena`, or `interrogate`.

## Sub-features

- `gate-playbook-skill` registers each playbook as a hidden skill under its stem, so `skill bug-fix` loads the Bug fix playbook.
- `gate-commit` holds `git commit` until `deslop` has loaded, and asks for the commit to be rerun as its own command.

## How to get to it (user POV)

- Select the `poteto-mode` agent or send `/poteto-mode`, then give a task that commits.
- Spawn a `poteto-agent` that commits.

## Driving it with harness.mjs

Preconditions:

- `$H doctor` reports every line `ok`, including the playbook count.
- `eval "$($H env)"` ran, and `$PSTACK_VERIFY_PROJECT` has a clean tree at the seed commit.

The model's replies do not show tool errors. For each step, run `$H export <sid>` and read each tool part's `state.status` and `state.error.message` in the saved `session-<sid>.json`.

- **Commit gate.** Run `$H run --agent poteto-mode "Use the edit tool to add export const subtract = (a, b) => a - b to math.js, then run git commit -am verify as one shell call, then stop whatever happens."`. The `edit` completes with no playbook loaded. The `shell` part errors with `pstack: load the \`deslop\` skill with the \`skill\` tool`, and `git -C "$PSTACK_VERIFY_PROJECT" log --oneline -1` still shows `seed`.
- **Restore.** Run `git -C "$PSTACK_VERIFY_PROJECT" checkout .` after the commit gate step.

## Gotchas

- A loaded `deslop` carries over within a session. Use a fresh session for each check.
