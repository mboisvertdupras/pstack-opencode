# pstack for OpenCode

pstack is a set of engineering skills for OpenCode, a mode that runs them, and agents it delegates to. The `poteto-mode` skill holds the playbooks for bug fixes, features, refactors, perf work, investigations, and PRs. It routes each step to the skill that does it, such as `how` to explain code, `why` to trace a decision, `interrogate` for adversarial review, and `deslop` before a commit. The 63 skills in `src/skills` include the `principle-*` skills that the playbooks cite, and `/thermos`, which runs two harsh branch reviews in parallel. The five agents in `src/agents` are the `poteto-mode` primary agent, the `poteto-agent` delegate, the `comment-sicko` comment reviewer, and the two thermo-nuclear reviewers that `/thermos` spawns.

pstack was ported from poteto's [pstack in cursor/plugins](https://github.com/cursor/plugins/tree/main/pstack), which is MIT licensed, and that license still ships.

## Install

Add the package to `plugins` in `~/.config/opencode/opencode.jsonc`.

```jsonc
{
	"plugins": ["pstack-opencode"]
}
```

The plugin registers the skills, their slash commands, and the five agents. A file in `agents/` named after a pstack agent, such as `poteto-mode.md`, overrides the fields it sets, and pstack's definition fills in the rest.

To run pstack from a checkout of this repo instead, use the installer. It links `src/` and copies nothing.

```sh
npm run install-pstack                         # every project, under ~/.config/opencode
npm run install-pstack -- --project ~/code/app # one project, under its .opencode/
```

The installer links `src/` to `plugins/pstack`. Older installs also linked each agent into `agents/`. The plugin now registers the agents itself, so the installer removes those links and prints `removed`. Rerunning it is safe. It never replaces a file or link it did not create. If an earlier install linked into this repo's `dist/` folder, the installer moves that link to `src/` and prints `moved`. Add `--dry-run` to print what it would do without changing anything.

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

To keep the mode on for a whole session, press Tab to the `poteto-mode` agent, or start with `opencode --agent poteto-mode`. Both work with the package and with the installer.

Every skill except the `principle-*` skills has a slash command of the same name, such as `/how`, `/why`, `/interrogate`, and `/deslop`.

For a long run you leave alone, give OpenCode's `/goal` a check that can pass or fail, such as `/goal npm test passes`.

A user skill with the same ID as a pstack skill keeps that ID in OpenCode. pstack still reads its own copy by path, and its slash command of that name does too. The installer lists any such skills it finds.

## Layout

```text
src/                     The plugin, published as the pstack-opencode package. The installer links this folder.
src/plugin/              Registers the skills, commands, and agents. lib.js is pure, index.js talks to OpenCode.
src/skills/              One folder per skill, each with a SKILL.md
src/agents/              poteto-mode, poteto-agent, comment-sicko, and the two thermo-nuclear reviewers
src/LICENSE*             The pstack, cursor-team-kit, and Thermos MIT notices
scripts/install.mjs      Links src/ into OpenCode, removes old agent links, and uninstalls
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

## Cut a release

Run the release script from an up-to-date `main` with a clean working tree.

```sh
npm run release -- 0.15.39-opencode
```

The script runs the tests and lint, sets the version in `src/package.json`, commits `Release <version>`, tags `v<version>`, and pushes `main` and the tag. The tag starts `.github/workflows/release.yml`. That workflow checks that the tag matches `src/package.json`, runs the tests and lint again, and publishes `src/` to npm with trusted publishing. GitHub's OIDC identity authenticates the publish, so no npm token or browser login is needed. The workflow turns provenance off, because npm/cli#10078 makes a slow Sigstore response fail the whole publish. Remove `NPM_CONFIG_PROVENANCE` from the publish step once that issue is fixed.

Trusted publishing is set once per package by a maintainer with 2FA:

```sh
npm trust github pstack-opencode --file release.yml --repo mboisvertdupras/pstack-opencode --allow-publish
```

## License

MIT. See `LICENSE`. pstack is by Lauren Tan, and `cursor-team-kit`, the source of `deslop`, `control-cli`, and `control-ui`, is by Cursor. So is Thermos, the source of `thermos`, `thermo-nuclear-review`, `thermo-nuclear-code-quality-review`, and their two agents. Their notices ship as `src/LICENSE`, `src/LICENSE-cursor-team-kit`, and `src/LICENSE-thermos`.
