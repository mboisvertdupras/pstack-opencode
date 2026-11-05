# Model roles

`/setup-pstack` writes per-role model choices to `pstack-models.md` in the OpenCode config folder. The plugin keeps that file in every session as the `pstack-models` instruction entry, so pstack skills pick each role's model from it. An edit shows up at the next request, and deleting the file removes the entry.

## Sub-features

- `models-entry` adds the `pstack-models` entry when the file exists and is not empty.
- `models-edit` replaces the entry text after the file changes.
- `models-delete` removes the entry after the file is deleted or emptied.
- `models-read` lets the agent answer a role's model from the entry.
- `models-ladder` picks a code delegate's model from a list on a code playbook line, per the Subagents section of the poteto-mode skill.
- `models-pool` picks a cross-family reviewer from the `arena cross-judge pool` line, skipping entries in the caller's own family.

## How to get to it (user POV)

- Run `/setup-pstack` and accept a configuration.
- Edit `pstack-models.md` by hand in the OpenCode config folder the plugin reads: `$XDG_CONFIG_HOME/opencode` when that is set, else `~/.config/opencode`.

## Driving it with harness.mjs

Preconditions:

- `eval "$($H env)"` ran, and `$PSTACK_VERIFY_CONFIG/pstack-models.md` does not exist.

- **No file.** Run `$H run "Reply with only OK."`. Then `$H entries <sid>` lists no `pstack-models`.
- **Write.** Run `printf '# budget: small (medium)\nswarm workers: claude-agent/haiku#medium\n' > "$PSTACK_VERIFY_CONFIG/pstack-models.md"`. Then `$H run --session <sid> "Which model does the swarm workers role use? One line."`. The reply names `claude-agent/haiku#medium`, and `$H entries <sid>` shows `pstack-models` containing that line.
- **Edit.** Change the line to `swarm workers: inherit-parent`, then `$H run --session <sid> "Reply with only OK."`. `$H entries <sid>` shows `inherit-parent`.
- **Empty.** Run `: > "$PSTACK_VERIFY_CONFIG/pstack-models.md"` and `$H run --session <sid> "Reply with only OK."`. `$H entries <sid>` lists no `pstack-models`.
- **Delete.** Write any role line to the file, run a turn, and confirm the entry is back. Then run `rm "$PSTACK_VERIFY_CONFIG/pstack-models.md"` and `$H run --session <sid> "Reply with only OK."`. `$H entries <sid>` lists no `pstack-models`.
- **Pool.** Write `arena cross-judge pool: claude-agent/haiku#low, openrouter/deepseek/deepseek-v4.1-flash-1017#low` to the file, using a non-Claude entry this machine's providers list. Run `$H run "Spawn one general subagent on a different model family from yours, picking its model from the arena cross-judge pool line in your pstack-models context the way the arena skill picks a cross-family judge: skip entries in your own family. Give it the brief 'Reply with only OK.' Do nothing else."`. Take the child from `$H children <sid>`, run `$H export <child>`, and read `info.model` in the saved JSON. It names the non-Claude entry.
- **Ladder.** Write `feature, refactoring: claude-agent/haiku#medium, claude-agent/sonnet#medium` to the file. Run `$H run --model claude-agent/sonnet#medium` twice with the prompt "Load the poteto-mode skill. You are on step 4 of pstack's Feature playbook. Delegate the code change below to a poteto-agent subagent, choosing its model from the feature, refactoring line in your pstack-models context per the skill's Subagents section. Give the delegate the brief 'Reply with only OK. Do not change any files.' Skip every other playbook step. Task:" and a task. The task "add an exported subtract(a, b) next to add in math.js" gets a child on `haiku`. The task "move add into ops/add.js, add ops/subtract.js, and change math.js to re-export both, with add now taking an array of numbers" gets a child on `sonnet`. Take each child from `$H children <sid>`, run `$H export <child>`, and read `info.model` in the saved JSON. The reply's claim alone is not proof.

## Gotchas

- The harness config folder is not `~/.config/opencode`. Writing the user's real file changes their real sessions, not the test server's.
- The entry updates at the next request, so read `entries` only after a turn.
- The file is read by modification time. Two writes within the filesystem's timestamp resolution can look like one.
- The `setup-pstack` skill tells the agent to write `~/.config/opencode/pstack-models.md`, while the plugin reads `$XDG_CONFIG_HOME/opencode` when that is set. Drive the file directly, as these recipes do, instead of verifying through `/setup-pstack`.
