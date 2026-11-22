import { Clock, Context, type Duration, Effect, Layer } from "effect";

/** A part of Leaf's stop, and when it began. */
interface Part {
  readonly name: string;
  readonly at: number;
}

/**
 * Leaf's stop, when a deploy asks for it (SIGTERM, or SIGINT). Leaf is taken down from the top, each
 * part once everything above it has stopped, and then the process exits. Until it has, the proxy in
 * front sends it requests that it can no longer answer, so the whole stop is meant to take a fraction
 * of a second. This keeps which part is stopping and how long each took, for the log.
 */
export class Stop extends Context.Service<
  Stop,
  {
    /** Everything above has stopped, and `part` begins to. The first part's beginning is the stop's. */
    readonly next: (part: string) => Effect.Effect<void>;
  }
>()("leaf/Stop") {
  /**
   * Keeps the stop. Put it underneath everything, so that its own end is the stop's: it logs
   * `stopped`, with how long each part took. Should the stop not be over `deadline` after it began,
   * it logs `stop_overdue`, with the part it is waiting for, and runs `overdue`.
   */
  static readonly layer = (options: { readonly deadline: Duration.Input; readonly overdue: Effect.Effect<void> }) =>
    Layer.effect(
      Stop,
      Effect.gen(function* () {
        const scope = yield* Effect.scope;
        let began: number | null = null;
        let stopping: Part | null = null;
        const tookMs: Record<string, number> = {};
        /** The part stopping now, if any, is done. */
        const done = (now: number) => {
          if (stopping !== null) tookMs[stopping.name] = now - stopping.at;
          stopping = null;
        };
        const late = Effect.sleep(options.deadline).pipe(
          Effect.andThen(
            Effect.suspend(() =>
              Effect.logError("stop_overdue").pipe(
                Effect.annotateLogs({ waiting_for: stopping?.name ?? null, took_ms: { ...tookMs } }),
              ),
            ),
          ),
          Effect.andThen(options.overdue),
        );
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            if (began === null) return;
            done(now);
            yield* Effect.logInfo("stopped").pipe(Effect.annotateLogs({ total_ms: now - began, took_ms: tookMs }));
          }),
        );
        return Stop.of({
          next: (part) =>
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis;
              if (began === null) {
                began = now;
                // In the stop's own scope, which closes last: the deadline lasts as long as the stop.
                yield* Effect.forkIn(late, scope);
              }
              done(now);
              stopping = { name: part, at: now };
            }),
        });
      }),
    );

  /** Marks, on top of a layer, where its part of the stop begins: once everything above it has stopped. */
  static readonly begins = (part: string) =>
    Layer.effectDiscard(
      Effect.gen(function* () {
        const stop = yield* Stop;
        yield* Effect.addFinalizer(() => stop.next(part));
      }),
    );
}
