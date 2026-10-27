# Demo video

Re-records `docs/media/demo.mp4` / `docs/media/demo.gif`. Linux + Hyprland only (pointer moves with `hyprctl`).

1. Serve the shop: `cd scripts/demo/site && python3 -m http.server 8765 --bind 0.0.0.0`
   (the payment widget comes from `127.0.0.1`, a different site than `localhost`, so it runs as a cross-site iframe)
2. Start a separate browser with a clean profile and its own socket:
   `ZEN_MCP_SOCKET=$XDG_RUNTIME_DIR/zen-mcp-demo.sock zen-bin --no-remote --profile <empty dir>`;
   float it at 1600×1000+480+220 (`WIN` in `scenario.mjs`).
3. `ZEN_MCP_SOCKET=… node sub-demo.ts &` (so the picked element goes to a "my-shop" session), `./reset.sh`
4. `gpu-screen-recorder -w region -region 1600x1000+480+220 -f 60 -cursor yes -o raw.mp4 &`, then
   `node scenario.mjs`; it prints a timeline for the captions.
