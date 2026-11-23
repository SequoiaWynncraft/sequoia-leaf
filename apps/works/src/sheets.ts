/** The yard's art laid out with names, for looking at it large: `?sheet=machines`, `?sheet=items`. */

import {
  ALL_ITEMS,
  type Dir,
  FOLIOS,
  isItem,
  item,
  ITEM_INFO,
  kind,
  KIND_INFO,
  type KindName,
  NONE,
  numeral,
} from "@sequoia-leaf/factory";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { arms, beltTile, marksOf, woodOf } from "./art/belts.ts";
import type { Art } from "./art/index.ts";
import { lookOf } from "./art/machines.ts";
import type { Sprite } from "./art/pal.ts";
import { type Entry, showSheet } from "./sheet.ts";

const pics = (list: readonly (Sprite | undefined)[]): HTMLCanvasElement[] => list.flatMap((s) => (s ? [s.c] : []));

/** A belt piece with something drawn over it. */
function onBelt(tile: HTMLCanvasElement, top: HTMLCanvasElement | null): HTMLCanvasElement {
  const { c, g } = makeCanvas(16, 16);
  g.drawImage(tile, 0, 0);
  if (top) g.drawImage(top, 0, 0);
  return c;
}

const WAYS = [0, 1, 2, 3] as const;
/** The arms of a splitter and of a joiner pointing each way (east, south, west, north), as `beltTile` takes them. */
const SPLITS = [arms(2, 2, 1, 2), arms(2, 2, 2, 1), arms(1, 2, 2, 2), arms(2, 1, 2, 2)];
const JOINS = [arms(2, 1, 1, 1), arms(1, 2, 1, 1), arms(1, 1, 2, 1), arms(1, 1, 1, 2)];
/** A kind's name, as the sheet labels it. */
const named = (k: KindName): string => KIND_INFO[kind(k)]?.name ?? "";
/** Every thing of a step, labelled with its picture. */
const step = (art: Art, n: number): Entry[] =>
  ALL_ITEMS.filter((k) => ITEM_INFO[k]?.step === n).map((k) => ({
    name: ITEM_INFO[k]?.name ?? "",
    pics: [art.item(k)],
  }));

const GRADES = [1, 2, 3] as const;
/** A straight belt's arms pointing each way, as `beltTile` takes them. */
const STRAIGHT = [arms(2, 0, 1, 0), arms(0, 2, 0, 1), arms(1, 0, 2, 0), arms(0, 1, 0, 2)];
/** A sorter's arms pointing each way: in from behind, out ahead and to its left. */
const SORTS = [arms(2, 0, 1, 2), arms(2, 2, 0, 1), arms(1, 2, 2, 0), arms(0, 1, 2, 2)];

/**
 * A piece as it stands on its tile, with a tile's worth of room over it: the picture with its foot
 * on the tile's foot (`rise` pixels above it), and the grade's mark in the tile's top-left corner.
 */
function standing(
  art: Art,
  s: Sprite | undefined,
  grade: number,
  rise = 0,
  under: HTMLCanvasElement | null = null,
): HTMLCanvasElement {
  const { c, g } = makeCanvas(20, 34);
  const left = 2;
  const top = 16;
  if (under) g.drawImage(under, left, top);
  if (s) g.drawImage(s.c, left + 8 - s.ax, top + 16 - rise - s.ay);
  const pip = art.m.pips[grade - 2];
  if (pip) g.drawImage(pip, left, top);
  return c;
}

/** A run of belt of a grade, three tiles long, with a thing riding the middle one. */
function run(art: Art, grade: number, dir: Dir, riding: number, tint = 0): HTMLCanvasElement {
  const down = dir === 1 || dir === 3;
  const { c, g } = makeCanvas(down ? 16 : 48, down ? 48 : 16);
  for (let k = 0; k < 3; k++)
    g.drawImage(
      beltTile(STRAIGHT[dir] ?? 0, dir, 5, woodOf(grade), tint, marksOf(grade)),
      down ? 0 : k * 16,
      down ? k * 16 : 0,
    );
  if (isItem(riding)) {
    const pic = art.item(riding);
    g.drawImage(pic, (c.width - pic.width) >> 1, ((c.height - pic.height) >> 1) - 1);
  }
  return c;
}

/** A grade, as a label names it. */
const at = (grade: number): string => `grade ${numeral(grade)}`;

/** Every graded piece at each grade, each way round, working and not; the Study, the sorter and the cart stop; the folios. */
function grades(art: Art): Entry[] {
  const m = art.m;
  const plank = item("plank");
  const out: Entry[] = [];
  const head = (name: string): void => void out.push({ name, pics: [], head: true });
  head("Belts: each grade, each way, empty and carrying; painted; a corner");
  for (const grade of GRADES) {
    out.push({ name: `${at(grade)}, east and west`, pics: [run(art, grade, 0, NONE), run(art, grade, 2, plank)] });
    out.push({ name: "south and north", pics: [run(art, grade, 1, plank), run(art, grade, 3, NONE)] });
    out.push({ name: "painted blue", pics: [run(art, grade, 0, plank, 4)] });
    out.push({
      name: "a corner, a join",
      pics: [
        beltTile(arms(2, 1, 0, 0), 0, 5, woodOf(grade), 0, marksOf(grade)),
        beltTile(arms(2, 1, 1, 0), 0, 5, woodOf(grade), 0, marksOf(grade)),
      ],
    });
  }
  head("Tunnels: each grade, its four mouths");
  for (const grade of GRADES)
    out.push({
      name: at(grade),
      pics: [0, 1, 2, 3].map((side) => standing(art, m.hood[lookOf(grade)]?.[side], grade, -1)),
    });
  head("Gatherers: each grade, standing, bent, lifting and asleep; facing left");
  for (const grade of GRADES) {
    const gnome = (pose: number, left = false): HTMLCanvasElement => {
      const c = standing(art, (left ? m.gnomeLeft : m.gnome)[0]?.[pose], grade, 1);
      const g = c.getContext("2d");
      const rake = left ? m.rakeLeft : m.rake;
      if (grade >= 2) g?.drawImage(rake.c, 2 + (left ? 2 : 13) - rake.ax, 16 + 15 - rake.ay);
      g?.drawImage(m.basket, left ? 2 + 15 - m.basket.width : 2, 16 + 16 - m.basket.height);
      return c;
    };
    out.push({ name: at(grade), pics: [gnome(0), gnome(2), gnome(3), gnome(4), gnome(0, true)] });
  }
  head("Mills: each grade, cold and at work, sawing, firing and pressing");
  for (const grade of GRADES)
    for (const [name, frames] of [
      ["sawing", m.saw],
      ["firing", m.kiln],
      ["pressing", m.press],
    ] as const)
      out.push({
        name: `${at(grade)}, ${name}`,
        pics: [0, 1, 2].map((frame) => standing(art, frames[lookOf(grade)]?.[frame], grade)),
      });
  head("Benches and workshops: each grade, idle and at work");
  for (const grade of GRADES) {
    out.push({
      name: `bench, ${at(grade)}`,
      pics: [0, 1, 2].map((frame) => standing(art, m.bench[lookOf(grade)]?.[frame], grade)),
    });
    out.push({
      name: `workshop, ${at(grade)}`,
      pics: [
        standing(art, m.workshop[lookOf(grade)]?.[0]?.[0], grade),
        standing(art, m.workshop[lookOf(grade)]?.[1]?.[0], grade),
        standing(art, m.workshop[lookOf(grade)]?.[1]?.[1], grade),
      ],
    });
  }
  head("The Study: each grade, unlit, with nothing to study, and a page turned");
  for (const grade of GRADES)
    out.push({
      name: at(grade),
      pics: [0, 1, 2, 3, 4].map((state) => standing(art, m.study[lookOf(grade)]?.[state], grade)),
    });
  head("The sorter: not set, and set, each way; the cart stop: waiting, loaded, under, gone, back");
  const sorter = (dir: Dir, thing: number): HTMLCanvasElement => {
    const { c, g } = makeCanvas(16, 16);
    g.drawImage(beltTile(SORTS[dir] ?? 0, dir, 5, 0), 0, 0);
    g.drawImage(art.sorter(dir, thing), 0, 0);
    return c;
  };
  out.push({ name: "not set", pics: WAYS.map((dir) => sorter(dir, NONE)) });
  for (const name of ["plank", "ore", "lantern", "timber"] as const)
    out.push({ name: `set to ${ITEM_INFO[item(name)]?.many}`, pics: WAYS.map((dir) => sorter(dir, item(name))) });
  out.push({ name: "the cart stop", pics: m.stop.map((s) => standing(art, s, 1)) });
  head("The folios: by themselves, and on a belt of each grade");
  for (const folio of FOLIOS)
    out.push({
      name: ITEM_INFO[folio]?.name ?? "",
      pics: [art.item(folio), ...GRADES.map((grade) => run(art, grade, 0, folio))],
    });
  head("The grade's mark, and each kind's picture for a button at each grade");
  out.push({ name: "II, III", pics: m.pips });
  for (const name of ["belt", "tunnel", "gatherer", "mill", "bench", "workshop", "study"] as const)
    out.push({ name: named(name), pics: GRADES.map((grade) => art.icon(kind(name), grade)) });
  out.push({ name: "sorter, cart stop", pics: [art.icon(kind("sorter")), art.icon(kind("stop"))] });
  return out;
}

export function sheets(art: Art, which: string): void {
  for (const id of ["top", "track", "feed", "hand", "dock", "panel", "card", "banner", "letter", "study"])
    document.getElementById(id)?.remove();
  const m = art.m;
  // `grades`, and `grades-1` for the same at one pixel to a pixel, as the farthest zoom shows it.
  if (which.startsWith("grades")) {
    showSheet(grades(art), which === "grades" ? 4 : Number(which.slice(7)) || 1, 1900);
    return;
  }
  if (which === "items") {
    const entries: Entry[] = [
      { name: "From the ground", pics: [], head: true },
      ...step(art, 0),
      { name: "Worked once, at a mill", pics: [], head: true },
      ...step(art, 1),
      { name: "Put together", pics: [], head: true },
      ...step(art, 2),
      { name: "The guild's goods", pics: [], head: true },
      ...step(art, 3),
      { name: "The two that take the whole yard", pics: [], head: true },
      ...step(art, 4),
    ];
    showSheet(entries, 8, 1180);
    return;
  }
  const belts = [0, 1, 2].map((tier) => beltTile(arms(2, 0, 1, 0), 0, 5, tier));
  const entries: Entry[] = [
    { name: "Gathering and making", pics: [], head: true },
    { name: `${named("gatherer")}: stands, leans, bends, lifts, sleeps`, pics: pics(m.gnome[0] ?? []) },
    { name: "the other hats", pics: pics([m.gnome[1]?.[0], m.gnome[2]?.[0], m.gnome[3]?.[0]]) },
    { name: "basket, rake, wheelbarrow", pics: [m.basket, m.rake.c, m.barrow] },
    { name: `${named("mill")}, sawing`, pics: pics(m.saw[0] ?? []) },
    { name: `${named("mill")}, firing`, pics: pics(m.kiln[0] ?? []) },
    { name: `${named("mill")}, pressing`, pics: pics(m.press[0] ?? []) },
    { name: named("bench"), pics: pics(m.bench[0] ?? []) },
    {
      name: `${named("workshop")}: dark, and at work`,
      pics: pics([...(m.workshop[0]?.[0] ?? []).slice(0, 1), ...(m.workshop[0]?.[1] ?? [])]),
    },
    { name: "Carrying", pics: [], head: true },
    { name: `${named("belt")}: plain, waxed, roller`, pics: belts },
    {
      name: "a corner, a join",
      pics: [
        beltTile(arms(2, 1, 0, 0), 0, 5, 0),
        beltTile(arms(2, 1, 1, 0), 0, 5, 0),
        beltTile(arms(0, 2, 0, 1), 1, 5, 0),
      ],
    },
    {
      name: `${named("splitter")}: east, south, west, north`,
      pics: SPLITS.map((a, dir) => onBelt(beltTile(a, WAYS[dir] ?? 0, 5, 0), m.splitter[dir] ?? null)),
    },
    {
      name: "its left way shut: bare, and in each paint",
      pics: [0, 1, 2, 3, 4, 5, 6].map((tint) =>
        onBelt(beltTile(arms(2, 2, 1, 3), 0, 5, 0, tint), m.heads[0]?.[0] ?? null),
      ),
    },
    {
      name: `${named("joiner")}: east, south, west, north`,
      pics: JOINS.map((a, dir) => onBelt(beltTile(a, WAYS[dir] ?? 0, 5, 0), m.joiner[dir] ?? null)),
    },
    { name: `${named("tunnel")}: its four mouths`, pics: pics(m.hood[0] ?? []) },
    { name: `${named("crate")}: shut, open, and bigger`, pics: pics([...(m.crate[0] ?? []), ...(m.crate[1] ?? [])]) },
    { name: "Power", pics: [], head: true },
    { name: `${named("pylon")}: out, low, lit`, pics: pics(m.pylon[0] ?? []) },
    { name: "taller", pics: pics((m.pylon[1] ?? []).slice(2)) },
    { name: named("wheel"), pics: pics(m.wheel) },
    { name: `${named("boiler")}: cold, and burning`, pics: pics(m.boiler) },
    { name: "The yard", pics: [], head: true },
    { name: named("depot"), pics: [m.depot.c] },
    { name: "its flywheel, the shift's flag", pics: [...m.fly.slice(0, 2), ...pics(m.flag)] },
    { name: "the gate", pics: [m.gate.c] },
    { name: "fence", pics: [m.fenceAcross.c, m.fenceDown.c] },
    { name: "a plot's price", pics: [art.sign(500).c, art.sign(2600).c] },
    { name: "undergrowth", pics: pics(art.growth) },
    { name: "a redwood", pics: pics(art.trunks.slice(0, 1).map((t) => t.s)) },
    { name: "trouble, no power, asleep, a crate out", pics: [art.bang.c, art.bolt.c, art.zed.c, art.parcel.c] },
    { name: "pointers", pics: [...m.pointer] },
  ];
  showSheet(entries, 4, 1180);
}
