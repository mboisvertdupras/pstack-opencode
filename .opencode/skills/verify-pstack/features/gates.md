# Gates

In a poteto-mode session, the plugin rejects a `git commit` until `deslop` has loaded, and the rejection message tells the model what to do next. Every commit by a `poteto-agent` waits the same way. Once a playbook with `requires` frontmatter loads, the plugin also rejects a `poteto-agent` delegation and a commit until every skill that playbook lists has loaded, and one rejection names everything missing. Edits and subagent calls to any other agent, such as `explore`, `general`, or `comment-sicko`, are never held. Plain sessions and other delegates are never held at all. Routing comes from the `poteto-mode` skill's prose. The model decides when a task needs a playbook, and when it needs `how`, `why`, `architect`, `arena`, or `interrogate`.

## Sub-features

- `gate-playbook-skill` registers each playbook as a hidden skill under its stem, so `skill bug-fix` loads the Bug fix playbook.
- `gate-commit` holds `git commit` until `deslop` has loaded, and asks for the commit to be rerun as its own command.
- `gate-playbook-requires` holds a `poteto-agent` delegation and a `git commit` until every skill in the loaded playbook's `requires` frontmatter has loaded, and names the playbook and the missing skills.

## How to get to it (user POV)

- Select the `poteto-mode` agent or send `/poteto-mode`, then give a task that commits.
- Spawn a `poteto-agent` that commits.
- Load a playbook that has `requires` frontmatter, such as Perf issue, then delegate to `poteto-agent`.

## Driving it with harness.mjs

Preconditions:

- `$H doctor` reports every line `ok`, including the playbook count.
- `eval "$($H env)"` ran, and `$PSTACK_VERIFY_PROJECT` has a clean tree at the seed commit.

The model's replies do not show tool errors. For each step, run `$H export <sid>` and read each tool part's `state.status` and `state.error.message` in the saved `session-<sid>.json`.

- **Commit gate.** Run `$H run --agent poteto-mode "Use the edit tool to add export const subtract = (a, b) => a - b to math.js, then run git commit -am verify as one shell call, then stop whatever happens."`. The `edit` completes with no playbook loaded. The `shell` part errors with `pstack: load the \`deslop\` skill with the \`skill\` tool`, and `git -C "$PSTACK_VERIFY_PROJECT" log --oneline -1` still shows `seed`.
- **Playbook requires.** Run `$H run --agent poteto-mode "Load the perf-issue skill with the skill tool. Then spawn the poteto-agent subagent with the brief 'Reply with OK. Do no other work.' Then stop whatever happens."`. The `subagent` part errors with `pstack: the Perf issue playbook always runs \`benchmark-checklist\`, \`how\`, and \`principle-sequence-verifiable-units\``, and `$H children <sid>` lists no child. Run `$H run --session <sid> "Load the benchmark-checklist, how, and principle-sequence-verifiable-units skills with the skill tool and do none of the work they describe. Then spawn the poteto-agent subagent with the brief 'Reply with OK. Do no other work.' and relay its reply."`. The `subagent` part completes, and `$H children <sid>` lists one `poteto-agent` child.
- **Restore.** Run `git -C "$PSTACK_VERIFY_PROJECT" checkout .` after the commit gate step.

## Gotchas

- A loaded `deslop` or playbook carries over within a session. Use a fresh session for each check.
- The plugin records loads per session. A `poteto-agent` child has no playbook of its own, so its commits wait only for `deslop`, whatever playbook its parent loaded.
