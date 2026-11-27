import { afterEach, describe, expect, it } from "bun:test";

import { LIVE_PATH, livePath, PAGE_ERRORS_PATH, playerId } from "@sequoia-leaf/core";
import { readView as readYardView } from "@sequoia-leaf/factory";
import { near } from "@sequoia-leaf/factory/test/near.ts";
import { Effect } from "effect";

import type { Settings } from "../src/config.ts";
import { scheduledSync } from "../src/jobs.ts";
import { LiveClient } from "./live-client.ts";
import { asPage, fakeBackend, type Fetcher, type LogLine, rejection, sessionOf, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const ORIGIN = "https://leaf.seqwawa.com";
/** Wednesday 25 November 2026, 12:00 UTC: not minute 17, so a scheduled sync is a recent one. */
const T0 = Date.UTC(2026, 10, 25, 12);

const clock = { now: T0 };
let logged: LogLine[] = [];
/** The Leaf a test started, and its HTTP API, to be closed after it. */
let started: { leaf: ReturnType<typeof testLeaf>; app: ReturnType<ReturnType<typeof testLeaf>["app"]> } | null = null;
/** What else a test opened, to be closed after it, before its Leaf. */
const closing: (() => unknown)[] = [];

/** Leaf with Alice's session known to the backend, every warning and error it logs kept in `logged`. */
function start(slow = 0, config: Partial<Settings> = {}) {
  clock.now = T0;
  logged = [];
  const fake = fakeBackend({ "alice-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")) });
  const fetcher: Fetcher = (url, init) => Bun.sleep(slow).then(() => fake.fetcher(url, init));
  const leaf = testLeaf(clock, fetcher, config, { logged });
  started = { leaf, app: leaf.app() };
  return started;
}

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
  await started?.app.dispose();
  await started?.leaf.dispose();
  started = null;
});

/** A port free just now. */
function freePort(): number {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const { port } = probe;
  void probe.stop(true);
  return port ?? 0;
}

/** The value of the sample of a metric that has these labels, among others; undefined for none. */
function sample(text: string, name: string, labels: Readonly<Record<string, string>> = {}): number | undefined {
  for (const line of text.split("\n")) {
    const found = /^([a-zA-Z_:][\w:]*)(?:\{(.*)\})? (\S+)$/.exec(line);
    if (found?.[1] !== name) continue;
    const has = new Map([...(found[2] ?? "").matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)].map((l) => [l[1], l[2]]));
    if (Object.entries(labels).every(([key, value]) => has.get(key) === value)) return Number(found[3]);
  }
  return undefined;
}

/** What Leaf logged with this message, as the JSON logger writes it. */
const lines = (message: string) => logged.filter((line) => line.message === message);

/** A request as Alice's page sends it; a batch to the Works says its rules (`asPage`). */
const asAlice = (method: string, body?: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method,
  headers: { Cookie: "seq_session=alice-token", Origin: ORIGIN, "Content-Type": "application/json", ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(asPage("/v1/game/play/works", body)) }),
});

describe("requests", () => {
  it("are counted by method, route template and status, with how long they took; /metrics is not on Leaf's own port", async () => {
    const { leaf, app } = start();
    await app.request("/healthz");
    await app.request("/healthz");
    await app.request("/nope/abc");
    expect((await app.request("/metrics")).status).toBe(404);
    expect((await app.request(`/v1/game/people/${alice}`)).status).toBe(401);

    const text = await leaf.metrics();
    expect(sample(text, "http_requests_total", { method: "GET", route: "/healthz", status: "200" })).toBe(2);
    expect(sample(text, "http_requests_total", { method: "GET", route: "unmatched", status: "404" })).toBe(2);
    expect(sample(text, "http_requests_total", { route: "/v1/game/people/:player", status: "401" })).toBe(1);
    expect(sample(text, "http_request_duration_seconds_count", { route: "/healthz", status: "200" })).toBe(2);
    expect(sample(text, "http_request_duration_seconds_bucket", { route: "/healthz", le: "+Inf" })).toBe(2);
    // No path as it was asked, and nobody's id.
    expect(text).not.toContain("abc");
    expect(text).not.toContain(alice);
  });

  it("answering 5xx are logged once each, a 500 as an error with the defect behind it", async () => {
    const { leaf, app } = start();
    await leaf.query((sql) => sql`DROP TABLE accounts`);

    expect((await app.request("/v1/me", asAlice("GET"))).status).toBe(500);

    expect(lines("http_error")).toEqual([
      expect.objectContaining({
        level: "ERROR",
        annotations: { method: "GET", route: "/v1/me", status: 500, code: "internal_error", ms: expect.any(Number) },
        cause: expect.stringContaining("no such table"),
      }),
    ]);
    // The line is the request's: no other for the same defect.
    expect(logged).toHaveLength(1);
    expect(sample(await leaf.metrics(), "http_requests_total", { route: "/v1/me", status: "500" })).toBe(1);
  });

  it("slower than a second are logged as slow", async () => {
    const { app } = start(1100);

    expect((await app.request("/v1/game/me", asAlice("GET"))).status).toBe(200);

    expect(lines("http_slow")).toEqual([
      expect.objectContaining({
        level: "WARN",
        annotations: { method: "GET", route: "/v1/game/me", status: 200, ms: expect.any(Number) },
      }),
    ]);
  });
});

describe("Live", () => {
  it("counts an opening let in as one request, 101, and one refused by its reason, logged", async () => {
    const { leaf } = start();
    const server = await leaf.serve();
    closing.push(server.close);
    const refused = await fetch(`${server.origin}${livePath("town")}`, {
      headers: { Upgrade: "websocket", Connection: "Upgrade" },
    });
    expect(refused.status).toBe(401);
    const client = await LiveClient.open(server.origin, { bearer: "alice-token" });
    await client.welcome();

    let text = await leaf.metrics();
    expect(sample(text, "http_requests_total", { route: LIVE_PATH, status: "401" })).toBe(1);
    expect(sample(text, "http_requests_total", { route: LIVE_PATH, status: "101" })).toBe(1);
    expect(sample(text, "leaf_live_refused_total", { reason: "unauthorized" })).toBe(1);
    expect(sample(text, "leaf_live_opened_total")).toBe(1);
    expect(sample(text, "leaf_live_players")).toBe(1);
    expect(sample(text, "leaf_live_connections")).toBe(1);
    expect(sample(text, "leaf_live_rooms")).toBe(1);
    expect(lines("live_refused")).toEqual([
      expect.objectContaining({ level: "WARN", annotations: { code: "unauthorized", status: 401, player: null } }),
    ]);

    client.close();
    await client.ended();
    // The close comes off the socket and has nothing to answer: looked for each turn of the event loop.
    const closedThrough = async (turns = 10_000): Promise<string> => {
      const now = await leaf.metrics();
      if (sample(now, "leaf_live_connections") === 0 || turns === 0) return now;
      await new Promise((resolve) => setImmediate(resolve));
      return closedThrough(turns - 1);
    };
    text = await closedThrough();
    expect(sample(text, "leaf_live_closed_total", { how: "page" })).toBe(1);
    expect(sample(text, "leaf_live_connections")).toBe(0);
  });
});

describe("the play service", () => {
  it("counts a Works command by what became of it, and where its job's time went", async () => {
    const { leaf, app } = start();
    const opened = await app.request("/v1/game/play/works", asAlice("GET"));
    const tick = readYardView(Object(await opened.json()).state)?.clock ?? 0;
    const sent = await app.request(
      "/v1/game/play/works",
      asAlice("POST", {
        player: alice,
        commands: [
          { id: "w-1", do: "build", kind: "gatherer", ...near(-4, -3), dir: 0, tick },
          { id: "w-2", do: "remove", x: 2, y: 2, tick },
        ],
      }),
    );
    expect(Object(await sent.json()).results).toEqual([
      { id: "w-1", notes: [] },
      { id: "w-2", refused: expect.any(String) },
    ]);
    expect((await app.request("/v1/game/play/works", asAlice("POST", { player: alice, commands: [{}] }))).status).toBe(
      400,
    );

    const text = await leaf.metrics();
    expect(sample(text, "leaf_play_commands_total", { game: "works", outcome: "taken" })).toBe(1);
    expect(sample(text, "leaf_play_commands_total", { game: "works", outcome: "refused" })).toBe(1);
    expect(sample(text, "leaf_play_commands_total", { game: "works", outcome: "invalid" })).toBe(1);
    for (const phase of ["queue", "simulation", "codec", "sqlite", "other"]) {
      expect(sample(text, "leaf_play_job_seconds_count", { game: "works", kind: "batch", phase })).toBe(1);
    }
    // A rule's refusal is counted, not logged.
    expect(logged).toEqual([]);
  });

  it("says how long the state due a tend longest has been due, by game", async () => {
    const { leaf } = start();
    expect(sample(await leaf.metrics(), "leaf_play_overdue_seconds", { game: "works" })).toBe(0);
    await leaf.query(
      (sql) =>
        sql`INSERT INTO play_state (player_id, game, rev, state, updated_at, due_at) VALUES (${alice}, 'works', 1, '{}', ${T0}, ${T0 - 40 * 60_000})`,
    );

    expect(sample(await leaf.metrics(), "leaf_play_overdue_seconds", { game: "works" })).toBe(2400);
  });
});

describe("scheduled jobs", () => {
  it("count each run that did its work or failed, each failure, and the last success; 0 until there is one", async () => {
    const { leaf } = start();
    const run = (result: Effect.Effect<{ readonly status: "busy" } | undefined, string>) =>
      leaf.run(scheduledSync("credit", () => result));
    const series = async () => {
      const text = await leaf.metrics();
      return [
        "background_job_runs_total",
        "background_job_failures_total",
        "background_job_last_success_timestamp_seconds",
      ].map((name) => sample(text, name, { name: "credit_sync" }));
    };

    await run(Effect.succeed(undefined));
    expect(await series()).toEqual([undefined, undefined, undefined]);
    await run(Effect.fail("the feed is down"));
    expect(await series()).toEqual([1, 1, 0]);
    clock.now += 60_000;
    await run(Effect.succeed({ status: "busy" }));
    expect(await series()).toEqual([2, 1, (T0 + 60_000) / 1000]);
    expect(lines("The scheduled recent credit sync failed")).toHaveLength(1);
  });
});

const report = {
  page: "town",
  kind: "error",
  version: "abc123",
  browser: "firefox",
  message: "x is undefined",
  stack: "at draw (town.js:1:2)",
};

describe("pages' reports of their failures", () => {
  it("are logged with the player and counted by page and kind", async () => {
    const { leaf, app } = start();

    expect((await app.request(PAGE_ERRORS_PATH, asAlice("POST", report))).status).toBe(204);

    expect(lines("page_error")).toEqual([
      expect.objectContaining({ level: "WARN", annotations: { player: alice, ...report } }),
    ]);
    expect(sample(await leaf.metrics(), "leaf_page_errors_total", { page: "town", kind: "error" })).toBe(1);
  });

  it("are taken ten a minute from a player, the rest let go and counted, and more a minute later", async () => {
    const { leaf, app } = start();
    for (let i = 0; i < 11; i++) {
      // oxlint-disable-next-line no-await-in-loop -- one after another, as a page sends them
      expect((await app.request(PAGE_ERRORS_PATH, asAlice("POST", { ...report, message: `${i}` }))).status).toBe(204);
    }
    expect(lines("page_error").map((line) => line.annotations.message)).toEqual(
      Array.from({ length: 10 }, (_, i) => `${i}`),
    );
    let text = await leaf.metrics();
    expect(sample(text, "leaf_page_errors_total", { page: "town", kind: "error" })).toBe(10);
    expect(sample(text, "leaf_page_errors_dropped_total", { limit: "player" })).toBe(1);

    clock.now += 60_000;
    await app.request(PAGE_ERRORS_PATH, asAlice("POST", report));
    text = await leaf.metrics();
    expect(sample(text, "leaf_page_errors_total", { page: "town", kind: "error" })).toBe(11);
  });

  it("are taken from a page that could not sign in, but not from another site's page or in another shape", async () => {
    const { app } = start();
    const anonymous = {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: JSON.stringify({ ...report, kind: "sign_in" }),
    };

    expect((await app.request(PAGE_ERRORS_PATH, anonymous)).status).toBe(204);
    expect(
      (await app.request(PAGE_ERRORS_PATH, asAlice("POST", report, { Origin: "https://elsewhere.example" }))).status,
    ).toBe(403);
    const odd = await app.request(PAGE_ERRORS_PATH, asAlice("POST", { ...report, kind: "anything" }));
    expect([odd.status, Object(await odd.json()).code]).toEqual([400, "invalid_report"]);
    expect(lines("page_error").map((line) => [line.annotations.player, line.annotations.kind])).toEqual([
      [null, "sign_in"],
    ]);
  });
});

describe("the metrics listener", () => {
  it("serves /metrics on a port of its own, and nothing else there", async () => {
    const port = freePort();
    const { leaf, app } = start(0, { metrics: { hostname: "127.0.0.1", port } });
    const listener = await leaf.listen();
    closing.push(listener.close);
    await app.request("/healthz");

    const answer = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(answer.headers.get("content-type")).toContain("text/plain; version=0.0.4");
    const text = await answer.text();
    expect(text).toContain("# TYPE http_requests_total counter");
    expect(sample(text, "http_requests_total", { route: "/healthz" })).toBe(1);
    expect(sample(text, "process_resident_memory_bytes") ?? 0).toBeGreaterThan(0);
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(404);
  });

  it("stops Leaf starting when its port is taken", async () => {
    const taken = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    closing.push(() => taken.stop(true));
    const { leaf } = start(0, { metrics: { hostname: "127.0.0.1", port: taken.port ?? 0 } });

    await rejection(leaf.listen());
  });
});
