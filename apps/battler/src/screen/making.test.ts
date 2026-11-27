import { describe, expect, test } from "bun:test";

import {
  choose,
  countOn,
  eraOf,
  type FigureId,
  FINISHED_IDS,
  forgeItems,
  giveItem,
  GOOD_WITH,
  halvesOf,
  type ItemId,
  kindsOn,
  LEGACY_ERA,
  type Piece,
  predict,
  type RackItem,
  rackOf,
  type RaidCommand,
  type RunView,
  startRun,
} from "@sequoia-leaf/raid";
import { CAT, viewWith } from "@sequoia-leaf/raid/testkit.ts";

import { commandsFor, dropOf, type Offer, offerOf, offersFor, onOffer, pairsOf, wanters, wants } from "./making.ts";

/** A run in its first room with these figures on the board from seat 0 (each holding what is said), and this rack. */
function planning(
  figures: [FigureId, ItemId[]][],
  rack: RackItem[] = [],
  benched: [FigureId, ItemId[]][] = [],
): RunView {
  const run = startRun(5, { era: LEGACY_ERA });
  choose(run, 0);
  run.board.fill(null);
  const piece = ([kind, items]: [FigureId, ItemId[]]): Piece => ({ id: run.nextId++, kind, stars: 1, items, fed: 0 });
  figures.forEach((f, seat) => (run.board[seat] = piece(f)));
  benched.forEach((f, slot) => (run.bench[slot] = piece(f)));
  run.rack = rackOf(rack);
  return run;
}
const first = (run: RunView): Piece => {
  const p = run.board[0];
  if (!p) throw new Error("nobody on the board");
  return p;
};
const how = (offers: Offer[]): string[] => offers.map((o) => `${o.item}:${o.how}`);
/** What lies on the rack, one of each as many times as there are. */
const listOf = (run: RunView): string[] =>
  kindsOn(run.rack).flatMap((kind) => Array.from({ length: countOn(run.rack, kind) }, () => kind));

describe("what a figure's card offers", () => {
  // A Rock is good with a Hedgehog Coat (Thorn + Bark), a Winter Hoard (Chestnut + Chestnut) and a Hollow Log (Bark + Chestnut).
  test("the three that suit it, each makeable from the rack or saying which components are missing", () => {
    const run = planning([["rock", []]], ["plume", "bark", "glowcap", "thorn", "chestnut"]);
    expect(GOOD_WITH.rock).toEqual(["hedgehog", "hoard", "hollowlog"]);
    expect(offersFor(run, first(run))).toEqual([
      { item: "hedgehog", how: "make", forge: ["thorn", "bark"] },
      { item: "hoard", how: "needs", needs: ["chestnut"] },
      { item: "hollowlog", how: "make", forge: ["bark", "chestnut"] },
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
      { item: "hedgehog", how: "make", give: "thorn" },
      // Its Bark is no half of a Winter Hoard, and the rack has one Chestnut.
      { item: "hoard", how: "needs", needs: ["chestnut"] },
      { item: "hollowlog", how: "make", give: "chestnut" },
    ]);
  });

  test("a finished one on the rack is handed over; one it holds is not offered", () => {
    const run = planning([["rock", ["hoard"]]], ["glowcap", "hedgehog"]);
    expect(offersFor(run, first(run))).toEqual([
      { item: "hedgehog", how: "give", give: "hedgehog" },
      { item: "hoard", how: "held" },
      { item: "hollowlog", how: "needs", needs: ["bark", "chestnut"] },
    ]);
  });

  test("with three places full there is no room, but for the item its loose half makes", () => {
    const full = planning([["rock", ["lichen", "stewpot", "fairyring"]]], ["thorn", "bark", "chestnut", "chestnut"]);
    expect(how(offersFor(full, first(full)))).toEqual(["hedgehog:full", "hoard:full", "hollowlog:full"]);
    const half = planning([["rock", ["lichen", "stewpot", "bark"]]], ["thorn", "bark", "chestnut", "chestnut"]);
    expect(offersFor(half, first(half))).toEqual([
      { item: "hedgehog", how: "make", give: "thorn" },
      { item: "hoard", how: "full" },
      { item: "hollowlog", how: "make", give: "chestnut" },
    ]);
  });

  test("a press makes exactly that item, the figure holds it, and exactly its two components are used", () => {
    // Every finished item, for a figure holding nothing, one half of it, or another component, from a rack with one of each and a spare.
    for (const item of FINISHED_IDS) {
      const [a, b] = halvesOf(CAT, item);
      const another = item === "lichen" ? "quilt" : "lichen";
      for (const held of [[], [a], [b], ["glowcap"], [another, "glowcap"]] satisfies ItemId[][]) {
        const run = planning([["rock", [...held]]], ["thorn", "plume", "glowcap", "bark", "chestnut", a, b]);
        const offer = offerOf(run, first(run), item);
        expect([item, held, onOffer(offer)]).toEqual([item, held, true]);
        const before = [...listOf(run), ...held].toSorted();
        for (const c of commandsFor(offer, { on: "board", at: 0 })) {
          const done =
            c.do === "forge" ? forgeItems(run, c.item, c.with) : c.do === "give" && giveItem(run, c.item, c.to);
          expect(done).toMatchObject({ ok: true });
        }
        expect([item, held, first(run).items.includes(item)]).toEqual([item, held, true]);
        // Everything is where it was, but for the two halves, which are the item now.
        const after = [...listOf(run), ...first(run).items.flatMap((i) => (i === item ? [a, b] : [i]))].toSorted();
        expect(after).toEqual(before);
      }
    }
  });

  test("the commands are ones the page may show at once, and nothing is offered that the rules refuse", () => {
    const run = planning([["rock", ["plume"]]], ["bark", "chestnut", "chestnut"]);
    const view = viewWith(run);
    const commands: RaidCommand[] = commandsFor(offerOf(run, first(run), "hoard"), { on: "board", at: 0 });
    expect(commands).toEqual([
      { do: "forge", item: "chestnut", with: "chestnut" },
      { do: "give", item: "hoard", to: { on: "board", at: 0 } },
    ]);
    let shown = view;
    for (const c of commands) {
      const guess = predict(shown, c);
      if (!guess || !("view" in guess)) throw new Error(`${c.do} was not done`);
      shown = guess.view;
    }
    expect([shown.held.main?.board[0]?.items, shown.held.main?.rack]).toEqual([["plume", "hoard"], { bark: 1 }]);
    expect(commandsFor(offerOf(run, first(run), "hedgehog"), { on: "board", at: 0 })).toEqual([]);
  });
});

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
    expect(wants(CAT, { kind: "kettle", items: ["stewpot"] }, "glowthorn")).toBe(true);
    // Full, but its loose Glowcap is half of a Stewpot: it has a place for one, and for nothing else.
    expect(wanters(run, "chestnut").map((p) => p.kind)).toEqual(["mossmote"]);
    expect(wants(CAT, { kind: "mossmote", items: ["hoard", "hedgehog", "bark"] }, "stewpot")).toBe(false);
  });
});

describe("an item in the hand", () => {
  test("pairs with every kind of component on the rack it makes something with, its own kind only with two", () => {
    const run = planning([["rock", []]], ["thorn", "mosscharm", "plume", "wasptail", "thorn"]);
    expect(pairsOf(run, "thorn")).toEqual(["thorn", "plume"]);
    expect(pairsOf(run, "plume")).toEqual(["thorn"]);
    expect(pairsOf(run, "mosscharm")).toEqual([]);
    expect(pairsOf(run, "wasptail")).toEqual([]);
    expect(pairsOf(planning([["rock", []]], ["tongs", "thorn"]), "tongs")).toEqual([]);
  });

  test("over a component on the rack, the tip is the item the two make", () => {
    const run = planning([["rock", []]], ["thorn", "mosscharm", "plume"]);
    expect(dropOf(run, "thorn", { rack: "plume" })).toEqual({
      does: "make",
      item: "wasptail",
      command: { do: "forge", item: "plume", with: "thorn" },
    });
    // Over an emblem, or its own kind with one of it, there is nothing to say.
    expect(dropOf(run, "thorn", { rack: "mosscharm" })).toBeNull();
    expect(dropOf(run, "thorn", { rack: "thorn" })).toBeNull();
  });

  test("over a figure holding a loose component, the tip is the item the two make", () => {
    const run = planning([["rock", ["bark"]]], ["plume"]);
    expect(dropOf(run, "plume", { piece: first(run).id })).toEqual({
      does: "make",
      item: "quilt",
      command: { do: "give", item: "plume", to: { on: "board", at: 0 } },
    });
  });

  test("otherwise it is what the figure gets, and how many of its three places are full then", () => {
    const run = planning([["rock", ["hoard"]]], ["plume", "mosscharm", "lichen"]);
    const to = { piece: first(run).id };
    expect(dropOf(run, "plume", to)).toMatchObject({ does: "give", item: "plume", holds: 2 });
    expect(dropOf(run, "mosscharm", to)).toMatchObject({ does: "give", item: "mosscharm", holds: 2 });
    expect(dropOf(run, "lichen", to)).toMatchObject({ does: "give", item: "lichen", holds: 2 });
  });

  test("where it cannot be given, the tip says why in the refusal's words, before it is tried", () => {
    const full = planning([["rock", ["hoard", "lichen", "quilt"]]], ["plume"]);
    expect(dropOf(full, "plume", { piece: first(full).id })).toMatchObject({
      does: "nothing",
      item: "plume",
      why: "It is holding all it can.",
    });
    const kin = planning([["rock", []]], ["burrowcharm"]);
    expect(dropOf(kin, "burrowcharm", { piece: first(kin).id })).toMatchObject({
      does: "nothing",
      why: "It is of that origin already.",
    });
    // Nothing is said of a figure that has gone, or a kind there is none of.
    expect(dropOf(kin, "burrowcharm", { piece: 999 })).toBeNull();
    expect(dropOf(kin, "plume", { piece: first(kin).id })).toBeNull();
    expect(kin.rack).toEqual({ burrowcharm: 1 });
  });

  test("a tool over a figure: the Tongs say what comes back, a Whetstone how many change, and neither on an empty-handed one", () => {
    const run = planning(
      [
        ["rock", ["hoard", "plume"]],
        ["worm", []],
      ],
      ["tongs", "whetstone"],
    );
    const rock = { piece: first(run).id };
    expect(dropOf(run, "tongs", rock)).toEqual({
      does: "tongs",
      item: "tongs",
      items: ["hoard", "plume"],
      command: { do: "tongs", to: { on: "board", at: 0 } },
    });
    expect(dropOf(run, "whetstone", rock)).toEqual({
      does: "whetstone",
      item: "whetstone",
      holds: 2,
      command: { do: "whetstone", to: { on: "board", at: 0 } },
    });
    const worm = { piece: run.board[1]?.id ?? 0 };
    expect(dropOf(run, "tongs", worm)).toMatchObject({ does: "nothing", why: "It holds nothing." });
    // Over the rack a tool does nothing.
    expect(dropOf(run, "tongs", { rack: "whetstone" })).toBeNull();
    expect(run.rack).toEqual({ tongs: 1, whetstone: 1 });
  });
});

/** A run of Penguin Month's era with these figures and this rack. */
function knives(figures: [FigureId, ItemId[]][], rack: RackItem[]): RunView {
  const run = planning(figures, rack);
  run.era = eraOf("penguin-month");
  return run;
}

describe("two Knives (Penguin Month)", () => {
  test("on the rack, the tip says they make An Extra Chair, and its button forges them, by tap or keyboard alike", () => {
    const run = knives([["worm", []]], ["knife", "knife"]);
    const drop = dropOf(run, "knife", { rack: "knife" });
    expect(drop).toMatchObject({ does: "boon", item: "knife", boon: "extrachair" });
    expect(drop?.command).toEqual({ do: "forge", item: "knife", with: "knife" });
    const copy = structuredClone(run);
    expect(forgeItems(copy, "knife", "knife")).toMatchObject({ ok: true, notes: [{ t: "boon", boon: "extrachair" }] });
    expect([copy.boons.includes("extrachair"), countOn(copy.rack, "knife")]).toEqual([true, 0]);
  });
  test("a Knife handed to a figure holding one says the same: both used up, the chair the run's", () => {
    const run = knives([["worm", ["knife"]]], ["knife"]);
    const id = run.board[0]?.id ?? -1;
    expect(dropOf(run, "knife", { piece: id })).toMatchObject({ does: "boon", boon: "extrachair" });
  });
});
