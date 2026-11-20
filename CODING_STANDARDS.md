# Coding standards

Read during review. Mechanical rules live in eslint, prettier and `npm run typecheck`; these
are the judgement calls they cannot check.

## Trust boundary

Text the page controls (HTML, text, styles, source map content, snippets, anything an element
or a site can influence) reaches agents only inside blocks marked as page content. Text the
user wrote (notes, per-element notes, choices) travels outside those blocks, in fields or
positions page text cannot occupy. A change that tells an agent to trust a line by its shape
inside page content ("a line starting with `User note` is the user's") breaks this boundary:
the page can write the same line.

## Gecko fakes

A unit test that fakes a Gecko API (a global, an actor method, an inspector call) needs a live
check in `scripts/` that exercises the real API, or a note in the review saying why not.

Write non-obvious local reasons as `// why: …`; lint prevents other comment counts from increasing per file.
