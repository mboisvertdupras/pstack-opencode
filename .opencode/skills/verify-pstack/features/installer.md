# Installer

`npm run install-pstack` links `src/` into OpenCode as the `pstack` plugin and links the three agents. It copies nothing and is safe to rerun. It counts any symlink that points into this repo's `src/` or old `dist/` as its own. It refuses to overwrite anything else, and `--uninstall` removes only its own links. A link from an earlier install that points into `dist/` moves to `src/`. `--project <dir>` installs into that project's `.opencode/` instead.

## Sub-features

- `install-link` links `plugins/pstack` and the three agent files.
- `install-migrate` repoints links into the old `dist/` at `src/` and prints `moved`.
- `install-rerun` reports `ok` for links that already point at this `src/`.
- `install-refuse` fails on an existing file that is not its link.
- `install-uninstall` removes its links and keeps anything else.
- `install-advice` prints the missing `experimental` settings and the `/setup-pstack` step.

## How to get to it (user POV)

- Run `npm run install-pstack` in this repo.
- Run `npm run install-pstack -- --project <dir>`.

## Driving it with harness.mjs

The installer needs no server. Drive it against a scratch config folder so the user's real config is never touched.

Preconditions:

- `C=$(mktemp -d)` holds an empty scratch folder.

- **Link.** Run `XDG_CONFIG_HOME=$C node scripts/install.mjs`. It prints four `linked` lines, and `ls -l $C/opencode/plugins $C/opencode/agents` shows symlinks into `src/`.
- **Advice.** The same output lists `"todo": true` and `"subagent_depth": 2` and the `/setup-pstack` step.
- **Rerun.** Run it again. It prints four `ok` lines.
- **Migrate.** Run the uninstall, then `mkdir -p $C/opencode/plugins $C/opencode/agents`, `ln -s $PWD/dist $C/opencode/plugins/pstack` and `ln -s $PWD/dist/agents/poteto-mode.md $C/opencode/agents/poteto-mode.md`. Install with `--dry-run`. It prints `moved` for both and changes nothing. Install again without it. It prints two `moved` and two `linked` lines, and both links now point into `src/`.
- **Refuse.** Run `XDG_CONFIG_HOME=$C node scripts/install.mjs --uninstall`, then `mkdir -p $C/opencode/agents && echo mine > $C/opencode/agents/poteto-agent.md`, then install again. It prints a `FAIL` line for that file and exits `1`. `cat` shows `mine` unchanged.
- **Uninstall.** Run the uninstall again. It prints `keep` for `poteto-agent.md` and `removed` for the three links the refused install made. `cat` still shows `mine`. Remove `$C` afterward.

## Gotchas

- Never run the installer without `XDG_CONFIG_HOME` while verifying. It writes to the user's real `~/.config/opencode`.
- The shadow warning lists real skills in `~/.claude/skills` and `~/.agents/skills`, whatever `XDG_CONFIG_HOME` says, plus the config folder's own `skills/`. With `--project`, it also scans that project's `.claude`, `.agents`, and `.opencode` skills.
- A partial install after a refusal leaves the links it made. Uninstall to clear them.
