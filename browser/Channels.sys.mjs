// Ajan oturumlarına tarayıcıdan olay itmek için (Claude Code channels, Codex alıcısı).
//
// Kanal olarak açılmış her oturumun MCP sunucusu kalıcı bir "subscribe" bağlantısı açar;
// olaylar bu bağlantıya satır satır yazılır. Birden fazla oturum varsa olay tarayıcıyı en son
// kullanan (ya da en son açılan) oturuma gider. env:
//   env.theme(agent), env.connectOwner(session, transport, theme, cwd),
//   env.disconnectOwner(session, transport), env.logError(where, e),
//   env.setTimeout/clearTimeout, env.uuid()

// soket satırları ASCII: JSON içindeki ASCII dışı karakterler \u kaçışıyla yazılır
export const ascii = s => s.replace(/[\u007f-￿]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

export class Channels {
  // lastUse: session → son tool çağrısı; reload'dan sağ çıksın diye dışarıdan gelir
  constructor(lastUse, env) {
    this.lastUse = lastUse;
    this.env = env;
    this.subscribers = new Map(); // session → { id, name, agent, ack, relay, threadId, transport, output, since, queue }
    this.pending = new Map(); // teslim kimliği → { session, transport, finish }
  }

  subscribe({ session, cwd, agent, label, title, threadId, ack = false, toolsOnly = false }, transport, output) {
    if (!session) throw new Error("session is required.");
    const theme = this.env.theme(agent ?? { id: "claude" });
    if (toolsOnly) {
      this.env.connectOwner(session, transport, theme, cwd, title);
      return session;
    }
    const relay = theme.id === "codex" && session === `codex:${threadId}`;
    const key = theme.id === "codex" && threadId ? `codex:${threadId}` : session;
    const old = this.subscribers.get(key);
    if (old?.relay && !relay) throw new Error("This Codex thread already has an automatic receiver.");
    if (old) try { old.transport.close(Cr.NS_OK); } catch {}
    // Codex sohbet alıcısı aynı zamanda sekme sahibi oturumdur: Codex araçları bu kimlikle çağırır
    if (relay) this.env.connectOwner(key, transport, theme, label || cwd, title);
    const name = this.env.sessionName(theme, label || cwd, title, threadId || session);
    this.subscribers.set(key, { id: key, name, agent: theme, ack, relay, threadId, transport, output, since: Date.now(), queue: Promise.resolve(true) });
    return key;
  }

  unsubscribe(session, transport) {
    this.env.disconnectOwner(session, transport);
    if (this.subscribers.get(session)?.transport === transport) this.subscribers.delete(session);
    for (const pending of this.pending.values()) {
      if (pending.session === session && pending.transport === transport) pending.finish(false);
    }
  }

  // olayın varsayılan hedefi
  target() {
    let best = null;
    let bestTime = -1;
    for (const [session, sub] of this.subscribers) {
      const time = Math.max(this.lastUse.get(session) ?? 0, sub.since);
      if (time > bestTime) [best, bestTime] = [sub, time];
    }
    return best;
  }

  // tek satır yazar, bağlantı açık kalır (NetUtil.asyncCopy soketi de kapatırdı)
  #push(sub, message) {
    const stream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
    stream.setByteStringData(ascii(JSON.stringify(message)) + "\n");
    sub.queue = sub.queue.then(() => new Promise(resolve => {
      const copier = Cc["@mozilla.org/network/async-stream-copier;1"].createInstance(Ci.nsIAsyncStreamCopier);
      copier.init(stream, sub.output, null, true, false, 0x8000, true, false);
      copier.asyncCopy({ onStartRequest() {}, onStopRequest: (_request, status) => resolve(Components.isSuccessCode(status)) }, null);
    }));
    return sub.queue;
  }

  // ack isteyen alıcıda alındı bildirimi gelene kadar (en çok 40 sn) bekler
  async deliver(sub, message) {
    if (!sub.ack) return this.#push(sub, message); // legacy Claude channel processes
    const id = this.env.uuid();
    return new Promise(resolve => {
      let timer;
      const finish = ok => {
        this.env.clearTimeout(timer);
        this.pending.delete(id);
        resolve(ok);
      };
      this.pending.set(id, { session: sub.id, transport: sub.transport, finish });
      timer = this.env.setTimeout(() => finish(false), 40_000);
      this.#push(sub, { ...message, id }).then(ok => { if (!ok) finish(false); }, () => finish(false));
    });
  }

  acknowledge(session, transport, event) {
    const pending = this.pending.get(event?.id);
    if (event?.event !== "delivery" || !pending || pending.session !== session || pending.transport !== transport) return;
    if (!event.ok) this.env.logError("pick delivery", new Error(String(event.error || "Delivery rejected")));
    pending.finish(event.ok === true);
  }

  // köprü kapanırken: aboneler yeni sürüme yeniden bağlansın
  closeAll() {
    for (const sub of this.subscribers.values()) {
      try { sub.transport.close(Cr.NS_OK); } catch {}
    }
    this.subscribers.clear();
    for (const pending of this.pending.values()) pending.finish(false);
  }
}
