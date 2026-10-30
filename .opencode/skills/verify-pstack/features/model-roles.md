# Model roles

`/setup-pstack` writes per-role model choices to `pstack-models.md` in the OpenCode config folder. The plugin keeps that file in every session as the `pstack-models` instruction entry, so pstack skills pick each role's model from it. An edit shows up at the next request, and deleting the file removes the entry.

## Sub-features

- `models-entry` adds the `pstack-models` entry when the file exists.
- `models-edit` replaces the entry text after the file changes.
- `models-delete` removes the entry after the file is deleted.
- `models-read` lets the agent answer a role's model from the entry.

## How to get to it (user POV)

- Run `/setup-pstack` and accept a configuration.
- Edit `~/.config/opencode/pstack-models.md` by hand.

## Driving it with harness.mjs

Preconditions:

- `eval "$($H env)"` ran, and `$PSTACK_VERIFY_CONFIG/pstack-models.md` does not exist.

- **No file.** Run `$H run "Reply with only OK."`. Then `$H entries <sid>` lists no `pstack-models`.
- **Write.** Run `printf '# budget: small (medium)\nswarm workers: claude-agent/haiku#medium\n' > "$PSTACK_VERIFY_CONFIG/pstack-models.md"`. Then `$H run --session <sid> "Which model does the swarm workers role use? One line."`. The reply names `claude-agent/haiku#medium`, and `$H entries <sid>` shows `pstack-models` containing that line.
- **Edit.** Change the line to `swarm workers: inherit-parent`, then `$H run --session <sid> "Reply with only OK."`. `$H entries <sid>` shows `inherit-parent`.
- **Delete.** Run `rm "$PSTACK_VERIFY_CONFIG/pstack-models.md"` and `$H run --session <sid> "Reply with only OK."`. `$H entries <sid>` lists no `pstack-models`.

## Gotchas

- The harness config folder is not `~/.config/opencode`. Writing the user's real file changes their real sessions, not the test server's.
- The entry updates at the next request, so read `entries` only after a turn.
- The file is read by modification time. Two writes within the filesystem's timestamp resolution can look like one.
