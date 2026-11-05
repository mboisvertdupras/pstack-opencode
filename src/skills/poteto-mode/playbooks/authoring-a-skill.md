### Authoring or modifying a skill

**You own the skill's voice.**

1. Use the `skill-creator` or `writing-for-agents` skill when the catalog lists one. Otherwise author it by hand as `<id>/SKILL.md` with `name` and `description` frontmatter.
2. Validate the skill: frontmatter has `name` and `description`, referenced files exist, cross-skill links resolve.
3. Test cases if structural. Skip if subjective.
4. Run **Opening a PR**.

**Porting from an upstream plugin.** Copy each skill byte for byte, then change only what this host needs: tool names and fields, and agent frontmatter. Drop fallbacks that existed only because the source shipped as a separate plugin. Ship the source's license notice next to the others. Update every place that counts or lists skills and agents, including the README, tests, and health checks. Record the upstream repo and commit in the commit body.

When in doubt, delete. Keep only prose that changes a decision. Tell it to do the thing and skip the reason. Explain only when the rule is confusing without one. Match tone to scope. Point at structural sources (types, READMEs, config) per the `principle-encode-lessons-in-structure` skill. Delegate to other skills by path. Don't restate. A workflow you keep hitting but isn't captured → propose a new skill.

**Reply:** Load the `unslop` skill with the `skill` tool, then write summary of the skill, key design decisions, validation notes.
