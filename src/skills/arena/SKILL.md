---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape."
disable-model-invocation: true
---

# Arena

Open a todo list with `todowrite` with one entry per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify) before launching anything.

## Phase A: Frame

Every candidate gets the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric, 3-6 concrete gradeable criteria for what success looks like on *this* task. It is the picker's tool in Phase D. Candidates only see the task.
3. Pick the runners from the `arena runners` line in the `pstack-models` instruction entry, by default `<provider>/claude-fable-5-2#high`, `<provider>/claude-opus-5-5#high`, and `<provider>/gemini-4-neon#xhigh` from a provider that lists each. Omit `model` for a default seat no provider lists, and say so. An `auto` or `inherit-parent` entry is the parent model, so omit `model`. If the `subagent` tool rejects a value, use the closest listed model of the same family (`opencode models`) or drop the seat, keep at least two runners (one when the line has one entry), and say so. Families go by the model after the `<provider>/`, not the provider. Fable is one family (`claude-fable-*`, or `fable` under any provider). The other Claude models are another (`claude-*`, and `opus`, `sonnet`, or `haiku` under any provider). Gemini (`gemini-*`) is a third. Any other model's family is its text before the first hyphen. Spawn more for multiple design directions, and repeat one model when the work is generation-bound, not judgment-sensitive. Pick each subagent's reasoning level per the Subagents section of the `poteto-mode` skill.
4. Give each candidate its own output location (a git worktree from `tools.opencode.worktree_create({ name })` inside `execute` where possible, otherwise `/tmp/arena-<slug>/candidate-<n>/`), per the `principle-separate-before-serializing-shared-state` skill.

## Phase B: Fan out

Spawn all N subagents in one message with `background: true`, each with the task, the path to the shared grounding, its own output path, and instructions to produce the artifact and a short rationale naming the alternatives it considered and what it rejected.

If a candidate produces no output, proceed with N-1 and note the dropout.

## Phase C: Cross-judge

After all Phase B candidates complete, spawn one judge with `agent: "explore"` from the `arena cross-judge pool` line in the `pstack-models` instruction entry, by default `<provider>/claude-opus-5-5#high`, `<provider>/gemini-4-neon#xhigh`. Its brief says "do not edit files", and you check `git status` after it returns. The judge is never from the parent's vendor. Vendors are the Phase A step 3 families, except that Fable counts as Claude, so use the first entry from another vendor. An `auto` or `inherit-parent` entry is the parent model. If you do not know the parent's model, use the first real value and say that the vendor check did not run. If the `subagent` tool rejects a value, use the closest listed model of the same family, then the next entry from another vendor, or skip the judge and pick the base alone in Phase D, and say so. While you read in Phase D, the judge scores each candidate, by path label, on each rubric criterion and recommends a base.

## Phase D: Pick a base

Read every candidate end to end before picking. Score each against the rubric criterion by criterion, not on holistic feel, and compare with the cross-judge when Phase C ran one. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base a future maintainer can extend most easily without breaking invariants. When two feel tied, prefer the cleaner boundary or smaller API, per the Laziness Protocol.

## Phase E: Graft

Walk each losing candidate once more for what is worth porting into the base, usually one or two things per candidate, not most of it. Fold each graft in by hand, per the `principle-redesign-from-first-principles` skill, so the result stays coherent under one mental model. Don't paste mechanically. If your model is on the `no code` line, brief each code graft to an implementer per the Subagents section of the `poteto-mode` skill.

If the candidates converge on one shape, that is strong agreement. Note it and ship the consensus shape. No graft is needed. If they wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

Verify the synthesized artifact like any other output, per the `principle-prove-it-works` skill. If verification finds a problem the arena missed, either Phase A was wrong (re-frame and re-run) or a candidate caught it and you missed the graft (go back to Phase E). Don't paper over it.

## Outputs

One synthesized artifact, with a short synthesis note alongside naming the base and why, the cross-judge's verdict or that Phase C skipped the judge, each graft with its source candidate, what was rejected and why, any convergence or dropouts, and the verification result.
