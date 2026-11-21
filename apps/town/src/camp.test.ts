import { describe, expect, test } from "bun:test";

import {
  allReached,
  boxOf,
  type Camp,
  campFull,
  canPlace,
  CGH,
  CGW,
  COSY,
  freeSpot,
  KIND,
  layout,
  MOST_OWNED,
  MOST_PARCELS,
  MOST_PLACED,
  move,
  newCamp,
  owned,
  parseCamp,
  petsOf,
  putAway,
  setOut,
  taken,
  TRAIL,
  trayList,
  turned,
  unpackParcel,
  WHY_NOT,
  YARD,
} from "./camp.ts";
import { clearFlights, flights } from "./flights.ts";
import { BOX, isLetter, letter, open, post, roomInBox, tidied, waiting } from "./mail.ts";
import { footprint, isThing, KINDS, thingOf, THINGS, turnsOf } from "./things.ts";

const fresh = (): Camp => structuredClone(newCamp());
const at = (camp: Camp, id: string): number => camp.placed.findIndex((p) => p.id === id);

/** A new camp with plank paths laid over the yard, row by row wherever one may go, until `n` things stand in it. */
function crowded(n: number): Camp {
  const camp = fresh();
  for (let y = YARD.y0; y <= YARD.y1 && camp.placed.length < n; y++)
    for (let x = YARD.x0; x < YARD.x1 && camp.placed.length < n; x += 2)
      if (canPlace(camp.placed, "plank-path", x, y, 0) === "ok")
        camp.placed.push({ id: "plank-path", x, y, t: 0, s: 0 });
  return camp;
}

describe("the catalogue", () => {
  test("there are forty things and more, each with a name of its own", () => {
    expect(THINGS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(THINGS.map((t) => t.id)).size).toBe(THINGS.length);
    expect(new Set(THINGS.map((t) => t.name)).size).toBe(THINGS.length);
  });

  test("every name can be kept in a record, and every thing takes some ground", () => {
    for (const t of THINGS) {
      expect(t.id).toMatch(/^[a-z0-9-]{1,32}$/);
      expect(t.w).toBeGreaterThan(0);
      expect(t.d).toBeGreaterThan(0);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.about.length).toBeGreaterThan(0);
    }
  });

  test("every kind has something in it", () => {
    for (const k of KINDS) expect(THINGS.some((t) => t.kind === k)).toBe(true);
  });

  test("most things do something when touched", () => {
    const doing = THINGS.filter((t) => t.does !== "").length;
    expect(doing / THINGS.length).toBeGreaterThan(0.9);
  });

  test("what lies flat stops nobody", () => {
    for (const t of THINGS) if (t.flat) expect(t.solid).toBe("none");
  });

  test("a thing laid the other way takes the same ground turned", () => {
    const fence = thingOf("picket");
    expect(fence && footprint(fence, 0)).toEqual([2, 1]);
    expect(fence && footprint(fence, 1)).toEqual([1, 2]);
    const gnome = thingOf("gnome");
    expect(gnome && footprint(gnome, 1)).toEqual([1, 1]);
  });
});

describe("a new camp", () => {
  test("has a cabin, a fire with two logs, a mailbox, a signpost and a shelf", () => {
    const ids = newCamp().placed.map((p) => p.id);
    for (const id of ["cabin", "fire-ring", "mailbox", "signpost", "trophy-shelf"]) expect(ids).toContain(id);
    expect(ids.filter((id) => id === "log-seat").length).toBe(2);
  });

  test("is laid out as its own rules allow", () => {
    const camp = newCamp();
    camp.placed.forEach((p, i) => {
      expect(canPlace(camp.placed, p.id, p.x, p.y, p.t, i)).toBe("ok");
    });
    expect(allReached(camp.placed)).toBe(true);
  });

  test("has nobody living in it until a pet is chosen", () => {
    expect(petsOf(newCamp())).toEqual([]);
  });
});

describe("setting things down", () => {
  test("nothing goes on top of another thing, in the trees, or on the trail", () => {
    const camp = fresh();
    const fire = camp.placed[at(camp, "fire-ring")];
    expect(fire && canPlace(camp.placed, "stump", fire.x, fire.y, 0)).toBe("taken");
    expect(canPlace(camp.placed, "stump", YARD.x0 - 1, 20, 0)).toBe("off");
    expect(canPlace(camp.placed, "stump", 20, YARD.y1 + 1, 0)).toBe("off");
    expect(canPlace(camp.placed, "stump", TRAIL.x0, TRAIL.y0, 0)).toBe("trail");
    expect(canPlace(camp.placed, "stump", 30, 32, 0)).toBe("ok");
  });

  test("a rug may lie under a seat, but not under another rug", () => {
    const camp = fresh();
    camp.tray = { "rug-woven": 2, stump: 1 };
    expect(setOut(camp, "rug-woven", 30, 31)).toBe("ok");
    expect(setOut(camp, "stump", 31, 31)).toBe("ok");
    expect(setOut(camp, "rug-woven", 31, 32)).toBe("taken");
    expect(camp.tray).toEqual({ "rug-woven": 1 });
  });

  test("the tray gives up only what is in it", () => {
    const camp = fresh();
    expect(setOut(camp, "well", 30, 31)).toBe("off");
  });

  test("a thing may be moved onto ground it was itself standing on", () => {
    const camp = fresh();
    const i = at(camp, "fire-ring");
    const fire = camp.placed[i];
    expect(fire && move(camp, i, fire.x + 1, fire.y, 0)).toBe("ok");
  });

  test("nothing may shut the cabin, the mailbox or the signpost in", () => {
    const camp = fresh();
    const box = camp.placed[at(camp, "mailbox")];
    if (!box) throw new Error("no mailbox");
    // Fence it in on three sides, then try the fourth.
    camp.placed.push({ id: "stump", x: box.x - 1, y: box.y, t: 0, s: 0 });
    camp.placed.push({ id: "stump", x: box.x + 1, y: box.y, t: 0, s: 0 });
    camp.placed.push({ id: "stump", x: box.x, y: box.y - 1, t: 0, s: 0 });
    expect(allReached(camp.placed)).toBe(true);
    expect(canPlace(camp.placed, "stump", box.x, box.y + 1, 0)).toBe("shut");
    // The cabin wants the square before its door.
    const cabin = camp.placed[at(camp, "cabin")];
    expect(cabin && canPlace(camp.placed, "stump", cabin.x + 6, cabin.y + 3, 0)).toBe("shut");
  });

  test("an arch and a string of lights stop a walker only at their ends", () => {
    const arch = thingOf("arch");
    if (!arch) throw new Error("no arch");
    const on = taken([{ id: "arch", x: 20, y: 30, t: 0, s: 0 }]);
    expect([20, 21, 22].map((x) => on.solid[30 * CGW + x])).toEqual([1, 0, 1]);
    expect([20, 21, 22].map((x) => on.stand[30 * CGW + x])).toEqual([0, 0, 0]);
  });

  test("turning lays a fence the other way, and leaves a mailbox alone", () => {
    const camp = fresh();
    camp.placed.push({ id: "picket", x: 30, y: 31, t: 0, s: 0 });
    const fence = turned(camp, camp.placed.length - 1);
    expect(fence?.t).toBe(1);
    const thing = thingOf("picket");
    expect(fence && thing && boxOf(fence, thing)).toEqual({ x0: 30, y0: 30, x1: 30, y1: 31 });
    expect(turned(camp, at(camp, "mailbox"))).toBeNull();
  });

  test("putting away fills the tray; the cabin, the mailbox and the signpost stay out", () => {
    const camp = fresh();
    expect(putAway(camp, at(camp, "stump"))).toBe(true);
    expect(putAway(camp, at(camp, "log-seat"))).toBe(true);
    expect(putAway(camp, at(camp, "log-seat"))).toBe(true);
    expect(trayList(camp)).toEqual([
      { id: "log-seat", n: 2 },
      { id: "stump", n: 1 },
    ]);
    for (const id of ["cabin", "mailbox", "signpost"]) expect(putAway(camp, at(camp, id))).toBe(false);
    expect(owned(camp, "log-seat")).toBe(2);
  });

  test("the nearest free spot is found, and is free", () => {
    const camp = fresh();
    const fire = camp.placed[at(camp, "fire-ring")];
    if (!fire) throw new Error("no fire");
    const spot = freeSpot(camp.placed, "well", fire);
    expect(spot).not.toBeNull();
    expect(spot && canPlace(camp.placed, "well", spot.x, spot.y, 0)).toBe("ok");
  });
});

describe("who lives in a camp", () => {
  test("the first pet is the one chosen", () => {
    const camp = fresh();
    camp.first = "cat";
    expect(petsOf(camp)).toEqual(["cat"]);
  });

  test("a cosy camp brings a second, and kindness a third", () => {
    const camp = fresh();
    camp.first = "fox";
    while (camp.placed.length < COSY) {
      const spot = freeSpot(camp.placed, "stump", { x: 30, y: 32 });
      if (!spot) throw new Error("no room");
      camp.placed.push({ id: "stump", ...spot, t: 0, s: 0 });
    }
    expect(petsOf(camp)).toEqual(["fox", "glorp"]);
    for (let i = 0; i < KIND; i++) camp.gave.push({ to: `Mate${"abc".charAt(i)}`, what: "pinecone" });
    expect(petsOf(camp)).toEqual(["fox", "glorp", "cat"]);
  });
});

describe("a guild-mate's camp", () => {
  const taste = ["toadstool", "potted-fern", "gnome", "lantern-post", "rug-woven", "picket"];

  test("is the same every visit", () => {
    expect(layout(1234, taste, 14)).toEqual(layout(1234, taste, 14));
    expect(layout(1234, taste, 14)).not.toEqual(layout(99, taste, 14));
  });

  test("has a cabin, a fire, a mailbox and a signpost, and can be walked about in", () => {
    for (const seed of [1, 2, 3, 77, 4096, 918273]) {
      const placed = layout(seed, taste, 16);
      const ids = placed.map((p) => p.id);
      for (const id of ["cabin", "fire-ring", "mailbox", "signpost"]) expect(ids).toContain(id);
      expect(placed.length).toBeGreaterThan(10);
      placed.forEach((p, i) => {
        expect(canPlace(placed, p.id, p.x, p.y, p.t, i)).toBe("ok");
      });
      expect(allReached(placed)).toBe(true);
    }
  });
});

describe("keeping a camp", () => {
  test("a camp comes back as it was kept", () => {
    const camp = fresh();
    camp.first = "glorp";
    camp.tray = { well: 1, gnome: 3 };
    camp.parcels = ["barrel"];
    camp.gave = [{ to: "Mossback", what: "pinecone" }];
    camp.earned = ["trophy-oldbramble"];
    post(camp.letters, letter("m-1", "Tindra", "I left you a mushroom.", "toadstool"));
    expect(parseCamp(JSON.parse(JSON.stringify(camp)))).toEqual(camp);
  });

  test("every parcel waiting by the trail comes back, up to as many as may wait", () => {
    expect(MOST_PARCELS).toBe(200);
    const camp = fresh();
    for (const n of [41, MOST_PARCELS]) {
      camp.parcels = Array.from({ length: n }, (_v, i) => THINGS[i % THINGS.length]?.id ?? "gnome");
      const back = parseCamp(JSON.parse(JSON.stringify(camp)));
      expect(back?.parcels).toHaveLength(n);
      expect(back?.parcels).toEqual(camp.parcels);
    }
  });

  test("every thing put away comes back, up to as many of one thing as a member may have", () => {
    expect(MOST_OWNED).toBe(999);
    const camp = fresh();
    for (const n of [100, MOST_OWNED]) {
      camp.tray = { "plank-path": n, picket: 3 };
      const back = parseCamp(JSON.parse(JSON.stringify(camp)));
      expect(back?.tray).toEqual(camp.tray);
      expect(back ? owned(back, "plank-path") : 0).toBe(n);
    }
  });

  test("every thing set out comes back, up to as many as may be set out in a camp", () => {
    expect(MOST_PLACED).toBe(300);
    for (const n of [241, MOST_PLACED]) {
      const camp = crowded(n);
      expect(camp.placed).toHaveLength(n);
      const back = parseCamp(JSON.parse(JSON.stringify(camp)));
      expect(back?.placed).toHaveLength(n);
      expect(back?.placed).toEqual(camp.placed);
      expect(back?.tray).toEqual({});
    }
  });

  test("nonsense is not a camp", () => {
    for (const raw of [null, 7, "camp", [], {}, { placed: "everywhere" }]) expect(parseCamp(raw)).toBeNull();
  });

  test("things that cannot stand where they were kept go into the tray", () => {
    const camp = fresh();
    const odd: unknown[] = [
      { id: "well", x: 0, y: 0, t: 0, s: 0 },
      { id: "stump", x: 23, y: 24, t: 0, s: 0 },
      { id: "no-such-thing", x: 30, y: 30, t: 0, s: 0 },
      "a gnome",
      null,
    ];
    const back = parseCamp({ ...camp, placed: [...camp.placed, ...odd] });
    expect(back?.placed.length).toBe(camp.placed.length);
    expect(back?.tray).toEqual({ well: 1, stump: 1 });
  });

  test("a camp is never kept without its cabin, mailbox and signpost", () => {
    const back = parseCamp({ placed: [], first: "nobody", tray: { cabin: 4, gnome: -2, well: 2.9 } });
    expect(back?.placed.map((p) => p.id).toSorted()).toEqual(["cabin", "mailbox", "signpost"]);
    expect(back?.first).toBe("");
    expect(back?.tray).toEqual({ well: 2 });
    expect(back && allReached(back.placed)).toBe(true);
  });

  test("a present is remembered once for each guild-mate", () => {
    const back = parseCamp({
      placed: [],
      gave: [
        { to: "Mossback", what: "pinecone" },
        { to: "Mossback", what: "acorn-jar" },
        { to: "<script>", what: "pinecone" },
        { to: "Tindra", what: "the moon" },
      ],
    });
    expect(back?.gave).toEqual([{ to: "Mossback", what: "pinecone" }]);
  });

  test("every square of the clearing has a number", () => {
    expect(taken([]).solid.length).toBe(CGW * CGH);
  });

  test("every thing in the catalogue can stand somewhere in an empty yard, every way round", () => {
    for (const t of THINGS)
      for (let turn = 0; turn < turnsOf(t); turn++) expect(freeSpot([], t.id, { x: 24, y: 24 }, turn)).not.toBeNull();
    expect(isThing("cabin")).toBe(true);
  });
});

describe("unpacking a parcel", () => {
  const near = { x: 37, y: 31 };

  test("what was in it is in the kept camp before it is seen to land, and stays if the flight is cleared", () => {
    const camp = fresh();
    camp.parcels = ["barrel", "gnome"];
    const got = unpackParcel(camp, (id) => freeSpot(camp.placed, id, near));
    expect(got?.id).toBe("barrel");
    expect(got?.at?.id).toBe("barrel");
    // Delivery has started and nothing has landed: a reload now finds it standing, not waiting.
    const reloaded = (): Camp | null => parseCamp(JSON.parse(JSON.stringify(camp)));
    expect(reloaded()?.parcels).toEqual(["gnome"]);
    expect(reloaded()?.placed.filter((p) => p.id === "barrel")).toEqual(got?.at ? [got.at] : []);
    expect(owned(camp, "barrel")).toBe(1);
    // Leaving the camp drops whatever is in the air, and the flight was only ever how it was seen.
    clearFlights();
    expect(flights).toHaveLength(0);
    expect(reloaded()?.placed.filter((p) => p.id === "barrel")).toHaveLength(1);
    expect(reloaded()?.parcels).toEqual(["gnome"]);
  });

  test("with nowhere to go it goes into the tray, still in one step", () => {
    const camp = fresh();
    camp.parcels = ["well"];
    expect(unpackParcel(camp, () => null)).toEqual({ id: "well", at: null });
    expect(camp.parcels).toEqual([]);
    expect(camp.tray).toEqual({ well: 1 });
    expect(unpackParcel(camp, () => null)).toBeNull();
  });
});

describe("a full camp", () => {
  test("the 301st thing set down is refused and stays in the tray, and a parcel opened goes there too", () => {
    const camp = crowded(MOST_PLACED);
    expect(campFull(camp.placed)).toBe(true);
    camp.tray = { gnome: 1 };
    // There is ground for it; it is only that the camp has as many set out as may be.
    const spot = freeSpot(camp.placed, "gnome", { x: 30, y: 30 });
    if (!spot) throw new Error("no ground for a gnome");
    expect(setOut(camp, "gnome", spot.x, spot.y)).toBe("full");
    expect(WHY_NOT.full).toBe("The camp is full. Put something away first.");
    expect(camp.placed).toHaveLength(MOST_PLACED);
    expect(camp.tray).toEqual({ gnome: 1 });
    let looked = 0;
    camp.parcels = ["barrel"];
    expect(
      unpackParcel(camp, () => {
        looked++;
        return spot;
      }),
    ).toEqual({ id: "barrel", at: null });
    expect(looked).toBe(0);
    expect(camp.tray).toEqual({ gnome: 1, barrel: 1 });
    // Nothing is lost on a reload, and putting one thing away makes room for the gnome.
    const back = parseCamp(JSON.parse(JSON.stringify(camp)));
    expect(back?.placed).toHaveLength(MOST_PLACED);
    expect(back?.tray).toEqual({ gnome: 1, barrel: 1 });
    expect(putAway(camp, at(camp, "plank-path"))).toBe(true);
    expect(setOut(camp, "gnome", spot.x, spot.y)).toBe("ok");
    expect(camp.placed).toHaveLength(MOST_PLACED);
    expect(camp.tray).toEqual({ barrel: 1, "plank-path": 1 });
  });
});

describe("the mailbox", () => {
  test("a letter waits until it is read and its present taken", () => {
    const box = [letter("a", "Pipwick", "hello"), letter("b", "Tindra", "for you", "flower-pot")];
    expect(waiting(box)).toBe(2);
    for (const l of box) l.read = true;
    expect(waiting(box)).toBe(1);
    const [, second] = box;
    if (second) second.taken = true;
    expect(waiting(box)).toBe(0);
    expect(tidied(box)).toEqual([]);
  });

  test("the same letter is not delivered twice", () => {
    const box = [letter("a", "Pipwick", "hello")];
    expect(post(box, letter("a", "Pipwick", "hello again"))).toBe(false);
    expect(post(box, letter("b", "Pipwick", "hello again"))).toBe(true);
    expect(box.length).toBe(2);
  });

  test("a full box makes room by dropping what has been dealt with, oldest first", () => {
    const box = Array.from({ length: 12 }, (_v, i) => letter(`l${i}`, "Wrenly", "a note"));
    const third = box[3];
    if (third) third.read = true;
    post(box, letter("new", "Wrenly", "another"));
    expect(box.length).toBe(12);
    expect(box.some((l) => l.id === "l3")).toBe(false);
    expect(box.every(open)).toBe(true);
    post(box, letter("newer", "Wrenly", "and another"));
    expect(box[0]?.id).toBe("l1");
  });

  test("a box full of presents throws none away: the next letter is not left, and every one comes back", () => {
    const camp = fresh();
    camp.letters = Array.from({ length: BOX }, (_v, i) => letter(`g${i}`, "Tindra", "for you", "toadstool"));
    const ids = camp.letters.map((l) => l.id);
    expect(roomInBox(camp.letters)).toBe(false);
    expect(post(camp.letters, letter("late", "Pipwick", "and this", "cushion"))).toBe(false);
    expect(camp.letters.map((l) => l.id)).toEqual(ids);
    const back = parseCamp(JSON.parse(JSON.stringify(camp)));
    expect(back?.letters.filter(open)).toHaveLength(BOX);
    // Reading one is not enough; taking its present out makes room.
    const first = camp.letters[0];
    if (first) first.read = true;
    expect(roomInBox(camp.letters)).toBe(false);
    if (first) first.taken = true;
    expect(post(camp.letters, letter("late", "Pipwick", "and this", "cushion"))).toBe(true);
    expect(camp.letters).toHaveLength(BOX);
    expect(camp.letters.filter((l) => l.gift !== "" && !l.taken)).toHaveLength(BOX);
  });

  test("an unread note with nothing inside makes room before any present", () => {
    const box = Array.from({ length: BOX }, (_v, i) =>
      letter(`g${i}`, "Tindra", "for you", i === 5 ? "" : "acorn-jar"),
    );
    expect(post(box, letter("late", "Pipwick", "hello"))).toBe(true);
    expect(box.some((l) => l.id === "g5")).toBe(false);
    expect(box.filter((l) => l.gift !== "")).toHaveLength(BOX - 1);
  });

  test("only a real letter is a letter", () => {
    expect(isLetter(letter("a", "Old Barkley", "sit. the fire likes company."))).toBe(true);
    expect(isLetter({ ...letter("a", "Pipwick", "x"), gift: "the moon" })).toBe(false);
    expect(isLetter({ ...letter("a", "Pipwick", "x"), from: "<b>" })).toBe(false);
    expect(isLetter({ id: "a" })).toBe(false);
    expect(CGH).toBe(40);
  });
});
