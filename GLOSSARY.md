# zen-browser-mcp

A bridge between the user's own Zen or Firefox-based browser and their coding agents. It carries
precise context between the two; the agent, never the bridge, edits the user's code.

## Reading and acting on a page

**Clickable**:
An element without a control role that the page signals as reacting to a click, such as a menu
entry built from a plain block. Controls (buttons, links, fields) are never called clickables.
_Avoid_: Interactive element, hotspot

## Sending to an agent

**Pick**:
One to eight elements of one page that the user selects and sends to an agent session, numbered
in order, each with an optional note of its own plus one note for the whole pick.
_Avoid_: Selection, review, show to agent (that is the menu item that starts a pick)

**Source location**:
The file and line in the user's project that produced a picked element, as far as the page's
dev-mode metadata reveals it.
_Avoid_: Mapping, label

## Sharing a tab with agents

**Takeover**:
The user takes control of one agent tab for a while and gives it back. The agents keep their place
in the tab but can neither act nor look there meanwhile.
_Avoid_: Hold (an agent keeps other agents out), take back (the agents lose the tab), hand-over (the
agent asks the user to do a step)
