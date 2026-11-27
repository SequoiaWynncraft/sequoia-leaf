import { describe, expect, test } from "bun:test";

import { beside, type Box, clear, EDGE, GAP, type Room, sheet } from "./place.ts";

/** The two windows every page is checked at: a laptop's and a phone's. */
const ROOMS: readonly Room[] = [
  { w: 1280, h: 760 },
  { w: 390, h: 844, floor: 96, ceiling: 120 },
];

/** A card's width in a window (`kit.css`: 220 units of 2 pixels, or the window less 8). */
const cardW = (room: Room): number => Math.min(440, room.w - 8);

/** Boxes the size a glance, a card and a long card are, in a window. */
const sizes = (room: Room): { w: number; h: number }[] => [
  { w: 150, h: 56 },
  { w: cardW(room), h: 320 },
  { w: cardW(room), h: 1200 },
];

/** Things to point at, laid over the window and past its edges: small, a button, a panel's width. */
function things(room: Room): Box[] {
  const out: Box[] = [];
  for (const [w, h] of [
    [8, 8],
    [40, 40],
    [120, 30],
    [200, 200],
  ] as const)
    for (let x = -w / 2; x <= room.w - w / 2; x += room.w / 9)
      for (let y = -h / 2; y <= room.h - h / 2; y += room.h / 11) out.push({ x, y, w, h });
  return out;
}

describe("a box beside a thing", () => {
  test("never overlaps the thing and never leaves the window, at either size, beside or to a side", () => {
    let checked = 0;
    for (const room of ROOMS)
      for (const size of sizes(room))
        for (const thing of things(room))
          for (const side of [false, true]) {
            const p = beside(size, thing, room, { side });
            const shown = { w: size.w, h: Math.min(size.h, p.most) };
            if (!clear(p, shown, thing, room))
              throw new Error(`${JSON.stringify({ room, size, thing, side, p })} overlaps or leaves the window`);
            expect(p.most).toBeGreaterThan(40);
            checked++;
          }
    expect(checked).toBeGreaterThan(2000);
  });

  test("goes above where it fits, else below, and a side first when asked", () => {
    const room = { w: 1280, h: 760 };
    expect(beside({ w: 200, h: 100 }, { x: 600, y: 400, w: 40, h: 40 }, room).side).toBe("above");
    expect(beside({ w: 200, h: 100 }, { x: 600, y: 40, w: 40, h: 40 }, room).side).toBe("below");
    expect(beside({ w: 200, h: 100 }, { x: 600, y: 400, w: 40, h: 40 }, room, { side: true }).side).toBe("right");
    expect(beside({ w: 200, h: 100 }, { x: 1200, y: 400, w: 40, h: 40 }, room, { side: true }).side).toBe("left");
  });

  test("stays on the side it was on while it fits there, and leaves it when it does not", () => {
    const room = { w: 1280, h: 760 };
    const thing = { x: 600, y: 400, w: 40, h: 40 };
    expect(beside({ w: 200, h: 100 }, thing, room, { was: "below" }).side).toBe("below");
    expect(beside({ w: 200, h: 330 }, thing, room, { was: "below" }).side).toBe("above");
  });

  test("where it fits whole nowhere, takes the largest room and is no taller than it", () => {
    const room = { w: 390, h: 844 };
    const p = beside({ w: 382, h: 2000 }, { x: 100, y: 300, w: 40, h: 40 }, room);
    expect(p.side).toBe("below");
    expect(p.most).toBe(844 - EDGE - (340 + GAP));
  });

  test("a thing covering the window leaves no room: the box stays inside the window", () => {
    const room = { w: 390, h: 844 };
    const p = beside({ w: 300, h: 200 }, { x: -10, y: -10, w: 500, h: 900 }, room);
    expect(p.x).toBeGreaterThanOrEqual(EDGE);
    expect(p.y + Math.min(200, p.most)).toBeLessThanOrEqual(844 - EDGE);
  });
});

describe("a sheet under a finger", () => {
  test("goes along the bottom, or the top where the bottom would cover the thing, and covers it from neither", () => {
    for (const room of ROOMS) {
      const floor = room.floor ?? 0;
      const ceiling = room.ceiling ?? 0;
      for (const h of [120, 400, 900])
        for (const thing of things(room)) {
          const s = sheet(h, thing, room);
          const tall = Math.min(h, s.most);
          const top = s.edge === "top" ? ceiling : room.h - floor - tall;
          const t0 = Math.max(0, thing.y);
          const t1 = Math.min(room.h, thing.y + thing.h);
          const apart = top + tall <= t0 || top >= t1;
          if (!apart && t1 > t0) throw new Error(`${JSON.stringify({ room, h, thing, s })} covers the thing`);
          expect(top).toBeGreaterThanOrEqual(s.edge === "top" ? ceiling : 0);
          expect(top + tall).toBeLessThanOrEqual(room.h - (s.edge === "bottom" ? floor : 0));
        }
    }
  });

  test("is at the bottom for a thing at the top, at the top for a thing at the bottom, and at the bottom for no thing", () => {
    const room = { w: 390, h: 844, floor: 96 };
    expect(sheet(300, { x: 100, y: 80, w: 40, h: 40 }, room).edge).toBe("bottom");
    expect(sheet(300, { x: 100, y: 640, w: 40, h: 40 }, room).edge).toBe("top");
    expect(sheet(300, null, room).edge).toBe("bottom");
  });
});
