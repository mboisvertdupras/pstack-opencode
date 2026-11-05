### Review

**You own the verdict. Frame, attack, verify.**

Review requests are read-only. They produce verified findings, not fixes.

1. Load the `interrogate` skill with the `skill` tool and run it on the code or change the user named.
2. Throughput checkpoint stays one line: `throughput checkpoint: n/a, read-only review`.
3. Report `interrogate`'s Output. Unverified findings stay dropped, as `interrogate` says.
4. Load the `unslop` skill with the `skill` tool and apply it to the reply.

No PR, no babysit, no fixes. If the user wants a finding fixed, hand back to the user and re-route to Bug fix.

**Reply:** Load the `unslop` skill with the `skill` tool, then write the `interrogate` output. Say "no verified findings" when none survive.
