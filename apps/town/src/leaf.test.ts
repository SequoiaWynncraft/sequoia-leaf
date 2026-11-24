import { afterEach, expect, test } from "bun:test";

import type { Ctx } from "@sequoia-leaf/core";
import { isRecord } from "@sequoia-leaf/kit/net.ts";
import type { Answer } from "@sequoia-leaf/kit/play.ts";
import { type Route, type Standin, standin } from "@sequoia-leaf/kit/standin.ts";
import { TOWN, type Town, type TownCommand, type TownNote, visitView } from "@sequoia-leaf/town";
import { freeSpot } from "@sequoia-leaf/town/camp.ts";

import {
  ask,
  doNow,
  lookAgain,
  lookAt,
  numbered,
  ok,
  openCamp,
  openTown,
  setOutAs,
  shown,
  town,
  visiting,
  waitingForLeaf,
} from "./leaf.ts";

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
/** Until Leaf has answered everything sent, a turn of the page's clock at a time, for a while at most. */
async function answeredAll(turns = 50): Promise<void> {
  if (!waitingForLeaf()) return;
  if (turns <= 0) throw new Error("Leaf never answered");
  await new Promise((go) => setTimeout(go, 0));
  return answeredAll(turns - 1);
}
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

test("a camp left is put away: its copy hears the page no more, and is read no more", async () => {
  const w = standin({
    "GET /v1/game/play/town": { status: 200, body: { rev: 1, now: "x", state: own } },
    "GET /v1/game/play/town/of/bob": { status: 200, body: { rev: 4, now: "x", state: visitView(theirs) } },
    "GET /v1/game/play/town/of/carol": { status: 200, body: { rev: 2, now: "x", state: visitView(theirs) } },
  });
  world = w;
  expect(await openTown("me", () => undefined)).toBeNull();
  const before = w.hearing();
  const bob = await openCamp("bob", "Bob");
  const carol = await openCamp("carol", "Carol");
  if (typeof bob === "string" || typeof carol === "string") throw new Error("not opened");
  lookAt(bob);
  // On from one camp to the next, and then home: each camp left goes with it.
  lookAt(carol);
  expect(w.hearing()).toBe(before + 1);
  lookAt(null);
  expect(w.hearing()).toBe(before);
  const asked = w.sent.length;
  await Promise.all([bob.play.refresh(), carol.play.refresh()]);
  expect(w.sent.length).toBe(asked);
});

test("the camp looked at is read again while the member is in it, and not once they are walking off from it", async () => {
  const w = standin({
    "GET /v1/game/play/town": { status: 200, body: { rev: 1, now: "x", state: own } },
    "GET /v1/game/play/town/of/bob": { status: 200, body: { rev: 4, now: "x", state: visitView(theirs) } },
    "GET /v1/game/play/town/of/carol": { status: 200, body: { rev: 2, now: "x", state: visitView(theirs) } },
  });
  world = w;
  await openTown("me", () => undefined);
  const bob = await openCamp("bob", "Bob");
  if (typeof bob === "string") throw new Error(bob);
  lookAt(bob);
  await lookAgain(true);
  // On the way to Carol's: hers is opened, Bob's still shown until the walk is over, and read no more.
  const carol = await openCamp("carol", "Carol");
  if (typeof carol === "string") throw new Error(carol);
  await lookAgain(false);
  lookAt(carol);
  await lookAgain(true);
  expect(w.sent.map((s) => s.path)).toEqual([
    "/v1/game/play/town",
    "/v1/game/play/town/of/bob",
    "/v1/game/play/town/of/bob",
    "/v1/game/play/town/of/carol",
    "/v1/game/play/town/of/carol",
  ]);
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

/**
 * Leaf keeping the member's town with the real rules, as the play service does: it reads the
 * town, and answers a batch command by command. `elsewhere` is another page of the member's doing
 * a command first.
 */
function townLeaf(): { routes: Record<string, Route>; elsewhere: (c: TownCommand) => void; town: () => Town } {
  let s = TOWN.create(ctx(1));
  s.camp.tray["stump"] = 1;
  s.camp.tray["gnome"] = 1;
  let rev = 0;
  const apply = (c: TownCommand): Answer<TownNote> => {
    const did = TOWN.apply(s, c, ctx(1));
    if ("refused" in did) return { refused: did.refused };
    s = did.state;
    return { notes: [...did.notes] };
  };
  const state = () => ({ rev, now: "x", state: TOWN.view(s, ctx(1)) });
  return {
    routes: {
      "GET /v1/game/play/town": () => ({ status: 200, body: state() }),
      "POST /v1/game/play/town": (sent) => {
        const commands: unknown[] = isRecord(sent.body) && Array.isArray(sent.body.commands) ? sent.body.commands : [];
        const results = commands.map((raw) => {
          const id = isRecord(raw) ? String(raw.id) : "";
          const c = TOWN.command(raw);
          const answer = c ? apply(c) : { refused: "unreadable" };
          return "refused" in answer ? { id, refused: answer.refused } : { id, notes: answer.notes };
        });
        rev++;
        return { status: 200, body: { ...state(), results, purse: { coins: 0, leaf: 0, version: rev } } };
      },
    },
    elsewhere(c) {
      if ("refused" in apply(c)) throw new Error(`${c.do} refused`);
      rev++;
    },
    town: () => s,
  };
}

// Astra 2: two pages of the member's see the same next number; one sets out a stump; before the
// other hears of it, the other sets out a gnome and puts it away. That page named the gnome by the
// number its own copy would give it, which Leaf had given the stump: the stump went. What follows a
// thing set out now names the number Leaf gives it, and nothing is sent for it until Leaf has.
test("a thing set out is named by the number Leaf gives it, not the one the page would", async () => {
  const leaf = townLeaf();
  world = standin(leaf.routes);
  expect(await openTown("me", () => undefined)).toBeNull();
  const near = { x: 30, y: 24 };
  const stumpAt = freeSpot(leaf.town().camp.placed, "stump", near);
  if (!stumpAt) throw new Error("no room for the stump");
  leaf.elsewhere({ do: "setOut", thing: "stump", ...stumpAt, t: 0 });
  const stump = leaf.town().camp.placed.find((p) => p.id === "stump")?.n;

  // Somewhere else in the camp, so that Leaf takes both.
  const gnomeAt = freeSpot(town().camp.placed, "gnome", { x: near.x + 8, y: near.y });
  if (!gnomeAt) throw new Error("no room for the gnome");
  const did = doNow({ do: "setOut", thing: "gnome", ...gnomeAt, t: 0 });
  if (!ok(did)) throw new Error("not set out");
  const mine = setOutAs(did);
  if (mine === null) throw new Error("no number for the gnome");
  // The page's own number for it is no number Leaf gives, and nothing is sent naming it.
  expect(mine).toBeLessThan(0);
  expect(town().camp.placed.some((p) => p.n === mine && p.id === "gnome")).toBe(true);
  expect(doNow({ do: "putAway", n: mine })).toBeNull();

  const n = await numbered(mine);
  expect(n).not.toBeNull();
  expect(n).not.toBe(stump);
  expect(town().camp.placed.find((p) => p.n === n)?.id).toBe("gnome");
  if (n === null) return;
  expect(ok(doNow({ do: "putAway", n }))).toBe(true);
  await answeredAll();
  // The camp's own stump and the other page's are both still out; the gnome is back in Storage.
  expect(leaf.town().camp.placed.filter((p) => p.id === "stump")).toHaveLength(2);
  expect(leaf.town().camp.placed.map((p) => p.id)).not.toContain("gnome");
  expect(leaf.town().camp.tray["gnome"]).toBe(1);
});
