import { monitorEventLoopDelay } from "node:perf_hooks";

import { BunHttpServer } from "@effect/platform-bun";
import { Clock, Duration, Effect, FileSystem, Layer, Metric, Option } from "effect";
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";
import { PrometheusMetrics } from "effect/observability";

import { AppConfig } from "./config.ts";
import { GAMES } from "./play/games.ts";
import { PlayStore } from "./play/store.ts";

// What Leaf counts, in Prometheus text on a listener of its own (`metrics/listener.ts`). Series that
// mean what one of the other Sequoia services' means have its name and labels (sequoia-backend's
// `docs/metrics.md`); Leaf's own start `leaf_`. No label holds a player, a yard or free text.

/** Durations of requests and jobs, in seconds: a millisecond up to ten seconds. */
const SECONDS = [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/**
 * One series of a metric for each set of labels, made once: a call site gives its labels in the same
 * order every time.
 */
export function seriesOf<I, S>(
  metric: Metric.Metric<I, S>,
): (labels: Readonly<Record<string, string>>) => Metric.Metric<I, S> {
  const made = new Map<string, Metric.Metric<I, S>>();
  return (labels) => {
    const key = Object.values(labels).join("\u0000");
    let one = made.get(key);
    if (one === undefined) {
      one = Metric.withAttributes(metric, labels);
      made.set(key, one);
    }
    return one;
  };
}

/** Requests answered, by method, route template (`unmatched` for none) and status; the live connection's upgrade is one. */
export const httpRequests = seriesOf(
  Metric.counter("http_requests_total", { description: "HTTP requests answered", incremental: true }),
);
/** How long each request took until its answer's head, by the same labels. */
export const httpDuration = seriesOf(
  Metric.histogram("http_request_duration_seconds", {
    description: "Time from a request to its answer's head",
    boundaries: SECONDS,
  }),
);

const jobRuns = seriesOf(
  Metric.counter("background_job_runs_total", { description: "Runs of a scheduled job", incremental: true }),
);
const jobFailures = seriesOf(
  Metric.counter("background_job_failures_total", {
    description: "Runs of a scheduled job that failed",
    incremental: true,
  }),
);
const jobLastSuccess = seriesOf(
  Metric.gauge("background_job_last_success_timestamp_seconds", {
    description: "When a scheduled job last succeeded, in Unix seconds; 0 until it has",
  }),
);

/** A run of a scheduled job: it did its work, or it had none to do and does not count, or it failed. */
export type JobRun = "done" | "idle";

/**
 * Counts a run of the scheduled job `name`, as the other services count theirs: each run that did
 * something or failed, each failure, and when it last succeeded (0 until it has; nothing at all
 * until its first run).
 */
export const jobRun = (name: string, run: JobRun | "failed") =>
  Effect.gen(function* () {
    if (run === "idle") return;
    const labels = { name };
    yield* Metric.update(jobRuns(labels), 1);
    if (run === "failed") {
      yield* Metric.update(jobFailures(labels), 1);
      // Read, the series is made, at 0, if the job has never succeeded.
      yield* Metric.value(jobLastSuccess(labels));
      return;
    }
    yield* Metric.update(jobLastSuccess(labels), (yield* Clock.currentTimeMillis) / 1000);
  });

/** Sets when a job last succeeded from what it left behind, as Leaf starts: a snapshot taken before it did. */
export const jobSucceededAt = (name: string, at: number) => Metric.update(jobLastSuccess({ name }), at / 1000);

/** What became of a play command: done, refused by the rules (or for Coins or Leaf), failed, or its batch turned away. */
export type CommandOutcome = "taken" | "refused" | "failed" | "slow" | "invalid";
/** Play commands by game and what became of them. */
export const playCommands = seriesOf(
  Metric.counter("leaf_play_commands_total", { description: "Play commands, by game and outcome", incremental: true }),
);

/** Where a play job's time went: waiting its turn, running the state on, reading and writing its text, in SQLite, and the rest. */
export type JobPhase = "queue" | "simulation" | "codec" | "sqlite" | "other";
/** A play job's time in each phase, by game and kind of job (open, visit, batch, tend). */
export const playJobSeconds = seriesOf(
  Metric.histogram("leaf_play_job_seconds", {
    description: "Time a play job spent in each phase",
    boundaries: [0.0001, 0.00025, 0.0005, ...SECONDS],
  }),
);

const playOverdue = seriesOf(
  Metric.gauge("leaf_play_overdue_seconds", {
    description: "How long the state due a tend longest has been due, by game; 0 when none is",
  }),
);

/** Pages' reports of their own failures, by page and kind (`/v1/game/page-errors`). */
export const pageErrors = seriesOf(
  Metric.counter("leaf_page_errors_total", { description: "Failures pages reported", incremental: true }),
);
/** Pages' reports let go of past the limits, by which limit: the player's, or Leaf's overall. */
export const pageErrorsDropped = seriesOf(
  Metric.counter("leaf_page_errors_dropped_total", {
    description: "Page reports dropped past a limit",
    incremental: true,
  }),
);

/** Live: openings turned away before their upgrade, by the code they were refused with. */
export const liveRefused = seriesOf(
  Metric.counter("leaf_live_refused_total", { description: "Live openings refused, by reason", incremental: true }),
);
/** Live's figures, read where Live keeps them (`readOnAsk`). */
export const live = {
  players: Metric.gauge("leaf_live_players", { description: "Players in Live, connected or in their grace" }),
  connections: Metric.gauge("leaf_live_connections", { description: "Open live connections" }),
  rooms: Metric.gauge("leaf_live_rooms", { description: "Rooms with anybody in them" }),
  opened: Metric.counter("leaf_live_opened_total", { description: "Live connections opened" }),
  closed: seriesOf(
    Metric.counter("leaf_live_closed_total", {
      description: "Live connections closed: by the page, dropped, or by Leaf",
    }),
  ),
  framesDropped: Metric.counter("leaf_live_frames_dropped_total", {
    description: "Frames from pages that could not be read or were over an allowance",
  }),
  handoffs: Metric.counter("leaf_live_handoffs_total", {
    description: "Openings that handed a player over from one of their pages to another",
  }),
};

const databaseBytes = seriesOf(Metric.gauge("leaf_database_bytes", { description: "Size of the database's files" }));

const loop = {
  p50: Metric.gauge("leaf_event_loop_delay_p50_seconds", { description: "Median event-loop delay over the last 15 s" }),
  p99: Metric.gauge("leaf_event_loop_delay_p99_seconds", {
    description: "99th percentile event-loop delay over the last 15 s",
  }),
  max: Metric.gauge("leaf_event_loop_delay_max_seconds", {
    description: "Longest event-loop delay over the last 15 s",
  }),
};

const process$ = {
  cpu: Metric.counter("process_cpu_seconds_total", { description: "CPU time used, user and system" }),
  resident: Metric.gauge("process_resident_memory_bytes", { description: "Resident memory" }),
  virtual: Metric.gauge("process_virtual_memory_bytes", { description: "Virtual memory" }),
  openFds: Metric.gauge("process_open_fds", { description: "Open file descriptors" }),
  maxFds: Metric.gauge("process_max_fds", { description: "Most file descriptors the process may open" }),
  threads: Metric.gauge("process_threads", { description: "Threads" }),
  started: Metric.gauge("process_start_time_seconds", { description: "When the process started, in Unix seconds" }),
};

const NO_UPDATE = { update: () => {}, modify: () => {} };

/**
 * Gauges and counters whose values are read where they are kept, each time the metrics are asked
 * for, rather than updated as they change: for as long as the scope lasts.
 */
export const readOnAsk = (
  gauges: ReadonlyArray<readonly [Metric.Gauge<number>, () => number]>,
  counters: ReadonlyArray<readonly [Metric.Counter<number>, () => number]> = [],
) =>
  Effect.gen(function* () {
    const context = yield* Effect.context();
    const registered = [
      ...gauges.map(([m, read]) => Metric.registerUnsafe(m, context, { get: () => ({ value: read() }), ...NO_UPDATE })),
      ...counters.map(([m, read]) =>
        Metric.registerUnsafe(m, context, { get: () => ({ count: read() }), ...NO_UPDATE }),
      ),
    ];
    yield* Effect.addFinalizer(() => Effect.sync(() => registered.forEach((r) => r.remove())));
  });

/** Nanoseconds in seconds; none for no reading. */
const seconds = (ns: number) => (Number.isFinite(ns) ? ns / 1e9 : 0);

/** How often the event loop's delay is read and begun again: each window is one of Prometheus's scrapes. */
const LOOP_WINDOW = Duration.seconds(15);

/**
 * What is measured as Leaf runs, rather than as things happen: the event loop's delay, read over
 * each `LOOP_WINDOW` (Bun samples it every 10 ms), and the process's CPU and memory, read when they
 * are asked for.
 */
export const RuntimeMetrics = Layer.effectDiscard(
  Effect.gen(function* () {
    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();
    yield* Effect.addFinalizer(() => Effect.sync(() => delay.disable()));
    const read = Effect.gen(function* () {
      yield* Metric.update(loop.p50, seconds(delay.percentile(50)));
      yield* Metric.update(loop.p99, seconds(delay.percentile(99)));
      yield* Metric.update(loop.max, seconds(delay.max));
      delay.reset();
    });
    yield* Effect.forkScoped(Effect.forever(Effect.andThen(Effect.sleep(LOOP_WINDOW), read)));
    const started = Date.now() / 1000 - process.uptime();
    yield* readOnAsk(
      [
        [process$.resident, () => process.memoryUsage.rss()],
        [process$.started, () => started],
      ],
      [
        [
          process$.cpu,
          () => {
            const used = process.cpuUsage();
            return (used.user + used.system) / 1e6;
          },
        ],
      ],
    );
  }),
);

/** The process's figures Linux keeps in `/proc`: its virtual memory, threads and file descriptors. None elsewhere. */
const fromProc = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  // Fields 20 and 23 of `stat` (threads, virtual memory), counted after the command's name in brackets.
  const stat = (yield* fs.readFileString("/proc/self/stat")).split(") ")[1]?.split(" ") ?? [];
  yield* Metric.update(process$.threads, Number(stat[17]));
  yield* Metric.update(process$.virtual, Number(stat[20]));
  yield* Metric.update(process$.openFds, (yield* fs.readDirectory("/proc/self/fd")).length);
  const limit = /^Max open files\s+(\d+)/m.exec(yield* fs.readFileString("/proc/self/limits"))?.[1];
  if (limit !== undefined) yield* Metric.update(process$.maxFds, Number(limit));
}).pipe(Effect.ignore);

/** The size of a file, if it is there. */
const sizeOf = (path: string) =>
  FileSystem.FileSystem.use((fs) => fs.stat(path)).pipe(
    Effect.map((info) => Number(info.size)),
    Effect.option,
  );

/**
 * Leaf's metrics in Prometheus text, with what is read when they are asked for brought up to date
 * first: how far behind tending each game's states is, the database's files and the process.
 */
export const metricsText = Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis;
  const firstDue = yield* PlayStore.use((store) => store.firstDue);
  for (const played of Object.values(GAMES)) {
    if (!played.tends) continue;
    const due = firstDue.get(played.id);
    yield* Metric.update(playOverdue({ game: played.id }), due === undefined ? 0 : Math.max(0, now - due) / 1000);
  }
  const { databasePath } = yield* AppConfig;
  if (databasePath !== ":memory:") {
    for (const [file, path] of [
      ["database", databasePath],
      ["wal", `${databasePath}-wal`],
    ] as const) {
      yield* Metric.update(
        databaseBytes({ file }),
        Option.getOrElse(yield* sizeOf(path), () => 0),
      );
    }
  }
  yield* fromProc;
  return yield* PrometheusMetrics.format();
});

/**
 * Leaf's metrics at `GET /metrics` on a listener of its own (`LEAF_METRICS_BIND`, `0.0.0.0:9095` by
 * default): no image publishes its port and Traefik routes nothing to it, so only Prometheus, on the
 * server's network, reaches it. It serves nothing else, and Leaf does not start without it.
 */
export const MetricsListener = Layer.unwrap(
  Effect.gen(function* () {
    const { metrics } = yield* AppConfig;
    // A handler of its own, not a router: the app's router is never shared with this listener.
    const answer = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (request.method !== "GET" || request.url !== "/metrics") return HttpServerResponse.empty({ status: 404 });
      return HttpServerResponse.text(yield* metricsText, { contentType: "text/plain; version=0.0.4; charset=utf-8" });
    });
    return HttpServer.serve(answer).pipe(
      Layer.provide(BunHttpServer.layer({ hostname: metrics.hostname, port: metrics.port })),
    );
  }),
);
