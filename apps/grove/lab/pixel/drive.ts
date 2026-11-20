/**
 * Drives the glade in headless Chromium over the DevTools protocol, to check taps as a player
 * makes them: `bun lab/pixel/drive.ts <page-url> <out-dir> <steps.json>`.
 *
 * Steps are `["size", w, h]`, `["wait", ms]`, `["tap", x, y]` (CSS pixels), `["key", "1"]` and
 * `["shot", "name"]`, run one after another. Uses only Bun's own fetch and WebSocket.
 */

import { mkdirSync } from "node:fs";

type Step =
  | ["size", number, number]
  | ["wait", number]
  | ["tap", number, number]
  | ["key", string]
  | ["shot", string]
  | ["eval", string];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function isStep(v: unknown): v is Step {
  if (!Array.isArray(v)) return false;
  const [kind, a, b] = v as unknown[];
  if (kind === "size" || kind === "tap") return typeof a === "number" && typeof b === "number";
  if (kind === "wait") return typeof a === "number";
  return (kind === "key" || kind === "shot" || kind === "eval") && typeof a === "string";
}

const [url, outDir, stepsPath] = process.argv.slice(2);
if (!url || !outDir || !stepsPath) throw new Error("usage: drive.ts <url> <out-dir> <steps.json>");
const parsed: unknown = await Bun.file(stepsPath).json();
if (!Array.isArray(parsed) || !parsed.every(isStep)) throw new Error("steps must be a list of steps");
const steps: Step[] = parsed;
mkdirSync(outDir, { recursive: true });

const port = 9400 + Math.floor(Math.random() * 400);
const browser = Bun.spawn(
  [
    "chromium",
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/grove-drive-${port}`,
    "--hide-scrollbars",
    "--use-angle=gl",
    "about:blank",
  ],
  { stdout: "ignore", stderr: "ignore" },
);

/** The new tab's socket address, retried while Chromium starts. */
async function target(tries = 80): Promise<string> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
    const info: unknown = await res.json();
    if (isRecord(info) && typeof info.webSocketDebuggerUrl === "string") return info.webSocketDebuggerUrl;
    throw new Error("no socket address");
  } catch (e) {
    if (tries <= 0) throw e;
    await Bun.sleep(100);
    return target(tries - 1);
  }
}

const ws = new WebSocket(await target());
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map<number, (v: unknown) => void>();
ws.addEventListener("message", (e) => {
  const msg: unknown = JSON.parse(String(e.data));
  if (isRecord(msg) && typeof msg.id === "number") pending.get(msg.id)?.(msg.result);
});
const send = (method: string, params: Record<string, unknown> = {}): Promise<unknown> =>
  new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });

const metrics = (w: number, h: number): Promise<unknown> =>
  send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });

await send("Page.enable");
// A tab opened over the protocol starts in the background, where animation frames never run.
await send("Page.bringToFront");
await metrics(1440, 900);
await send("Page.navigate", { url });
await Bun.sleep(1500);

async function run(step: Step): Promise<void> {
  switch (step[0]) {
    case "size":
      await metrics(step[1], step[2]);
      await Bun.sleep(300);
      return;
    case "wait":
      await Bun.sleep(step[1]);
      return;
    case "tap": {
      const at = { x: step[1], y: step[2], button: "left", clickCount: 1 };
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", ...at });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
      return;
    }
    case "key":
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: step[1], text: step[1] });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: step[1] });
      return;
    case "eval": {
      const res = await send("Runtime.evaluate", { expression: step[1], awaitPromise: true, returnByValue: true });
      const value = isRecord(res) && isRecord(res.result) ? res.result.value : res;
      console.log(JSON.stringify(value));
      return;
    }
    case "shot": {
      const shot = await send("Page.captureScreenshot", { format: "png" });
      if (!isRecord(shot) || typeof shot.data !== "string") throw new Error("no screenshot");
      await Bun.write(`${outDir}/${step[1]}.png`, Buffer.from(shot.data, "base64"));
      console.log(`${outDir}/${step[1]}.png`);
    }
  }
}

// One after another: each step waits for the one before it.
await steps.reduce<Promise<void>>((prev, step) => prev.then(() => run(step)), Promise.resolve());
ws.close();
browser.kill();
