# Porting contract

pstack-opencode is a self-contained plugin. `src/` is the plugin: `src/package.json`, `src/plugin/`, `src/agents/`, `src/skills/<id>/`. Upstream pstack (`.upstream/pstack`, plus `deslop`, `control-cli`, `control-ui` from `.upstream/cursor-team-kit`) is a reference to port from, never something the plugin reads. There is no adapter, no docs folder, and no build step. Each skill states the real tool, field, path, or command directly.

`scripts/lint-skills.mjs [path...]` is the definition of done for a file: zero findings. It checks product names, Cursor vocabulary, links, and frontmatter. Run it on your scope after every edit batch.

## Hard rules

- No skill names a product in prose. Never write `Cursor` or `OpenCode`. Describe the capability ("the agent", "the app", "this plugin"). Lowercase `opencode` may appear only inside a backticked literal command or path the agent must run or open, such as `opencode session export <id>` or `~/.config/opencode/pstack-models.md`.
- Keep each skill's meaning, steps, voice, and structure. Port it. Don't rewrite it. Change only what this contract maps, plus the minimum rewording needed to read naturally.
- Relative links between skills stay relative (`../how/SKILL.md`). The plugin turns them into absolute paths at load time. A link to a file that doesn't exist in `src/skills` becomes plain text or is dropped. Never use a `github.com/cursor/...` URL.
- Frontmatter keeps `name`, `description`, and `disable-model-invocation` when upstream sets it. Drop Cursor-only fields such as `icon` and `color`.
- Keep the generic word "cursor" in code (`endCursor`, a GraphQL pagination cursor). Lowercase `"cursor"` as a GitHub bot login and `CURSOR_AUTOMATION_ID` in `watch-pr/github.ts` detect Bugbot, so leave them.

## Vocabulary map

| Upstream | Write instead |
| --- | --- |
| `Task` tool, a Task call, Task subagent | the `subagent` tool. Fields: `agent`, `description`, `prompt`, `background`, `model`, `sessionID`. |
| `subagent_type: generalPurpose` | `agent: "general"` |
| `subagent_type: "poteto-agent"`, `comment-sicko` | `agent: "poteto-agent"`, `agent: "comment-sicko"` |
| `readonly: true` | `agent: "explore"`. It has `read`, `grep`, `glob`, `shell`, `webfetch`, `websearch`, and no `edit`, `execute`, or `skill`. So the brief carries the skill text or path it needs, says "do not edit files", and the parent checks `git status` afterwards. |
| `readonly: false` | `agent: "general"` or the named agent. These keep MCP through `execute`. |
| `run_in_background: true` | `background: true`. The call returns the child's `sessionID` at once, and you're notified when the child finishes. |
| `resume`, resume an agent | continue the child by passing its `sessionID` |
| `file_attachments` | list the absolute paths in `prompt` |
| `environment: "cloud"`, cloud agent, cloud VM | a git worktree. Create it with `tools.opencode.worktree_create({ name })` inside `execute`, and put the returned `directory` in the brief. The worker runs every command there. Name the branch or commit it checks out. A step that needs the cloud agent itself (its dashboard, its machine) is dropped. |
| `environment: "local"` | omit |
| `cloud_base_branch: <b>` | the worker runs `git switch -c <work-branch> <b>` in the worktree first |
| nested subagents | a subagent can spawn only when `experimental.subagent_depth` is above 1. If a spawn is rejected for depth, run that step yourself, or finish and tell the parent which spawns to make. |
| `AskQuestion` | the `question` tool. Each question needs a short `header`, the `question`, and `options`. A free-form answer is always offered, so never add an "other" option. In a non-interactive run (`opencode run`) no one answers, so ask in plain text. |
| open a todolist, todo list | `todowrite`. Without it, keep the list in your reply and update it at each phase. |
| `/name`, "the **name** skill", when the agent should run a skill | load it with the `skill` tool by ID (`name`). Most pstack skills are hidden from the catalog but load by ID. Write `/name` only when telling a user what to type. |
| `Read`, `Grep`, `Glob`, `Shell`, `Edit`, `Write` | `read`, `grep`, `glob`, `shell`, `edit`, `write`. Put the working directory in `shell`'s `workdir`. |
| MCP tool calls | `execute`, under the server's namespace |
| model slug `claude-opus-5-5-xhigh`, `grok-4.7-xhigh-fast` | `<provider>/claude-opus-5-5#xhigh`, `<provider>/grok-4.7#xhigh` from a provider that lists the model. The variant is the effort, on the ladder `max` > `xhigh` > `high` > `medium` > `low`. There's no fast flag, so drop `-fast` and any fast-mode rule. If no provider lists the family, omit `model` so the child runs on the parent model, and say so. |
| `pstack-models.mdc` rule, `~/.cursor/rules/pstack-models.mdc` | the `pstack-models` instruction entry, which the plugin keeps in every session. `/setup-pstack` writes it to `~/.config/opencode/pstack-models.md`. A role value is `<provider>/<model>#<variant>`, passed as `model` unchanged. `auto` or `inherit-parent` means omit `model`. |
| `.cursor/skills/`, `~/.cursor/skills/` | `.opencode/skills/`, `~/.config/opencode/skills/`. A user skill there with a pstack ID shadows pstack's, and the `skill` tool's base directory shows which one loaded. |
| `~/.cursor/plugins/`, `.cursor-plugin/plugin.json`, `plugins/cache/` | this plugin's folder. Never edit an installed copy. |
| `.cursor/rules/*.mdc`, always-applied rules | `AGENTS.md` in the project, or `~/.config/opencode/AGENTS.md` for every project |
| `~/.cursor/projects/<slug>/agent-transcripts/` | session transcripts. `opencode session list --format json` lists this project's sessions, newest first. `opencode session export <id>` prints one as JSON. `opencode api session.list --param parentID=<id>` lists a session's subagent sessions. Read only this project's sessions. |
| Custom Mode, Use as Mode, Option+Enter | the `poteto-mode` agent (Tab to select it, or start with `--agent poteto-mode`). The plugin attaches the skill to its first message and keeps a `pstack-mode` instruction entry. |
| `/loop until <predicate>` | `/goal <predicate>`, with a check that can pass or fail |
| `/loop <interval>` | a `shell` call with `background: true` running `sleep <seconds>`. You're woken when it exits. Run the tick, then start the next sleep. |
| `create-skill` (the built-in for authoring SKILL.md) | the `skill-creator` or `writing-for-agents` skill when the catalog lists one. Otherwise author it by hand: `<id>/SKILL.md` with `name` and `description` frontmatter. |
| `cursor-team-kit` (`deslop`, `control-cli`, `control-ui`) | the bundled `deslop`, `control-cli`, `control-ui` skills. Before `control-ui` builds a harness, check for a browser you can already drive: the `browser` namespace inside `execute`, or a browser MCP such as `chrome-devtools`. |
| Cursor Automations, routines, `update_state`, `SendToUser`, automation webhooks | drop the step. A skill that only exists for these is not ported. |
| Bugbot | a review bot on GitHub. Its comments are ordinary review threads, triaged with `gh`. Drop steps that start, wait for, or configure Bugbot when the PR has none. |
| built-in PR tool | `gh pr create` and the other `gh pr` commands |
| `https://github.com/cursor/plugins/blob/main/pstack/<path>` | the relative path to the ported file, or plain text when it isn't ported |
| `docs/guide/...` links | plain text, or drop the link. There's no docs folder. |

## Not ported

- `make-bot-ui`. It only exists for Cursor Automations.
