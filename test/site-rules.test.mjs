import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { normalizeDomain, normalizeConfig, siteRule } from '../browser/SiteRules.sys.mjs';

test('legacy sensitive config migrates to one site map; explicit rules take priority', () => {
  assert.deepEqual(normalizeConfig({ mode: 'ask', sensitive: ['Example.COM', '*.old.test'], sites: { 'example.com': 'block', 'old.test': 'default' } }), { mode: 'ask', sites: { 'example.com': 'block' } });
  assert.equal(normalizeDomain('https://BÜCHER.de/path'), 'xn--bcher-kva.de');
  for (const input of ['', 'file:///tmp/a', 'https://user:pass@example.com']) assert.throws(() => normalizeDomain(input));
  assert.throws(() => normalizeConfig({ sites: { 'example.com': 'allow' } }));
});

test('rules respect domain boundaries and block cannot be weakened by child ask', () => {
  const sites = { 'example.com': 'block', 'sub.example.com': 'ask', 'mail.test': 'ask' };
  for (const host of ['example.com', 'sub.example.com', 'deep.sub.example.com', 'EXAMPLE.COM.']) assert.equal(siteRule(host, sites), 'block');
  assert.equal(siteRule('notexample.com', sites), 'default');
  assert.equal(siteRule('example.com.attacker.test', sites), 'default');
  assert.equal(siteRule('sub.mail.test', sites), 'ask');
});

test('CLI migrates legacy config, removes explicit rules and preserves block through mode edits', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zen-sites-'));
  const file = path.join(directory, 'zen-mcp/config.json');
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify({ mode: 'auto', sensitive: ['old.test'] }));
  const run = (...args) => execFileSync(process.execPath, ['dist/cli.js', 'config', ...args], { env: { ...process.env, XDG_CONFIG_HOME: directory }, stdio: 'pipe' });
  const read = () => JSON.parse(fs.readFileSync(file));
  try {
    run('site', 'block', 'https://BLOCKED.test/path');
    assert.deepEqual(read(), { mode: 'auto', sites: { 'old.test': 'ask', 'blocked.test': 'block' } });
    run('mode', 'ask');
    assert.equal(read().sites['blocked.test'], 'block');
    run('site', 'default', 'old.test');
    assert.deepEqual(read().sites, { 'blocked.test': 'block' });
    const before = fs.readFileSync(file, 'utf8');
    assert.throws(() => run('site', 'ask', 'valid.test', 'file:///bad'));
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    run('sensitive', 'add', 'legacy.test');
    assert.equal(read().sites['legacy.test'], 'ask');
  } finally { fs.rmSync(directory, { recursive: true }); }
});

test('workspace setting is kept trimmed and dropped when empty', () => {
  assert.equal(normalizeConfig({ workspace: '  Agents ' }).workspace, 'Agents');
  assert.equal('workspace' in normalizeConfig({ workspace: '   ' }), false);
  assert.equal('workspace' in normalizeConfig({ workspace: 42 }), false);
  assert.equal(normalizeConfig({ workspace: 'x'.repeat(200) }).workspace.length, 80);
});
