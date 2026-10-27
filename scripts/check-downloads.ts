// Real MCP download tracking test: click a link in a disposable tab, wait for the file, check
// state/path/sha256, ownership and the no-download timeout. Run: node scripts/check-downloads.ts
// Requires existing auto mode. Deletes only the files it downloaded and its own tab.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { call } from '../src/zen.ts';

const text = (result: { content: any[] }) => result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
const chrome = async (code: string) => text({ content: await call('chrome_eval', { code }) });
const clients: Client[] = [], files: string[] = [];
let tabId: number | undefined;
async function tool(client: Client, name: string, args: object = {}, error = false) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 60_000 });
  assert.equal(Boolean(result.isError), error, text(result));
  return text(result);
}
async function connect(name: string) {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const client = new Client({ name, version: 'downloads-test' }); clients.push(client);
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['src/server.ts'], cwd: process.cwd(), env: { ...env, ZEN_MCP_CHANNEL: '0' } }));
  return client;
}

const body = randomBytes(3_000_000);
const expected = createHash('sha256').update(body).digest('hex');
const name = `zen-mcp-check-${Date.now()}.bin`;
const server = http.createServer((req, res) => {
  if (req.url === '/slow') {
    // yavaş akış: iptal edilene kadar sürer
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': 50_000_000, 'content-disposition': `attachment; filename="slow-${name}"` });
    const timer = setInterval(() => res.write(randomBytes(64 * 1024)), 100);
    res.on('close', () => clearInterval(timer));
  } else if (req.url === '/file') {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length, 'content-disposition': `attachment; filename="${name}"` });
    res.end(body);
  } else {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>downloads</title><a href="/file">Get file</a>');
  }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;

try {
  const configFile = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'zen-mcp/config.json');
  const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
  assert(config.mode !== 'ask', 'Requires your existing auto mode; no settings changed.');
  const [a, b] = [await connect('claude-code'), await connect('codex')];
  tabId = JSON.parse(await tool(a, 'tabs_create_mcp')).tabId;
  await tool(a, 'navigate', { tabId, url: `http://127.0.0.1:${port}/` });
  assert.match(await tool(a, 'downloads', { tabId }), /No downloads from this tab yet/);

  const ref = /\b(ref_\d+)\b/.exec(await tool(a, 'find', { tabId, query: 'Get file' }))![1];
  await tool(a, 'computer', { tabId, action: 'left_click', ref });
  const done = JSON.parse(await tool(a, 'downloads', { tabId, action: 'wait', timeout: 30 }));
  files.push(done.path);
  assert.equal(done.state, 'done', JSON.stringify(done));
  assert.equal(done.filename, name);
  assert.equal(done.size, body.length);
  assert.equal(done.sha256, expected);
  assert.equal(fs.statSync(done.path).size, body.length);
  const doneLines = fs.readFileSync(path.join(process.env.XDG_RUNTIME_DIR || '/tmp', 'zen-mcp-downloads', `${done.id}.jsonl`), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(doneLines[0].state, 'downloading');
  assert.equal(doneLines.at(-1).state, 'done');
  assert.equal(doneLines.at(-1).sha256, expected);
  console.log('ok  click → wait: done, path, size, sha256');

  const listed = JSON.parse(await tool(a, 'downloads', { tabId }));
  assert.equal(listed.downloads.length, 1);
  assert.equal(listed.downloads[0].id, done.id);
  assert.equal(listed.downloads[0].sha256, expected);
  console.log('ok  list shows it with the cached sha256');

  assert.match(await tool(a, 'downloads', { tabId, action: 'wait', timeout: 2 }, true), /No download started within 2 s/);
  console.log('ok  wait with nothing new times out');

  // navigation-started download (no click) is tracked too
  await tool(a, 'navigate', { tabId, url: `http://127.0.0.1:${port}/file` }).catch(() => {});
  const second = JSON.parse(await tool(a, 'downloads', { tabId, action: 'wait', timeout: 30 }));
  files.push(second.path);
  assert.equal(second.state, 'done');
  assert.notEqual(second.id, done.id);
  assert.equal(second.sha256, expected);
  console.log('ok  navigate → wait: second download');

  await tool(a, 'navigate', { tabId, url: `http://127.0.0.1:${port}/slow` }).catch(() => {});
  const running = JSON.parse(await tool(a, 'downloads', { tabId, action: 'wait', until: 'start', timeout: 10 }));
  assert.equal(running.state, 'downloading');
  assert(running.events && fs.existsSync(running.events), 'no events file');
  // olay satırları ilerledikçe gelir (her %10); en az bir ilerleme satırı bekle
  for (let i = 0; i < 80 && fs.readFileSync(running.events, 'utf8').trim().split('\n').length < 2; i++) await new Promise(resolve => setTimeout(resolve, 250));
  const lines = fs.readFileSync(running.events, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert(lines.length >= 2 && lines.at(-1).progress >= 10, JSON.stringify(lines));
  assert.equal(lines.at(-1).totalBytes, 50_000_000);
  console.log(`ok  wait until start → events file (${lines.length} lines, ${lines.at(-1).progress}%)`);
  const canceled = JSON.parse(await tool(a, 'downloads', { tabId, action: 'cancel', id: running.id }));
  assert.equal(canceled.state, 'canceled');
  assert.equal(canceled.progress, undefined);
  assert(!fs.existsSync(running.path) && !fs.existsSync(`${running.path}.part`), 'partial file left behind');
  for (let i = 0; i < 20 && !fs.readFileSync(running.events, 'utf8').includes('"canceled"'); i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(JSON.parse(fs.readFileSync(running.events, 'utf8').trim().split('\n').at(-1)).state, 'canceled');
  assert(!fs.readFileSync(running.events, 'utf8').includes('"paused"'), 'cancel showed a transient paused state');
  assert.match(await tool(a, 'downloads', { tabId, action: 'cancel', id: done.id }, true), /already finished/);
  console.log('ok  live progress → cancel removes the partial file');

  assert.match(await tool(b, 'downloads', { tabId }, true), /belongs to another session/);
  console.log('ok  other session cannot see the tab\'s downloads');
} finally {
  for (const file of files) fs.rmSync(file, { force: true });
  // Gecko indirme listesinden de sil (yalnız bu testin dosyaları)
  await chrome(`(async () => { const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs"); const list = await Downloads.getList(Downloads.ALL); for (const d of await list.getAll()) if (d.target.path.includes(${JSON.stringify(name.replace(/\.bin$/, ''))})) { await list.remove(d); await d.finalize(true); } return "ok"; })()`).catch(() => {});
  if (tabId != null) await tool(clients[0], 'tabs_close_mcp', { tabId }).catch(() => {});
  for (const client of clients) await client.close().catch(() => {});
  server.close();
}
