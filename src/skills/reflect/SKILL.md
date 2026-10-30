---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
disable-model-invocation: true
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

Invoke when the user says "reflect" or "/reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## 1. Locate the active transcript

Before fanning out, find this conversation's session and export it to a file. Run the commands from the project directory. `opencode session list --format json` lists only this project's sessions, newest first. Do not read sessions from other projects. That crosses project boundaries and reads private chats from unrelated work.

```bash
opencode session list --format json | head -40
opencode session export <id> > /tmp/reflect-<id>.json
```

Try the newest candidates in order. Take the session whose first user message contains the conversation's opening user prompt. `opencode api session.list --param parentID=<id>` lists its subagent sessions, which export the same way. If none matches, pass a tight digest of the session instead.

## 2. Spawn three reviewers in parallel

One message, three `subagent` calls, `agent: "general"`. Reviewers need MCP access through `execute` to look up the tickets, chat threads, and observability traces the transcript references, and `explore` has no `execute`.

Each reviewer and the synthesizer name a role line in the `pstack-models` instruction entry and a default. Set `model` to that line's value, or to the default if the entry or the line is missing. A default's `<provider>` is one that lists the model. If none does, omit `model` and say so. Leave `model` unset when the value is `auto` or `inherit-parent`. If the `subagent` tool rejects a value, use the default and say so. If it rejects the default, use the closest listed model of the same family (`opencode models`), or omit `model` so the child runs on the parent model, and say which. Pick each subagent's reasoning level for the job, per the Subagents section of the `poteto-mode` skill.

| Lens | Role line | Default `model` | Prompt template |
|---|---|---|---|
| Judgment | `reflect judgment, divergent, synthesizer` | `<provider>/claude-opus-5-5#xhigh` | `references/judgment-reviewer.md` |
| Tooling | `reflect tooling` | `<provider>/grok-4.7#xhigh` | `references/tooling-reviewer.md` |
| Divergent | `reflect judgment, divergent, synthesizer` | `<provider>/claude-opus-5-5#xhigh` | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting the exported session path or digest where marked. Reviewers return findings in the `subagent` response body.

## 3. Synthesize

One `subagent` call, `agent: "general"`, `model` from the `reflect judgment, divergent, synthesizer` line (default `<provider>/claude-opus-5-5#xhigh`). It spot-verifies citations through MCP inside `execute`, and `explore` has no `execute`. Pass `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. It returns an Accepted / Rejected / Backlog list.

## 4. Structural enforcement check

Move any Accepted item that a lint rule, script, metadata flag, or runtime check would enforce more reliably to Backlog. See the `principle-encode-lessons-in-structure` skill.

## 5. Apply

Present the synthesizer's full Accepted / Rejected / Backlog output and wait for explicit approval before applying any Accepted edit. The user picks the subset and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

File each Backlog item to your team's devex or backlog tracker without waiting. Only the Accepted list waits for approval.

Never edit a skill in this plugin's folder. Before approval, show its destination, `.opencode/skills/<skill>/` or `~/.config/opencode/skills/<skill>/`. After approval, copy the skill folder there and edit the copy. A copy with a pstack ID shadows pstack's, and the `skill` tool's base directory shows which one loaded. Never open a PR or push.

Follow each approved row's Routing exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): the parent does it directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): hand to the `skill-creator` skill when the catalog lists one and run its draft / test / iterate loop. Otherwise the parent edits it by hand.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): hand to `skill-creator` when the catalog lists one and run its description-optimization loop. Otherwise the parent rewrites the description by hand.
- `new skill: <kebab-name>`: hand creation to the `skill-creator` or `writing-for-agents` skill when the catalog lists one. Otherwise author `<kebab-name>/SKILL.md` by hand, with `name` and `description` frontmatter, per the [Authoring a skill playbook](../poteto-mode/playbooks/authoring-a-skill.md). Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done.

## 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
