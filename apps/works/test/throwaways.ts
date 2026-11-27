/**
 * The throwaway kinds of more than one tile `kinds/new-kind.test.ts` adds to a copy of the
 * repository: each one module of the rules and one of the page, as any kind is, and the recipes they
 * make, which are content. A sifter of two tiles by two sifts stone into sand, with clay beside it out
 * of a second way out; a forge of three by three makes resin of deadfall and stone, out of the middle
 * of its front. And what plays them by the rules, in the copy.
 */

/** The content they make: the makers' names, and a recipe each, the sifter's with a by-product. */
export const MAKERS = `"mill" | "bench" | "workshop" | "sifter" | "forge"`;
export const RECIPE_LINES = [
  `  { out: "sand", also: "clay", from: { stone: 1 }, by: "sifter", ticks: 10 },`,
  `  { out: "resin", from: { deadfall: 1, stone: 1 }, by: "forge", ticks: 10 },`,
];

/** A throwaway machine's rules: `size` tiles, taking parts on its back and sides, and its ways out. */
const rules = (
  name: string,
  size: number,
  what: string,
  outs: string,
): string => `/** A throwaway kind for the test that a kind may cover many tiles. */
import { BIG_MAKER } from "./big.ts";
import { kind } from "./kind.ts";
import { backAndSides, front } from "./ports.ts";

export const ${name} = kind({
  name: "${name}",
  info: { name: "${name[0]?.toUpperCase()}${name.slice(1)}", cost: 40, draw: 2, gives: 0, what: "${what}" },
  graded: true,
  holds: true,
  size: [${size}, ${size}],
  ports: { in: backAndSides(${size}, ${size}), out: [${outs}] },
  rules: BIG_MAKER,
});
`;
export const RULES_SIFTER = rules(
  "sifter",
  2,
  "Sifts stone into sand, and clay beside it.",
  `{ at: front(2, 0), sends: "out" }, { at: front(2, 1), sends: "also" }`,
);
export const RULES_FORGE = rules("forge", 3, "Makes resin of deadfall and stone.", `{ at: front(3, 1), sends: "out" }`);

/** A throwaway machine on the page: a picture of its own, drawn once over its tiles. */
const page = (
  name: string,
  dock: number,
): string => `/** A throwaway kind for the test that a kind may cover many tiles. */
import { GOLD } from "@sequoia-leaf/kit/palette.ts";

import { bm } from "../art/pal.ts";
import type { KindPage } from "./kind.ts";

const PLATE = ["nnnn", "nyyn", "nyyn", "nnnn"];

export const ${name}: KindPage = {
  picture: () => bm(PLATE, 4, 4).c,
  draw(art, _y, at) {
    at.stand(art.zed, at.cx, at.foot - 4, at.z, at.a);
    return at.foot - 8;
  },
  pointer: "bare",
  lamps: (_y, _i, x, foot, _at, out) => out.push({ x, y: foot - 4, r: 9, power: 0.4, reach: false }),
  map: [GOLD[1], GOLD[2]],
  dock: ${dock},
  faces: true,
};
`;
export const PAGE_SIFTER = page("sifter", 16);
export const PAGE_FORGE = page("forge", 17);

/**
 * Plays both throwaways by the rules, in the copy, and prints what it found as one line of JSON, each
 * part true where it holds: built and refused where they do not fit, fed on their backs and sides and
 * never their fronts, working and handing out of their ways out (the sifter its by-product out of its
 * second, and stopping while that one is blocked), standing as one from any tile, and removed, moved,
 * copied, blueprinted, coded, kept in a plan of the whole yard and put back, undone, kept and read
 * back, checked and walked round.
 */
export const PLAY_BIG = `import * as F from "./packages/factory/src/index.ts";
import { act } from "./packages/factory/src/commands.ts";
import { bareLand } from "./packages/factory/test/land.ts";

const kindOf = (name) => {
  const k = F.kindNamed(name);
  if (k === null) throw new Error("no " + name);
  return k;
};
const land = bareLand(34, 20, [], [26, 10]);
const fresh = () => {
  const y = F.create({ land, tier: 4, seed: 1 });
  for (const n of ["sifter", "forge"]) y.open.kinds[kindOf(n)] = 1;
  return y;
};
const tile = (y, x, z) => F.at(y, x, z);
const run = (y, n) => {
  for (let t = 0; t < n; t++) F.step(y);
};
const belts = (y, x0, x1, z) => {
  for (let x = x0; x <= x1; x++) if (!F.build(y, F.BELT, x, z, 0, Infinity).ok) throw new Error("no belt at " + x + "," + z);
};
/** Every tile from (x0, z0) to (x1, z1) holds the kind and knows the piece on (ox, oz) as its own. */
const covers = (y, k, x0, z0, x1, z1, ox, oz) => {
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) if (y.kind[tile(y, x, z)] !== k || F.pieceOf(y, tile(y, x, z)) !== tile(y, ox, oz)) return false;
  return true;
};
const bare = (y, x0, z0, x1, z1) => {
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (y.kind[tile(y, x, z)] !== F.NONE || y.part[tile(y, x, z)] !== 0) return false;
  return true;
};
const out = {};

// The sifter, two by two, its own tile (20, 10) facing east: it covers 20 to 21 across and 10 to 11 down,
// in reach of the depot's power; its two ways out lead on belts into the depot, which covers 25 to 27.
const SIFTER = kindOf("sifter");
const sifting = (byproduct) => {
  const y = fresh();
  if (!F.build(y, F.CRATE, 18, 10, 0, Infinity).ok) throw new Error("no crate");
  for (let n = 0; n < 40; n++) F.put(y.holders, F.holderOf(y, tile(y, 18, 10)), F.item("stone"));
  belts(y, 19, 19, 10);
  out.built = F.build(y, SIFTER, 20, 10, 0, Infinity).ok;
  belts(y, 22, 24, 10);
  if (byproduct) belts(y, 22, 24, 11);
  return y;
};
const y = sifting(true);
out.covers = covers(y, SIFTER, 20, 10, 21, 11, 20, 10);
out.overBelt = F.refusal(y, F.BELT, 21, 11, Infinity) === "Something is here already";
out.overlap = F.refusal(y, SIFTER, 19, 9, Infinity) === "Something is here already";
out.offMap = F.refusal(y, SIFTER, 33, 5, Infinity) === "That is off the map";
out.takesBack = F.takes(y, tile(y, 20, 10), tile(y, 19, 10));
out.takesSides = F.takes(y, tile(y, 21, 10), tile(y, 21, 9)) && F.takes(y, tile(y, 20, 11), tile(y, 20, 12));
out.refusesFront = !F.takes(y, tile(y, 21, 10), tile(y, 22, 10)) && !F.takes(y, tile(y, 21, 11), tile(y, 22, 11));
run(y, 600);
out.sand = (y.depot[F.item("sand")] ?? 0) > 5;
out.clay = (y.depot[F.item("clay")] ?? 0) > 5;
out.both = Math.abs((y.depot[F.item("sand")] ?? 0) - (y.depot[F.item("clay")] ?? 0)) <= 1;
out.sameStatus = F.status(y, tile(y, 21, 11))?.line === F.status(y, tile(y, 20, 10))?.line;
out.solid = [[20, 10], [21, 11]].every(([x, z]) => F.yardSolid(y).at(x * 16 + 8, z * 16 + 8) === "in-the-way");

// Its second way out blocked: one sand made, and it stops; once a belt takes the clay, it goes on.
const stuck = sifting(false);
run(stuck, 600);
out.stops = (stuck.depot[F.item("sand")] ?? 0) === 1;
belts(stuck, 22, 24, 11);
run(stuck, 600);
out.goesOn = (stuck.depot[F.item("sand")] ?? 0) > 5;

// A tunnel passes under it, as under any piece but the depot.
const under = fresh();
F.build(under, SIFTER, 20, 10, 0, Infinity);
out.tunnelUnder = F.build(under, F.TUNNEL, 19, 11, 0, Infinity, { span: 2 }).ok && under.kind[tile(under, 22, 11)] === F.TUNNEL && covers(under, SIFTER, 20, 10, 21, 11, 20, 10);

// Kept and read back, and the check the same.
const read = F.decode(F.encode(y), land);
out.readBack = read !== null && covers(read, SIFTER, 20, 10, 21, 11, 20, 10) && F.check(read) === F.check(y);

// Turned from a tile it covers: an even side keeps its tiles, the middle's top left its own tile, whichever way it faces.
const turned = sifting(true);
out.turns = F.turn(turned, 21, 11, 2) && turned.dir[tile(turned, 20, 10)] === 2 && covers(turned, SIFTER, 20, 10, 21, 11, 20, 10);

// Removed from a tile it covers: every tile bare, its price back.
const gone = sifting(true);
const refund = F.remove(gone, 21, 11);
out.removed = refund.ok && refund.refund === 40 && bare(gone, 20, 10, 21, 11);

// Moved and turned, copied, kept as a blueprint and set down, and as a code.
const moving = sifting(true);
out.moved = F.move(moving, F.within(moving, 20, 10, 21, 11), 1, 4, 14) === null && covers(moving, SIFTER, 4, 14, 5, 15, 4, 14) && bare(moving, 20, 10, 21, 11);
const copying = sifting(true);
const copy = F.copyOf(copying, F.within(copying, 20, 10, 21, 11), 0, 4, 14);
out.copied = copy !== null && F.stand(copying, copy, Infinity).ok && covers(copying, SIFTER, 4, 14, 5, 15, 4, 14) && covers(copying, SIFTER, 20, 10, 21, 11, 20, 10);
const printing = sifting(true);
out.saved = F.saveBlueprint(printing, 1, F.within(printing, 20, 10, 21, 11)) === null;
const pieces = F.blueprintAt(printing, 1, 0, 4, 14) ?? [];
out.blueprinted = F.stand(printing, pieces, Infinity).ok && covers(printing, SIFTER, 4, 14, 5, 15, 4, 14);
const code = F.blueprintCode(printing.blueprints[1]);
out.coded = code !== null && JSON.stringify(F.codePieces(code)) === JSON.stringify(F.piecesOf(printing.blueprints[1].pieces));

// Kept in a plan of the whole yard (tier 5, where its research is done), taken away, and the plan put back: it stands again, whole, where it stood.
const whole = F.create({ land, tier: 5, seed: 1 });
F.build(whole, SIFTER, 20, 10, 0, Infinity);
const planned = F.saveYard(whole, 1) === null;
F.remove(whole, 21, 11);
const print = whole.blueprints[1];
out.wholeYard = planned && print !== null && F.placeYard(whole, print, Infinity).ok && covers(whole, SIFTER, 20, 10, 21, 11, 20, 10);

// Undone: built by a command, then undone; removed by one, and stood again.
const undoing = fresh();
act(undoing, { do: "build", kind: SIFTER, x: 10, y: 10, dir: 0 }, Infinity, "b1");
const builtByCommand = covers(undoing, SIFTER, 10, 10, 11, 11, 10, 10);
act(undoing, { do: "undo", entry: "b1" }, Infinity, "u1");
out.undoBuild = builtByCommand && bare(undoing, 10, 10, 11, 11);
F.build(undoing, SIFTER, 10, 10, 0, Infinity);
act(undoing, { do: "remove", x: 11, y: 11 }, Infinity, "r1");
const removedByCommand = bare(undoing, 10, 10, 11, 11);
act(undoing, { do: "undo", entry: "r1" }, Infinity, "u2");
out.undoRemove = removedByCommand && covers(undoing, SIFTER, 10, 10, 11, 11, 10, 10);

// The forge, three by three, its own tile its middle (20, 10): fed deadfall on its back and stone on its side, its resin out of the middle of its front.
const FORGE = kindOf("forge");
const forge = fresh();
for (const [x, z, d, raw] of [[17, 10, 0, "deadfall"], [20, 7, 1, "stone"]]) {
  if (!F.build(forge, F.CRATE, x, z, d, Infinity).ok) throw new Error("no crate");
  for (let n = 0; n < 40; n++) F.put(forge.holders, F.holderOf(forge, tile(forge, x, z)), F.item(raw));
}
F.build(forge, F.BELT, 18, 10, 0, Infinity);
F.build(forge, F.BELT, 20, 8, 1, Infinity);
out.forgeBuilt = F.build(forge, FORGE, 20, 10, 0, Infinity).ok && covers(forge, FORGE, 19, 9, 21, 11, 20, 10);
belts(forge, 22, 24, 10);
out.forgeRefusesFront = !F.takes(forge, tile(forge, 21, 9), tile(forge, 22, 9));
run(forge, 900);
out.resin = (forge.depot[F.item("resin")] ?? 0) > 5;
const forgeRead = F.decode(F.encode(forge), land);
out.forgeReadBack = forgeRead !== null && F.check(forgeRead) === F.check(forge);
out.forgeRemoved = F.remove(forge, 19, 9).ok && bare(forge, 19, 9, 21, 11);

console.log(JSON.stringify(out));
`;

/**
 * What the page makes of the forge, in the copy, and prints as one line of JSON, each part true where
 * it holds: both throwaways in the dock; one card, its own tile's, from any of its tiles; drawn from
 * its own tile alone, over its box of three by three; reach counted on every tile it would cover and
 * every tile it does; its map colour its module's; and one lamp, from the middle of its box.
 */
export const PAGE_BIG = `import * as F from "./packages/factory/src/index.ts";
import { bareLand } from "./packages/factory/test/land.ts";
import { drawnFrom, pieceBox } from "./apps/works/src/big.ts";
import { footprint } from "./apps/works/src/figure/reach.ts";
import { PAGES } from "./apps/works/src/kinds/index.ts";
import { lampsIn } from "./apps/works/src/lamps.ts";
import { blockColour } from "./apps/works/src/plan.ts";
import { DRAWN, S } from "./apps/works/src/state.ts";
import { refAt } from "./apps/works/src/ui/card.ts";
import { tileRef } from "./apps/works/src/ui/refs.ts";

const FORGE = F.kindNamed("forge");
const SIFTER = F.kindNamed("sifter");
const y = F.create({ land: bareLand(34, 20, [], [26, 10]), tier: 4, seed: 1 });
if (FORGE === null || SIFTER === null || !F.build(y, FORGE, 20, 10, 0, Infinity).ok) throw new Error("no forge");
S.world = y;
const own = F.at(y, 20, 10);
const tiles = [];
for (let z = 9; z <= 11; z++) for (let x = 19; x <= 21; x++) tiles.push(F.at(y, x, z));
const nine = (list) => list.length === 9 && tiles.every((t) => list.includes(t));
const lamps = lampsIn(y, { x: 0, y: 0 }, { x: 0, y: 0, w: 34 * 16, h: 20 * 16 }, 1, () => true, () => false).filter((l) => l.r === 9);
console.log(
  JSON.stringify({
    docked: DRAWN.includes(FORGE) && DRAWN.includes(SIFTER),
    card: tiles.every((t) => refAt(t % 34, Math.floor(t / 34)) === tileRef(own)),
    drawnOnce: tiles.filter((t) => drawnFrom(y, t)).length === 1 && drawnFrom(y, own),
    box: JSON.stringify(pieceBox(y, F.at(y, 21, 11))) === JSON.stringify({ x: 19, y: 9, w: 3, h: 3 }),
    reachBuild: nine(footprint(y, { do: "build", kind: FORGE, x: 20, y: 10, dir: 0 }).flat()),
    reachRemove: nine(footprint(y, { do: "remove", x: 21, y: 11 }).flat()),
    colour: blockColour(FORGE) === PAGES.forge.map?.[0],
    lamp: lamps.length === 1 && lamps[0]?.x === 20 * 16 + 8 && lamps[0]?.y === 12 * 16 - 4,
  }),
);
`;
export const PAGED_BIG = Object.fromEntries(
  ["docked", "card", "drawnOnce", "box", "reachBuild", "reachRemove", "colour", "lamp"].map((k) => [k, true]),
);

/** Every part `PLAY_BIG` prints, each to hold. */
export const PLAYED_BIG = Object.fromEntries(
  [
    "built",
    "covers",
    "overBelt",
    "overlap",
    "offMap",
    "takesBack",
    "takesSides",
    "refusesFront",
    "sand",
    "clay",
    "both",
    "sameStatus",
    "solid",
    "stops",
    "goesOn",
    "tunnelUnder",
    "readBack",
    "turns",
    "removed",
    "moved",
    "copied",
    "saved",
    "blueprinted",
    "coded",
    "wholeYard",
    "undoBuild",
    "undoRemove",
    "forgeBuilt",
    "forgeRefusesFront",
    "resin",
    "forgeReadBack",
    "forgeRemoved",
  ].map((k) => [k, true]),
);
