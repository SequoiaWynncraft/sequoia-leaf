/**
 * Opens the built pages in headless Chromium while their styles or script are not there, as while
 * Leaf is updating, and checks the guard (`src/guard.ts`) does what it says:
 * `bun packages/kit/review/deploy.ts [<built-pages>]`. Without a folder it builds the pages first
 * (`tools/build-pages.ts`), under `TMPDIR`.
 *
 * Each case serves one page from a server of its own, one of whose files answers 404 for its first
 * asks or for all of them, and reads after a while how many times the page loaded, what it says,
 * whether its styles hold, and what it reported. One case answers that 404 as Leaf did before
 * (kept a year), to show the guard's second ask past the cache replaces it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const tmp = process.env["TMPDIR"] ?? join(homedir(), ".cache");
const root = join(import.meta.dir, "..", "..", "..");

const given = process.argv[2];
const site = given ?? mkdtempSync(join(tmp, "leaf-deploy-pages-"));
if (given === undefined) {
  const built = Bun.spawnSync([process.execPath, "packages/kit/tools/build-pages.ts", site], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (built.exitCode !== 0) process.exit(1);
}

interface Case {
  readonly name: string;
  readonly page: string;
  /** Which of the page's own files fails: its styles or its script. */
  readonly missing: "css" | "js";
  /** How many asks for it fail, from the first. */
  readonly fails: number;
  /** Whether the 404 is kept a year, as Leaf answered it before. */
  readonly kept?: boolean;
  readonly expect: { readonly loads: number; readonly updating: boolean; readonly reports: number };
}

const UPDATING = "Leaf is updating. Reload in a moment.";
const CASES: Case[] = [
  {
    name: "nothing missing",
    page: "battler",
    missing: "css",
    fails: 0,
    expect: { loads: 1, updating: false, reports: 0 },
  },
  ...["battler", "town", "works"].flatMap((page): Case[] => [
    {
      name: `${page}: styles missing once`,
      page,
      missing: "css",
      fails: 1,
      expect: { loads: 2, updating: false, reports: 0 },
    },
    {
      name: `${page}: styles missing twice`,
      page,
      missing: "css",
      fails: 99,
      expect: { loads: 2, updating: true, reports: 1 },
    },
    {
      name: `${page}: script missing once`,
      page,
      missing: "js",
      fails: 1,
      expect: { loads: 2, updating: false, reports: 0 },
    },
    {
      name: `${page}: script missing twice`,
      page,
      missing: "js",
      fails: 99,
      expect: { loads: 2, updating: true, reports: 1 },
    },
  ]),
  {
    name: "battler: styles missing once, the 404 kept a year",
    page: "battler",
    missing: "css",
    fails: 1,
    kept: true,
    expect: { loads: 2, updating: false, reports: 0 },
  },
];

/** A server for one case: the built pages, one file failing, Leaf's API answering nothing but reports. */
function serve(c: Case) {
  const seen = { loads: 0, asks: 0, reports: [] as unknown[] };
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/v1/game/page-errors") {
        seen.reports.push(await request.json());
        return new Response(null, { status: 204 });
      }
      if (!path.startsWith("/play/"))
        return new Response("no", { status: 404, headers: { "cache-control": "no-store" } });
      const rest = path.slice("/play/".length);
      const file = Bun.file(join(site, rest.endsWith("/") ? `${rest}index.html` : rest));
      if (rest === `${c.page}/`) seen.loads++;
      if (rest.startsWith(`${c.page}/index-`) && rest.endsWith(`.${c.missing}`) && seen.asks++ < c.fails) {
        const keep = c.kept ? "public, max-age=31536000, immutable" : "no-store";
        return Response.json({ code: "not_found" }, { status: 404, headers: { "cache-control": keep } });
      }
      if (!(await file.exists())) return new Response("no", { status: 404, headers: { "cache-control": "no-store" } });
      const hashed = /\/index-[0-9a-z]+\.(js|css)$/.test(path);
      return new Response(file, {
        headers: { "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache" },
      });
    },
  });
  return { server, seen };
}

const port = 9400 + Math.floor(Math.random() * 400);
const home = join(tmp, `leaf-deploy-${port}-${process.pid}`);
const browser = Bun.spawn(
  [
    "chromium",
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${home}/profile`,
    "--disable-extensions",
    "about:blank",
  ],
  { stdout: "ignore", stderr: "ignore", env: { ...process.env, XDG_CONFIG_HOME: `${home}/config` } },
);
process.on("exit", () => {
  browser.kill();
  rmSync(home, { recursive: true, force: true });
  if (process.argv[2] === undefined) rmSync(site, { recursive: true, force: true });
});

/** What `key` of `x` is, when `x` is an object. */
const field = (x: unknown, key: string): unknown =>
  typeof x === "object" && x !== null ? Reflect.get(x, key) : undefined;

async function tab(tries = 80): Promise<string> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
    const address = field(await res.json(), "webSocketDebuggerUrl");
    if (typeof address !== "string") throw new Error("no socket address");
    return address;
  } catch (e) {
    if (tries <= 0) throw e;
    await Bun.sleep(100);
    return tab(tries - 1);
  }
}

/** A tab of its own for each case; with a server of its own, on a port of its own, no case shares another's storage or cache. */
async function open(): Promise<{ send: (method: string, params?: object) => Promise<unknown>; close: () => void }> {
  const ws = new WebSocket(await tab());
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map<number, (v: unknown) => void>();
  ws.addEventListener("message", (e) => {
    const msg: unknown = JSON.parse(String(e.data));
    const n = field(msg, "id");
    if (typeof n === "number") pending.get(n)?.(field(msg, "result"));
  });
  const send = (method: string, params: object = {}) =>
    new Promise<unknown>((resolve) => {
      const n = ++id;
      pending.set(n, resolve);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  return { send, close: () => ws.close() };
}

const READ = `(() => ({
  said: document.body ? document.body.innerText.trim().slice(0, 80) : "",
  styled: [...document.styleSheets].some((s) => { try { return s.cssRules.length > 100; } catch { return false; } }),
  hidden: getComputedStyle(document.documentElement).visibility === "hidden",
}))()`;

/** Runs one case in a tab of its own: whether it did as it should. */
async function check(c: Case): Promise<boolean> {
  const { server, seen } = serve(c);
  const { send, close } = await open();
  await send("Network.enable");
  await send("Network.clearBrowserCache");
  await send("Page.enable");
  await send("Page.navigate", { url: `http://127.0.0.1:${server.port}/play/${c.page}/` });
  await Bun.sleep(6000);
  const read = field(
    field(await send("Runtime.evaluate", { expression: READ, returnByValue: true }), "result"),
    "value",
  );
  const said = field(read, "said");
  const styled = field(read, "styled") === true;
  const updating = said === UPDATING;
  const assets = seen.reports.filter((r) => field(r, "kind") === "assets");
  const ok =
    seen.loads === c.expect.loads &&
    updating === c.expect.updating &&
    assets.length === c.expect.reports &&
    field(read, "hidden") === false &&
    (updating || c.missing === "js" || styled);
  const what = updating ? "says Leaf is updating" : styled ? "styled" : "UNSTYLED";
  console.log(`${ok ? "ok  " : "FAIL"} ${c.name}: loaded ${seen.loads}x, ${what}, ${assets.length} report(s)`);
  for (const r of assets) console.log(`       ${JSON.stringify(r)}`);
  await send("Page.navigate", { url: "about:blank" });
  close();
  await server.stop(true);
  return ok;
}

let failed = 0;
for (const c of CASES) {
  // oxlint-disable-next-line no-await-in-loop -- one case at a time: each waits a while on its page
  if (!(await check(c))) failed++;
}
console.log(failed === 0 ? "Every case did as it should." : `${failed} case(s) did not.`);
// The profile goes once Chromium has let go of it.
browser.kill();
await browser.exited;
process.exit(failed === 0 ? 0 : 1);
