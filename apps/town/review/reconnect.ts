/**
 * How long the town takes to come back after Leaf restarts, measured on a real page:
 *
 *   bun apps/town/review/reconnect.ts [rounds] [down-seconds] [port]
 *
 * From the repository's root. It builds the town into a folder of its own, runs Leaf on this
 * machine with it (`apps/api/test/play.ts`), and opens the town as Tester in headless Chromium
 * with the kit's driver (`packages/kit/tools/drive.ts`). Once the page is in the town's live room,
 * each round stops Leaf as a deploy does (SIGTERM: the live connections are told Leaf is
 * restarting), starts it again `down-seconds` later (15 unless said), and times from Leaf answering
 * `GET /healthz` again to the page's connection being open, and to its welcome. Five rounds unless
 * said; port 4100 unless said.
 *
 * The page's side is watched from inside it: every WebSocket it makes is written down as it is
 * made, opens, hears its welcome and closes, so each round also says how many tries the page made
 * while Leaf was away. Both clocks are this machine's.
 */

/* oxlint-disable no-await-in-loop -- a run is one step after another, in time */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../../..", import.meta.url).pathname;
const [roundsText = "5", downText = "15", portText = "4100"] = process.argv.slice(2);
const rounds = Number(roundsText);
const downMs = Number(downText) * 1000;
const port = Number(portText);
if (!Number.isInteger(rounds) || rounds < 1 || !(downMs >= 0) || !Number.isInteger(port)) {
  console.error("Usage: bun apps/town/review/reconnect.ts [rounds] [down-seconds] [port]");
  process.exit(2);
}
const origin = `http://127.0.0.1:${port}`;
const work = mkdtempSync(join(tmpdir(), "town-reconnect-"));

// ---------- the town, built ----------

const built = Bun.spawnSync(["bun", "build", "index.html", "--outdir", join(work, "public", "town"), "--minify"], {
  cwd: join(ROOT, "apps/town"),
  stdout: "ignore",
  stderr: "inherit",
});
if (built.exitCode !== 0) throw new Error("the town did not build");

// ---------- Leaf ----------

let leaf: ReturnType<typeof Bun.spawn> | null = null;

function startLeaf(): void {
  leaf = Bun.spawn(["bun", join(ROOT, "apps/api/test/play.ts"), String(port), join(work, "public")], {
    cwd: ROOT,
    stdout: "ignore",
    stderr: "ignore",
  });
}

/** Stops Leaf as a deploy does, and waits for it to be gone. */
async function stopLeaf(): Promise<void> {
  const was = leaf;
  leaf = null;
  if (!was) return;
  was.kill("SIGTERM");
  await was.exited;
}

/** Asks `/healthz` every 20 ms until Leaf answers it; says when it did. */
async function healthy(within = 60_000): Promise<number> {
  const until = Date.now() + within;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(500) });
      if (res.ok) return Date.now();
    } catch {
      // Not yet.
    }
    await Bun.sleep(20);
  }
  throw new Error("Leaf did not answer /healthz");
}

// ---------- the page ----------

/** Writes down, inside the page, every WebSocket it makes: when made, opened, welcomed and closed, and the code. */
const RECORD = `(() => {
  if (window.__wire) return "recording";
  const log = (window.__wire = []);
  const Real = WebSocket;
  window.WebSocket = class extends Real {
    constructor(url, protocols) {
      super(url, protocols);
      const e = { made: Date.now(), opened: null, welcomed: null, closed: null, code: null };
      log.push(e);
      this.addEventListener("open", () => { e.opened = Date.now(); });
      this.addEventListener("message", (m) => {
        if (e.welcomed === null && typeof m.data === "string" && m.data.includes('"welcome"')) e.welcomed = Date.now();
      });
      this.addEventListener("close", (c) => { e.closed = Date.now(); e.code = c.code; });
    }
  };
  return "recording";
})()`;

/** Waits, inside the page, for the town's live connection to be open. */
const OPEN = `new Promise((resolve) => {
  const t = setInterval(() => {
    if (window.town?.link().status === "open" && window.town.link().you !== null) { clearInterval(t); resolve("open"); }
  }, 10);
})`;

/**
 * Waits, inside the page, for one round: the connection drops, then a WebSocket made after it
 * opens and is welcomed. Says when it dropped, every try since, and when the one that worked opened.
 */
const ROUND = `new Promise((resolve) => {
  const log = window.__wire;
  const from = log.length;
  let down = null;
  const t = setInterval(() => {
    if (down === null && window.town.link().status !== "open") down = Date.now();
    if (down === null) return;
    const tries = log.slice(from);
    const ok = tries.find((e) => e.welcomed !== null);
    if (!ok) return;
    clearInterval(t);
    resolve({ down, opened: ok.opened, welcomed: ok.welcomed, tries: tries.map((e) => [e.made, e.opened, e.closed, e.code]) });
  }, 5);
})`;

const steps = [
  ["size", 1280, 760],
  ["eval", RECORD],
  ["eval", OPEN],
  ...Array.from({ length: rounds }, () => ["eval", ROUND]),
];
const stepsPath = join(work, "steps.json");
await Bun.write(stepsPath, JSON.stringify(steps));

startLeaf();
await healthy();

const page = `${origin}/sign-in?return_to=${encodeURIComponent(`${origin}/play/town/`)}`;
const drive = Bun.spawn(["bun", join(ROOT, "packages/kit/tools/drive.ts"), page, join(work, "shots"), stepsPath], {
  cwd: ROOT,
  stdout: "pipe",
  stderr: "inherit",
});

/** The driver's lines, as it prints each step's value. */
async function* lines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let held = "";
  for await (const chunk of stream) {
    held += decoder.decode(chunk, { stream: true });
    let at = held.indexOf("\n");
    while (at >= 0) {
      yield held.slice(0, at);
      held = held.slice(at + 1);
      at = held.indexOf("\n");
    }
  }
  if (held !== "") yield held;
}
const said = lines(drive.stdout);
async function next(): Promise<unknown> {
  const line = await said.next();
  if (line.done) throw new Error("the driver stopped early");
  return JSON.parse(line.value);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const num = (v: unknown): number => (typeof v === "number" ? v : NaN);

try {
  if ((await next()) !== "recording") throw new Error("the page is not being watched");
  if ((await next()) !== "open") throw new Error("the page never got into the room");
  const results: { opened: number; welcomed: number; tries: number }[] = [];
  for (let round = 1; round <= rounds; round++) {
    // Leaf goes, and stays away; then it is started again, and is back once it answers.
    await stopLeaf();
    const stopped = Date.now();
    await Bun.sleep(Math.max(0, stopped + downMs - Date.now()));
    startLeaf();
    const back = await healthy();
    const r = await next();
    if (!isRecord(r) || !Array.isArray(r.tries)) throw new Error(`no round: ${JSON.stringify(r)}`);
    const opened = num(r.opened) - back;
    const welcomed = num(r.welcomed) - back;
    const away = Array.isArray(r.tries) ? r.tries.length : 0;
    results.push({ opened, welcomed, tries: away });
    const after = r.tries
      .map((t: unknown) => (Array.isArray(t) ? num(t[0]) - num(r.down) : NaN))
      .map((ms: number) => (ms / 1000).toFixed(2));
    console.log(
      `round ${round}: open ${(opened / 1000).toFixed(2)} s and welcomed ${(welcomed / 1000).toFixed(2)} s after Leaf answered /healthz ` +
        `(down ${((back - stopped) / 1000).toFixed(1)} s; ${away} tries, made at ${after.join(", ")} s after the drop)`,
    );
  }
  const opens = results.map((r) => r.opened / 1000);
  console.log(
    `open after Leaf answered: ${opens.map((s) => s.toFixed(2)).join(", ")} s; ` +
      `median ${opens.toSorted((a, b) => a - b)[Math.floor(opens.length / 2)]?.toFixed(2)} s, worst ${Math.max(...opens).toFixed(2)} s`,
  );
} finally {
  // After its last step the driver closes its browser and ends; stopped early, its browser is
  // found by its profile's name, which carries the driver's process id.
  const ended = await Promise.race([drive.exited.then(() => true), Bun.sleep(5000).then(() => false)]);
  if (!ended) {
    drive.kill();
    await drive.exited;
    Bun.spawnSync(["pkill", "-f", `grove-drive-[0-9]+-${drive.pid}`]);
  }
  await stopLeaf();
  rmSync(work, { recursive: true, force: true });
}
