# Installer

`npm run install-pstack` links `src/` into OpenCode as the `pstack` plugin. The plugin registers the three agents itself, so the installer removes the agent links older installs made in `agents/`. It copies nothing and is safe to rerun. It counts any symlink that points into this repo's `src/` or old `dist/` as its own. It refuses to overwrite anything else, and `--uninstall` removes only its own links. A link from an earlier install that points into `dist/` moves to `src/`. `--project <dir>` installs into that project's `.opencode/` instead.

## Sub-features

- `install-link` links `plugins/pstack` and nothing in `agents/`.
- `install-migrate` repoints a plugin link into the old `dist/` at `src/` and prints `moved`.
- `install-retire` removes agent links into `src/` or `dist/` and prints `removed`, and keeps any other file in `agents/`.
- `install-rerun` reports `ok` for a plugin link that already points at this `src/`.
- `install-refuse` fails on an existing `plugins/pstack` that is not its link, and changes nothing.
- `install-uninstall` removes its links and keeps anything else.
- `install-advice` prints the missing `experimental` settings and the `/setup-pstack` step.

## How to get to it (user POV)

- Run `npm run install-pstack` in this repo.
- Run `npm run install-pstack -- --project <dir>`.

## Driving it with harness.mjs

The installer needs no server. Drive it against a scratch config folder so the user's real config is never touched.

Preconditions:

- `C=$(mktemp -d)` holds an empty scratch folder.

- **Link.** Run `XDG_CONFIG_HOME=$C node scripts/install.mjs`. It prints one `linked` line, `ls -l $C/opencode/plugins` shows a symlink to `src/`, and `$C/opencode/agents` does not exist.
- **Advice.** The same output lists `"todo": true` and `"subagent_depth": 2` and the `/setup-pstack` step.
- **Rerun.** Run it again. It prints one `ok` line.
- **Migrate.** Run the uninstall, then `mkdir -p $C/opencode/plugins $C/opencode/agents`, `ln -s $PWD/dist $C/opencode/plugins/pstack` and `ln -s $PWD/dist/agents/poteto-mode.md $C/opencode/agents/poteto-mode.md`. Install with `--dry-run`. It prints `moved` for the plugin and `removed` for the agent link, and changes nothing. Install again without it. It prints the same two lines, the plugin link now points at `src/`, and the agent link is gone.
- **Keep.** Run `echo mine > $C/opencode/agents/poteto-agent.md`, then install again. It prints `ok` and `keep` for that file and exits `0`. `cat` shows `mine` unchanged.
- **Uninstall.** Run `XDG_CONFIG_HOME=$C node scripts/install.mjs --uninstall`. It prints `removed` for the plugin link and `keep` for `poteto-agent.md`. `cat` still shows `mine`.
- **Refuse.** Run `mkdir $C/opencode/plugins/pstack && ln -s $PWD/src/agents/poteto-mode.md $C/opencode/agents/poteto-mode.md`, then install again. It prints a `FAIL` line for `plugins/pstack` and exits `1`, and the agent link is still there. Remove `$C` afterward.

## Gotchas

- Never run the installer without `XDG_CONFIG_HOME` while verifying. It writes to the user's real `~/.config/opencode`.
- The shadow warning lists real skills in `~/.claude/skills` and `~/.agents/skills`, whatever `XDG_CONFIG_HOME` says, plus the config folder's own `skills/`. With `--project`, it also scans that project's `.claude`, `.agents`, and `.opencode` skills.
