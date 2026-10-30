# pstack for OpenCode

[pstack](https://github.com/cursor/plugins/tree/main/pstack) is poteto's set of rigorous engineering skills for Cursor. This repo runs it in OpenCode V2 on OpenCode's own primitives. The skills, playbooks, and principles are upstream's, unchanged. What changes is the machinery around them: agents, commands, modes, models, and loops map to the OpenCode feature that does the same job.

It also bundles `deslop`, `control-cli`, and `control-ui` from `cursor-team-kit`, which `/poteto-mode` routes to.

## Install

```sh
npm run install-pstack                         # every project, under ~/.config/opencode
npm run install-pstack -- --project ~/code/app # one project, under its .opencode/
```

The installer links two things and copies nothing. The plugin directory goes to `plugins/pstack`, and the three agents go to `agents/`. Rerunning it is safe. It never overwrites a file it did not create. `--uninstall` removes only its own links, and `--dry-run` shows what it would do.

Then do the two things the installer prints:

1. Add `"todo": true` and `"subagent_depth": 2` under `experimental` in your OpenCode config. The first gives agents `todowrite`, the todo list every playbook opens. The second lets a delegate run skills that spawn their own subagents, such as `/no-comments` calling `/how`.
2. Run `/setup-pstack` once to pick a model per role.

## Use

Same as upstream. Start rigorous work with `/poteto-mode <task>`, and the other skills run as its steps need them. Every pstack skill has a slash command of the same name, such as `/how`, `/why`, `/interrogate`, and `/deslop`.

To keep the mode on across turns, press Tab to the `poteto-mode` agent, or start with `opencode --agent poteto-mode`. That replaces Cursor's Custom Mode.

For overnight runs, give OpenCode's built-in `/goal` a check that can pass or fail. That replaces Cursor's `/loop`.

## How it maps to OpenCode

| pstack in Cursor | pstack in OpenCode |
| --- | --- |
| Plugin with `skills/` and `agents/` | A server plugin that registers the skills and commands, plus three Markdown agents |
| `/name` attaches a skill to one message | A plugin command that attaches the skill through the prompt's `skills` field |
| Custom Mode (Option+Enter) | The `poteto-mode` primary agent. The plugin attaches the skill to its first message and keeps a `pstack-mode` session instruction entry, which survives compaction. |
| `~/.cursor/rules/pstack-models.mdc`, an always-applied rule | `~/.config/opencode/pstack-models.md`, kept in every session as the `pstack-models` instruction entry |
| `Task` with `subagent_type`, `readonly`, `resume`, `run_in_background` | `subagent` with `agent`, `explore`, `sessionID`, `background` |
| Model slugs such as `claude-opus-5-5-xhigh` | `<provider>/claude-opus-5-5#xhigh`. Effort is the model variant. |
| `environment: "cloud"` | A git worktree from `worktree_create` |
| `AskQuestion`, todo list | `question`, `todowrite` |
| `/loop` | `/goal`, or a background `sleep` for a fixed cadence |
| `agent-transcripts/` | `opencode session list` and `opencode session export` |

The full table lives in [`src/adapter.md`](src/adapter.md). Every pstack skill that uses a Cursor name gets one added line telling the agent to read it once per session. That is the same mechanism upstream uses for Claude Code.

Session instruction entries carry the mode and the model roles because every provider receives them. That includes `claude-agent`, which ignores system text that plugin hooks add.

A user skill with the same ID as a pstack skill keeps that ID. Today that is `tdd` and `teach` if you have them in `~/.agents/skills`. pstack then reads its own copy by path, and its `/tdd` and `/teach` commands do too.

Cursor Automations, Bugbot setup, and cloud agents have no OpenCode equivalent. A step that needs one is skipped with a one-line note. `make-bot-ui` is Automations-only.

## Layout

```text
src/adapter.md          Cursor names to OpenCode primitives (dist/docs/harness/opencode.md)
src/agents/             poteto-agent and the poteto-mode primary agent
src/plugin/             The OpenCode plugin. lib.js is pure, index.js is the boundary.
src/pins.json           Hashes of the upstream files src/ adapts
scripts/build.mjs       Upstream checkout to dist/, with --check, --update, --repin
scripts/install.mjs     Links dist/ into OpenCode
test/                   Plugin behavior against a fake OpenCode context
upstream.json           The pinned cursor/plugins commit
dist/                   Generated. Never edit by hand.
```

## Update from upstream

```sh
npm run update-upstream   # move the pin to cursor/plugins main and rebuild
npm test
```

The build fails loudly in three cases:

- An upstream file that `src/` adapts by hand has changed. The message names the `git diff` to review. Update `src/`, then run `node scripts/build.mjs --repin`.
- A skill starts using a Cursor name the adapter has no row for.
- A skill's frontmatter no longer parses, or a link in authored text points outside the tree.

`npm run check` fails when `dist/` is stale.

## License

MIT. pstack is by Lauren Tan, and `cursor-team-kit` is by Cursor. Their licenses ship in `dist/LICENSE` and `dist/LICENSE-cursor-team-kit`.
