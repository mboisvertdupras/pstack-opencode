### Investigation

**You own the answer. Plan, route, write.**

Investigation requests are read-only. They produce a cited explanation or a recommendation, not a code change.

1. For a question that spans a subsystem, load the `how` skill with the `skill` tool and run it. For a motivation question, load the `why` skill with the `skill` tool and run it. Answer a narrow question that one or two files settle by reading them yourself.
2. Produce the `how`-shaped output (Overview / Key Concepts / How It Works / Where Things Live / Gotchas), or a recommendation with a tradeoffs table if the request is a decision between alternatives.
3. Load the `unslop` skill with the `skill` tool and apply it to the reply.

No PR, no babysit, no `architect` unless the investigation precedes a code change. If it does, hand back to the user and re-route to Bug fix or Feature.

**Reply:** Load the `unslop` skill with the `skill` tool, then write the investigation output. For "are we sure?" answers, include your real judgment with reasons. Push back if the premise is wrong (see Autonomy).
