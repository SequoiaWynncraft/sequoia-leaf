/**
 * The board's value budget (`RAID-BOARD.md` section 12), from the figures' own rows and the board's
 * tones, with no canvas: the faces' lightness, the grooves' step, the ink edge against a face, how
 * much of each figure sinks into a face, and the two halves apart. Colours are CIELAB (sRGB, D65).
 */
import { describe, expect, test } from "bun:test";

import { artOf } from "@sequoia-leaf/figures/figures.ts";
import { FIGURE_PAL } from "@sequoia-leaf/figures/pal.ts";
import { CREAM, INK, WATER } from "@sequoia-leaf/kit/palette.ts";
import { eraOf, RELEASES } from "@sequoia-leaf/raid";
import { catalogAt } from "@sequoia-leaf/raid/content/catalog.ts";
import { SUMMON_IDS, TROUBLE_IDS, type UnitKind } from "@sequoia-leaf/raid/content/figures.ts";
import { hasTrueForm } from "@sequoia-leaf/raid/content/graid.ts";

import { COMMODORE, type Crew, CREW_FRONT, GROOTERS } from "../../../review/crew.ts";
import { BENCH, BOARD, type HexTones, quietOf, RIM } from "./board.ts";

/** A channel (0 to 255) as linear light, and lightness's curve. */
const lin = (v: number): number => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
/** A colour as CIELAB: lightness, a, b. */
function lab(hex: string): readonly [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  const r = lin((n >> 16) & 255);
  const g = lin((n >> 8) & 255);
  const b = lin(n & 255);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const L = (hex: string): number => lab(hex)[0];
const chroma = (hex: string): number => Math.hypot(lab(hex)[1], lab(hex)[2]);
const dE = (p: string, q: string): number => {
  const [a, b] = [lab(p), lab(q)];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
};

/** A figure as the colours of its pixels, its ink edge left out. */
type Pixels = readonly string[];
const pixelsOf = (rows: readonly string[], pal: Readonly<Record<string, string>>): Pixels =>
  rows.flatMap((row) => row.split("").flatMap((ch) => (pal[ch] && pal[ch] !== INK ? [pal[ch]] : [])));
/** A person drawn from a skin, as the colours of their front. */
const person = (inks: Crew): Pixels => CREW_FRONT.flatMap((rows) => pixelsOf(rows, { ...inks }));

/** Every figure any release has, the forest's own, the summoned, Graid's five in their true forms. */
function everyone(): Map<string, Pixels> {
  const kinds = new Set<UnitKind>([...TROUBLE_IDS, ...SUMMON_IDS]);
  for (const r of RELEASES) for (const k of catalogAt(eraOf(r.id)).order) kinds.add(k);
  const out = new Map<string, Pixels>();
  for (const k of kinds) {
    const rows = artOf(k).rows;
    if (rows.length > 0) out.set(k, pixelsOf(rows, FIGURE_PAL));
    if (hasTrueForm(k)) out.set(`${k} true`, pixelsOf(artOf(k, "true").rows, FIGURE_PAL));
  }
  // People, drawn from a member's skin (the Commodore and his grooters): the review's made-up crew.
  out.set("commodore", person(COMMODORE));
  for (const [name, inks] of GROOTERS) out.set(`grooter ${name}`, person(inks));
  // Yule's bubble: its ring and the bright arc on it.
  out.set("bubble", [WATER[3], WATER[3], WATER[3], CREAM]);
  return out;
}
const EVERYONE = everyone();

/** The share of a figure's own pixels within ΔE 14 of a ground: they read as holes in it. */
const lost = (px: Pixels, ground: string): number => px.filter((c) => dE(c, ground) < 14).length / px.length;

/** Mud keeps only its edge and its face on the board's faces (its picture wants a lighter tone): seen here when it changes. */
const MUD = { near: 0.78, far: 0.18 } as const;

const HALVES = { near: BOARD.near, far: BOARD.far } as const;
const round2 = (v: number): number => Math.round(v * 100) / 100;

describe("the board's value budget", () => {
  test("every rule is checked against the figures it is about", () => {
    // The 29 of the base set, the three new sets' figures, the forest's own, the summoned, Graid's five.
    expect(EVERYONE.size).toBeGreaterThanOrEqual(60);
  });

  test("1. faces are L* 26 to 48, grooves 12 to 26 darker (6 to 14 in a fight), the bare board's tones chroma 22 or less", () => {
    for (const t of Object.values(HALVES)) {
      expect(L(t.face)).toBeGreaterThanOrEqual(26);
      expect(L(t.face)).toBeLessThanOrEqual(48);
      expect(L(t.lip)).toBeLessThanOrEqual(54);
      const step = L(t.face) - L(t.groove);
      expect(step).toBeGreaterThanOrEqual(12);
      expect(step).toBeLessThanOrEqual(26);
      const quiet = quietOf(t);
      const calm = L(quiet.face) - L(quiet.groove);
      expect(calm).toBeGreaterThanOrEqual(6);
      expect(calm).toBeLessThanOrEqual(14);
    }
    // The hexes and the wood round them: the bare board.
    const bare = [
      ...Object.values(HALVES).flatMap((t: HexTones) => [t.face, t.lip, t.groove, t.edge]),
      BOARD.wood,
      BOARD.ring,
      BOARD.fleck,
    ];
    for (const tone of bare) expect([tone, chroma(tone) <= 22]).toEqual([tone, true]);
    // The stump's bark at its rim and the bench's plank are their own wood, as dark as the board.
    for (const tone of [RIM.pale, RIM.dark, BENCH.plank, BENCH.top, BENCH.foot, BENCH.slat]) {
      expect([tone, L(tone) <= 48]).toEqual([tone, true]);
    }
    // Darkest to lightest: the wood, their half, your half.
    expect(L(BOARD.wood)).toBeLessThan(L(BOARD.far.face));
  });

  test("2. the ink edge against a face is at least 1.5 times the groove's step, and 38 on yours, 28 on theirs", () => {
    for (const [side, t] of Object.entries(HALVES)) {
      const edge = L(t.face) - L(INK);
      expect([side, edge >= 1.5 * (L(t.face) - L(t.groove))]).toEqual([side, true]);
      expect([side, edge >= (side === "near" ? 38 : 28)]).toEqual([side, true]);
    }
  });

  test("3. no figure loses more than 30% of its fill to a face, but mud", () => {
    for (const [side, t] of Object.entries(HALVES)) {
      const sunk = [...EVERYONE]
        .filter(([kind, px]) => kind !== "mud" && lost(px, t.face) > 0.3)
        .map(([kind, px]) => `${kind} ${Math.round(lost(px, t.face) * 100)}%`);
      expect([side, sunk]).toEqual([side, []]);
    }
    const mud = EVERYONE.get("mud") ?? [];
    expect({ near: round2(lost(mud, BOARD.near.face)), far: round2(lost(mud, BOARD.far.face)) }).toEqual(MUD);
  });

  test("4. your face is 8 to 12 lighter than theirs", () => {
    const apart = L(BOARD.near.face) - L(BOARD.far.face);
    expect(apart).toBeGreaterThanOrEqual(8);
    expect(apart).toBeLessThanOrEqual(12);
  });
});
