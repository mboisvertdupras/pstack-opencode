# pstack for OpenCode

pstack is a set of engineering skills for OpenCode, a mode that runs them, and agents it delegates to. The `poteto-mode` skill holds the playbooks for bug fixes, features, refactors, perf work, investigations, and PRs. It routes each step to the skill that does it, such as `how` to explain code, `why` to trace a decision, `interrogate` for adversarial review, and `deslop` before a commit. The 60 skills in `src/skills` include the `principle-*` skills that the playbooks cite. The three agents in `src/agents` are the `poteto-mode` primary agent, the `poteto-agent` delegate, and the `comment-sicko` comment reviewer.

pstack was ported from poteto's [pstack in cursor/plugins](https://github.com/cursor/plugins/tree/main/pstack), which is MIT licensed, and that license still ships.

## Install

Run the installer from this repo. It links `src/` and copies nothing.

```sh
npm run install-pstack                         # every project, under ~/.config/opencode
npm run install-pstack -- --project ~/code/app # one project, under its .opencode/
```

The installer links `src/` to `plugins/pstack` and each file in `src/agents` to `agents/`. Rerunning it is safe. It never replaces a file or link it did not create. If an earlier install linked into this repo's `dist/` folder, the installer moves that link to `src/` and prints `moved`. Add `--dry-run` to print what it would do without changing anything.

To uninstall, run `npm run install-pstack -- --uninstall`. It removes only links into this repo's `src/` or the old `dist/`, and it keeps everything else.

## Configure OpenCode

pstack needs two settings under `experimental` in `opencode.jsonc`. The installer prints the ones you are missing.

```jsonc
{
	"experimental": {
		"todo": true,
		"subagent_depth": 2
	}
}
```

`todo` gives agents `todowrite`, which every playbook uses for its todo list. `subagent_depth` lets a delegate run a skill that spawns its own subagents, such as `/no-comments` calling `/how`.

Then run `/setup-pstack` once. It finds the models you have and writes a model per role to `~/.config/opencode/pstack-models.md`.

## Use pstack

To work in the mode for one message, start with `/poteto-mode <task>`. The other skills run as its steps need them.

To keep the mode on for a whole session, press Tab to the `poteto-mode` agent, or start with `opencode --agent poteto-mode`.

Every skill except the `principle-*` skills has a slash command of the same name, such as `/how`, `/why`, `/interrogate`, and `/deslop`.

For a long run you leave alone, give OpenCode's `/goal` a check that can pass or fail, such as `/goal npm test passes`.

A user skill with the same ID as a pstack skill keeps that ID in OpenCode. pstack still reads its own copy by path, and its slash command of that name does too. The installer lists any such skills it finds.

## Layout

```text
src/                     The plugin. The installer links this folder.
src/plugin/              Registers the skills and commands. lib.js is pure, index.js talks to OpenCode.
src/skills/              One folder per skill, each with a SKILL.md
src/agents/              poteto-mode, poteto-agent, and comment-sicko
src/LICENSE*             The pstack and cursor-team-kit MIT notices
scripts/install.mjs      Links src/ into OpenCode, and uninstalls
scripts/lint-skills.mjs  Checks skills and agents for product names, Cursor-only tool names, broken links, and bad frontmatter
test/                    Plugin, installer, and lint tests. skills.test.mjs lints everything in src/.
.opencode/skills/verify-pstack/  Repo-local skill that drives src/ in a real OpenCode server
```

## Change a skill

1. Edit the skill under `src/skills/<id>/`. Skills name no product. Write "the `subagent` tool", not the product that provides it. The lint fails on names such as `Cursor` or `OpenCode` in skill text.
2. Run the tests. `npm test` includes the lint, and `npm run lint` runs the lint alone.

	```sh
	npm test
	npm run lint
	```

3. Verify the change in a real server with the `verify-pstack` skill in this repo. Its harness starts a private OpenCode server with `src/` installed, drives commands and agents, and saves evidence.

	```sh
	H=.opencode/skills/verify-pstack/scripts/harness.mjs
	$H up && $H doctor
	$H command how "how does math.js work?"
	$H down
	```

## License

MIT. See `LICENSE`. pstack is by Lauren Tan, and `cursor-team-kit`, the source of `deslop`, `control-cli`, and `control-ui`, is by Cursor. Their notices ship as `src/LICENSE` and `src/LICENSE-cursor-team-kit`.
