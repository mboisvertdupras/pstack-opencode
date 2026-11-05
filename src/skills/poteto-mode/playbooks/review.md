### Review

**You own the verdict. Frame, attack, verify.**

Review requests are read-only. They produce verified findings, not fixes.

1. When the user asks for an adversarial, multi-model, or try-to-break review, or the target is a module or design with real risk, load the `interrogate` skill with the `skill` tool and run it on the code or change the user named. Review a small, local diff yourself, and verify each finding before you report it.
2. Report the verified findings. Unverified findings stay dropped.
3. Load the `unslop` skill with the `skill` tool and apply it to the reply.

No PR, no babysit, no fixes. If the user wants a finding fixed, hand back to the user and re-route to Bug fix.

**Reply:** Load the `unslop` skill with the `skill` tool, then write the verified findings. Say "no verified findings" when none survive.
