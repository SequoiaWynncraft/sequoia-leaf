/** The yard's art laid out with names, for looking at it large: `?sheet=machines`, `?sheet=items`. */

import { makeCanvas } from "@sequoia-leaf/kit/util.ts";
import { ITEM, ITEMS, KIND } from "@sequoia-leaf/yard";

import { beltTile } from "./art/belts.ts";
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
const SPLITS = [
  [2, 2, 1, 2],
  [2, 2, 2, 1],
  [1, 2, 2, 2],
  [2, 1, 2, 2],
] as const;
const JOINS = [
  [2, 1, 1, 1],
  [1, 2, 1, 1],
  [1, 1, 2, 1],
  [1, 1, 1, 2],
] as const;

export function sheets(art: Art, which: string): void {
  for (const id of ["top", "track", "feed", "hand", "dock", "panel", "card", "banner", "letter"])
    document.getElementById(id)?.remove();
  const m = art.m;
  if (which === "items") {
    const entries: Entry[] = [
      { name: "From the ground", pics: [], head: true },
      ...ITEMS.filter((k) => ITEM[k].step === 0).map((k) => ({ name: ITEM[k].name, pics: [art.item(k)] })),
      { name: "Worked once, at a mill", pics: [], head: true },
      ...ITEMS.filter((k) => ITEM[k].step === 1).map((k) => ({ name: ITEM[k].name, pics: [art.item(k)] })),
      { name: "Put together", pics: [], head: true },
      ...ITEMS.filter((k) => ITEM[k].step === 2).map((k) => ({ name: ITEM[k].name, pics: [art.item(k)] })),
      { name: "The guild's goods", pics: [], head: true },
      ...ITEMS.filter((k) => ITEM[k].step === 3).map((k) => ({ name: ITEM[k].name, pics: [art.item(k)] })),
      { name: "The two that take the whole yard", pics: [], head: true },
      ...ITEMS.filter((k) => ITEM[k].step === 4).map((k) => ({ name: ITEM[k].name, pics: [art.item(k)] })),
    ];
    showSheet(entries, 8, 1180);
    return;
  }
  const belts = [0, 1, 2].map((tier) => beltTile([2, 0, 1, 0], 0, 5, tier));
  const entries: Entry[] = [
    { name: "Gathering and making", pics: [], head: true },
    { name: `${KIND.gatherer.name}: stands, leans, bends, lifts, sleeps`, pics: pics(m.gnome[0] ?? []) },
    { name: "the other hats", pics: pics([m.gnome[1]?.[0], m.gnome[2]?.[0], m.gnome[3]?.[0]]) },
    { name: "basket, rake, wheelbarrow", pics: [m.basket, m.rake, m.barrow] },
    { name: `${KIND.mill.name}, sawing`, pics: pics(m.saw) },
    { name: `${KIND.mill.name}, firing`, pics: pics(m.kiln) },
    { name: `${KIND.mill.name}, pressing`, pics: pics(m.press) },
    { name: KIND.bench.name, pics: pics(m.bench) },
    {
      name: `${KIND.workshop.name}: dark, and at work`,
      pics: pics([...(m.workshop[0] ?? []).slice(0, 1), ...(m.workshop[1] ?? [])]),
    },
    { name: "Carrying", pics: [], head: true },
    { name: `${KIND.belt.name}: plain, waxed, roller`, pics: belts },
    {
      name: "a corner, a join",
      pics: [beltTile([2, 1, 0, 0], 0, 5, 0), beltTile([2, 1, 1, 0], 0, 5, 0), beltTile([0, 2, 0, 1], 1, 5, 0)],
    },
    {
      name: `${KIND.splitter.name}: east, south, west, north`,
      pics: SPLITS.map((arms, dir) => onBelt(beltTile(arms, WAYS[dir] ?? 0, 5, 0), m.splitter[dir] ?? null)),
    },
    {
      name: `${KIND.joiner.name}: east, south, west, north`,
      pics: JOINS.map((arms, dir) => onBelt(beltTile(arms, WAYS[dir] ?? 0, 5, 0), m.joiner[dir] ?? null)),
    },
    { name: `${KIND.tunnel.name}: its four mouths`, pics: pics(m.hood) },
    { name: `${KIND.crate.name}: shut, open, and bigger`, pics: pics([...(m.crate[0] ?? []), ...(m.crate[1] ?? [])]) },
    { name: "Power", pics: [], head: true },
    { name: `${KIND.pylon.name}: out, low, lit`, pics: pics(m.pylon[0] ?? []) },
    { name: "taller", pics: pics((m.pylon[1] ?? []).slice(2)) },
    { name: KIND.wheel.name, pics: pics(m.wheel) },
    { name: `${KIND.boiler.name}: cold, and burning`, pics: pics(m.boiler) },
    { name: "The yard", pics: [], head: true },
    { name: KIND.depot.name, pics: [m.depot.c] },
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
