# Subagents

pstack ships two subagents. `poteto-agent` is the delegate that poteto-mode spawns for playbook steps. It reads the `poteto-mode` skill from the path its brief gives, and with no path it loads the skill by ID even though the skill is hidden from its catalog. It loads `deslop` before every commit, and the commit gate in the [gates](./gates.md) file holds its commits until it does. `comment-sicko` reviews comments in a scope and reports, without editing code.

## Sub-features

- `sub-poteto-load` makes `poteto-agent` load `poteto-mode` with the `skill` tool when its brief gives no path.
- `sub-sicko-report` makes `comment-sicko` open with its fixed line and report kills without editing files.
- `sub-depth` lets a delegate spawn its own subagent when `subagent_depth` is 2.

## How to get to it (user POV)

- Run `/poteto-mode` on a task whose playbook delegates work.
- Run `/no-comments`, which spawns `comment-sicko`.
- Ask for either agent by name.

## Driving it with harness.mjs

Preconditions:

- `$H doctor` lists `poteto-agent=subagent` and `comment-sicko=subagent`.

- **poteto-agent.** Run `$H run "Spawn the poteto-agent subagent in the foreground with exactly this brief: 'Load the poteto-mode skill as your instructions say, then reply with only its first ## heading. Do no other work.' Relay its reply verbatim."`. The reply is `## Non-negotiables`. Run `$H children <sid>`. It lists one child with `agent=poteto-agent`. Run `$H export <child sid>`. It shows `tool skill {"id":"poteto-mode"}`.
- **comment-sicko.** Run `eval "$($H env)"`, then append `// add two numbers together` above the export in `$PSTACK_VERIFY_PROJECT/math.js`. Run `$H run "Spawn the comment-sicko subagent in the foreground on math.js and relay its report."`. The child's first reply line is `Yes... Ha ha ha... Yes!`, and the report names the comment. Run `git -C "$PSTACK_VERIFY_PROJECT" diff`. It shows only your added comment, so the agent edited nothing.
- **Depth.** Run `$H run "Spawn the poteto-agent subagent in the foreground with this brief: 'Do not load any skill. Spawn the explore subagent to list the files in this project, then relay its list.' Relay the result."`. `$H children <sid>` lists one `poteto-agent` child, and `$H children <poteto-agent sid>` lists one `explore` child.

## Gotchas

- `general` has no subagent tool, so it lists the files itself and never spawns. Use `poteto-agent` as the outer level in the depth check. If the depth check fails on a permission denial, that is OpenCode's agent rule, not `subagent_depth`. Record which one blocked it.
- Restore `math.js` with `git -C "$PSTACK_VERIFY_PROJECT" checkout math.js` after the comment-sicko check.
