import { describe, expect, test } from "bun:test";

import {
  allReached,
  boxOf,
  type Camp,
  canPlace,
  CGH,
  CGW,
  COSY,
  freeSpot,
  KIND,
  layout,
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
  YARD,
} from "./camp.ts";
import { isLetter, letter, open, post, tidied, waiting } from "./mail.ts";
import { footprint, isThing, KINDS, thingOf, THINGS, turnsOf } from "./things.ts";

const fresh = (): Camp => structuredClone(newCamp());
const at = (camp: Camp, id: string): number => camp.placed.findIndex((p) => p.id === id);

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

  test("only a real letter is a letter", () => {
    expect(isLetter(letter("a", "Old Barkley", "sit. the fire likes company."))).toBe(true);
    expect(isLetter({ ...letter("a", "Pipwick", "x"), gift: "the moon" })).toBe(false);
    expect(isLetter({ ...letter("a", "Pipwick", "x"), from: "<b>" })).toBe(false);
    expect(isLetter({ id: "a" })).toBe(false);
    expect(CGH).toBe(40);
  });
});
