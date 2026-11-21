import { describe, expect, test } from "bun:test";

import type { Pt } from "@sequoia-leaf/kit/util.ts";

import { STRINGS, tieAt, wire } from "./strings.ts";

const at = (p: Pt): string => `${p.x},${p.y}`;

describe("strings of lights", () => {
  test("every string's two ends lie on a tie: a post's arm, a stall's corner, an eave or a trunk", () => {
    const loose: string[] = [];
    for (const s of STRINGS) {
      const w = wire(s);
      for (const end of [w[0], w.at(-1)])
        if (!end || !tieAt(end))
          loose.push(`the string from ${at(s.from)} to ${at(s.to)}, at ${end ? at(end) : "neither"}`);
    }
    expect(loose).toEqual([]);
  });

  test("the wire runs from one tie to the other", () => {
    for (const s of STRINGS) {
      const w = wire(s);
      expect(w[0]).toEqual(s.from);
      expect(w.at(-1)).toEqual(s.to);
    }
  });

  test("the air beside a post or past a stall is no tie", () => {
    // Where two strings once ended: past the third stall, and just over the arm of the post at the stump.
    expect(tieAt({ x: 196, y: 232 })).toBeUndefined();
    expect(tieAt({ x: 433, y: 144 })).toBeUndefined();
    // Their ties now, and a stall's corner.
    expect(tieAt({ x: 197, y: 243 })?.what).toBe("the arm of the post at 188,276");
    expect(tieAt({ x: 433, y: 148 })?.what).toBe("the arm of the post at 424,181");
    expect(tieAt({ x: 175, y: 204 })?.what).toBe("the stall at 136,248");
  });
});
