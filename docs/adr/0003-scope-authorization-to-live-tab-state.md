# Scope authorization to live tab state

## Context

A user's tab can be shared, change pages, or return to the user while a call is queued or
an approval prompt is visible. A tab mark and a host name can remain unchanged across
these transitions. The system clipboard is also shared by the entire desktop.

## Decision

Authorize agent calls through live transport-backed tab membership. Persist the visual
mark in SessionStore without tying it to a cookie container or using it to restore access.
Bind approval to the current document, origin, policy and tab membership. Batch approval
covers the listed actions on that state and is checked at each step. System clipboard
operations require separate consent and check that the captured target is still current.

## Consequences

Reload and navigation can invalidate grants even when the host is unchanged. The bridge
can mark a user tab without changing its logins. Clipboard access may prompt in auto mode
or within an approved batch.
