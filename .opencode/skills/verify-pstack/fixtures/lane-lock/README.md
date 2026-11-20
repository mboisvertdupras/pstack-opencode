# lane-lock

Reproduces a swarm lane that waits on a shared heavy-work lock. It is the seed for `scripts/replay-lane.mjs`.

- `bench.sh` sleeps 3 seconds and prints `ms=42`.
- `heavy-run.sh <owner> <cmd...>` is the program's lock wrapper. It takes `.locks/heavy` beside the script, retries every 20 seconds, and clears a lock whose pid is dead.

With `--lock-held <seconds>`, the replay holds `.locks/heavy` as another owner before the prompt, so a worker that follows the rule to the letter waits for the lock.

With `--brief mkdir`, the brief drops the offer of `./heavy-run.sh` and the seeded project leaves out `heavy-run.sh` and this file, so the worker writes its own wait on `.locks/heavy`.

`--brief budget` is the `mkdir` brief plus a 3-minute limit on the wait, after which the worker reports `BLOCKED`.
