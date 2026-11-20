// Live source locations on real dev servers: scaffolds small Next.js (Turbopack and webpack),
// Vite React 19/18, Svelte, Vue, Astro and Angular apps, picks one element in each and checks the
// file:line the agent receives. Needs network for the first scaffold; later runs reuse the apps.
// Run inside a sandbox (scripts/sandbox.ts): node scripts/check-source-stacks.ts [work dir] [stack…]
// No message reaches an AI session.
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { call, subscribe, type Content } from "../src/zen.ts";

const work = path.resolve(process.argv[2] ?? path.join(os.homedir(), ".cache", "zen-mcp-stacks"));
const only = process.argv.slice(3);
fs.mkdirSync(work, { recursive: true });

const CARD_TSX = `import "./Card.css";

export function Card({ title }: { title: string }) {
  return (
    <section className="card">
      <button type="button">{title}</button>
    </section>
  );
}
`;
const APP_TSX = `import { Card } from "./Card";

export default function App() {
  return (
    <main>
      <Card title="Vite card" />
    </main>
  );
}
`;
const NEXT_FILES = {
  "src/app/page.tsx": `import { Card } from "../components/Card";
import { Counter } from "../components/Counter";

export default function Home() {
  return (
    <main>
      <Card title="Server card" />
      <Counter />
    </main>
  );
}
`,
  "src/components/Card.tsx": `export function Card({ title }: { title: string }) {
  return (
    <section>
      <button type="button">{title}</button>
    </section>
  );
}
`,
  "src/components/Counter.tsx": `"use client";
import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button type="button" onClick={() => setCount(count + 1)}>
        Client count {count}
      </button>
    </div>
  );
}
`,
};
const VITE_REACT_FILES = {
  "src/Card.tsx": CARD_TSX,
  "src/Card.css": ".card button {\n  color: rgb(10, 20, 30);\n}\n",
  "src/App.tsx": APP_TSX,
};
const ASTRO_FILES = {
  "src/components/Card.astro": `---
const { title } = Astro.props;
---

<section class="card">
  <button type="button">{title}</button>
</section>
`,
  "src/pages/index.astro": `---
import Card from "../components/Card.astro";
---

<html lang="en">
  <body>
    <Card title="Astro card" />
  </body>
</html>
`,
};

type Pick = { name: string; expect: RegExp[] };
type Stack = { app: string; scaffold: string; files: Record<string, string>; dev: string; picks: Pick[] };
const STACKS: Record<string, Stack> = {
  "next-turbopack": {
    app: "nextapp",
    scaffold:
      "npx --yes create-next-app@latest nextapp --ts --app --no-eslint --no-tailwind --src-dir --import-alias '@/*' --use-npm --yes --disable-git",
    files: NEXT_FILES,
    dev: "npx next dev -p PORT",
    picks: [
      {
        name: "Server card",
        expect: [/element: \S*src\/components\/Card\.tsx:4:7$/m, /<Card> rendered at \S*src\/app\/page\.tsx:7:7$/m],
      },
      {
        name: "Client count 0",
        expect: [
          /element: \S*src\/components\/Counter\.tsx:8:7/m,
          /<Counter> rendered at \S*src\/app\/page\.tsx:8:7$/m,
        ],
      },
    ],
  },
  "next-webpack": {
    app: "nextapp",
    scaffold: "",
    files: {},
    dev: "npx next dev --webpack -p PORT",
    picks: [
      { name: "Server card", expect: [/element: \S*src\/components\/Card\.tsx:4:7$/m] },
      { name: "Client count 0", expect: [/element: \S*src\/components\/Counter\.tsx:8:7/m] },
    ],
  },
  "vite-react19": {
    app: "r19",
    scaffold: "npm create vite@latest r19 -- --template react-ts --no-interactive && cd r19 && npm i",
    files: VITE_REACT_FILES,
    dev: "npx vite --port PORT --strictPort",
    picks: [
      {
        name: "Vite card",
        expect: [
          /^Source \(React, element-level\):$/m,
          /element: \S*src\/Card\.tsx:6:7$/m,
          /<Card> rendered at \S*src\/App\.tsx:6:7$/m,
        ],
      },
    ],
  },
  "vite-react18": {
    app: "r18",
    scaffold:
      "npm create vite@latest r18 -- --template react-ts --no-interactive && cd r18 && npm i && npm i react@18 react-dom@18 @types/react@18 @types/react-dom@18",
    files: VITE_REACT_FILES,
    dev: "npx vite --port PORT --strictPort",
    picks: [
      { name: "Vite card", expect: [/element: \S*src\/Card\.tsx:6:7$/m, /<Card> rendered at \S*src\/App\.tsx:6:7$/m] },
    ],
  },
  svelte: {
    app: "svelteapp",
    scaffold: "npm create vite@latest svelteapp -- --template svelte-ts --no-interactive && cd svelteapp && npm i",
    files: {
      "src/lib/Card.svelte": `<script lang="ts">
  let { title }: { title: string } = $props();
</script>

<section class="card">
  <button type="button">{title}</button>
</section>
`,
      "src/App.svelte": `<script lang="ts">
  import Card from "./lib/Card.svelte";
</script>

<main>
  <Card title="Svelte card" />
</main>
`,
    },
    dev: "npx vite --port PORT --strictPort",
    picks: [
      {
        name: "Svelte card",
        expect: [/element: \S*src\/lib\/Card\.svelte:6:3$/m, /<Card> rendered at \S*src\/App\.svelte:6:3$/m],
      },
    ],
  },
  vue: {
    app: "vueapp",
    scaffold: "npm create vite@latest vueapp -- --template vue-ts --no-interactive && cd vueapp && npm i",
    files: {
      "src/components/Card.vue": `<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<template>
  <section class="card">
    <button type="button">{{ title }}</button>
  </section>
</template>
`,
      "src/App.vue": `<script setup lang="ts">
import Card from "./components/Card.vue";
</script>

<template>
  <main>
    <Card title="Vue card" />
  </main>
</template>
`,
    },
    dev: "npx vite --port PORT --strictPort",
    picks: [
      {
        name: "Vue card",
        expect: [/^Source \(Vue, component-level\):$/m, /<Card> defined in \S*src\/components\/Card\.vue$/m],
      },
    ],
  },
  astro: {
    app: "astroapp",
    scaffold: "npm create astro@latest astroapp -- --template minimal --install --no-git --yes",
    files: ASTRO_FILES,
    dev: "npx astro dev --port PORT",
    picks: [{ name: "Astro card", expect: [/element: \S*src\/components\/Card\.astro:6$/m] }],
  },
  angular: {
    app: "ngapp",
    scaffold: "npx --yes @angular/cli@latest new ngapp --defaults --skip-git --ssr=false --zoneless --style=css",
    files: {
      "src/app/card.ts": `import { Component, input } from "@angular/core";

@Component({
  selector: "app-card",
  template: \`<section class="card"><button type="button">{{ title() }}</button></section>\`,
})
export class Card {
  title = input("");
}
`,
      "src/app/app.ts": `import { Component } from "@angular/core";
import { Card } from "./card";

@Component({
  imports: [Card],
  selector: "app-root",
  template: '<app-card title="Angular card" />',
})
export class App {}
`,
    },
    dev: "npx ng serve --port PORT",
    picks: [
      {
        name: "Angular card",
        expect: [/^Source \(Angular, component-level\):$/m, /<Card> defined in \S*src\/app\/card\.ts:7$/m],
      },
    ],
  },
};

const text = (content: Content[]) => content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");
const chrome = async (code: string) => JSON.parse(text(await call("chrome_eval", { code })));
const command = (tool: string, args: object = {}) => call(tool, args, 60_000, { id: "codex", name: "Codex" });
async function until(check: () => Promise<boolean>, message: string, tries = 200) {
  for (let i = 0; i < tries; i++) {
    if (await check().catch(() => false)) return;
    await sleep(100);
  }
  throw new Error(message);
}

const token = `stacks-${randomUUID()}`;
const session = `${token}-claude`;
const events: { content: string; note: string }[] = [];
const receiver = subscribe(
  (event) => {
    if (event.event === "channel") events.push(event as never);
  },
  {
    session,
    label: token,
    agent: { id: "claude", name: "claude" },
    cwd: process.cwd(),
    ack: true,
    toolsOnly: true,
    push: "channel",
  },
);

async function pick(url: string, name: string): Promise<string> {
  const tabId = JSON.parse(text(await command("tabs_create_mcp"))).tabId;
  try {
    await command("navigate", { tabId, url });
    let ref: string | undefined;
    await until(async () => {
      const line = text(await command("read_page", { tabId }))
        .split("\n")
        .find((l) => l.includes(`"${name}"`) && /\[[^\]]+\]\s*$/.test(l));
      ref = line && /\[([^\]]+)\]\s*$/.exec(line)![1];
      return Boolean(ref);
    }, `No element named ${name} on ${url}.`);
    await chrome(
      `(() => {const browser=h.findTab(${tabId}).linkedBrowser;h.startPick(browser.ownerDocument.defaultView,{browser});return true;})()`,
    );
    await until(() => chrome('h.island.pickMode==="picking"'), "Picker did not start.");
    await command("computer", { tabId, action: "left_click", ref });
    await until(() => chrome('h.island.pickMode==="compose" && !h.pick?.preparing'), "Picker did not reach compose.");
    const note = `${token}: ${name}`;
    await chrome(`(() => {
      const win=h.findTab(${tabId}).ownerDocument.defaultView;
      const el=win.document.getElementById('zen-mcp-island');
      const select=el.querySelector('.target');select.value=${JSON.stringify(session)};
      select.dispatchEvent(new win.Event('change',{bubbles:true}));
      el.querySelector('.compose textarea').value=${JSON.stringify(note)};
      el.querySelector('.compose-footer button.primary').click();return true;
    })()`);
    await until(async () => events.some((e) => e.note === note), "The pick was not delivered.");
    return events.find((e) => e.note === note)!.content;
  } finally {
    await chrome(`(() => {if(h.pick?.browser===h.findTab(${tabId})?.linkedBrowser)h.endPick();return true;})()`).catch(
      () => {},
    );
    await command("tabs_close_mcp", { tabId }).catch(() => {});
  }
}

let failed = 0;
try {
  assert(process.env.ZEN_MCP_SOCKET, "Run inside a sandbox: node scripts/sandbox.ts up, then source its env file.");
  await until(() => chrome(`h.subscribers.has(${JSON.stringify(session)})`), "Local receipt fixture did not connect.");
  let port = 3700;
  for (const [id, stack] of Object.entries(STACKS)) {
    if (only.length && !only.includes(id)) continue;
    const dir = path.join(work, stack.app);
    if (!fs.existsSync(dir)) execSync(stack.scaffold, { cwd: work, stdio: "ignore" });
    for (const [file, content] of Object.entries(stack.files)) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), content);
    }
    const url = `http://localhost:${++port}/`;
    // its own process group, so stopping it also stops the dev server's children
    const server = spawn("sh", ["-c", stack.dev.replace("PORT", String(port))], {
      cwd: dir,
      detached: true,
      stdio: "ignore",
    });
    try {
      await until(async () => (await fetch(url)).ok, `${id}: dev server did not answer on ${url}.`, 900);
      for (const { name, expect } of stack.picks) {
        const content = await pick(url, name);
        const misses = expect.filter((pattern) => !pattern.test(content));
        if (misses.length) {
          failed++;
          console.log(`✗ ${id} "${name}": missing ${misses.join(", ")}\n${content}`);
        } else console.log(`✓ ${id} "${name}"`);
      }
    } finally {
      try {
        process.kill(-server.pid!);
      } catch {}
      // some dev servers (Astro) leave a listener outside the process group
      await sleep(500);
      const listeners = execSync(`ss -ltnpH 'sport = :${port}'`, { encoding: "utf8" });
      for (const pid of new Set([...listeners.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1])))) process.kill(pid);
    }
  }
} finally {
  receiver.close();
}
if (failed) process.exitCode = 1;
else console.log("All source stacks resolved. No message was sent to a real AI session.");
setTimeout(() => process.exit(), 200);
