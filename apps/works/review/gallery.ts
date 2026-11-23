/**
 * The page with a yard of its own that holds every graded piece at each grade, each way round,
 * working and not, with the Study, the sorter and the cart stop: for looking at the grades' art in
 * the yard itself, at any zoom. No goal of the slice unlocks the third grade, so no yard of Leaf's
 * can hold one: here each piece is built by the rules at the first grade and its grade is then set
 * on the piece, as the rules' own tests of grades set it. Nothing is opened from Leaf (`S.alone`),
 * and the yard is not run on: what each piece is doing is set on it, so a picture is the same twice.
 *
 * Built and opened as `bench.ts` is (see the README's "How long a frame takes"):
 *
 *     sed 's#./src/main.ts#./review/gallery.ts#' index.html > gallery.html
 *     bun build gallery.html --outdir <site>/works-gallery
 *
 * and opened at `/play/works-gallery/gallery.html`. The grades are three rows, I at the top, in two
 * blocks: north of the depot, where pylons bring power, every piece is at work; south of it, past
 * power's reach, the same pieces stand in the dark. Along a row: belts east, west, south and north
 * (the lit ones carrying a plank and the two folios), gatherers facing each way, a mill sawing,
 * firing and pressing, a bench, a workshop, a Study, and a tunnel each way round. East of them,
 * sorters each way: not set, set to planks, set to lanterns. By the depot: a Study with nothing to
 * study, and a cart stop.
 */
import * as F from "@sequoia-leaf/factory";
import { bareLand } from "@sequoia-leaf/factory/test/land.ts";

import { S } from "../src/state.ts";

const GRADES = [1, 2, 3] as const;
const WAYS = [0, 1, 2, 3] as const;
/** The row each grade's pieces stand on: in the light, and in the dark. */
const lit = (grade: number): number => 3 + (grade - 1) * 4;
const dark = (grade: number): number => 27 + (grade - 1) * 4;
const ROWS = [lit, dark].flatMap((row) => GRADES.map((grade) => ({ grade, z: row(grade), on: row === lit })));
/** Where the gatherers stand along a row, and the way each faces. */
const GATHER: readonly (readonly [number, F.Dir])[] = [
  [14, 0],
  [16, 2],
  [18, 1],
];

const land = bareLand(
  64,
  40,
  ROWS.flatMap(({ z }) => GATHER.map(([x]) => [x, z, "deadfall"] as const)),
  [32, 18],
);
const y = F.create({ land, tier: 4, seed: 1 });
// Every goal done but one piece of research that unlocks no piece or recipe: that one is being
// studied, so the Studies have something to study, and everything the gallery builds may be built.
const studied = F.ALL_GOALS.find((g) => !F.isNode(g) && F.unlockedBy(g).every((e) => e.is === "number"));
y.done = F.ALL_GOALS.filter((g) => g !== studied);
F.reopen(y);
if (studied !== undefined) F.study(y, studied);
const folio = F.FOLIOS.find((f) => studied !== undefined && (F.GOALS[studied]?.want[f] ?? 0) > 0) ?? F.item("timber");

/** Builds a piece, and sets its grade on it (both mouths of a tunnel). Gives its tile. */
function build(kind: F.KindName, x: number, z: number, dir: F.Dir, grade = 1): number {
  const did = F.build(y, F.kind(kind), x, z, dir, Infinity);
  if (!did.ok) throw new Error(`${kind} at ${x}, ${z}: ${did.why}`);
  const i = F.at(y, x, z);
  if (!F.isGraded(F.kind(kind))) return i;
  y.grade[i] = grade;
  const far = F.otherMouth(y, i);
  if (far >= 0) y.grade[far] = grade;
  return i;
}
/** Sets a machine at work on a thing, so far through it. */
function making(i: number, thing: F.ItemName, share: number): void {
  const r = F.holderOf(y, i);
  const recipe = F.RECIPE[F.item(thing)];
  if (r < 0 || !recipe) return;
  recipe.from.forEach((part, k) => {
    for (let n = 0; n < (recipe.need[k] ?? 1); n++) F.put(y.holders, r, part);
  });
  y.holders.making[r] = recipe.out;
  y.holders.work[r] = Math.floor(recipe.work * share);
}
/** Sets a thing on a belt, half-way across its tile. */
function riding(x: number, z: number, thing: F.Item): void {
  const i = F.at(y, x, z);
  y.item[i] = thing;
  y.prog[i] = 4;
}

// Power for the northern block: two rows of pylons between the grades' rows, and boilers by the depot.
for (const x of [6, 16, 26, 36, 46, 56]) for (const z of [5, 9]) build("pylon", x, z, 0);
for (const x of [27, 28, 29, 30, 34, 35]) {
  const i = build("boiler", x, 22, 0);
  y.holders.fuel[F.holderOf(y, i)] = 20;
}

for (const { grade, z, on } of ROWS) {
  // Belts each way: a run east, a run west under it, and a pair south and north beside them.
  for (const x of [2, 3, 4]) build("belt", x, z, 0, grade);
  for (const x of [8, 7, 6]) build("belt", x, z, 2, grade);
  build("belt", 10, z, 1, grade);
  build("belt", 10, z + 1, 1, grade);
  build("belt", 11, z + 1, 3, grade);
  build("belt", 11, z, 3, grade);
  if (on) {
    riding(3, z, F.item("plank"));
    riding(7, z, F.FOLIOS[0] ?? F.item("plank"));
    riding(10, z + 1, F.FOLIOS[1] ?? F.item("plank"));
  }
  // Gatherers each way round: standing, bent, and lifting what he found.
  GATHER.forEach(([x, dir], k) => {
    const i = build("gatherer", x, z, dir, grade);
    y.holders.work[F.holderOf(y, i)] = Math.floor(F.WORK.gather * ([0.1, 0.5, 0.85][k] ?? 0));
  });
  // A mill at each of its faces, a bench with its hammer down, and a workshop.
  (["plank", "brick", "oil"] as const).forEach((thing, k) => {
    const i = build("mill", 21 + k * 2, z, 0, grade);
    if (on) making(i, thing, 0.7);
    else F.setRecipe(y, 21 + k * 2, z, F.item(thing));
  });
  const bench = build("bench", 28, z, 0, grade);
  const shop = build("workshop", 30, z, 0, grade);
  if (on) {
    making(bench, "tool", 0.4);
    making(shop, "lantern", 0.5);
  }
  // A Study: with folios, part-way through one, a page further on at each grade.
  const study = build("study", 33, z, 0, grade);
  if (on) {
    const r = F.holderOf(y, study);
    for (let n = 0; n < 3; n++) F.put(y.holders, r, folio);
    y.holders.making[r] = folio;
    y.holders.work[r] = Math.floor(F.WORK.study * ([0.3, 0.7, 0.9][grade - 1] ?? 0));
  }
  // A tunnel each way round.
  build("tunnel", 36, z, 0, grade);
  build("tunnel", 42, z, 2, grade);
  build("tunnel", 44, z - 1, 1, grade);
  build("tunnel", 46, z + 1, 3, grade);
}

// Sorters each way: not set, set to planks, set to lanterns.
([null, "plank", "lantern"] as const).forEach((thing, k) => {
  for (const dir of WAYS) {
    const x = 50 + dir * 3;
    build("sorter", x, lit(k + 1), dir);
    if (thing !== null) F.setSort(y, x, lit(k + 1), F.item(thing));
  }
});
// By the depot: a Study with nothing to study, and a cart stop with a belt into it.
build("study", 36, 18, 0);
build("stop", 28, 18, 0);
build("belt", 27, 18, 0);
riding(27, 18, F.item("plank"));

F.changed(y);
y.powered = false;
S.world = y;
S.alone = true;
await import("../src/main.ts");
