# zen-browser-mcp

A bridge between the user's own Zen or Firefox-based browser and their coding agents. It carries
precise context between the two; the agent, never the bridge, edits the user's code.

## Sending to an agent

**Pick**:
One to eight elements of one page that the user selects and sends to an agent session, numbered
in order, each with an optional note of its own plus one note for the whole pick.
_Avoid_: Selection, review, show to agent (that is the menu item that starts a pick)

**Source location**:
The file and line in the user's project that produced a picked element, as far as the page's
dev-mode metadata reveals it.
_Avoid_: Mapping, label
