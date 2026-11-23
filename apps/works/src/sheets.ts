/** The yard's art laid out with names, for looking at it large: `?sheet=machines`, `?sheet=items`. */

import { ALL_ITEMS, ITEM_INFO, kind, KIND_INFO, type KindName } from "@sequoia-leaf/factory";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { arms, beltTile } from "./art/belts.ts";
import type { Art } from "./art/index.ts";
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

export function sheets(art: Art, which: string): void {
  for (const id of ["top", "track", "feed", "hand", "dock", "panel", "card", "banner", "letter"])
    document.getElementById(id)?.remove();
  const m = art.m;
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
    { name: "basket, rake, wheelbarrow", pics: [m.basket, m.rake, m.barrow] },
    { name: `${named("mill")}, sawing`, pics: pics(m.saw) },
    { name: `${named("mill")}, firing`, pics: pics(m.kiln) },
    { name: `${named("mill")}, pressing`, pics: pics(m.press) },
    { name: named("bench"), pics: pics(m.bench) },
    {
      name: `${named("workshop")}: dark, and at work`,
      pics: pics([...(m.workshop[0] ?? []).slice(0, 1), ...(m.workshop[1] ?? [])]),
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
    { name: `${named("tunnel")}: its four mouths`, pics: pics(m.hood) },
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
    { name: "pointers", pics: [...m.pointer, m.pip] },
  ];
  showSheet(entries, 4, 1180);
}
