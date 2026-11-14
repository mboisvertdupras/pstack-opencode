---
requires: principle-model-the-domain
---

### Feature

**You own the design. Plan, review, verify.** Delegate implementation. Stay in the lead.

1. Size the change per **Size the task first** in `SKILL.md`. When you can't map the affected code from a quick read, load the `how` skill with the `skill` tool and run it over the subsystem.
2. When the design has several credible shapes and the pick is costly to reverse, load the `architect` skill with the `skill` tool and run it for parallel design exploration. A change with one obvious shape skips it.
3. When the work splits across more than one worker, write the throughput checkpoint as four todo items. A single-owner change skips it:
   - **Blocking first steps.** Gates run before fan-out.
   - **Independent workstreams.** Disjoint files, services, or layers parallelize. Shared writes serialize.
   - **Shared mutable state.** Default to splitting the target (the `principle-separate-before-serializing-shared-state` skill). Serialize only for real invariants.
   - **Smallest safe decomposition.** If one worker is best, name why.
4. Make a small change (per **Size the task first**) yourself, unless your model is on the `no code` line (**Subagents** in `SKILL.md`). Delegate larger code-writing to a subagent using your configured feature model (default `grok-4.7#xhigh`) with a specific scope (file paths, named data shape and its organizing structure per **principle-model-the-domain**, a state machine over scattered booleans, a table/registry over branching, a typed model over repeated shape assumptions, chosen before the delegate writes logic, and success criteria). Pick each subagent's reasoning level for the job, per the Subagents section. When the implementation admits several valid shapes that differ in ways a reviewer would care about (error handling, abstraction layer, test structure) and the change is large enough that a wrong pick is costly, load the `arena` skill with the `skill` tool and run it instead so the runners surface the alternatives and the cross-judge guards the pick. No "standing by" reply that waits on a nested agent. Comments per **Comments**. Surgical edits, re-ground against the source for upstream-derived files. Port shared-primitive improvements to all consumers and verify each. Commit liberally. The brief tells the delegate to load the `deslop` skill before every commit and the `no-comments` skill before it reports.
5. Verify on the matching surface. "Inconclusive" or wrong-surface is not a pass. Flag it. For CI or deploy config, the matching surface includes the runtime versions the config pins, so run the checks under them (for example `npx -p node@<version>`). Report each path that only the runner exercises, such as OIDC auth or a publish, as unverified.
6. Rebase into small, ordered commits. Stack follow-ups.
   Use the `principle-sequence-verifiable-units` skill, building, verifying, and committing each small unit before the next.
7. If the design is contested, load the `interrogate` skill with the `skill` tool and run it before shipping.
8. Run **Opening a PR**.

Code-coupled work (one feature, one migration) goes to a single owner with the checkpoint inline. That owner fans out internally after the blocking phase. Parent-level fan-out is for slices that produce independent artifacts (audits, cross-subsystem investigations, competing experiments). Rewrite the checkpoint at phase boundaries. Spawn a fresh owner rather than chaining interrupts.

**Reply:** Load the `unslop` skill with the `skill` tool, then write what you built, what you chose and why, the throughput checkpoint when you wrote one, open decisions. Tables for design alternatives when there were any.
