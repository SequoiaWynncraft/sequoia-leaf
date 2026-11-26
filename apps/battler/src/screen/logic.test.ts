import { describe, expect, test } from "bun:test";

import {
  buy,
  choose,
  type FigureId,
  type ItemId,
  move,
  type Piece,
  type RoomRecord,
  type Run,
  startRun,
  traitNumber,
} from "@sequoia-leaf/raid";
import { REGULARS } from "@sequoia-leaf/raid/content/rooms.ts";

import {
  acrossName,
  arrivalOf,
  canBuy,
  combosWithHeld,
  fightTitle,
  handing,
  looseComponents,
  membersOf,
  nudgeFor,
  type NudgeId,
  ownTraitCount,
  pieceNumbers,
  plainNumbers,
  rackHas,
  reachOf,
  reachOfOffer,
  recipesOf,
  savings,
  steppedUp,
  stepsOf,
  streakName,
  streakNow,
  streakRule,
  TraitWatch,
  watchersOf,
  whereIs,
} from "./logic.ts";

/** A run past its first pick, with the starter on the front row. */
function begun(seed = 5): Run {
  const run = startRun(seed);
  choose(run, 0);
  return run;
}
/** Puts a figure straight onto the bench or the board, as if it had been bought. */
function put(run: Run, kind: FigureId, on: "board" | "bench", at: number, items: ItemId[] = []): Piece {
  const piece: Piece = { id: run.nextId++, kind, stars: 1, items, fed: 0 };
  if (on === "board") run.board[at] = piece;
  else run.bench[at] = piece;
  return piece;
}

describe("where a held figure may go", () => {
  test("a figure on the board may go to any other seat, and to the bench", () => {
    const run = begun();
    const reach = reachOf(run, { on: "board", at: 3 });
    expect(reach.seats.length).toBe(27);
    expect(reach.seats).not.toContain(3);
    expect(reach.swaps).toEqual([]);
    expect(reach.slots.length).toBe(9);
  });
  test("a figure on the bench may only take a free seat while there is room on the board", () => {
    const run = begun();
    put(run, "worm", "bench", 0);
    // Level one fields one, and the starter is already there.
    const full = reachOf(run, { on: "bench", at: 0 });
    expect(full.seats).toEqual([]);
    expect(full.swaps).toEqual([3]);
    run.level = 2;
    const room = reachOf(run, { on: "bench", at: 0 });
    expect(room.seats.length).toBe(27);
    expect(room.swaps).toEqual([3]);
    expect(room.slots).not.toContain(0);
  });
  test("what is lit is what the rules allow", () => {
    const run = begun();
    put(run, "worm", "bench", 0);
    for (const level of [1, 2]) {
      run.level = level;
      const reach = reachOf(run, { on: "bench", at: 0 });
      for (let seat = 0; seat < 28; seat++) {
        const copy: Run = structuredClone(run);
        const allowed = move(copy, { on: "bench", at: 0 }, { on: "board", at: seat }).ok;
        expect(reach.seats.includes(seat) || reach.swaps.includes(seat)).toBe(allowed);
      }
    }
  });
  test("a figure on the bench may change places with another on the bench", () => {
    const run = begun();
    put(run, "worm", "bench", 0);
    put(run, "moth", "bench", 4);
    const reach = reachOf(run, { on: "bench", at: 0 });
    expect(reach.slotSwaps).toEqual([4]);
    expect(reach.slots.length).toBe(7);
  });
  test("an offer straight off the stall needs a free hollow, and a free seat needs room on the board", () => {
    const run = begun();
    expect(reachOfOffer(run, 0).slots.length).toBe(9);
    expect(reachOfOffer(run, 0).seats).toEqual([]);
    run.level = 2;
    expect(reachOfOffer(run, 0).seats.length).toBe(27);
    for (let i = 0; i < 9; i++) put(run, "worm", "bench", i);
    expect(reachOfOffer(run, 0).slots).toEqual([]);
    expect(reachOfOffer(run, 0).seats).toEqual([]);
  });
});

describe("whether an offer can be bought", () => {
  test("it has to be paid for", () => {
    const run = begun();
    run.acorns = 0;
    expect(run.stall.some((_, i) => canBuy(run, i))).toBe(false);
    run.acorns = 5;
    expect(run.stall.every((kind, i) => kind === null || canBuy(run, i))).toBe(true);
  });
  test("with a full bench, only a third of a kind", () => {
    const run = begun();
    run.acorns = 20;
    const kind = run.stall[0];
    if (!kind) throw new Error("the stall is empty");
    for (let i = 0; i < 9; i++) put(run, kind === "rock" ? "worm" : "rock", "bench", i);
    expect(canBuy(run, 0)).toBe(false);
    run.bench[0] = { id: run.nextId++, kind, stars: 1, items: [], fed: 0 };
    run.bench[1] = { id: run.nextId++, kind, stars: 1, items: [], fed: 0 };
    expect(canBuy(run, 0)).toBe(true);
    expect(buy(run, 0).ok).toBe(true);
  });
  test("an empty place on the stall cannot be bought", () => {
    const run = begun();
    run.stall[2] = null;
    expect(canBuy(run, 2)).toBe(false);
  });
});

/** A Finch (a Feather and a Slinger) holding these. */
const finch = (items: ItemId[]): Pick<Piece, "kind" | "items"> => ({ kind: "finch", items });

describe("handing an item over", () => {
  test("a first component is simply held", () => {
    expect(handing(finch([]), "thorn")).toEqual({ can: true, forged: null });
  });
  test("a second component forges with the first, and says with what", () => {
    expect(handing(finch(["thorn"]), "plume")).toEqual({ can: true, forged: "wasptail", with: "thorn" });
    expect(handing(finch(["hoard", "bark"]), "bark")).toEqual({ can: true, forged: "stump", with: "bark" });
  });
  test("a figure holding three finished items takes no more", () => {
    expect(handing(finch(["hoard", "stump", "quilt"]), "thorn")).toEqual({ can: false });
  });
  test("an emblem is simply held, and not by a figure of its kin already, so that figure is not lit to take it", () => {
    expect(handing(finch(["thorn"]), "crabcharm")).toEqual({ can: true, forged: null });
    expect(handing(finch([]), "feathercharm")).toEqual({ can: false });
    expect(handing(finch(["crabcharm"]), "crabcharm")).toEqual({ can: false });
  });
  test("every component makes something with each of the five", () => {
    const made = recipesOf("glowcap");
    expect(made.map((r) => r.with)).toEqual(["thorn", "plume", "glowcap", "bark", "chestnut"]);
    expect(made.map((r) => r.makes)).toEqual(["glowthorn", "mothlantern", "fairyring", "lichen", "stewpot"]);
  });
  test("what a component makes with what the party holds: the rack and loose components on figures, once each", () => {
    const run = begun();
    run.items = ["thorn", "thorn", "hoard", "bark"];
    put(run, "worm", "bench", 0, ["plume"]);
    expect(looseComponents(run)).toEqual(["thorn", "thorn", "bark", "plume"]);
    // The thorn at place 0, against everything else that is held.
    expect(combosWithHeld(run, "thorn", 0)).toEqual([
      { with: "thorn", makes: "blackthorn" },
      { with: "bark", makes: "hedgehog" },
      { with: "plume", makes: "wasptail" },
    ]);
    // A component not on the rack yet is tried against all of it.
    expect(combosWithHeld(run, "chestnut").map((c) => c.makes)).toEqual(["conker", "hollowlog", "honeycake"]);
  });
});

describe("the purse as it is counted", () => {
  test("every ten held is a pile that pays one, up to five", () => {
    const run = begun();
    run.acorns = 0;
    expect(savings(run)).toEqual({ per: 10, most: 5, piles: 0, loose: 0, pays: 0, toNext: 10 });
    run.acorns = 23;
    expect(savings(run)).toEqual({ per: 10, most: 5, piles: 2, loose: 3, pays: 2, toNext: 7 });
    run.acorns = 77;
    expect(savings(run)).toEqual({ per: 10, most: 5, piles: 5, loose: 27, pays: 5, toNext: 0 });
  });
  test("with Deep Pockets a pile is five, and there may be six", () => {
    const run = begun();
    run.boons.push("deeppockets");
    run.acorns = 23;
    expect(savings(run)).toEqual({ per: 5, most: 6, piles: 4, loose: 3, pays: 4, toNext: 2 });
  });
});

describe("the streak as it is told", () => {
  test("the rule is said from the table it pays from", () => {
    expect(streakRule()).toBe(
      "Win or lose 3 or more rooms in a row for extra acorns each room: 1 at 3 or 4, 2 at 5 or more.",
    );
  });
  test("a streak is told from 2, won or lost", () => {
    const run = begun();
    run.streak = 1;
    expect(streakNow(run)).toBeNull();
    run.streak = 3;
    expect(streakNow(run)).toBe("You have won 3 rooms in a row.");
    run.streak = -2;
    expect(streakNow(run)).toBe("You have lost 2 rooms in a row.");
    expect([streakName(3), streakName(-2)]).toEqual(["Win streak 3", "Loss streak 2"]);
  });
});

describe("a trait switching on", () => {
  test("only traits whose step has gone up are told", () => {
    const run = begun();
    run.level = 4;
    run.board.fill(null);
    put(run, "emberkit", "board", 0);
    const before = stepsOf(run);
    expect(steppedUp(before, run)).toEqual([]);
    put(run, "crab7", "board", 1);
    // Emberkit and Crab #7 are both Fangs: that is two.
    expect(steppedUp(before, run)).toEqual([{ trait: "fang", step: 1 }]);
    expect(steppedUp(stepsOf(run), run)).toEqual([]);
  });

  test("a second Fang moved onto the board switches Fang on, though every answer from Leaf is a fresh copy of the run", () => {
    const run = begun();
    run.level = 4;
    run.board.fill(null);
    put(run, "emberkit", "board", 0);
    put(run, "crab7", "bench", 0);
    const watch = new TraitWatch();
    // The page's copy as Leaf last gave it, and as the move left it: another object, the same run.
    const before = structuredClone(run);
    expect(watch.look(before, 1)).toEqual([]);
    const after = structuredClone(before);
    expect(move(after, { on: "bench", at: 0 }, { on: "board", at: 1 }).ok).toBe(true);
    expect(after).not.toBe(before);
    expect(watch.look(after, 1)).toEqual([{ trait: "fang", step: 1 }]);
    // Seen once, it is not told again on the next copy.
    expect(watch.look(structuredClone(after), 1)).toEqual([]);
    // Another run, by its number, starts afresh; so does a run forgotten.
    expect(watch.look(structuredClone(before), 2)).toEqual([]);
    watch.forget();
    expect(watch.look(after, 2)).toEqual([]);
  });
});

/** A list of nudges already given. */
const all = (...ids: NudgeId[]): string[] => ids;

describe("teaching by doing", () => {
  test("nothing while the first figure is picked: the pick asks for itself", () => {
    const run = startRun(5);
    expect(nudgeFor(run, "plan", [])).toBeNull();
    expect(nudgeFor(run, "other", [])).toBeNull();
  });
  test("then buying, while only the starter is owned and something can be paid for", () => {
    const run = begun();
    expect(nudgeFor(run, "plan", [])).toBe("buy");
    run.acorns = 0;
    expect(nudgeFor(run, "plan", [])).toBe("setout");
  });
  test("then setting out, in the first room", () => {
    const run = begun();
    expect(nudgeFor(run, "plan", all("buy"))).toBe("setout");
    run.room = 1;
    expect(nudgeFor(run, "plan", all("buy"))).toBeNull();
  });
  test("the fight has one, the first time", () => {
    const run = begun();
    expect(nudgeFor(run, "fight", [])).toBe("watch");
    expect(nudgeFor(run, "fight", all("watch"))).toBeNull();
  });
  test("a figure on the bench with room on the board asks to be fielded", () => {
    const run = begun();
    put(run, "worm", "bench", 0);
    expect(nudgeFor(run, "plan", all("buy", "setout"))).toBeNull();
    run.level = 2;
    expect(nudgeFor(run, "plan", all("buy", "setout"))).toBe("field");
  });
  test("an item on the rack, a pair, a trait and savings each have their moment, one at a time", () => {
    const run = begun();
    run.room = 2;
    run.level = 3;
    run.acorns = 0;
    const taught = all("buy", "setout", "field", "rustle");
    expect(nudgeFor(run, "plan", taught)).toBeNull();
    run.items.push("thorn");
    expect(nudgeFor(run, "plan", taught)).toBe("item");
    taught.push("item");
    put(run, "worm", "bench", 0);
    put(run, "worm", "bench", 1);
    expect(nudgeFor(run, "plan", [...taught, "field"])).toBe("three");
    taught.push("three");
    run.board.fill(null);
    put(run, "emberkit", "board", 0);
    put(run, "crab7", "board", 1);
    put(run, "moth", "board", 2);
    expect(nudgeFor(run, "plan", taught)).toBe("trait");
    taught.push("trait");
    run.acorns = 10;
    expect(nudgeFor(run, "plan", taught)).toBe("save");
  });
  test("with nothing on the stall that can be paid for and a free rustle in hand, the rustle is pointed out", () => {
    const run = begun();
    run.room = 2;
    run.acorns = 0;
    const taught = all("buy", "setout", "field");
    expect(nudgeFor(run, "plan", taught)).toBe("rustle");
    run.rustles = 0;
    expect(nudgeFor(run, "plan", taught)).toBeNull();
    run.rustles = 1;
    run.acorns = 3;
    expect(nudgeFor(run, "plan", taught)).toBeNull();
  });
  test("nothing is said while something is waiting to be chosen, or once everything has been", () => {
    const run = begun();
    run.stage = { phase: "plan", picks: [{ kind: "component", options: ["thorn", "bark", "plume"] }] };
    expect(nudgeFor(run, "plan", [])).toBeNull();
    run.stage = { phase: "plan", picks: [] };
    expect(
      nudgeFor(run, "plan", all("buy", "setout", "watch", "field", "three", "item", "trait", "save", "rustle")),
    ).toBeNull();
  });
});

describe("what a card says about a figure", () => {
  test("a figure's numbers on the board count its items and its party's traits", () => {
    const run = startRun(3, { trail: 0 });
    run.stage = { phase: "plan", picks: [] };
    run.board.fill(null);
    run.bench.fill(null);
    run.board[0] = { id: 1, kind: "barrowgnome", stars: 1, items: ["stump"], fed: 0 };
    run.board[1] = { id: 2, kind: "slug", stars: 1, items: [], fed: 0 };
    const plain = plainNumbers("barrowgnome", 1);
    const now = pieceNumbers(run, { on: "board", at: 0 });
    // Stump Shield's 40 armour and two Bulwarks' own.
    expect(now?.armour).toBe(plain.armour + 40 + traitNumber("bulwark", "armour", 1));
    expect(now?.health).toBe(plain.health);
    // On the bench the trait does not count, the item still does.
    run.bench[0] = run.board[0];
    run.board[0] = null;
    expect(pieceNumbers(run, { on: "bench", at: 0 })?.armour).toBe(plain.armour + 40);
  });
  test("a trait's count and next step, as the strip shows them", () => {
    const run = startRun(3, { trail: 0 });
    run.board.fill(null);
    run.board[0] = { id: 1, kind: "emberkit", stars: 1, items: [], fed: 0 };
    expect(ownTraitCount(run, "ember")).toEqual({ count: 1, next: 2, step: 0 });
    run.board[1] = { id: 2, kind: "kettle", stars: 1, items: [], fed: 0 };
    expect(ownTraitCount(run, "ember")).toEqual({ count: 2, next: 4, step: 1 });
    expect(ownTraitCount(run, "sage")).toEqual({ count: 0, next: 2, step: 0 });
    // A Finch holding an Ember emblem is a third Ember.
    run.board[2] = { id: 3, kind: "finch", stars: 1, items: ["embercharm"], fed: 0 };
    expect(ownTraitCount(run, "ember")).toEqual({ count: 3, next: 4, step: 1 });
  });
  test("a trait's figures run cheapest first", () => {
    expect(membersOf("ember")).toEqual(["emberkit", "kettle", "cindernewt", "hearthcat"]);
    expect(membersOf("fang")).toEqual(["emberkit", "crab7", "jay", "badger", "whitefox", "hearthcat"]);
  });
  test("where a figure is, and what the rack has", () => {
    const run = startRun(3, { trail: 0 });
    run.board.fill(null);
    run.bench.fill(null);
    run.stall = ["moth", null, null, null, null];
    run.board[0] = { id: 1, kind: "emberkit", stars: 1, items: [], fed: 0 };
    run.bench[2] = { id: 2, kind: "worm", stars: 1, items: [], fed: 0 };
    expect(whereIs(run, "emberkit")).toBe("board");
    expect(whereIs(run, "worm")).toBe("bench");
    expect(whereIs(run, "moth")).toBe("stall");
    expect(whereIs(run, "greg")).toBe(null);
    run.items = ["thorn", "plume"];
    expect(rackHas(run, "wasptail")).toBe("parts");
    expect(rackHas(run, "blackthorn")).toBe(null);
    run.items = ["thorn", "thorn", "hoard"];
    expect(rackHas(run, "blackthorn")).toBe("parts");
    expect(rackHas(run, "hoard")).toBe("item");
  });
});

describe("a fight's sheet", () => {
  test("is titled with how the fight went and how long it took", () => {
    expect(fightTitle("win", 280)).toBe("Room won · 14 s");
    expect(fightTitle("loss", 411)).toBe("Room lost · 21 s");
    expect(fightTitle("draw", 900)).toBe("A draw · 45 s");
    expect(fightTitle("win", 0)).toBe("Room won · 1 s");
  });
});

describe("who watches from the side logs", () => {
  const forest = { who: "The forest" };
  test("is the same two all raid, others from one raid to the next, and never the regular across the table", () => {
    expect(watchersOf(7, forest)).toEqual(watchersOf(7, forest));
    const pairs = new Set(Array.from({ length: 40 }, (_, n) => watchersOf(n + 1, forest).join()));
    expect(pairs.size).toBeGreaterThan(10);
    for (const regular of REGULARS) {
      for (let n = 1; n < 30; n++) {
        const [a, b] = watchersOf(n, { who: regular.name });
        expect([a === regular.kind, b === regular.kind, a === b]).toEqual([false, false, false]);
      }
    }
  });
  test("may be any regular across another member's board, whatever that member is called", () => {
    const greg = { who: "Greg", by: "10000000-0000-0000-0000-000000000002" };
    const watching = new Set(Array.from({ length: 60 }, (_, n) => watchersOf(n + 1, greg)).flat());
    expect(watching.has("greg")).toBe(true);
    expect(Array.from({ length: 60 }, (_, n) => watchersOf(n + 1, greg))).toEqual(
      Array.from({ length: 60 }, (_, n) => watchersOf(n + 1, forest)),
    );
  });
});

describe("the name across the table", () => {
  test("starts a sentence with a regular's capital, and is a member's or the forest's as written", () => {
    expect(acrossName({ who: "the Hearth Cat" })).toBe("The Hearth Cat");
    expect(acrossName({ who: "The forest" })).toBe("The forest");
    expect(acrossName({ who: "mossy_fern", by: "10000000-0000-0000-0000-000000000002" })).toBe("mossy_fern");
    // A member called as a regular is a member still.
    expect(acrossName({ who: "a Moth", by: "10000000-0000-0000-0000-000000000002" })).toBe("a Moth");
  });
});

describe("the far party walking in", () => {
  test("walks in for each room met, and again when the last room is fought again", () => {
    const run = startRun(9, { trail: 0 });
    const first = arrivalOf(run);
    expect(arrivalOf({ ...run, room: 1 })).not.toBe(first);
    const lost: RoomRecord = { room: 14, kind: "boss", result: "loss", standing: [0, 2], boss: "bigcrab" };
    const once = { ...run, room: 14, record: [lost] };
    expect(arrivalOf({ ...once, record: [lost, lost] })).not.toBe(arrivalOf(once));
  });
});
