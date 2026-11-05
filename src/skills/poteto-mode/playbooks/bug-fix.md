### Bug fix

**You own this task. Plan, review, verify.** Delegate investigation and the fix to subagents, stay in the lead. Pick each subagent's reasoning level for the job, per the Subagents section.

Be scientific. Every shipped line traces to runtime evidence. Belt-and-suspenders that "might help" is a hypothesis, not a fix. It does not ship. When evidence refutes a hypothesis, revert what it motivated. The smallest change the evidence justifies ships, nothing more.

1. Reproduce it yourself on the matching surface via the control skill (Non-negotiables), even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
2. Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. When the repro doesn't already point at the cause, seed them by loading the `how` skill with the `skill` tool and running it over the affected subsystem. When the bug looks like a regression, load the `why` skill the same way and run it for the history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. Drive a long or stubborn hunt with the wake mechanism from the Autonomous run playbook (`playbooks/autonomous-run.md`). Confirm the surviving *mechanism* with runtime evidence before you plan the fix.
3. Plan the fix. When the fix has several credible shapes and the pick is costly to reverse, load the `architect` skill with the `skill` tool and run it first. Make a small fix (per **Size the task first** in `SKILL.md`) yourself. Delegate a larger one to a subagent using your configured bug-fix model (default `grok-4.7#xhigh`) with a specific scope. The brief tells the delegate to load the `deslop` skill before every commit and the `no-comments` skill before it reports.
4. Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
5. Stage the commits so the failing repro lands before the fix in git history. When the bug has a cheap local test path, load the `tdd` skill with the `skill` tool and run it for the failing-test-first cadence. Skip it when the test would be expensive, integration-heavy, or unclear.
   This is the canonical **sequence-verifiable-units** principle skill, the failing test first and the fix on top.
6. Run **Opening a PR**.

**Reply:** Load the `unslop` skill with the `skill` tool, then write what was broken, root cause, fix, how you verified. Paste failing-then-passing repro output verbatim.
