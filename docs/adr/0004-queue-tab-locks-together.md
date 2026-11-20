# Queue tab locks together

## Context

Calls on the same tab can invalidate one another's page state. Calls on separate tabs can
usually proceed in parallel, but a batch may need multiple tabs. Clipboard, tab selection
and recording also share state beyond a single tab.

## Decision

Queue a request on all of its tab locks synchronously in arrival order. Where needed,
acquire the exclusive lock after tab locks, then the recording lock. A batch that has
already taken tab locks cannot wait behind another request for a newly created tab's
lock. Hold watches and other controls that never touch the page can answer outside the tab
queue.

## Consequences

All overlapping tab queues agree on request order, so a later request cannot block an earlier one.
Disjoint tab calls retain parallelism. New operations must declare their tab and shared
state requirements before entering the queue or use an existing non-waiting path.
