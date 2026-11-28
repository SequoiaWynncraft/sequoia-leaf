/**
 * Rings built at random (`round.ts`): a ring of a random size and grade, with splitters, sorters,
 * joiners and stocked crates along it, a tunnel in it, and sorters at its corners whose straight ways
 * run round outside it and back in, so the order breaks round it in more than one place; a splitter
 * on it sends what it can off it first, onto a belt of a random grade into a shut crate (the drain).
 *
 * The drain takes what the same pieces would bring it as a line: the ring cut open just past the
 * drain, where a shut crate takes what goes on. That is the belt's pace where every piece runs at it
 * (the drain's belt of the ring's grade, at grade I or III); less where the rules carry less on a
 * line too, as through a crate at grade II, which hands a thing on from the start of the next tile,
 * or into a drain's belt slower than the ring. And no thing is made or lost. Rings by hand in
 * `beltrings.test.ts`.
 */
import { expect, test } from "bun:test";

import * as F from "../src/index.ts";
import { bareLand } from "./land.ts";
import { rng } from "./random.ts";
import { must } from "./yards.ts";

const PLANK = F.item("plank");
/** A tile of the ring: where, the way it hands on, and what stands there. */
interface Spot {
  readonly x: number;
  readonly z: number;
  readonly dir: number;
  kind: "belt" | "splitter" | "sorter" | "stone" | "joiner" | "crate" | "tunnel" | "under" | "corner" | "drain" | "cut";
  /** Kept a belt: a chord comes back in beside it. */
  keep?: boolean;
}

/** A ring's tiles clockwise from its north-west corner (`w` by `h`, the corner at x0, z0), each a belt to begin with. */
function spots(x0: number, z0: number, w: number, h: number): Spot[] {
  const out: Spot[] = [];
  const [x1, z1] = [x0 + w - 1, z0 + h - 1];
  for (let x = x0; x < x1; x++) out.push({ x, z: z0, dir: 0, kind: "belt" });
  for (let z = z0; z < z1; z++) out.push({ x: x1, z, dir: 1, kind: "belt" });
  for (let x = x1; x > x0; x--) out.push({ x, z: z1, dir: 2, kind: "belt" });
  for (let z = z1; z > z0; z--) out.push({ x: x0, z, dir: 3, kind: "belt" });
  return out;
}

/** What a yard holds of planks: on what carries, under the ground, and in every holder. */
function planks(y: F.Yard): number {
  let n = 0;
  for (let i = 0; i < y.kind.length; i++) {
    if (y.kind[i] === F.NONE) continue;
    if (F.carries(y.kind[i] ?? F.NONE) && y.item[i] === PLANK) n++;
    const t = F.tunnelOf(y, i);
    for (let u = t * F.SPAN_MOST; u < t * F.SPAN_MOST + (t >= 0 ? (y.span[i] ?? 0) : 0); u++)
      if (y.tunnels.under[u] === PLANK) n++;
    const r = F.holderOf(y, i);
    if (r < 0 || F.pieceOf(y, i) !== i) continue;
    const h = y.holders;
    n += (h.count[r] ?? 0) + (h.out[r] === F.NONE ? 0 : 1 + (h.more[r] ?? 0)) + (h.also[r] === F.NONE ? 0 : 1);
  }
  return n;
}

/**
 * A random ring in a bare yard (as the module says), from a seed: the yard, the drain's crate's row,
 * the grades. With `cut`, the same ring cut open just past the drain: a shut crate in the tile after it.
 */
function randomRing(
  seed: number,
  cut = false,
): { y: F.Yard; bin: number; grade: number; drainGrade: number; tiles: number } {
  const r = rng(seed);
  const pick = (n: number): number => Math.floor(r() * n);
  const y = F.create({ land: bareLand(40, 34, [], [36, 30]), tier: 8, seed: 1 });
  const [x0, z0, w, h] = [6, 6, 8 + pick(9), 7 + pick(7)];
  const [x1, z1] = [x0 + w - 1, z0 + h - 1];
  const grade = 1 + pick(3);
  const drainGrade = 1 + pick(3);
  const ring = spots(x0, z0, w, h);
  const at = (x: number, z: number): Spot | undefined => ring.find((s) => s.x === x && s.z === z);
  const b = (kind: string, x: number, z: number, dir: number, more: object = {}): void =>
    must(y, { do: "build", kind, x, y: z, dir, ...more });
  // Sorters at the north-east and south-west corners, whose straight ways run round outside and back in.
  const chords: [number, number, number, number][] = [];
  if (r() < 0.6) {
    const reach = 1 + pick(h - 3);
    for (let k = 0; k < reach; k++) chords.push([x1 + 1, z0 + k, 1, 0]);
    chords.push([x1 + 1, z0 + reach, 2, 0]);
    const corner = at(x1, z0);
    if (corner) corner.kind = "corner";
    for (let k = 1; k <= reach; k++) {
      const s = at(x1, z0 + k);
      if (s) s.keep = true;
    }
  }
  if (r() < 0.6) {
    const reach = 1 + pick(h - 3);
    for (let k = 0; k < reach; k++) chords.push([x0 - 1, z1 - k, 3, 0]);
    chords.push([x0 - 1, z1 - reach, 0, 0]);
    const corner = at(x0, z1);
    if (corner) corner.kind = "corner";
    for (let k = 1; k <= reach; k++) {
      const s = at(x0, z1 - k);
      if (s) s.keep = true;
    }
  }
  // The drain on the top row, clear of its corners.
  const drain = at(x0 + 2 + pick(w - 4), z0);
  if (drain) drain.kind = "drain";
  // A tunnel on the bottom row, clear of its corners: its way-in mouth, the tile it passes under, its far mouth.
  if (r() < 0.8) {
    const x = x1 - 2 - pick(w - 5);
    const [mouth, under, far] = [at(x, z1), at(x - 1, z1), at(x - 2, z1)];
    if (mouth && under && far && x - 2 > x0) {
      mouth.kind = "tunnel";
      under.kind = "under";
      far.kind = "under";
    }
  }
  // Along the rest, at random: belts, splitters, sorters (set to planks' way straight on, or to nothing), joiners, crates.
  const straight = ring.filter(
    (s) => s.kind === "belt" && !s.keep && !((s.x === x0 || s.x === x1) && (s.z === z0 || s.z === z1)),
  );
  for (const s of straight) {
    const roll = r();
    s.kind =
      roll < 0.55
        ? "belt"
        : roll < 0.65
          ? "splitter"
          : roll < 0.72
            ? "sorter"
            : roll < 0.79
              ? "stone"
              : roll < 0.88
                ? "joiner"
                : "crate";
  }
  // A crate on the ring's west side, stocked to keep it full while the drain takes, whether or not it is cut.
  const firstCrate = straight.find((s) => s.dir === 3);
  if (firstCrate) firstCrate.kind = "crate";
  const past = drain ? ring[ring.indexOf(drain) + 1] : undefined;
  if (cut && past) past.kind = "cut";
  for (const s of ring) {
    const g = { grade };
    if (s.kind === "under") continue;
    if (s.kind === "crate") {
      b("crate", s.x, s.z, s.dir);
      const n = s === firstCrate ? 400 : 10 + pick(50);
      for (let k = 0; k < n; k++) F.put(y.holders, F.holderOf(y, F.at(y, s.x, s.z)), PLANK);
    } else if (s.kind === "cut") {
      // Facing off the ring, so nothing it holds could go round: the ring is a line.
      b("crate", s.x, s.z, 3);
      must(y, { do: "crate", x: s.x, y: s.z, open: false });
    } else if (s.kind === "corner") {
      // The corner's sorter takes from behind, sends planks right, round the ring, and anything else straight on.
      b("sorter", s.x, s.z, (s.dir + 3) & 3, g);
      must(y, { do: "sort", x: s.x, y: s.z, item: "plank" });
      must(y, { do: "side", x: s.x, y: s.z, right: true });
    } else if (s.kind === "stone") {
      b("sorter", s.x, s.z, s.dir, g);
      must(y, { do: "sort", x: s.x, y: s.z, item: "stone" });
    } else if (s.kind === "drain") {
      b("splitter", s.x, s.z, s.dir, g);
      b("belt", s.x, s.z - 1, 3, { grade: drainGrade });
      b("crate", s.x, s.z - 2, 3);
      must(y, { do: "crate", x: s.x, y: s.z - 2, open: false });
      must(y, { do: "first", x: s.x, y: s.z, way: 1 });
    } else b(s.kind, s.x, s.z, s.dir, g);
  }
  for (const [x, z, dir] of chords) b("belt", x, z, dir, { grade });
  // Full: a plank across every tile of the ring that carries, and under the ground.
  for (const s of ring) {
    const i = F.at(y, s.x, s.z);
    if (!F.carries(y.kind[i] ?? F.NONE)) continue;
    y.item[i] = PLANK;
    y.prog[i] = 8;
    const t = F.tunnelOf(y, i);
    for (let u = t * F.SPAN_MOST; u < t * F.SPAN_MOST + (t >= 0 ? (y.span[i] ?? 0) : 0); u++) {
      y.tunnels.under[u] = PLANK;
      y.tunnels.along[u] = 8;
    }
  }
  F.changed(y);
  const bin = drain ? F.holderOf(y, F.at(y, drain.x, drain.z - 2)) : -1;
  return { y, bin, grade, drainGrade, tiles: ring.length };
}

/** What the drain of a random ring took in the ten seconds from second 10, and whether every plank is still there. */
function run(
  seed: number,
  cut: boolean,
): { took: number; kept: boolean; rings: number; grade: number; drainGrade: number } {
  const { y, bin, grade, drainGrade } = randomRing(seed, cut);
  const had = planks(y);
  while (y.tick < 100) F.step(y);
  const from = F.held(y.holders, bin, PLANK);
  while (y.tick < 200) F.step(y);
  const took = F.held(y.holders, bin, PLANK) - from;
  return { took, kept: planks(y) === had, rings: F.ringsOf(y).rings, grade, drainGrade };
}

test("a ring built at random brings its drain what the same pieces would as a line, the belt's pace where they all run at it, and loses nothing", () => {
  const seen: string[] = [];
  for (let seed = 1; seed <= 40; seed++) {
    const ring = run(seed, false);
    const line = run(seed, true);
    // What a belt carries a tick is its grade's pace in eighths of a tile.
    const pace = (100 * (F.PACE[ring.grade] ?? 0)) / 8;
    const belt = ring.grade !== 2 && ring.drainGrade === ring.grade ? Math.abs(ring.took - pace) <= 1 : true;
    const says = [
      ring.rings === 1 && line.rings === 0,
      Math.abs(ring.took - line.took) <= 1,
      belt,
      ring.kept && line.kept,
    ];
    const got = `${seed}: ${says.join(" ")}`;
    const why = ` (grade ${ring.grade}, drain ${ring.drainGrade}: ring ${ring.took}, line ${line.took}, belt ${pace})`;
    seen.push(says.every(Boolean) ? got : got + why);
  }
  expect(seen).toEqual(Array.from({ length: 40 }, (_, k) => `${k + 1}: true true true true`));
});
