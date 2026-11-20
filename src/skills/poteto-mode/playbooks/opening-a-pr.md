### Opening a PR

Invoked at the end of every other playbook.

Work from a git worktree off trunk, created with `tools.opencode.worktree_create({ name })` inside `execute` even when the repo keeps worktrees in another folder, and keep unrelated work out of it. Confirm a pushable remote and working auth (`git remote -v`, `gh auth status`) when the task starts, and tell the user then if either is missing. Rebase into small, landable commits. Load the `deslop` skill with the `skill` tool and run it over the diff before commit, and the `no-comments` skill before review. Before you claim tests pass, run each suite CI gates on the way CI runs it and read its exit status, or read the check owner's result when it already ran at this commit.

Title: `type(scope): subject`, naming a real symbol when one carries the change. Body: a one-minute briefing under 40 lines with these `##` headings in order, dropping empty ones: `## Why`, `## What changed`, `## Scope`, `## Tradeoffs` (only rejected alternatives a reviewer would otherwise ask about), `## Blast Radius`, `## Verification`.

Stack follow-ups by base branch. Open PRs ready, with `gh pr create` without `--draft`, or `origin pr create --status open` when `command -v origin` succeeds and Origin's CLI resolves the repository. Never require Graphite (`gt`). Opening a PR does not start a babysit.
