// İçerik sürecinde, her sayfanın üst çerçevesinde çalışır. Hatalar fırlatılmaz, { error }
// olarak döner: sendQuery hata mesajını düzgün taşımıyor.

const MAX_TEXT = 100000;

export class ZenMcpChild extends JSWindowActorChild {
  async receiveMessage({ name, data }) {
    try {
      switch (name) {
        case "text":
          return this.#text();
        case "eval":
          return { value: await this.#eval(data.code) };
        default:
          return { error: `Bilinmeyen mesaj: ${name}` };
      }
    } catch (e) {
      return { error: String(e?.message ?? e) };
    }
  }

  #text() {
    const doc = this.document;
    const root = doc.querySelector("main, article, [role=main]") || doc.body;
    let text = root?.innerText ?? "";
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + "\n…(kesildi)";
    return { title: doc.title, url: doc.URL, text };
  }

  // Sayfanın principal'ıyla, Xray olmadan çalışan sandbox: sayfa değişkenlerine doğrudan
  // erişir, sayfanın CSP'si eval'i engellemez
  async #eval(code) {
    const win = this.contentWindow;
    const sandbox = Cu.Sandbox(win, { sandboxPrototype: win, wantXrays: false, sameZoneAs: win });
    let value = Cu.evalInSandbox(code, sandbox, null, "zen-mcp", 1);
    if (value && typeof value.then === "function") value = await value;
    return describe(value);
  }
}

function describe(value) {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "nodeType" in value) {
    return value.outerHTML ?? value.textContent ?? String(value);
  }
  try {
    const json = JSON.stringify(value, null, 2);
    if (json !== undefined) return json;
  } catch {}
  return String(value);
}
