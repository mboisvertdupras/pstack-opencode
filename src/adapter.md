# pstack in OpenCode

pstack skills use Cursor names. In OpenCode, read this file once per session, then map each Cursor name in a skill with the tables below. `<pstack>` means the folder that holds `skills/` and `docs/`. It sits two folders above any pstack skill's base directory, so `<pstack>/skills/<name>/SKILL.md` is a skill's file. If a Cursor field has no row, drop it and say so. Never pass a field or value the tool schema rejects.

## Tools

| Cursor | OpenCode |
| --- | --- |
| `Task` | `subagent`. Its fields are `agent`, `description`, `prompt`, `background`, `model`, and `sessionID`. Only agents with `mode: subagent` or `all` can run there. |
| `AskQuestion` | `question`. Each question needs a short `header`, the `question`, and `options`. A free-form answer is always offered, so never add an "other" option. Under `opencode run` no client answers, so ask in plain text instead. |
| Open a todolist | `todowrite`, when the session offers it. It appears when the config sets `experimental.todo: true`. Otherwise keep the list in your reply and update it at each phase. |
| Run another pstack skill (`/name` or "the **name** skill") | `skill` with the skill's folder name as `id`. It loads pstack skills even though they are hidden from the catalog. Check the base directory it reports. If that is not `<pstack>/skills/<name>`, a user skill with the same ID shadows pstack's, so `read` `<pstack>/skills/<name>/SKILL.md` and follow that instead. When you tell the user to type it, write `/<name>`. |
| `Read`, `Grep`, `Glob`, `Shell`, `Edit`, `Write` | `read`, `grep`, `glob`, `shell`, `edit`, `write`. Put the working directory in `shell`'s `workdir`, not in a `cd`. |
| MCP tools | `execute`, under the server's namespace, unless the server sets `codemode: false`. |

## Subagent fields

| Cursor | OpenCode |
| --- | --- |
| `subagent_type: generalPurpose` | `agent: "general"`. |
| `poteto-agent`, `comment-sicko` | `agent: "poteto-agent"`, `agent: "comment-sicko"`. pstack ships both as OpenCode agents. |
| `readonly: true` | `agent: "explore"`. It has `read`, `grep`, `glob`, `shell`, `webfetch`, and `websearch`. It has no `edit`, no `execute`, so no MCP, and no `skill`, so the brief carries any skill text it needs, or the file path to `read`. It keeps `shell`, so the brief also says "do not edit files", and you check `git status` afterward. |
| `readonly: false` | `agent: "general"`, or the named agent. These keep the session's MCP servers through `execute`, so a step that needs MCP never runs on `explore`. |
| `environment: "cloud"` | A git worktree. Create it with `tools.opencode.worktree_create({ name })` inside `execute`, put the returned `directory` in the brief, and tell the worker to run every command, edit, and commit there. Name the branch or commit the worker checks out. A subagent starts in the parent's directory, so the brief carries the path. |
| `environment: "local"` | Omit. The worker runs in the parent's checkout. |
| `cloud_base_branch: <b>` | Create the worktree, then tell the worker to run `git switch -c <work-branch> <b>` in it first. |
| `run_in_background: true` | `background: true`. The call returns at once with the child's `sessionID`, and OpenCode notifies you when the child finishes. |
| `resume` | `sessionID` set to the earlier child's ID. This continues the same child conversation. The fresh-subagent rule in poteto-mode still decides whether to resume at all. |
| `file_attachments` | List the absolute paths in `prompt`. |
| A subagent that spawns subagents | Subagents can spawn only when the config sets `experimental.subagent_depth` above 1. If a spawn is rejected for depth, run that step yourself in sequence, or finish and tell your parent which spawns to make. |

## Models

OpenCode names a model `<provider>/<model>#<variant>`. The variant is the reasoning effort, on the ladder `max` > `xhigh` > `high` > `medium` > `low`. Find providers, models, and each model's `variants` with `tools.opencode.models({ query })` inside `execute`, or with `opencode models` in `shell`.

| Cursor | OpenCode |
| --- | --- |
| `claude-<family>-<version>-<effort>[-fast]`, such as `claude-opus-5-5-xhigh` | `model: "<provider>/claude-<family>-<version>#<effort>"`, from a provider that lists that model. Drop `-fast`. OpenCode has no fast flag, so every model runs at standard speed. |
| `grok-<version>-<effort>[-fast]`, `gpt-<version>-<effort>`, or another slug | The same shape, `<provider>/<model>#<effort>`. Drop `-fast`. |
| A model no provider lists, or an effort its `variants` lack | The nearest listed model of the same family, at the highest listed effort at or below the target. If the family has none, omit `model` so the child runs on the parent model, and say so. |
| `auto` or `inherit-parent` | Omit `model`. |
| The `pstack-models.mdc` rule, `~/.cursor/rules/pstack-models.mdc` | `~/.config/opencode/pstack-models.md`. The pstack plugin adds it to every session as the `pstack-models` instruction entry, so its role lines are already in context. If they are not, read the file. If the file or the role's line is missing, map the skill's default slug with the rows above. |
| A role value `<provider>/<model>#<effort>` | Pass it as `model` unchanged. |
| A code playbook line (`feature, refactoring`, `bug-fix`, `perf-issue`, or `hillclimb`) with a comma-separated list | A ladder, cheapest model first. Each code delegate starts on the first entry and moves one entry later for each of these it meets, stopping at the last entry. The change spans more than one module or alters an interface other code calls. The brief cannot name the data shape and the check that proves the change. A delegate on the same task already failed review or verification. A change that meets the `hardest tasks` bar takes that line instead. Then set effort per the Subagents section of poteto-mode, within the chosen entry's family. Name the chosen entry and the conditions it met in your reply. |
| A rejected model | The `subagent` call fails. Apply the calling skill's fallback with the rows above, and never pass the rejected value again. |

## setup-pstack

The pstack plugin reads `~/.config/opencode/pstack-models.md` before each request and keeps it in every session's instructions, so `setup-pstack` writes its rule there. Follow its steps with these changes.

- Detect. Page through `tools.opencode.models({ limit: 100, offset })` inside `execute` until `next` is null. Each model contributes one value per variant, written `<provider>/<model>#<variant>`, such as `anthropic/claude-opus-5-5#xhigh`. A model with no variants is written without `#`. The variant is the effort token, so the budget step works as written.
- Defaults. Map each default slug with the Models rows. `claude-opus-5-5-xhigh` becomes the listed `claude-opus-5-5` at `#xhigh`, and `grok-4.7-xhigh-fast` becomes the listed `grok-4.7` at `#xhigh`. When no provider lists a default's family, write `inherit-parent` for that role and say so.
- Lists. A code playbook line can hold a comma-separated list, cheapest model first, read as the ladder in Models. Offer it when showing those roles, and keep a list the user set on a re-run.
- Write. Write `~/.config/opencode/pstack-models.md` with no frontmatter, then the comment lines, the `# budget` line, and one line per role from step 5. Overwrite the whole file. Never put the role lines in `AGENTS.md` or in OpenCode config.
- Confirm. The plugin picks up the file at the next request in every open session, so new sessions are not required.

## Modes and loops

| Cursor | OpenCode |
| --- | --- |
| Enter on `/poteto-mode`, attaching the skill to one message | The `/poteto-mode` command. The plugin attaches the skill to that message. Every pstack skill has a command of the same name. |
| Custom Mode, Option+Enter or Alt+Enter, Use as Mode | The `poteto-mode` primary agent. Switch to it with Tab, or start with `opencode --agent poteto-mode`. While it is selected, the plugin keeps the `pstack-mode` instruction entry in the session, and it attaches the skill to the first message. The mode lasts until the user switches agents. |
| `/loop until <predicate>`, or `/loop` with a check | `/goal <predicate>`, OpenCode's built-in command that keeps working until an objective is met. `/goal pause`, `/goal resume`, and `/goal clear` control it. Give it a check that can pass or fail, never a duration. |
| `/loop <interval>`, such as `/loop 1h` for an audit tick | Start `shell` with `background: true` and the command `sleep <seconds>`. OpenCode wakes you when it exits. Run the tick, then start the next sleep. Inside `/goal`, the goal keeps the session going between ticks. |
| `/create-skill`, the `create-skill` skill, Cursor's built-in for authoring SKILL.md files | No built-in. Author the skill by hand to OpenCode's skill format. A folder `<id>/SKILL.md` with `name` and `description` frontmatter, an ID of lowercase words joined by hyphens, and supporting files beside it. Load a skill-authoring skill such as `skill-creator` or `writing-for-agents` when the catalog lists one. Run its test or description loop when the step asks for one. |

## cursor-team-kit skills

pstack in OpenCode bundles `deslop`, `control-cli`, and `control-ui` from `cursor-team-kit`. Run them like any pstack skill. A step that says they ship in another plugin is out of date here.

| Cursor | OpenCode |
| --- | --- |
| `/deslop`, the `deslop` skill | The bundled `deslop` skill. |
| `control-cli` | The bundled `control-cli` skill. |
| `control-ui` | The bundled `control-ui` skill. Before building a harness, check for a browser you can already drive. That is the `browser` namespace inside `execute` when OpenCode Desktop attaches one, or a browser MCP such as `chrome-devtools`. Use it when present. |

## Paths

| Cursor | OpenCode |
| --- | --- |
| `.cursor/skills/`, `~/.cursor/skills/` | `.opencode/skills/`, `~/.config/opencode/skills/`. A skill in either one overrides the pstack skill with the same ID, and the project folder wins. |
| `~/.cursor/plugins/`, `.cursor-plugin/plugin.json`, `plugins/cache/` | `<pstack>` and `<pstack>/plugin.json`. Never edit files under `<pstack>`. They are generated. To change a pstack skill, copy its folder to `.opencode/skills/<name>/` or `~/.config/opencode/skills/<name>/` and edit the copy. |
| `.cursor/rules/*.mdc`, always-applied rules | `AGENTS.md` in the project, or `~/.config/opencode/AGENTS.md` for every project. OpenCode never reads `.mdc` files. The model rule is the exception. See Models. |
| `https://github.com/cursor/plugins/blob/main/pstack/<path>` | `<pstack>/<path>` when that file exists. pstack ships the skills, `docs/guide/`, and `README.md`. Read the local copy and never fetch it. Give the user the URL when they need a link. |
| Transcripts in `~/.cursor/projects/<slug>/agent-transcripts/` | OpenCode sessions. `opencode session list --format json` in `shell` lists this project's top-level sessions, newest first, so the first is the current session. `opencode session export <id>` prints one as JSON with `info` and `messages`. `opencode api session.list --param parentID=<id>` lists a session's subagent sessions. Read only sessions from this project. |

## Cursor-only features

OpenCode has no Cursor Automations, Bugbot, Cursor cloud agents, or built-in PR tool. When a step needs one, put one line in your reply, `Skipped in OpenCode: <step>. <reason>.`, then go on to the next step. Do not stop, ask, or retry. When a later step needs what the skipped step made, such as a URL or a key, leave a placeholder and name it in the line.

| Cursor | OpenCode |
| --- | --- |
| Cursor Automations: routines, `update_state` routine calls, `api2.cursor.sh/automations` webhooks, routine wakes, and `SendToUser` secret requests | Skip with the line. The `make-bot-ui` skill is Automations-only, so skip it whole. |
| Bugbot | Bugbot comments on a GitHub PR are ordinary review threads, so triage them with the forge command that the step gives. Skip a step that starts, waits for, or configures Bugbot when the PR has no Bugbot check or comment. |
| Cursor cloud agents, a cloud VM | `environment: "cloud"` maps to a worktree, as in Subagent fields. Skip a step that needs the cloud agent itself, such as its dashboard status or its own machine. |
| A built-in PR tool | Use the forge command that the step gives, such as `gh pr create`. That is not a skip, so write no line. |
