# v0.2 review

The original Mindbug behavior suite is preserved. Added pet-domain tests cover typed/runtime target rejection, source modifiers, paid two-hit flows, post-hit reactions, replacement waits, snapshot restoration and invalid checkpoint rejection. A durable-session integration test covers lease takeover while waiting, prior-request deduplication and stale-worker fencing.

Independent standards and specification reviews found that pet flow faults could be committed as success. Both combo and choice entries now reject faults, preserving the original snapshot and allowing later valid commands. Regression tests cover illegal participants followed by legal healing. The shared flow runtime also gained persistent execution namespaces for choice IDs. Both fixes passed focused re-review.

See README and the kernel documentation for trusted-code, snapshot, storage and game-subset limitations.
