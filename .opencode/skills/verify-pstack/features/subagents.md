# Subagents

pstack ships two subagents. `poteto-agent` is the delegate that poteto-mode spawns for playbook steps. It reads the `poteto-mode` skill from the path its brief gives, and with no path it loads the skill by ID even though the skill is hidden from its catalog. It loads `deslop` before every commit, and the commit gate in the [gates](./gates.md) file holds its commits until it does. `comment-sicko` reviews comments in a scope and reports, without editing code. Inside a child session running a pstack agent, the plugin sets `background: false` on every `subagent` call, so the child's turn and its report wait for its own children. The plugin also rejects a `shell` call with `background: true` in such a child, because the job's completion notice would reach the child only after the parent took its first turn end as the report. Root sessions and children running `general` or `explore` keep the `background` they asked for.

## Sub-features

- `sub-poteto-load` makes `poteto-agent` load `poteto-mode` with the `skill` tool when its brief gives no path.
- `sub-sicko-report` makes `comment-sicko` open with its fixed line and report kills without editing files.
- `sub-depth` lets a delegate spawn its own subagent when `subagent_depth` is 2.
- `sub-foreground` runs a pstack delegate's `subagent` calls in the foreground, so the parent's notification arrives after the delegate's children finish and carries the delegate's final reply.
- `sub-no-background-shell` rejects a pstack delegate's background `shell` call, so a check runs in the foreground and a server starts detached.

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
- **Foreground.** Run `$H run --agent poteto-mode "Spawn the poteto-agent subagent with background: true and this brief: 'Do not load any skill. Spawn the general subagent with background: true and the brief \"Run sleep 30 in the shell, then reply SLEPT.\" When it reports, reply with DONE and its reply.' When its report arrives, relay it verbatim."`. Run `$H tree <sid>` so every session settles. The export still shows `background: true` on the child's `subagent` call, because OpenCode records the input the model sent, not the input the plugin rewrote. The proof is in the child instead. Its `subagent` call completes with the `general` child's reply in its output, and the child gets no `<subagent ... state="completed">` message of its own. The parent's one notification from the child arrives after the `general` child's `sleep` part completes, and it carries `DONE SLEPT`.
- **No background shell.** Run `$H run --agent poteto-mode "Spawn the poteto-agent subagent with background: true and exactly this brief: 'Do not load any skill. In the shell, run the command: sleep 25; echo CHECK-RESULT-42 . Pass background: true on that shell call. Then reply with the line that command printed.' When its report arrives, relay it verbatim and nothing else."`. `$H export <child sid>` shows the background `shell` call rejected, a foreground rerun, and `CHECK-RESULT-42` in the child's first reply, with no `synthetic` message before it. For the server path, use the brief `'Do not load any skill. Start the server python3 -m http.server 8765 from the shell, passing background: true on that shell call. Then fetch http://127.0.0.1:8765/ once with curl and note the HTTP status code, stop the server, and reply with the status code.'`. The child restarts the server with `nohup … &` in a foreground call and replies `200`.

## Gotchas

- `general` has no subagent tool, so it lists the files itself and never spawns. Use `poteto-agent` as the outer level in the depth check. If the depth check fails on a permission denial, that is OpenCode's agent rule, not `subagent_depth`. Record which one blocked it.
- Restore `math.js` with `git -C "$PSTACK_VERIFY_PROJECT" checkout math.js` after the comment-sicko check.
