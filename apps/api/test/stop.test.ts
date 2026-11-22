import { describe, expect, it } from "bun:test";

import { CLOSE, playerId } from "@sequoia-leaf/core";
import { Deferred, Effect, Exit, Fiber, Layer, Logger, Scope } from "effect";

import { Stop } from "../src/stop.ts";
import { LiveClient } from "./live-client.ts";
import { fakeBackend, rejection, sessionOf, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const clock = {
  get now() {
    return Date.now();
  },
  set now(_: number) {},
};

/** What was logged, as Leaf's log has it, and a layer that keeps it. */
function logs() {
  const lines: { message: unknown; annotations: Record<string, unknown> }[] = [];
  const logger = Logger.map(Logger.formatStructured, (line) => {
    lines.push({ message: line.message, annotations: line.annotations });
  });
  return { lines, layer: Logger.layer([logger]) };
}

describe("when a deploy stops Leaf", () => {
  // A deploy's proxy sends the old process half of all requests until it has exited, and every one
  // fails meanwhile: Leaf must be gone at once, not wait for what players hold open.
  it("ends the event streams, closes live connections as restarting, and stops within half a second", async () => {
    const { fetcher } = fakeBackend({ "alice-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")) });
    const services = testLeaf(clock, fetcher);
    const server = await services.serve();
    try {
      const stream = await fetch(`${server.origin}/v1/me/events/stream`, {
        headers: { Authorization: "Bearer alice-token" },
      });
      expect(stream.status).toBe(200);
      expect(stream.headers.get("content-type")).toStartWith("text/event-stream");
      const live = await LiveClient.open(server.origin, { bearer: "alice-token" });
      await live.welcome();

      const asked = performance.now();
      await server.close();
      const took = performance.now() - asked;

      expect(took).toBeLessThan(500);
      // Ended, not cut (its text would reject): the client reconnects, to the next Leaf.
      expect(await stream.text()).toStartWith("id: ");
      expect(await live.ended(100)).toEqual({ code: CLOSE.restart, reason: "restart" });
      expect(await rejection(fetch(`${server.origin}/healthz`))).toBeInstanceOf(Error);
    } finally {
      await services.dispose();
    }
  });
});

describe("Leaf's stop", () => {
  it("says how long each part took, once all have stopped", async () => {
    const { lines, layer } = logs();
    const leaf = Stop.begins("top").pipe(
      Layer.provideMerge(Stop.begins("bottom")),
      Layer.provide(Stop.layer({ deadline: "1 second", overdue: Effect.die("not overdue") })),
    );
    await Effect.runPromise(Effect.scoped(Layer.build(leaf)).pipe(Effect.provide(layer)));

    expect(lines).toEqual([
      {
        message: "stopped",
        annotations: { total_ms: expect.any(Number), took_ms: { top: expect.any(Number), bottom: expect.any(Number) } },
      },
    ]);
  });

  it("gives up after its deadline, saying what it was waiting for", async () => {
    const { lines, layer } = logs();
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const overdue = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        // A part that does not stop until it is let go.
        const stuck = Layer.effectDiscard(Effect.addFinalizer(() => Deferred.await(release)));
        const leaf = Stop.begins("quick").pipe(
          Layer.provideMerge(Stop.begins("stuck")),
          Layer.provideMerge(stuck),
          Layer.provide(Stop.layer({ deadline: "50 millis", overdue: Deferred.succeed(overdue, undefined) })),
        );
        const scope = yield* Scope.make();
        yield* Layer.buildWithScope(leaf, scope);
        const stopping = yield* Effect.forkChild(Scope.close(scope, Exit.void));
        yield* Deferred.await(overdue);
        const atDeadline = [...lines];
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(stopping);
        return atDeadline;
      }).pipe(Effect.provide(layer)),
    );

    expect(outcome).toEqual([
      { message: "stop_overdue", annotations: { waiting_for: "stuck", took_ms: { quick: expect.any(Number) } } },
    ]);
  });
});
