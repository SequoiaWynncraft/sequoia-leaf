import { afterEach, expect, test } from "bun:test";

import type { Ctx } from "@sequoia-leaf/core";
import { type Standin, standin } from "@sequoia-leaf/kit/standin.ts";
import { TOWN, visitView } from "@sequoia-leaf/town";

import { ask, doNow, lookAt, openCamp, openTown, shown, town, visiting } from "./leaf.ts";

const ctx = (seed: number): Ctx => ({
  now: Date.UTC(2026, 10, 25, 12),
  player: { id: "me", guest: false },
  seed,
  room: 0,
  awards: [],
});
const own = TOWN.view(TOWN.create(ctx(1)), ctx(1));
const theirs = TOWN.create(ctx(2));
theirs.camp.first = "cat";
theirs.camp.placed.push({ n: theirs.made++, id: "well", x: 30, y: 30, t: 0, s: 0 });

let world: Standin | null = null;
afterEach(() => {
  lookAt(null);
  world?.done();
});

test("a camp visited is opened beside the member's own and shown, and nothing but reads is sent", async () => {
  const w = standin({
    "GET /v1/game/play/town": { status: 200, body: { rev: 1, now: "x", state: own } },
    "GET /v1/game/play/town/of/bob": { status: 200, body: { rev: 4, now: "x", state: visitView(theirs) } },
    "GET /v1/game/people/bob": { status: 200, body: { id: "bob", name: "Bob", games: {}, played: 0, afk: 0 } },
  });
  world = w;
  expect(await openTown("me", () => undefined)).toBeNull();
  const looked = await openCamp("bob");
  if (typeof looked === "string") throw new Error(looked);
  expect(visiting()).toBeNull();
  lookAt(looked);
  expect([visiting()?.id, visiting()?.name]).toEqual(["bob", "Bob"]);
  expect(shown().camp.placed).toEqual(theirs.camp.placed);
  expect(town()).toEqual(own);

  expect(doNow({ do: "toggle", n: 0 })).toEqual({ refused: "visiting" });
  expect(await ask({ do: "openChest" })).toEqual({ refused: "visiting" });
  await looked.play.refresh();
  looked.play.flush();
  await Promise.resolve();
  expect(w.sent.map((s) => `${s.method} ${s.path}`)).toEqual([
    "GET /v1/game/play/town",
    "GET /v1/game/play/town/of/bob",
    "GET /v1/game/people/bob",
    "GET /v1/game/play/town/of/bob",
  ]);
  lookAt(null);
  expect(shown()).toEqual(own);
});

test("a camp there is nothing of is the trouble nothing; a name already known is not asked", async () => {
  const w = standin({
    "GET /v1/game/play/town": { status: 200, body: { rev: 1, now: "x", state: own } },
    "GET /v1/game/play/town/of/nobody": { status: 404, body: { code: "nothing_to_visit" } },
  });
  world = w;
  await openTown("me", () => undefined);
  expect(await openCamp("nobody", "Nobody")).toBe("nothing");
  expect(w.sent.map((s) => s.path)).toEqual(["/v1/game/play/town", "/v1/game/play/town/of/nobody"]);
});
