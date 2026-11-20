export const NO_PUSH = "no push path";

export const ascii = (s) => s.replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

export class Channels {
  // why: Preserve last activity timestamps across bridge reloads.
  constructor(lastUse, env) {
    this.lastUse = lastUse;
    this.env = env;
    this.subscribers = new Map();
    this.pending = new Map();
  }

  subscribe(
    {
      session,
      cwd,
      agent,
      label,
      title,
      threadId,
      ack = false,
      toolsOnly = false,
      push = null,
      clientSession = null,
      clientPid = null,
      hook = false,
    },
    transport,
    output,
  ) {
    if (!session) throw new Error("session is required.");
    const theme = this.env.theme(agent ?? { id: "claude" });
    if (toolsOnly) {
      this.env.connectOwner(session, transport, theme, cwd, title);
      // why: Acknowledgement capability identifies the process that can report delivery to a session.
      if (ack)
        this.subscribers.set(session, {
          id: session,
          name: this.env.sessionName(theme, label || cwd, title, session),
          agent: theme,
          ack,
          relay: false,
          push: typeof push === "string" ? push : null,
          // why: Prompt hooks know the client's conversation ID rather than the bridge session ID.
          clientSession: typeof clientSession === "string" ? clientSession : null,
          clientPid: Number.isInteger(clientPid) ? clientPid : null,
          hook: hook === true,
          threadId,
          transport,
          output,
          since: Date.now(),
          queue: Promise.resolve(true),
        });
      return session;
    }
    const relay = theme.id === "codex" && session === `codex:${threadId}`;
    const key = theme.id === "codex" && threadId ? `codex:${threadId}` : session;
    const old = this.subscribers.get(key);
    if (old?.relay && !relay) throw new Error("This Codex thread already has an automatic receiver.");
    if (old)
      try {
        old.transport.close(Cr.NS_OK);
      } catch {}
    // why: The relay uses the same session ID as Codex calls so it can own their tabs.
    if (relay) this.env.connectOwner(key, transport, theme, label || cwd, title);
    const name = this.env.sessionName(theme, label || cwd, title, threadId || session);
    this.subscribers.set(key, {
      id: key,
      name,
      agent: theme,
      ack,
      relay,
      // why: An older channel process needs its compatibility path for delivery.
      push: relay ? "codex" : "channel",
      threadId,
      transport,
      output,
      since: Date.now(),
      queue: Promise.resolve(true),
    });
    return key;
  }

  unsubscribe(session, transport) {
    this.env.disconnectOwner(session, transport);
    if (this.subscribers.get(session)?.transport === transport) this.subscribers.delete(session);
    for (const pending of this.pending.values()) {
      if (pending.session === session && pending.transport === transport) pending.finish(false);
    }
  }

  target() {
    let best = null;
    let bestTime = -1;
    for (const [session, sub] of this.subscribers) {
      const time = Math.max(this.lastUse.get(session) ?? 0, sub.since);
      if (time > bestTime) [best, bestTime] = [sub, time];
    }
    return best;
  }

  // why: NetUtil.asyncCopy would close the subscription (docs/gecko-pitfalls.md, Sockets and streams).
  #push(sub, message) {
    const stream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
    stream.setByteStringData(ascii(JSON.stringify(message)) + "\n");
    sub.queue = sub.queue.then(
      () =>
        new Promise((resolve) => {
          const copier = Cc["@mozilla.org/network/async-stream-copier;1"].createInstance(Ci.nsIAsyncStreamCopier);
          copier.init(stream, sub.output, null, true, false, 0x8000, true, false);
          copier.asyncCopy(
            { onStartRequest() {}, onStopRequest: (_request, status) => resolve(Components.isSuccessCode(status)) },
            null,
          );
        }),
    );
    return sub.queue;
  }

  async deliver(sub, message) {
    if (!sub.ack) return this.#push(sub, message);
    const id = this.env.uuid();
    return new Promise((resolve) => {
      let timer;
      const finish = (ok) => {
        this.env.clearTimeout(timer);
        this.pending.delete(id);
        resolve(ok);
      };
      this.pending.set(id, { session: sub.id, transport: sub.transport, finish });
      timer = this.env.setTimeout(() => finish(false), 40_000);
      this.#push(sub, { ...message, id }).then(
        (ok) => {
          if (!ok) finish(false);
        },
        () => finish(false),
      );
    });
  }

  acknowledge(session, transport, event) {
    const pending = this.pending.get(event?.id);
    if (event?.event !== "delivery" || !pending || pending.session !== session || pending.transport !== transport)
      return;
    if (!event.ok && event.error !== NO_PUSH)
      this.env.logError("pick delivery", new Error(String(event.error || "Delivery rejected")));
    pending.finish(event.ok === true);
  }

  // why: Reload closes subscriptions so clients reconnect to the new bridge.
  closeAll() {
    for (const sub of this.subscribers.values()) {
      try {
        sub.transport.close(Cr.NS_OK);
      } catch {}
    }
    this.subscribers.clear();
    for (const pending of this.pending.values()) pending.finish(false);
  }
}
