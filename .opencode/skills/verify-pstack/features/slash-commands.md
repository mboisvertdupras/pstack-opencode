# Slash commands

Every pstack skill folder except the principles has a slash command of the same name. The poteto-mode playbooks load as hidden skills by their stem (`bug-fix`), but they get no command. Typing `/how <question>` sends the question with the `how` skill attached, so the agent follows it without loading it first. When a user skill owns the same ID, the command sends pstack's file path instead, so pstack's copy still runs. `/poteto-mode` also turns poteto mode on for the session, as the [poteto-mode agent](./poteto-mode-agent.md) file describes.

## Sub-features

- `cmd-attach` attaches the named skill to the user message.
- `cmd-empty` sends `Run the <id> skill.` when the user typed no text.
- `cmd-principles` gives no command to a `principle-*` skill.
- `cmd-playbook` gives no command to a playbook, which still loads with the `skill` tool by its stem.
- `cmd-shadow` sends pstack's file path, not the skill ID, when a user skill shadows the ID.

## How to get to it (user POV)

- Type `/how`, `/why`, `/deslop`, or any pstack skill folder name in the TUI, then the request.
- Pick the command from the TUI's `/` menu.

## Driving it with harness.mjs

Preconditions:

- `$H doctor` reports every line `ok`, including the command count.

- **Attach.** Run `$H command how "In one sentence, what does math.js export? Answer directly, no subagents."`. The `user` line shows `skills=["how"]` with the text unchanged, and the reply names `add`.
- **Empty text.** Run `$H command bro`. The `user` line shows `skills=["bro"]` and text `"Run the bro skill."`.
- **No principle commands.** Run `$H doctor`. The command line counts only non-principle skills. Then run `$H command principle-prove-it-works "x"`. It fails, because no such command exists.
- **No playbook commands.** Run `$H command bug-fix "x"`. It fails with HTTP 404. Then `$H skill bug-fix` resolves to `src/skills/poteto-mode/playbooks/bug-fix.md` with `autoinvoke=false`.
- **Shadowed ID.** Run `eval "$($H env)"`, then `mkdir -p "$PSTACK_VERIFY_CONFIG/skills/tdd"` and write a `SKILL.md` there with frontmatter `name: tdd` and `description: user tdd`. Run `$H skill tdd` until it resolves to that file. Run `$H command tdd "Reply with only OK."`. The `user` line shows `skills=[]`, and its text starts `Read the pstack \`tdd\` skill at` with the `src/skills/tdd/SKILL.md` path. Remove the folder afterward.

## Gotchas

- `opencode run "/how ..."` sends the slash as plain text. It never reaches the command. Use `$H command`.
- The shadow check compares the registered path with pstack's path at the session's directory. A user skill added mid-run can take a few seconds to register.
- `cmd-shadow` changes `doctor`'s skill count while the user skill exists. Remove it before running `doctor` again.
- Every recipe here runs under `build`, so no gate applies. Under `--agent poteto-mode`, a command that commits meets the commit gate until `deslop` loads.
