# poteto-mode agent

Selecting the `poteto-mode` agent keeps poteto mode on for the whole session, replacing Cursor's Custom Mode. The first message carries the `poteto-mode` skill, and a `pstack-mode` instruction entry stays on the session so the mode survives compaction. Switching to another agent removes the entry.

## Sub-features

- `mode-first` attaches the `poteto-mode` skill to the first user message.
- `mode-once` attaches nothing to later messages in the same session.
- `mode-entry` puts the `pstack-mode` instruction entry on the session.
- `mode-playbook` makes the agent match a playbook from the skill.
- `mode-off` removes the entry once the session runs under another agent.
- `mode-other` gives sessions on other agents no entry and no skill.

## How to get to it (user POV)

- Press Tab in the TUI until `poteto-mode` is selected, then type a task.
- Start with `opencode --agent poteto-mode`.

## Driving it with harness.mjs

Preconditions:

- `$H doctor` lists `poteto-mode=primary`.

- **First message.** Run `$H run --agent poteto-mode "Task: add a subtract function to math.js. Do NOT do the task. Reply only with the playbook you matched and the path of the playbook file."`. The reply names the Feature playbook and `src/skills/poteto-mode/playbooks/feature.md`. Carry the printed `<sid>`.
- **Mechanism.** Run `$H export <sid>`. The first `user` line shows `skills=["poteto-mode"]`. Run `$H entries <sid>`. It lists `pstack-mode`, whose text starts `poteto mode is on`.
- **Later message.** Run `$H run --agent poteto-mode --session <sid> "One word: are you still in poteto mode?"`. Then `$H export <sid>` shows `skills=[]` on the second `user` line.
- **Switch away.** Run `$H run --agent build --session <sid> "Reply with only OK."`. Then `$H entries <sid>` no longer lists `pstack-mode`.
- **Other agents.** Run `$H run "Reply with only OK."`. Then `$H entries <new sid>` lists no `pstack-mode` and `export` shows `skills=[]`.
- **Slash command.** Run `$H command poteto-mode --agent build "Reply with only OK."`. Then `$H entries <sid>` lists `pstack-mode`, though the session runs `build`.

## Gotchas

- The reply alone does not prove the mode. The model can find the playbook by reading files. Cite the `skills` field and the entry.
- `pstack-models` also appears in `entries` once a recipe writes the model file. It is unrelated to the mode.
- The skill is attached once per session, tracked in plugin storage. A second run on a fresh session attaches it again.
