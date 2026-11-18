import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { normalizeDomain, normalizeConfig, siteAllowed, siteEntry } from "../browser/SiteRules.sys.mjs";

test("sites are a blocklist or an allowlist of normalized domains", () => {
  assert.deepEqual(
    normalizeConfig({ mode: "ask", sites: { blocklist: ["Example.COM", "*.old.test", "example.com"] } }),
    {
      mode: "ask",
      sites: { mode: "blocklist", blocklist: ["example.com", "old.test"], allowlist: [] },
    },
  );
  assert.deepEqual(normalizeConfig({}).sites, { mode: "blocklist", blocklist: [], allowlist: [] });
  assert.equal(normalizeDomain("https://BÜCHER.de/path"), "xn--bcher-kva.de");
  for (const input of ["", "file:///tmp/a", "https://user:pass@example.com"])
    assert.throws(() => normalizeDomain(input));
  // the old per-site rules are not a list
  assert.throws(() => normalizeConfig({ sites: { "example.com": "block" } }), /"sites" setting is/);
  assert.throws(() => normalizeConfig({ sites: { blocklist: "example.com" } }), /must be a list/);
});

test("a listed domain covers its subdomains, not look-alikes; only the mode's list applies", () => {
  const sites = { mode: "blocklist", blocklist: ["example.com"], allowlist: ["work.test"] };
  for (const host of ["example.com", "sub.example.com", "deep.sub.example.com", "EXAMPLE.COM."])
    assert.equal(siteAllowed(host, sites), false, host);
  assert.equal(siteAllowed("notexample.com", sites), true);
  assert.equal(siteAllowed("example.com.attacker.test", sites), true);
  assert.equal(siteEntry("sub.example.com", sites), "example.com");
  // the allowlist is kept but doesn't apply in blocklist mode
  assert.equal(siteAllowed("anything.test", sites), true);

  const only = { ...sites, mode: "allowlist" };
  assert.equal(siteAllowed("work.test", only), true);
  assert.equal(siteAllowed("app.work.test", only), true);
  assert.equal(siteAllowed("example.com", only), false);
  assert.equal(siteAllowed("other.test", only), false);
  // pages without a host (about:blank, local files) aren't sites
  assert.equal(siteAllowed("", only), true);
});

test("CLI edits each list and switches between them without losing either", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zen-sites-"));
  const file = path.join(directory, "zen-mcp/config.json");
  const run = (...args) =>
    execFileSync(process.execPath, ["dist/cli.js", "config", ...args], {
      env: { ...process.env, XDG_CONFIG_HOME: directory, LANG: "en_US.UTF-8" },
      stdio: "pipe",
      encoding: "utf8",
    });
  const read = () => JSON.parse(fs.readFileSync(file));
  try {
    run("site", "block", "https://BLOCKED.test/path", "bank.test");
    assert.deepEqual(read().sites, { mode: "blocklist", blocklist: ["blocked.test", "bank.test"], allowlist: [] });
    run("mode", "ask");
    assert.deepEqual(read().sites.blocklist, ["blocked.test", "bank.test"]);
    run("site", "unblock", "blocked.test");
    assert.deepEqual(read().sites.blocklist, ["bank.test"]);
    assert.match(run("site", "allow", "work.test"), /allowlist doesn't apply now/);
    run("site", "mode", "allowlist");
    assert.deepEqual(read().sites, { mode: "allowlist", blocklist: ["bank.test"], allowlist: ["work.test"] });
    const before = fs.readFileSync(file, "utf8");
    assert.throws(() => run("site", "allow", "valid.test", "file:///bad"));
    assert.throws(() => run("site", "ask", "valid.test"), /Use: config site/);
    assert.equal(fs.readFileSync(file, "utf8"), before);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});
