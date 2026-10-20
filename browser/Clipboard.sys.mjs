// Explicit per-operation consent, independent of site/auto/batch approvals.
export class ClipboardAccess {
  constructor(env) { this.env = env; }
  async run(args) {
    if (!['read', 'write', 'copy', 'paste', 'cut'].includes(args.action)) throw new Error('Unknown clipboard action.');
    if (args.action === 'write' && (typeof args.text !== 'string' || args.text.length > 1000000)) throw new Error('Clipboard write requires text (at most 1,000,000 characters).');
    const max = args.max_chars ?? 20000;
    if (!Number.isInteger(max) || max < 1 || max > 100000) throw new Error('max_chars must be an integer from 1 to 100000.');
    this.env.check();
    const context = await this.env.prepare(args);
    if (!await this.env.ask(args, context)) throw new Error('The user denied or did not answer the system clipboard request; nothing was done.');
    this.env.check(context);
    if (args.action === 'read') {
      const value = await this.env.read();
      this.env.check(context);
      return { source: 'system clipboard', untrusted: true, text: value.slice(0, max), characters: value.length, truncated: value.length > max };
    }
    if (args.action === 'write') { await this.env.write(args.text); return { written: true, characters: args.text.length }; }
    await this.env.command(args, context);
    return { [args.action === 'paste' ? 'pasted' : args.action === 'cut' ? 'cut' : 'copied']: true };
  }
}

export function clipboardShortcut({ key, mods }) {
  const name = key.toLowerCase();
  if ((mods.ctrlKey || mods.metaKey) && !mods.altKey) {
    if (!mods.shiftKey && (name === 'c' || name === 'key_insert')) return 'copy';
    if (name === 'v') return 'paste';
    if (!mods.shiftKey && name === 'x') return 'cut';
  }
  if (mods.shiftKey && !mods.ctrlKey && !mods.metaKey && !mods.altKey) {
    if (name === 'key_insert') return 'paste';
    if (name === 'key_delete') return 'cut';
  }
  return null;
}
