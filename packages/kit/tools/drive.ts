/**
 * Drives the client in headless Chromium over the DevTools protocol, to check taps as a player
 * makes them: `bun review/drive.ts <page-url> <out-dir> <steps.json> [<site-dir>]`.
 *
 * With `<site-dir>` (a built client, such as `dist`), the page needs no server: every request to
 * the page URL's origin is answered from that folder over the protocol, so any made-up origin does
 * (`http://grove.test/?debug#glade`).
 *
 * Steps run one after another:
 * - `["size", w, h]` sets the window (CSS pixels); `["wait", ms]` waits;
 * - `["tap", x, y]` taps a point (CSS pixels); `["tapAt", "expr"]` taps where a page expression
 *   says (`{x, y}` in CSS pixels; with `?debug`, `grove.hudToCss(x, y)` turns HUD art pixels into
 *   CSS pixels); `["click", "selector"]` taps the middle of an element;
 * - `["down", x, y]`, `["move", x, y]` and `["up", x, y]` press the mouse, drag it and let it go,
 *   one step each, so a picture can be taken with something held; `["downAt", "expr"]`,
 *   `["moveAt", "expr"]` and `["upAt", "expr"]` do the same where a page expression says;
 * - `["finger", "down" | "move" | "up", "expr"]` does the same with a finger instead of the mouse;
 * - `["key", "1"]` presses a key (a letter, or a key by its name, such as `"Escape"`);
 *   `["eval", "expr"]` prints an expression's value;
 * - `["shot", "name"]` saves a screenshot.
 *
 * Uses only Bun's own fetch and WebSocket.
 */

import { mkdirSync, rmSync } from "node:fs";

type Step =
  | ["size", number, number]
  | ["wait", number]
  | ["tap", number, number]
  | ["tapAt", string]
  | ["down" | "move" | "up", number, number]
  | ["downAt" | "moveAt" | "upAt", string]
  | ["finger", "down" | "move" | "up", string]
  | ["click", string]
  | ["key", string]
  | ["shot", string]
  | ["eval", string];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function isStep(v: unknown): v is Step {
  if (!Array.isArray(v)) return false;
  const [kind, a, b] = v as unknown[];
  if (kind === "size" || kind === "tap" || kind === "down" || kind === "move" || kind === "up")
    return typeof a === "number" && typeof b === "number";
  if (kind === "wait") return typeof a === "number";
  if (kind === "finger") return (a === "down" || a === "move" || a === "up") && typeof b === "string";
  return (
    (kind === "key" ||
      kind === "shot" ||
      kind === "eval" ||
      kind === "tapAt" ||
      kind === "click" ||
      kind === "downAt" ||
      kind === "moveAt" ||
      kind === "upAt") &&
    typeof a === "string"
  );
}

const [url, outDir, stepsPath, siteDir] = process.argv.slice(2);
if (!url || !outDir || !stepsPath) throw new Error("usage: drive.ts <url> <out-dir> <steps.json> [<site-dir>]");
const parsed: unknown = await Bun.file(stepsPath).json();
if (!Array.isArray(parsed) || !parsed.every(isStep)) throw new Error("steps must be a list of steps");
const steps: Step[] = parsed;
mkdirSync(outDir, { recursive: true });

const port = 9400 + Math.floor(Math.random() * 400);
/** Chromium's profile for this run, about 15 MB: removed when the run ends, so runs do not fill /tmp. */
const profile = `/tmp/grove-drive-${port}-${process.pid}`;
const browser = Bun.spawn(
  [
    "chromium",
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--hide-scrollbars",
    "--use-angle=gl",
    // Keep animation frames running: a headless tab otherwise counts as hidden and stops drawing.
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-background-timer-throttling",
    "about:blank",
  ],
  { stdout: "ignore", stderr: "ignore" },
);
// However the run ends, the browser does not outlive it.
process.on("exit", () => {
  browser.kill();
});

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
  if (!isRecord(msg)) return;
  if (typeof msg.id === "number") pending.get(msg.id)?.(msg.result);
  else if (msg.method === "Fetch.requestPaused" && isRecord(msg.params)) void answer(msg.params);
});
const send = (method: string, params: Record<string, unknown> = {}): Promise<unknown> =>
  new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });

/** A paused request for the site, answered from `siteDir`. */
async function answer(paused: Record<string, unknown>): Promise<void> {
  const request = isRecord(paused.request) ? paused.request : {};
  const path = decodeURIComponent(new URL(String(request.url)).pathname);
  const file = Bun.file(`${siteDir}${path === "/" ? "/index.html" : path}`);
  const found = !path.includes("..") && (await file.exists());
  await send("Fetch.fulfillRequest", {
    requestId: paused.requestId,
    responseCode: found ? 200 : 404,
    responseHeaders: [{ name: "Content-Type", value: found ? file.type : "text/plain" }],
    body: found ? Buffer.from(await file.arrayBuffer()).toString("base64") : "",
  });
}

const metrics = (w: number, h: number): Promise<unknown> =>
  send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });

await send("Page.enable");
// A tab opened over the protocol starts in the background, where animation frames never run.
await send("Page.bringToFront");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
await metrics(1440, 900);
if (siteDir) await send("Fetch.enable", { patterns: [{ urlPattern: `${new URL(url).origin}/*` }] });
await send("Page.navigate", { url });
await Bun.sleep(1500);

async function tap(x: number, y: number): Promise<void> {
  const at = { x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1 };
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...at });
  await Bun.sleep(30);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
}

const MOUSE = { down: "mousePressed", move: "mouseMoved", up: "mouseReleased" } as const;
const TOUCH = { down: "touchStart", move: "touchMove", up: "touchEnd" } as const;

/** One part of a drag with the mouse: pressing, moving while pressed, or letting go. */
async function mouse(part: keyof typeof MOUSE, x: number, y: number): Promise<void> {
  const at = { x: Math.round(x), y: Math.round(y), button: "left", buttons: part === "up" ? 0 : 1, clickCount: 1 };
  if (part === "down") await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at, buttons: 0 });
  await send("Input.dispatchMouseEvent", { type: MOUSE[part], ...at });
}

/** Where a page expression says, as a point in CSS pixels. */
async function where(expression: string): Promise<{ x: number; y: number }> {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true });
  const value = isRecord(res) && isRecord(res.result) ? res.result.value : null;
  if (!isRecord(value) || typeof value.x !== "number" || typeof value.y !== "number")
    throw new Error(`no point for ${expression}`);
  return { x: value.x, y: value.y };
}

async function run(step: Step): Promise<void> {
  switch (step[0]) {
    case "down":
    case "move":
    case "up":
      return mouse(step[0], step[1], step[2]);
    case "downAt":
    case "moveAt":
    case "upAt": {
      const at = await where(step[1]);
      return mouse(step[0] === "downAt" ? "down" : step[0] === "moveAt" ? "move" : "up", at.x, at.y);
    }
    case "finger": {
      const at = await where(step[2]);
      const point = { x: Math.round(at.x), y: Math.round(at.y), id: 1 };
      await send("Input.dispatchTouchEvent", { type: TOUCH[step[1]], touchPoints: step[1] === "up" ? [] : [point] });
      return;
    }
    case "size":
      await metrics(step[1], step[2]);
      await Bun.sleep(300);
      return;
    case "wait":
      await Bun.sleep(step[1]);
      return;
    case "tap":
      return tap(step[1], step[2]);
    case "tapAt":
    case "click": {
      const expression =
        step[0] === "click"
          ? `(() => { const r = document.querySelector(${JSON.stringify(step[1])})?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`
          : step[1];
      const res = await send("Runtime.evaluate", { expression, returnByValue: true });
      const value = isRecord(res) && isRecord(res.result) ? res.result.value : null;
      if (!isRecord(value) || typeof value.x !== "number" || typeof value.y !== "number")
        throw new Error(`nothing to tap for ${step[1]}`);
      return tap(value.x, value.y);
    }
    case "key": {
      // A letter types itself; a named key (Escape, Delete, ArrowLeft) is only pressed.
      const named = step[1].length > 1;
      await send("Input.dispatchKeyEvent", {
        type: named ? "rawKeyDown" : "keyDown",
        key: step[1],
        ...(named ? {} : { text: step[1] }),
      });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: step[1] });
      return;
    }
    case "eval": {
      const res = await send("Runtime.evaluate", { expression: step[1], awaitPromise: true, returnByValue: true });
      const value = isRecord(res) && isRecord(res.result) ? res.result.value : res;
      console.log(JSON.stringify(value));
      return;
    }
    case "shot": {
      // A page that draws with WebGL hands over a finished frame itself; a screenshot taken from
      // outside can land in the middle of one and show half a scene.
      // A name starting `ui-` asks for the whole page, interface and all, not only the world.
      const own = await send("Runtime.evaluate", {
        expression: step[1].startsWith("ui-")
          ? "null"
          : "window.grove && window.grove.snap ? window.grove.snap() : null",
        awaitPromise: true,
        returnByValue: true,
      });
      const png = isRecord(own) && isRecord(own.result) ? own.result.value : null;
      if (typeof png === "string" && png.startsWith("data:image/png;base64,")) {
        await Bun.write(`${outDir}/${step[1]}.png`, Buffer.from(png.slice(22), "base64"));
        console.log(`${outDir}/${step[1]}.png`);
        return;
      }
      const shot = await send("Page.captureScreenshot", { format: "png" });
      if (!isRecord(shot) || typeof shot.data !== "string") throw new Error("no screenshot");
      await Bun.write(`${outDir}/${step[1]}.png`, Buffer.from(shot.data, "base64"));
      console.log(`${outDir}/${step[1]}.png`);
    }
  }
}

// One after another: each step waits for the one before it. A step that cannot be done stops the
// run, and the browser and its profile are cleared away before the run says so.
let failed: unknown = null;
try {
  await steps.reduce<Promise<void>>((prev, step) => prev.then(() => run(step)), Promise.resolve());
} catch (e) {
  failed = e;
}
ws.close();
browser.kill();
await browser.exited;
// Its helpers go on writing for a moment after the browser itself has gone.
await Bun.sleep(250);
rmSync(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 });
if (failed !== null) throw failed;
