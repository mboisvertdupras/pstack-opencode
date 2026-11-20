### Multi-phase or multi-PR plan

**You own the plan, not the code. The plan is a checklist an owner runs box by box and the operator audits from the evidence.** The plan is the deliverable. Do not implement.

1. When the change is one or two files with an obvious approach, skip the plan. Say so and stop.
2. Settle open questions by prototype before you write. Run the Prototype playbook for each, loaded with the `skill` tool as `prototype`. Ask the operator only about a product or preference call that no run can settle.
3. Write the plan file, outside the repo and its worktrees unless the operator names a path. Open with what changes, the PR ids in landing order, and the dependency graph, which says which PRs are independent and branch from trunk, which wait for which, and the files each may touch. Then one section per PR. One PR is one change with its own evidence (the `principle-sequence-verifiable-units` skill). Each section has checkboxes for what it depends on, the files it edits, the one change it builds, the result you see, and its verification.
4. Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. One lane runs the full checks at the PR head, and the others read its result. Each live box drives the real surface through its control skill (`control-ui` or `control-cli`), in its own git worktree at the PR head created with `tools.opencode.worktree_create({ name })` inside `execute`, with a concrete scenario and a pass predicate. The perf box names the metric, the probe, the trunk baseline measured first, and the number that fails. A PR that changes an interaction waits for the operator's review before merge.
5. Hand back the plan path and stop. Execution starts on the operator's explicit go. Whoever runs it audits the run when a subagent report or a watcher wakes it and the last audit is more than an hour old, and never arms a timer for it.

**Reply:** Load the `unslop` skill with the `skill` tool, then write the plan path, the PR ids with their dependencies and the review-gated set, and what stays unproven.
