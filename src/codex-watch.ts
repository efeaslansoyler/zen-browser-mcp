// Follows Codex conversations through Codex's background service (the app-server daemon): a
// conversation connects as soon as it opens (without waiting for the first message), its name
// goes into the menus, and it disconnects when its window closes. `/quit` doesn't close a
// conversation but moves it to the background; background tasks aren't shown in menus.
// The service protocol is experimental: if it can't connect, the per-conversation relay from
// the hooks (codex-relay) takes over.
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RUNTIME_DIR, NAME } from './paths.ts';
import { subscribe } from './zen.ts';
import { THREAD_ID, deliverCodexPick } from './delivery.ts';
import { stopCodexRelays } from './codex-relay.ts';

const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
export const DAEMON_SOCKET = path.join(CODEX_HOME, 'app-server-control', 'app-server-control.sock');
const WATCH_SOCKET = path.join(RUNTIME_DIR, `${NAME}-codex`, 'watch.sock');
const POLL_MS = 2000;
const IDLE_EXIT_MS = 10 * 60_000; // exit after this long without a Codex window; a hook or the MCP server restarts it

export type Thread = { id: string; name?: string; cwd: string; createdAt: number; ephemeral: boolean; loadedAt: number };
export type Tui = { pid: number; startedAt: number; threadId?: string };

// Open Codex windows (TUI) and the conversations they show. The service doesn't say which
// conversation belongs to a window: `codex resume <id>` is exact; other windows are matched to
// the newest conversation opened or loaded after them (/new inside a window picks the newest too).
export function visibleThreads(threads: Thread[], tuis: Tui[]): Set<string> {
  const visible = new Set<string>();
  const candidates = threads.filter(t => !t.ephemeral);
  for (const tui of tuis) if (tui.threadId && candidates.some(t => t.id === tui.threadId)) visible.add(tui.threadId);
  for (const tui of [...tuis].filter(t => !t.threadId).sort((a, b) => b.startedAt - a.startedAt)) {
    const best = candidates
      .filter(t => !visible.has(t.id) && Math.max(t.createdAt, t.loadedAt) >= tui.startedAt - 2000)
      .sort((a, b) => Math.max(b.createdAt, b.loadedAt) - Math.max(a.createdAt, a.loadedAt))[0];
    if (best) visible.add(best.id);
  }
  return visible;
}

// argv: ["codex", ...]; the service and subcommands like `exec` or `agents` aren't windows. Only
// known non-interactive subcommands are excluded, so option values (`-m x`) aren't taken for one.
const NOT_WINDOWS = new Set(['app-server', 'exec', 'e', 'agents', 'queue', 'mcp', 'mcp-server', 'login', 'logout',
  'apply', 'a', 'completion', 'debug', 'sandbox', 'cloud', 'features', 'help', 'update', 'review']);
export function parseTui(argv: string[]): { threadId?: string } | null {
  if (path.basename(argv[0] ?? '') !== 'codex') return null;
  if (argv.slice(1).some(a => NOT_WINDOWS.has(a))) return null;
  if (argv.includes('resume')) {
    const id = argv.slice(argv.indexOf('resume') + 1).find(a => THREAD_ID.test(a));
    return { threadId: id };
  }
  return {};
}

function listTuis(): Tui[] {
  const ticks = 100; // CLK_TCK (in practice always 100 on Linux)
  const bootTime = Number(/^btime (\d+)/m.exec(fs.readFileSync('/proc/stat', 'utf8'))?.[1]) * 1000;
  const tuis: Tui[] = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const argv = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0').filter(Boolean);
      const tui = parseTui(argv);
      if (!tui) continue;
      const stat = fs.readFileSync(`/proc/${entry}/stat`, 'utf8');
      const startTicks = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]);
      tuis.push({ pid: Number(entry), startedAt: bootTime + (startTicks / ticks) * 1000, ...tui });
    } catch {}
  }
  return tuis;
}

// JSON-RPC with the service over a WebSocket on a Unix socket: read requests only
class DaemonClient {
  private socket?: net.Socket;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  onClose = () => {};
  onNotification = (_method: string, _params: any) => {};

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = this.socket = net.createConnection(DAEMON_SOCKET);
      let upgraded = false;
      socket.on('error', reject);
      socket.on('close', () => {
        for (const p of this.pending.values()) p.reject(new Error('Codex service connection closed.'));
        this.pending.clear();
        this.onClose();
      });
      socket.on('connect', () => socket.write(`GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
      socket.on('data', chunk => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        if (!upgraded) {
          const end = this.buffer.indexOf('\r\n\r\n');
          if (end < 0) return;
          if (!this.buffer.subarray(0, end).toString().startsWith('HTTP/1.1 101')) { reject(new Error('Codex service refused the connection.')); socket.destroy(); return; }
          this.buffer = this.buffer.subarray(end + 4);
          upgraded = true;
          this.request('initialize', { clientInfo: { name: NAME, title: 'Zen MCP', version: '1' } })
            .then(() => { this.send({ method: 'initialized' }); resolve(); }, reject);
        }
        this.readFrames();
      });
    });
  }

  private readFrames() {
    for (;;) {
      if (this.buffer.length < 2) return;
      const opcode = this.buffer[0] & 0x0f;
      let length = this.buffer[1] & 0x7f, offset = 2;
      if (length === 126) { if (this.buffer.length < 4) return; length = this.buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (this.buffer.length < 10) return; length = Number(this.buffer.readBigUInt64BE(2)); offset = 10; }
      if (this.buffer.length < offset + length) return;
      const payload = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);
      if (opcode === 0x9) { this.frame(payload, 0xa); continue; } // ping → pong
      if (opcode === 0x8) { this.socket?.destroy(); return; }
      if (opcode !== 0x1) continue;
      let message: any;
      try { message = JSON.parse(payload.toString()); } catch { continue; }
      if (message.id != null && this.pending.has(message.id)) {
        const p = this.pending.get(message.id)!;
        this.pending.delete(message.id);
        if (message.error) p.reject(new Error(message.error.message ?? 'Codex service error.'));
        else p.resolve(message.result);
      } else if (message.method) this.onNotification(message.method, message.params);
    }
  }

  // client frames are masked (RFC 6455)
  private frame(payload: Buffer, opcode = 0x1) {
    const mask = crypto.randomBytes(4);
    const head = payload.length < 126 ? Buffer.from([0x80 | opcode, 0x80 | payload.length])
      : payload.length < 65536 ? Buffer.from([0x80 | opcode, 0x80 | 126, payload.length >> 8, payload.length & 255])
        : Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(payload.length)); return b; })()]);
    this.socket?.write(Buffer.concat([head, mask, payload.map((byte, i) => byte ^ mask[i % 4])]));
  }

  private send(message: object) { this.frame(Buffer.from(JSON.stringify(message))); }

  request(method: string, params: object): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ id, method, params });
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} timed out.`)); }, 5000);
    });
  }

  close() { this.socket?.destroy(); }
}

export async function runCodexWatch() {
  fs.mkdirSync(path.dirname(WATCH_SOCKET), { recursive: true, mode: 0o700 });
  if (await contactWatch()) return;
  const threads = new Map<string, Thread>();
  const receivers = new Map<string, { title?: string; subscription: ReturnType<typeof subscribe> }>();
  let daemon: DaemonClient | undefined;
  let lastTui = Date.now();
  let stopped = false;
  let firstRead = true; // the load time of conversations loaded before the watcher is unknown

  const connectDaemon = async () => {
    const client = new DaemonClient();
    client.onClose = () => { if (daemon === client) daemon = undefined; };
    client.onNotification = (method, params) => {
      const thread = params?.threadId && threads.get(params.threadId);
      if (method === 'thread/name/updated' && thread) thread.name = params.name ?? params.threadName ?? thread.name;
      if (method === 'thread/closed' && params?.threadId) threads.delete(params.threadId);
    };
    await client.connect();
    daemon = client;
    // old relays started by hooks bind the same session; they would keep replacing each other
    await stopCodexRelays();
  };

  const poll = async () => {
    if (!daemon) await connectDaemon().catch(() => {});
    const tuis = listTuis();
    if (tuis.length) lastTui = Date.now();
    if (daemon) {
      try {
        const loaded: string[] = (await daemon.request('thread/loaded/list', {})).data ?? [];
        for (const id of threads.keys()) if (!loaded.includes(id)) threads.delete(id);
        for (const id of loaded) {
          const known = threads.get(id);
          // names can change: read visible ones every round, new ones once
          if (known && !receivers.has(id)) continue;
          const { thread } = await daemon.request('thread/read', { threadId: id });
          threads.set(id, {
            id, name: thread.name ?? undefined, cwd: thread.cwd ?? '', ephemeral: !!thread.ephemeral,
            createdAt: (thread.createdAt ?? 0) * 1000,
            loadedAt: known?.loadedAt ?? (firstRead ? (thread.createdAt ?? 0) * 1000 : Date.now()),
          });
        }
        firstRead = false;
      } catch {}
    }
    const visible = daemon ? visibleThreads([...threads.values()], tuis) : new Set<string>();
    for (const [id, receiver] of receivers) {
      if (visible.has(id) && receiver.title === threads.get(id)?.name) continue;
      receiver.subscription.close();
      receivers.delete(id);
    }
    for (const id of visible) {
      if (receivers.has(id)) continue;
      const thread = threads.get(id)!;
      receivers.set(id, {
        title: thread.name,
        subscription: subscribe(event => deliverCodexPick(id, event), {
          cwd: thread.cwd, label: thread.cwd, title: thread.name, threadId: id,
          agent: { id: 'codex', name: 'Codex' }, ack: true, session: `codex:${id}`,
        }),
      });
    }
    if (!tuis.length && Date.now() - lastTui > IDLE_EXIT_MS) stop();
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const receiver of receivers.values()) receiver.subscription.close();
    daemon?.close();
    server.close(() => process.exit(0));
  };

  const server = net.createServer(socket => {
    socket.setTimeout(1000, () => socket.destroy());
    socket.on('error', () => {});
    socket.once('data', chunk => {
      try {
        const request = JSON.parse(String(chunk));
        socket.end(JSON.stringify({ ok: true, daemon: !!daemon, pid: process.pid }) + '\n');
        if (request.action === 'stop') stop();
      } catch { socket.destroy(); }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    try { fs.unlinkSync(WATCH_SOCKET); } catch {}
    server.listen(WATCH_SOCKET, () => { fs.chmodSync(WATCH_SOCKET, 0o600); resolve(); });
  });
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  for (;;) {
    await poll().catch(() => {});
    if (stopped) return;
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
}

export function contactWatch(action: 'ping' | 'stop' = 'ping'): Promise<{ daemon: boolean } | null> {
  return new Promise(resolve => {
    const socket = net.createConnection(WATCH_SOCKET);
    let data = '';
    const finish = (value: { daemon: boolean } | null) => { socket.destroy(); resolve(value); };
    socket.setTimeout(500, () => finish(null));
    socket.on('error', () => finish(null));
    socket.on('connect', () => socket.write(JSON.stringify({ action }) + '\n'));
    socket.on('data', chunk => {
      data += chunk;
      if (!data.includes('\n')) return;
      try { const reply = JSON.parse(data); finish(reply.ok ? { daemon: !!reply.daemon } : null); } catch { finish(null); }
    });
  });
}

// Starts the watcher if it isn't running; true if it reached the service (hooks then skip the relay)
export async function ensureCodexWatch(): Promise<boolean> {
  let state = await contactWatch();
  if (!state) {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--watch'], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    for (let i = 0; i < 25 && !state; i++) {
      await new Promise(resolve => setTimeout(resolve, 80));
      state = await contactWatch();
    }
  }
  // the first round tries to reach the service; a short margin until it does
  for (let i = 0; i < 10 && state && !state.daemon; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    state = await contactWatch();
  }
  return !!state?.daemon;
}

if ((import.meta as { main?: boolean }).main && process.argv[2] === '--watch') {
  await runCodexWatch();
}
