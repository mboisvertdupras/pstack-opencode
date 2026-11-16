---
name: setup-pstack
description: Configure which models pstack uses per role and at what reasoning budget. Detects your available models and writes the per-role model file that overrides the skill defaults. Use for /setup-pstack, "configure pstack models", "pstack budget", or changing pstack's model choices.
---

# Setup pstack

Write `~/.config/opencode/pstack-models.md`, the file that sets pstack's model per role. The plugin keeps it in every session as the `pstack-models` instruction entry.

## Steps

### 1. Detect available models

Inside `execute`, page through `tools.opencode.models({ limit: 100, offset })`, starting at `offset: 0` and passing the returned `next` until it is `null`. Each model's `id` is `<provider>/<model>`, and each entry in its `variants` contributes one value, `<provider>/<model>#<variant>`. A model with no variants contributes its bare `id`. The set of those values is the detected set, and each is a value you can pass as a `subagent` call's `model`. If the call fails or lists nothing, ask the user to paste the values they have access to. Never write a real value you have not confirmed is available.

Map each default family to a detected model by its `id` or `name`. `claude-fable-5-2` is Fable 5.2, `claude-opus-5-5` is Opus 5.5, and `gemini-4-carbon` is Gemini 4 Carbon. When more than one provider lists a family, prefer the provider of the current session's model. When no provider lists a family, write `inherit-parent` for every role that defaults to it, and tell the user which roles fell back and why. The aliases `inherit-parent` and `auto` are always valid even though they are not detected values.

### 2. Load current state

The default role-to-model mapping is the file shape shown in step 5 below, with `<provider>/` filled in from step 1. If `~/.config/opencode/pstack-models.md` already exists, read it and treat its `# budget` line and its role values as the current choices. Otherwise start from those defaults. A line whose role is not in step 5, such as `how explorer` or `why investigators`, is from a retired role. Drop it.

A file without the `# defaults: 2` line comes from an older setup. That setup wrote a line for every role, so some of its values are old defaults, not choices. An old value is one whose model, the part after `<provider>/`, matches `grok-*`. Before step 3, replace these values:

- A line in `feature, refactoring`, `bug-fix`, `perf-issue`, `hillclimb`, `reflect tooling`, or `swarm workers` whose whole value is one old value takes the role's step 5 default.
- A `hardest tasks` value whose model matches `claude-opus-*` or is `opus` takes the role's step 5 default.
- In a panel role (`arena runners`, `arena cross-judge pool`, `architect runners`, `interrogate reviewers`), a list of exactly one such Opus entry and one old value, in either order, takes the role's step 5 list. In any other panel list, each old value becomes `<provider>/claude-opus-5-5#high`.

Every other value is the user's choice and stays, including an old value in a ladder or in any other role, the `no code` line, and every `inherit-parent` or `auto` value. Tell the user which values you replaced.

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Prefer the `question` tool over free text. Offer these four options with these exact labels, and name the current budget when the file records one. With no file, say that `large` matches the skill defaults.

- `unlimited — max reasoning`
- `large — xhigh reasoning`
- `medium — high reasoning`
- `small — medium reasoning`

**(b) Apply it.** Build the working table from the skill defaults, and on a re-run keep any role you changed by family, list, ladder, or alias (`inherit-parent`, `auto`). Families are the ones Phase A of the `arena` skill defines, so Fable is its own family. Each role has a target effort, which is its default's effort moved by the budget. `large` keeps it, `unlimited` raises it one step, `medium` lowers it one step, and `small` lowers it two steps, on the ladder `max` > `xhigh` > `high` > `medium` > `low`. A target at either end of the ladder stays there. Most defaults are at `xhigh`, and each budget label names where those land. Set the variant of every real value in the role, panel and ladder entries included, to the role's target. The variant is the part after `#`. If the result is not a detected value, use the same model's detected variant with the highest effort at or below the target, else mark the role as needing a choice. `inherit-parent`, `auto`, and the `no code` line do not change. So `unlimited` turns `<provider>/claude-opus-5-5#xhigh` into `<provider>/claude-opus-5-5#max` and `<provider>/claude-opus-5-5#high` into `<provider>/claude-opus-5-5#xhigh`, and it keeps `<provider>/claude-fable-5-2#max`. When Gemini tops out at `high`, the fallback under `unlimited` keeps `<provider>/gemini-4-carbon#high` as it is. `small` turns the first two into `<provider>/claude-opus-5-5#medium` and `<provider>/claude-opus-5-5#low`.

**(c) Show the roles and confirm.** Show every role with its model, marking any real value not in the detected set as needing a choice. Also list each line step 2 dropped. Ask whether to accept as-is or change specific roles, offering the detected models plus `inherit-parent` and `auto` (both mean the role runs on the parent chat model) as the options. Prefer the `question` tool over free text. For panel roles (arena runners, architect runners, interrogate reviewers) the value is a list, and one subagent runs per entry, alias entries included, so the list length sets the count. `arena cross-judge pool` is also a list, but each use takes one model from it: the arena judge, the eval judge, the show-me-your-work reviewer, and each orchestrate verifier. Each tries only values from a vendor other than the one whose work it reviews, in list order, so order it by preference. Fable and the other Claude models are one vendor. An `inherit-parent` or `auto` value never judges. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm. A code playbook line (`feature, refactoring`, `bug-fix`, `perf-issue`, `hillclimb`) may hold a comma-separated ladder, cheapest first. Each code delegate starts on the first entry and moves later only as the task gets harder, so offer a ladder when the user wants cheap models on routine edits. Then offer the optional `no code` line, which names the detected models that plan and verify but never edit source files, per the Subagents section of the `poteto-mode` skill. Its values are bare model IDs, `<provider>/<model>` with no `#variant`. It is empty by default, and a re-run keeps it like any role the user changed.

### 4. Validate

Every real role value written must be in the detected set, and every `no code` value must be the `id` of a detected model. `inherit-parent` and `auto` always pass. If a chosen real value is not available, stop and ask again.

### 5. Write the file

Write `~/.config/opencode/pstack-models.md` with no frontmatter. It holds the comment lines, the `# defaults: 2` line, a `# budget` line with the chosen label and the effort that label names, and one line per role, using the same labels poteto-mode uses. Overwrite the whole file so re-runs stay idempotent. Leave out the `no code` line when it is empty. Shape:

```
# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` as a value: the role runs on the parent chat model (omit the subagent `model`). Alias entries in a panel list still count toward its fan-out.
# defaults: 2
# budget: large (xhigh)
feature, refactoring: <provider>/claude-opus-5-5#xhigh
bug-fix: <provider>/claude-opus-5-5#xhigh
perf-issue: <provider>/claude-opus-5-5#xhigh
hillclimb: <provider>/claude-opus-5-5#xhigh
judgment and prose: <provider>/claude-opus-5-5#xhigh
hardest tasks: <provider>/claude-fable-5-2#max
reflect tooling: <provider>/claude-opus-5-5#high
reflect judgment, divergent, synthesizer: <provider>/claude-opus-5-5#xhigh
arena runners: <provider>/claude-fable-5-2#high, <provider>/claude-opus-5-5#high, <provider>/gemini-4-carbon#high
arena cross-judge pool: <provider>/claude-fable-5-2#high, <provider>/claude-opus-5-5#high, <provider>/gemini-4-carbon#high
swarm workers: <provider>/claude-opus-5-5#high
architect runners: <provider>/claude-fable-5-2#high, <provider>/claude-opus-5-5#high, <provider>/gemini-4-carbon#high
interrogate reviewers: <provider>/claude-fable-5-2#high, <provider>/claude-opus-5-5#high, <provider>/gemini-4-carbon#high
no code: <provider>/<model>
```

### 6. Confirm

Tell the user the file was written. The plugin reads it at the next request, so running sessions pick it up without a restart. Re-running this skill updates it.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill." On yes, load the `create-verification-skill` skill with the `skill` tool and follow it. On no, move on without pushing.

### 8. Offer a formal verification skill (optional)

Check whether the project already has a formal verification skill (a project skill that runs a model checker, a proof, or another verifier against the code). If not, offer once: "want a formal verification skill, so agents can prove a key property of your code holds in every case in scope, not only the cases tests reach? I can generate one with /create-formal-verification-skill." On yes, load the `create-formal-verification-skill` skill with the `skill` tool and follow it. On no, move on without pushing.
