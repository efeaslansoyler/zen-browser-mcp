# Use private per-bind ASCII sockets

## Context

The Node MCP process sends requests to a bridge in Gecko. Multiple profiles can run
simultaneously, and Unix permits unlinking a socket while its listener remains open.
A shared path lets another listener take over that name and makes stale cleanup unsafe.
The two runtimes also use different stream APIs.

## Decision

Bind a fresh private socket for each listener, then publish instance metadata for
discovery. Serialize protocol messages as newline-delimited ASCII JSON by escaping
non-ASCII characters on both sides. A normal request receives one reply per connection.
Subscriptions keep the connection open and can return delivery acknowledgements.

## Consequences

Reload and stale cleanup can distinguish old endpoints from new listeners. Clients must
discover a replacement endpoint after reload. ASCII framing works consistently across
both stream APIs at the cost of expanding non-ASCII text on the wire.
