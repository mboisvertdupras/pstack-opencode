### Perf issue

**You own the measurement story. Plan, review, verify the numbers.** Tie every fix to a measurement, don't read source instead of measuring.

1. Capture a baseline trace via the matching control skill. Vet the baseline, and each later number, with the `benchmark-checklist` skill.
2. Load the `how` skill with the `skill` tool and run it to ground hypotheses. Don't claim a perf ceiling without running it first.
   Try the performance mantras in order, cheapest first:
   1. Don't do it. Stop work whose result nothing uses rather than cheapening it.
   2. Do it, but don't do it again.
   3. Do it less.
   4. Do it later.
   5. Do it when they're not looking.
   6. Do it concurrently.
   7. Do it cheaper.

   When an earlier mantra meets the target, stop.
3. Plan the fix from the trace. When the fix has several credible shapes and the pick is costly to reverse, load the `architect` skill with the `skill` tool and run it first. Delegate implementation to a subagent using your configured perf-issue model (default `grok-4.7#xhigh`). The brief tells the delegate to load the `deslop` skill before every commit and the `no-comments` skill before it reports. Pick each subagent's reasoning level for the job, per the Subagents section. Review the diff. Capture a post-fix trace.
   Apply the `principle-sequence-verifiable-units` skill, verifying each attempt before trying the next.
4. Parse and compare the artifacts (JSON to sqlite, diff). "Inconclusive" or wrong-surface is not a pass. Flag it.
5. Cite the measurement in the PR.
6. Run **Opening a PR**.

For sustained improvement against a metric rather than a one-off fix, use the Hillclimb playbook (`playbooks/hillclimb.md`).

**Reply:** Load the `unslop` skill with the `skill` tool, then write baseline number, post-fix number, delta, artifact path.
