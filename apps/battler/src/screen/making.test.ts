import { describe, expect, test } from "bun:test";

import {
  choose,
  type FigureId,
  FINISHED,
  FINISHED_IDS,
  forgeItems,
  giveItem,
  GOOD_WITH,
  type ItemId,
  newAlmanac,
  newLooks,
  type Piece,
  predict,
  type RaidCommand,
  type RunView,
  startRun,
  type TableView,
} from "@sequoia-leaf/raid";

import { commandsFor, dropOf, type Offer, offerOf, offersFor, onOffer, pairsOf, wanters, wants } from "./making.ts";

/** A run in its first room with these figures on the board from seat 0 (each holding what is said), and this rack. */
function planning(figures: [FigureId, ItemId[]][], rack: ItemId[] = [], benched: [FigureId, ItemId[]][] = []): RunView {
  const run = startRun(5);
  choose(run, 0);
  run.board.fill(null);
  const piece = ([kind, items]: [FigureId, ItemId[]]): Piece => ({ id: run.nextId++, kind, stars: 1, items, fed: 0 });
  figures.forEach((f, seat) => (run.board[seat] = piece(f)));
  benched.forEach((f, slot) => (run.bench[slot] = piece(f)));
  run.items = rack;
  return run;
}
const first = (run: RunView): Piece => {
  const p = run.board[0];
  if (!p) throw new Error("nobody on the board");
  return p;
};
const how = (offers: Offer[]): string[] => offers.map((o) => `${o.item}:${o.how}`);

describe("what a figure's card offers", () => {
  // A Rock is good with a Hedgehog Coat (Thorn + Bark), a Winter Hoard (Chestnut + Chestnut) and a Hollow Log (Bark + Chestnut).
  test("the three that suit it, each makeable from the rack or saying which components are missing", () => {
    const run = planning([["rock", []]], ["plume", "bark", "glowcap", "thorn", "chestnut"]);
    expect(GOOD_WITH.rock).toEqual(["hedgehog", "hoard", "hollowlog"]);
    expect(offersFor(run, first(run))).toEqual([
      { item: "hedgehog", how: "make", forge: [3, 1] },
      { item: "hoard", how: "needs", needs: ["chestnut"] },
      { item: "hollowlog", how: "make", forge: [1, 4] },
    ]);
    expect(offersFor(planning([["rock", []]]), { kind: "rock", items: [] })).toEqual([
      { item: "hedgehog", how: "needs", needs: ["thorn", "bark"] },
      { item: "hoard", how: "needs", needs: ["chestnut", "chestnut"] },
      { item: "hollowlog", how: "needs", needs: ["bark", "chestnut"] },
    ]);
  });

  test("a half it holds counts: the other half, handed over, makes it", () => {
    const run = planning([["rock", ["bark"]]], ["thorn", "chestnut"]);
    expect(offersFor(run, first(run))).toEqual([
      { item: "hedgehog", how: "make", give: 0 },
      // Its Bark is no half of a Winter Hoard, and the rack has one Chestnut.
      { item: "hoard", how: "needs", needs: ["chestnut"] },
      { item: "hollowlog", how: "make", give: 1 },
    ]);
  });

  test("a finished one on the rack is handed over; one it holds is not offered", () => {
    const run = planning([["rock", ["hoard"]]], ["glowcap", "hedgehog"]);
    expect(offersFor(run, first(run))).toEqual([
      { item: "hedgehog", how: "give", give: 1 },
      { item: "hoard", how: "held" },
      { item: "hollowlog", how: "needs", needs: ["bark", "chestnut"] },
    ]);
  });

  test("with three places full there is no room, but for the item its loose half makes", () => {
    const full = planning([["rock", ["lichen", "stewpot", "fairyring"]]], ["thorn", "bark", "chestnut", "chestnut"]);
    expect(how(offersFor(full, first(full)))).toEqual(["hedgehog:full", "hoard:full", "hollowlog:full"]);
    const half = planning([["rock", ["lichen", "stewpot", "bark"]]], ["thorn", "bark", "chestnut", "chestnut"]);
    expect(offersFor(half, first(half))).toEqual([
      { item: "hedgehog", how: "make", give: 0 },
      { item: "hoard", how: "full" },
      { item: "hollowlog", how: "make", give: 2 },
    ]);
  });

  test("a press makes exactly that item, the figure holds it, and exactly its two components are used", () => {
    // Every finished item, for a figure holding nothing, one half of it, or another component, from a rack with one of each and a spare.
    for (const item of FINISHED_IDS) {
      const [a, b] = FINISHED[item].made;
      const another = item === "lichen" ? "quilt" : "lichen";
      for (const held of [[], [a], [b], ["glowcap"], [another, "glowcap"]] satisfies ItemId[][]) {
        const run = planning([["rock", [...held]]], ["thorn", "plume", "glowcap", "bark", "chestnut", a, b]);
        const offer = offerOf(run, first(run), item);
        expect([item, held, onOffer(offer)]).toEqual([item, held, true]);
        const before = [...run.items, ...held].toSorted();
        for (const c of commandsFor(run, offer, { on: "board", at: 0 })) {
          const done =
            c.do === "forge" ? forgeItems(run, c.item, c.with) : c.do === "give" && giveItem(run, c.item, c.to);
          expect(done).toMatchObject({ ok: true });
        }
        expect([item, held, first(run).items.includes(item)]).toEqual([item, held, true]);
        // Everything is where it was, but for the two halves, which are the item now.
        const after = [...run.items, ...first(run).items.flatMap((i) => (i === item ? [a, b] : [i]))].toSorted();
        expect(after).toEqual(before);
      }
    }
  });

  test("the commands are ones the page may show at once, and nothing is offered that the rules refuse", () => {
    const run = planning([["rock", ["plume"]]], ["bark", "chestnut", "chestnut"]);
    const view: TableView = {
      runs: 1,
      run,
      endless: null,
      ventures: 0,
      week: { at: 0, deepest: { wilds: 0, deep: 0 } },
      almanac: emptyAlmanac,
      trail: 0,
      looks: plainLooks,
      roster: {},
    };
    const commands: RaidCommand[] = commandsFor(run, offerOf(run, first(run), "hoard"), { on: "board", at: 0 });
    expect(commands).toEqual([
      { do: "forge", item: 1, with: 2 },
      { do: "give", item: 1, to: { on: "board", at: 0 } },
    ]);
    let shown = view;
    for (const c of commands) {
      const guess = predict(shown, c);
      if (!guess || !("view" in guess)) throw new Error(`${c.do} was not done`);
      shown = guess.view;
    }
    expect([shown.run?.board[0]?.items, shown.run?.items]).toEqual([["plume", "hoard"], ["bark"]]);
    expect(commandsFor(run, offerOf(run, first(run), "hedgehog"), { on: "board", at: 0 })).toEqual([]);
  });
});
const emptyAlmanac: TableView["almanac"] = newAlmanac();
const plainLooks: TableView["looks"] = newLooks();

describe("who on the board wants an item", () => {
  // A Kettle is good with a Stewpot, a Glowthorn and a Lichen Locket; a Rock with none of those.
  test("a fielded figure wants a finished item that suits it, and so the components it is made of", () => {
    const run = planning(
      [
        ["rock", []],
        ["kettle", []],
        ["crab23", []],
      ],
      [],
      [["leafling", []]],
    );
    const ids = (item: ItemId): FigureId[] => wanters(run, item).map((p) => p.kind);
    expect(ids("stewpot")).toEqual(["kettle", "crab23"]);
    expect(ids("hoard")).toEqual(["rock"]);
    // Glowcap makes a Stewpot, a Glowthorn and a Lichen Locket; Chestnut a Stewpot, a Winter Hoard and a Hollow Log.
    expect(ids("glowcap")).toEqual(["kettle", "crab23"]);
    expect(ids("chestnut")).toEqual(["rock", "kettle", "crab23"]);
    expect(ids("plume")).toEqual([]);
    // Nobody wants an emblem, and a Leafling on the bench wants nothing.
    expect(ids("mosscharm")).toEqual([]);
    expect(GOOD_WITH.leafling).toContain("stewpot");
  });

  test("not one that holds the item already, nor one with no place for it", () => {
    const run = planning([
      ["kettle", ["stewpot"]],
      ["crab23", ["hoard", "hedgehog", "quilt"]],
      ["mossmote", ["hoard", "hedgehog", "glowcap"]],
    ]);
    expect(wanters(run, "stewpot").map((p) => p.kind)).toEqual(["mossmote"]);
    expect(wants({ kind: "kettle", items: ["stewpot"] }, "glowthorn")).toBe(true);
    // Full, but its loose Glowcap is half of a Stewpot: it has a place for one, and for nothing else.
    expect(wanters(run, "chestnut").map((p) => p.kind)).toEqual(["mossmote"]);
    expect(wants({ kind: "mossmote", items: ["hoard", "hedgehog", "bark"] }, "stewpot")).toBe(false);
  });
});

describe("an item in the hand", () => {
  test("pairs with every other component on the rack, and with nothing else", () => {
    const run = planning([["rock", []]], ["thorn", "mosscharm", "plume", "wasptail", "thorn"]);
    expect(pairsOf(run, 0)).toEqual([2, 4]);
    expect(pairsOf(run, 1)).toEqual([]);
    expect(pairsOf(run, 3)).toEqual([]);
  });

  test("over a component on the rack, the tip is the item the two make, in the place it is let go on", () => {
    const run = planning([["rock", []]], ["thorn", "mosscharm", "plume"]);
    expect(dropOf(run, 0, { rack: 2 })).toEqual({
      does: "make",
      item: "wasptail",
      command: { do: "forge", item: 2, with: 0 },
    });
    // Over an emblem, or itself, there is nothing to say.
    expect(dropOf(run, 0, { rack: 1 })).toBeNull();
    expect(dropOf(run, 0, { rack: 0 })).toBeNull();
  });

  test("over a figure holding a loose component, the tip is the item the two make", () => {
    const run = planning([["rock", ["bark"]]], ["plume"]);
    expect(dropOf(run, 0, { piece: first(run).id })).toEqual({
      does: "make",
      item: "quilt",
      command: { do: "give", item: 0, to: { on: "board", at: 0 } },
    });
  });

  test("otherwise it is what the figure gets, and how many of its three places are full then", () => {
    const run = planning([["rock", ["hoard"]]], ["plume", "mosscharm", "lichen"]);
    const to = { piece: first(run).id };
    expect(dropOf(run, 0, to)).toMatchObject({ does: "give", item: "plume", holds: 2 });
    expect(dropOf(run, 1, to)).toMatchObject({ does: "give", item: "mosscharm", holds: 2 });
    expect(dropOf(run, 2, to)).toMatchObject({ does: "give", item: "lichen", holds: 2 });
  });

  test("where it cannot be given, the tip says why in the refusal's words, before it is tried", () => {
    const full = planning([["rock", ["hoard", "lichen", "quilt"]]], ["plume"]);
    expect(dropOf(full, 0, { piece: first(full).id })).toMatchObject({
      does: "nothing",
      item: "plume",
      why: "It is holding all it can.",
    });
    const kin = planning([["rock", []]], ["burrowcharm"]);
    expect(dropOf(kin, 0, { piece: first(kin).id })).toMatchObject({
      does: "nothing",
      why: "It is of that kin already.",
    });
    // Nothing is said of a figure that has gone, or a place with no item.
    expect(dropOf(kin, 0, { piece: 999 })).toBeNull();
    expect(dropOf(kin, 4, { piece: first(kin).id })).toBeNull();
    expect(kin.items).toEqual(["burrowcharm"]);
  });
});
