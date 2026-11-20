import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeHarURL } from "../browser/HarCapture.sys.mjs";

test("HAR URLs redact the value after a sensitive path marker, encoded or not", () => {
  for (const marker of ["token", "%74oken", "TOKEN", "%54OKEN", "reset", "r%65set"])
    assert.equal(
      sanitizeHarURL(`https://app.test/api/${marker}/abc123?x=1`),
      `https://app.test/api/${marker}/redacted?x=redacted`,
      marker,
    );
  assert.equal(sanitizeHarURL("https://app.test/docs/guide"), "https://app.test/docs/guide");
});
