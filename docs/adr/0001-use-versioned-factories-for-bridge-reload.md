# Use versioned factories for bridge reload

## Context

Developers need to reload the bridge in a running browser. Gecko caches privileged modules
by URL, and static relative imports do not inherit the entry module's version query.
Restarting the browser would interrupt active sessions.

## Decision

Load bridge modules with versioned URLs. The autoconfig entry point constructs a shared
context and passes it to module factories. Tool groups that capture helpers are constructed
after those helpers are in place. The child actor loads its helpers with the actor's version
query and passes cross-helper dependencies explicitly.

## Consequences

A reload avoids mixing cached and current implementations, and tests can replace a helper
at the shared context boundary. Initialization order and context wiring are part of the
reload contract. State that deliberately survives reload belongs in the autoconfig global.
