import { afterEach, expect, test } from "bun:test";

import type { Ctx } from "@sequoia-leaf/core";
import { isRecord } from "@sequoia-leaf/kit/net.ts";
import type { Answer } from "@sequoia-leaf/kit/play.ts";
import { type Reply, type Route, type Standin, standin } from "@sequoia-leaf/kit/standin.ts";
import { TOWN, type Town, type TownCommand, type TownNote, visitView } from "@sequoia-leaf/town";
import { COSY, freeSpot, type PetId } from "@sequoia-leaf/town/camp.ts";

import { gameContract } from "../../../contracts/game.ts";
import { GAMES, worksWaiting } from "./games.ts";
import {
  ask,
  campChanged,
  campEntered,
  doNow,
  lookAgain,
  lookAt,
  numbered,
  ok,
  onTown,
  openCamp,
  openTown,
  setOutAs,
  shown,
  town,
  visiting,
  waitingForLeaf,
} from "./leaf.ts";
import { keepPets, makePet } from "./pets.ts";

const ctx = (seed: number): Ctx => ({
  now: Date.UTC(2026, 10, 25, 12),
  player: { id: "me", guest: false },
  seed,
  room: 0,
  awards: [],
  postcards: {},
});
const own = TOWN.view(TOWN.create(ctx(1)), ctx(1));
const theirs = TOWN.create(ctx(2));
theirs.camp.first = "cat";
theirs.camp.placed.push({ n: theirs.made++, id: "well", x: 30, y: 30, t: 0, s: 0 });

/** A pet new to a camp, drawn as nothing (the page's pictures are not made here), by the fire. */
const come = (kind: PetId) =>
  makePet(kind, { sit: [], walk: [], walkR: [], sleep: null, glad: null }, { x: 100, y: 100 });

/** What Leaf sends a visitor of Alice's camp, as recorded from the real routes. */
const GAME: unknown = gameContract();
const aliceCamp = isRecord(GAME) ? GAME["GET /v1/game/play/{game}/of/{player}, a camp"] : undefined;

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

test("a camp visited shows who lives there as Leaf sends it, and nothing of the owner's count of callers", async () => {
  if (!isRecord(aliceCamp)) throw new Error("the contract has no camp visit");
  world = standin({
    "GET /v1/game/play/town": { status: 200, body: { rev: 1, now: "x", state: own } },
    "GET /v1/game/play/town/of/alice": { status: 200, body: aliceCamp["body"] },
    "GET /v1/game/people/alice": { status: 200, body: { id: "alice", name: "Alice", games: {}, played: 0, afk: 0 } },
  });
  expect(await openTown("me", () => undefined)).toBeNull();
  const looked = await openCamp("alice");
  if (typeof looked === "string") throw new Error(looked);
  lookAt(looked);
  expect([shown().pets, shown().camp.greeted]).toEqual([["glorp"], 0]);
});

test("a visitor staying while the owner greets their third caller sees the pet that moves in, the pets there staying where they are", async () => {
  // Bob's camp: the glorp he chose, two callers greeted, and the 24 things that bring a second pet.
  const bobs = TOWN.create(ctx(3));
  bobs.camp.first = "glorp";
  bobs.camp.greeted = 2;
  while (bobs.camp.placed.length < COSY)
    bobs.camp.placed.push({ n: bobs.made, id: "stump", x: bobs.made++, y: 40, t: 0, s: 0 });
  let rev = 4;
  world = standin({
    "GET /v1/game/play/town": { status: 200, body: { rev: 1, now: "x", state: own } },
    "GET /v1/game/play/town/of/bob": () => ({ status: 200, body: { rev, now: "x", state: visitView(bobs, 0) } }),
  });
  await openTown("me", () => undefined);
  const bob = await openCamp("bob", "Bob");
  if (typeof bob === "string") throw new Error(bob);
  lookAt(bob);
  // The pets drawn, kept as the camp scene keeps them on every change it hears.
  let drawn = keepPets([], shown().pets, come);
  let looking = true;
  onTown(() => {
    if (looking) drawn = keepPets(drawn, shown().pets, come);
  });
  const [glorp, cat] = drawn;
  if (!glorp || !cat || cat.kind !== "cat") throw new Error(`drawn: ${drawn.map((p) => p.kind).join()}`);
  // They have wandered off about the camp.
  [glorp.x, cat.x] = [33, 66];
  try {
    // Bob greets his third caller; Leaf keeps the camp at rev 5, and the camp's room says so.
    bobs.camp.greeted = 3;
    rev = 5;
    await campChanged(5);
    expect(drawn.map((p) => [p.kind, p.x])).toEqual([
      ["glorp", 33],
      ["cat", 66],
      ["fox", 100],
    ]);
    expect([drawn[0], drawn[1]]).toEqual([glorp, cat]);
    // Bob puts one of his 24 things away: a pet goes, and nobody else moves.
    bobs.camp.placed.pop();
    rev = 6;
    await campChanged(6);
    expect(drawn.map((p) => [p.kind, p.x])).toEqual([
      ["glorp", 33],
      ["cat", 66],
    ]);
  } finally {
    looking = false;
  }
});

test("a camp visited is opened beside the member's own and shown, and nothing but reads is sent", async () => {
  const w = standin({
    "GET /v1/game/play/town": { status: 200, body: { rev: 1, now: "x", state: own } },
    "GET /v1/game/play/town/of/bob": { status: 200, body: { rev: 4, now: "x", state: visitView(theirs, 0) } },
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
    "GET /v1/game/play/town/of/bob": { status: 200, body: { rev: 4, now: "x", state: visitView(theirs, 0) } },
    "GET /v1/game/play/town/of/carol": { status: 200, body: { rev: 2, now: "x", state: visitView(theirs, 0) } },
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
    "GET /v1/game/play/town/of/bob": { status: 200, body: { rev: 4, now: "x", state: visitView(theirs, 0) } },
    "GET /v1/game/play/town/of/carol": { status: 200, body: { rev: 2, now: "x", state: visitView(theirs, 0) } },
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

test("a camp visited is read again as the page comes into its room, after any read already on its way, and not while the page is out of sight", async () => {
  const late = Promise.withResolvers<Reply>();
  let reads = 0;
  const camp = { status: 200, body: { rev: 4, now: "x", state: visitView(theirs, 0) } };
  const w = standin({
    "GET /v1/game/play/town": { status: 200, body: { rev: 1, now: "x", state: own } },
    // The second read of Bob's camp left before the room's welcome, and comes back after it.
    "GET /v1/game/play/town/of/bob": () => (++reads === 2 ? late.promise : camp),
  });
  world = w;
  await openTown("me", () => undefined);
  const bob = await openCamp("bob", "Bob");
  if (typeof bob === "string") throw new Error(bob);
  lookAt(bob);
  const before = lookAgain(true);
  const entered = campEntered();
  late.resolve(camp);
  await Promise.all([before, entered]);
  expect(reads).toBe(3);
  // Out of sight, the page reads it as it comes back instead.
  Object.defineProperty(globalThis, "document", { value: { hidden: true }, configurable: true });
  try {
    await campEntered();
    await campChanged(9);
  } finally {
    Reflect.deleteProperty(globalThis, "document");
  }
  expect(reads).toBe(3);
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

test("the doors and the letter say what Leaf keeps of each game, never what a page left in this browser", async () => {
  const doors = { works: { waiting: "An order is filled and waiting at the gate.", till: 240 } };
  const state = TOWN.view(TOWN.create(ctx(1)), { ...ctx(1), postcards: doors });
  const w = standin({ "GET /v1/game/play/town": { status: 200, body: { rev: 1, now: "x", state } } });
  world = w;
  // What a Works page from before this left in the browser: the till as that page last saw it.
  w.store.setItem("town.postcard.works.v1", JSON.stringify({ waiting: "The yard is quiet.", till: 3, trophies: [] }));
  expect(await openTown("me", () => undefined)).toBeNull();
  expect(town().doors).toEqual(doors);
  expect(worksWaiting(town().doors)?.text).toBe("Your Works has 240 Coins waiting for you. Go in to collect them.");
  expect(GAMES.works.waiting(town().doors)).toBe("An order is filled and waiting at the gate.");
  expect(GAMES.table.waiting(town().doors)).toBe("The board is set out. One crab is uncounted.");
});

/** The town's rules as the Leaf before the doors ran them (main at 7cb91a56). */
const BEFORE_DOORS = "1e233b596ff9a1";

test("a town page with the doors, answered by a Leaf from before them, loads again rather than show a town without them", async () => {
  const before = Object.fromEntries(Object.entries(own).filter(([key]) => key !== "doors"));
  const answer = { status: 200, body: { rev: 1, now: "x", state: before, rules: BEFORE_DOORS } };
  world = standin({ "GET /v1/game/play/town": answer });
  expect(await openTown("me", () => undefined)).toBe("closed");
  expect(world.reloaded.count).toBe(1);
  // Loaded again within half a minute and answered by the same Leaf, it stays shut instead of loading again.
  expect(await openTown("me", () => undefined)).toBe("closed");
  expect(world.reloaded.count).toBe(1);
});
