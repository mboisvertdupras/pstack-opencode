---
name: principle-build-the-lever
description: "Apply to bulk or mechanical work, where many similar edits or files would otherwise be done by hand: codemods, migrations across many files, repetitive generation, analysis over lots of data. Build the tool that does it or proves it (codemod, script, generator, or a skill your subagents follow) instead of working by hand. Keep the tool in scratch unless the operator asks to keep it."
disable-model-invocation: true
---

# Build the Lever

When the work is bulk or mechanical, build the tool that does it (a codemod, script, generator, or rerunnable check) instead of making each edit by hand. Skip the tool for ordinary changes.

- Do the first unit by hand, then build the tool and prove it by rerunning it on that unit. Make it safe to rerun.
- A deterministic tool beats fan-out. When you do fan out, write the recipe, the verification contract, and the fences as one skill the delegates read and cannot edit.
- Build the smallest script that does or proves the job, never a framework. It lives in scratch, not the repo.
