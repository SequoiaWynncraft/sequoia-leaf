/** Where pictures lie on an atlas (`atlas.ts`): no two on the same pixels, none past its edge, and what happens when it is full. */
import { describe, expect, test } from "bun:test";

import { Atlas, type Place } from "./atlas.ts";
import { rng } from "./util.ts";

/** A picture's size, as a thing to place. */
interface Pic {
  readonly w: number;
  readonly h: number;
}

/** Whether two placed pictures share any pixel. */
const overlap = (a: Place & Pic, b: Place & Pic): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("an atlas", () => {
  test("places every picture inside itself, no two on the same pixels, and fills well before it has no room", () => {
    const atlas = new Atlas<Pic>(256, 256);
    const next = rng(7);
    const placed: (Place & Pic)[] = [];
    for (let n = 0; n < 2000; n++) {
      const pic = { w: 1 + Math.floor(next() * 40), h: 1 + Math.floor(next() * 40) };
      const at = atlas.place(pic, pic.w, pic.h);
      if (at) placed.push({ ...at, ...pic });
    }
    // 2,000 pictures of about 400 pixels each are far more than it holds: it took what fitted, and is well filled.
    expect(placed.length).toBeGreaterThan(150);
    expect(placed.length).toBeLessThan(2000);
    expect(placed.reduce((sum, p) => sum + p.w * p.h, 0)).toBeGreaterThan(256 * 256 * 0.8);
    for (const p of placed) expect(p.x >= 0 && p.y >= 0 && p.x + p.w <= 256 && p.y + p.h <= 256).toBe(true);
    for (let a = 0; a < placed.length; a++)
      for (let b = a + 1; b < placed.length; b++) {
        const [p, q] = [placed[a], placed[b]];
        if (p && q && overlap(p, q)) throw new Error(`${JSON.stringify(p)} lies on ${JSON.stringify(q)}`);
      }
  });

  test("keeps a picture where it was put, and knows nothing of one it has not placed", () => {
    const atlas = new Atlas<Pic>(64, 64);
    const [a, b] = [
      { w: 10, h: 10 },
      { w: 10, h: 10 },
    ];
    const at = atlas.place(a, 10, 10);
    atlas.place(b, 10, 10);
    expect(atlas.at(a)).toEqual(at ?? undefined);
    expect(atlas.at(b)).not.toEqual(atlas.at(a));
    expect(atlas.at({ w: 10, h: 10 })).toBeUndefined();
  });

  test("says when a picture does not fit, and starts again twice as large with nothing placed, up to its largest", () => {
    const atlas = new Atlas<Pic>(32, 64);
    const big = { w: 30, h: 30 };
    expect(atlas.place(big, 30, 30)).toEqual({ x: 0, y: 0 });
    const more = { w: 30, h: 30 };
    expect(atlas.place(more, 30, 30)).toBeNull();
    atlas.restart();
    expect([atlas.size, atlas.turn, atlas.count, atlas.at(big)]).toEqual([64, 1, 0, undefined]);
    expect(atlas.place(more, 30, 30)).toEqual({ x: 0, y: 0 });
    // At its largest it starts again at the same size.
    atlas.restart();
    expect([atlas.size, atlas.turn]).toEqual([64, 2]);
  });

  test("refuses a picture larger than it can ever be", () => {
    const atlas = new Atlas<Pic>(32, 64);
    expect(() => atlas.place({ w: 65, h: 4 }, 65, 4)).toThrow("larger than the atlas");
  });
});
