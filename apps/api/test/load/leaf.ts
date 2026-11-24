/**
 * Leaf under load, in a process of its own, for `drive.ts` to load:
 *
 *   bun apps/api/test/load/leaf.ts <port> [owners] [cold]
 *
 * The real app on a database in memory, on the machine's clock, with the tests' stand-in backend
 * knowing a session for each of 1,000 walkers (`w<n>`, every fourth not in the guild), `owners`
 * members (20 by default) whose yard is the largest staged one, written a minute ago (`o<n>`), and
 * 200 who only visit (`v<n>`); and `cold` more such yards (50 by default), left eight hours ago,
 * that no page keeps up. To see it as the 4-core server would run it, start it in a scope of its own:
 *
 *   systemd-run --user --scope -p CPUQuota=400% -p MemoryMax=16G mise x bun@1.4.5 -- bun apps/api/test/load/leaf.ts 4400
 *
 * Beside Leaf's routes, for the driver:
 * - `POST /load/phase?name=<name>` ends the phase under way and begins another.
 * - `POST /load/sweep` puts a tend in the line of every state due one, as the minute's sweep does,
 *   and answers at once; `GET /load/swept` says whether that sweep is done, and how long it took.
 * - `GET /load/report` says what was measured in each phase: the event loop's delay, where the play
 *   service's jobs spent their time (`PlayMeter`), the CPU used, the most memory held, and how far
 *   behind the yard longest unwritten was, sampled each second.
 *
 * SIGTERM or Ctrl-C stops it.
 */
import { monitorEventLoopDelay } from "node:perf_hooks";

import { FACTORY, here } from "@sequoia-leaf/factory";
import { staged } from "@sequoia-leaf/factory/test/yards.ts";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { SqlClient, SqlSchema } from "effect/sql";

import { GAMES } from "../../src/play/games.ts";
import { type JobTimes, Play } from "../../src/play/service.ts";
import { fakeBackend, sessionOf, testLeaf } from "../support.ts";
import { coldId, lookerId, LOOKERS, ownerId, spread, walkerId, WALKERS } from "./shared.ts";

const port = Number(process.argv[2]);
const owners = Number(process.argv[3] ?? 20);
const cold = Number(process.argv[4] ?? 50);
if (!Number.isInteger(port) || ![owners, cold].every((n) => Number.isInteger(n) && n >= 0)) {
  console.error("Usage: bun apps/api/test/load/leaf.ts <port> [owners] [cold]");
  process.exit(2);
}

const { fetcher } = fakeBackend(
  Object.fromEntries([
    ...Array.from({ length: WALKERS }, (_, i) => [
      `w${i}`,
      () => Response.json(sessionOf(walkerId(i), `W${i}`, i % 4 === 3 ? null : "RECRUIT")),
    ]),
    ...Array.from({ length: owners }, (_, i) => [`o${i}`, () => Response.json(sessionOf(ownerId(i), `O${i}`))]),
    ...Array.from({ length: LOOKERS }, (_, i) => [`v${i}`, () => Response.json(sessionOf(lookerId(i), `V${i}`))]),
  ]),
);

/** Nanoseconds in milliseconds, to two places. */
const ms = (ns: number) => Number((ns / 1e6).toFixed(2));

/** What one phase measured, from its beginning to its end. */
class Phase {
  readonly began = performance.now();
  readonly cpu = process.cpuUsage();
  readonly loop = monitorEventLoopDelay({ resolution: 5 });
  readonly jobs: JobTimes[] = [];
  rss = 0;
  /** How far behind the yard longest unwritten was, in seconds, each second. */
  readonly behind: number[] = [];
  readonly name: string;
  constructor(name: string) {
    this.name = name;
    this.loop.enable();
  }
  /** Ends it: what it measured. */
  end() {
    this.loop.disable();
    return this.summary();
  }
  /** What it has measured so far. */
  summary() {
    const seconds = (performance.now() - this.began) / 1000;
    const cpu = process.cpuUsage(this.cpu);
    const kinds = Map.groupBy(this.jobs, (job) => `${job.game} ${job.kind}`);
    return {
      name: this.name,
      seconds: Number(seconds.toFixed(1)),
      event_loop_delay_ms: {
        p50: ms(this.loop.percentile(50)),
        p95: ms(this.loop.percentile(95)),
        p99: ms(this.loop.percentile(99)),
        max: ms(this.loop.max),
      },
      jobs: Object.fromEntries(
        [...kinds].map(([kind, jobs]) => [
          kind,
          {
            waited: spread(jobs.map((j) => j.waited)),
            sqlite: spread(jobs.map((j) => j.sqlite)),
            worked: spread(jobs.map((j) => j.worked)),
            total: spread(jobs.map((j) => j.waited + j.sqlite + j.worked)),
          },
        ]),
      ),
      cpu_of_one_core: `${(((cpu.user + cpu.system) / 1e6 / seconds) * 100).toFixed(0)}%`,
      rss_mib_most: Math.round(this.rss / 1024 / 1024),
      yard_behind_s: {
        first: this.behind[0] ?? null,
        most: Math.max(0, ...this.behind),
        last: this.behind.at(-1) ?? null,
      },
    };
  }
}

let phase = new Phase("start");
const ended: ReturnType<Phase["end"]>[] = [];
const leaf = testLeaf(
  {
    get now() {
      return Date.now();
    },
    set now(_: number) {},
  },
  fetcher,
  {},
  { meter: (times) => phase.jobs.push(times) },
);

// The yards: the owners' written a minute ago, and the cold ones eight hours ago, each as if its
// owner left then.
const yard = staged("large");
yard.seen = here(yard);
const keep = (owner: string, at: number) => {
  yard.at = at;
  const kept = FACTORY.encode(yard);
  return leaf.run(
    SqlClient.SqlClient.use(
      (sql) =>
        sql`INSERT INTO play_state (player_id, game, rev, state, updated_at) VALUES (${owner}, 'works', 1, ${kept}, ${at})`,
    ),
  );
};
for (let i = 0; i < owners; i++) {
  // oxlint-disable-next-line no-await-in-loop -- one after another
  await keep(ownerId(i), Date.now() - 60_000);
}
for (let i = 0; i < cold; i++) {
  // oxlint-disable-next-line no-await-in-loop -- one after another
  await keep(coldId(i), Date.now() - 8 * 3600_000);
}

const oldest = SqlSchema.findAll({
  Request: Schema.Void,
  Result: Schema.Struct({ at: Schema.NullOr(Schema.Number) }),
  execute: () =>
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql`SELECT MIN(updated_at) AS at FROM play_state WHERE game = 'works'`,
    ),
});
setInterval(() => {
  phase.rss = Math.max(phase.rss, process.memoryUsage().rss);
  void leaf.run(oldest(undefined).pipe(Effect.orDie)).then(([row]) => {
    if (row?.at != null) phase.behind.push(Math.round((Date.now() - row.at) / 1000));
    return undefined;
  });
}, 1000);

let swept: { began: number; took: number | null } | null = null;
const json = (body: unknown) => Effect.succeed(HttpServerResponse.jsonUnsafe(body));
const routes = Layer.mergeAll(
  HttpRouter.add(
    "POST",
    "/load/phase",
    Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
      ended.push(phase.end());
      phase = new Phase(new URL(request.url, "http://leaf").searchParams.get("name") ?? "unnamed");
      return json({ ok: true });
    }),
  ),
  HttpRouter.add(
    "POST",
    "/load/sweep",
    Effect.suspend(() => {
      const began = performance.now();
      const sweep = { began, took: null };
      swept = sweep;
      void leaf
        .run(Play.use((play) => Effect.flatten(play.tend(Object.values(GAMES)))))
        .then(() => Object.assign(sweep, { took: Number(((performance.now() - began) / 1000).toFixed(1)) }));
      return json({ ok: true });
    }),
  ),
  HttpRouter.add(
    "GET",
    "/load/swept",
    Effect.suspend(() => json({ done: swept?.took != null, took_s: swept?.took ?? null })),
  ),
  HttpRouter.add(
    "GET",
    "/load/report",
    Effect.suspend(() => json([...ended, phase.summary()])),
  ),
);

const served = await leaf.serve(port, routes);
console.log(JSON.stringify({ serving: served.origin, owners, cold }));

let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  void served.close().finally(() => process.exit(0));
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
