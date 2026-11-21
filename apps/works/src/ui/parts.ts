/** Small pieces the yard's interface is put together from: its own icons, and a few helpers over the kit's. */

import { add, el, shown } from "@sequoia-leaf/kit/dom.ts";
import { INK } from "@sequoia-leaf/kit/palette.ts";
import { bitmap, outlined } from "@sequoia-leaf/kit/pix.ts";
import { makeCanvas, must, type Pt } from "@sequoia-leaf/kit/util.ts";

import type { Art } from "../art/index.ts";
import { PAL } from "../art/pal.ts";
import { ITEM, type Item, ITEMS, type Tally } from "../sim/index.ts";

export type Kid = Node | string | null;

export const $ = (id: string): HTMLElement => must(document.getElementById(id), id);

/** A copy of a small picture, shown `scale` interface units to each of its pixels. */
export function pic(src: HTMLCanvasElement, scale = 1): HTMLCanvasElement {
  const { c, g } = makeCanvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  return shown(c, scale);
}

/** A copy of a picture cut down to fit a box, keeping its top: a tall machine is known by its head. */
export function fitted(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const cw = Math.min(src.width, w);
  const ch = Math.min(src.height, h);
  const { c, g } = makeCanvas(cw, ch);
  g.drawImage(src, Math.floor((src.width - cw) / 2), 0, cw, ch, 0, 0, cw, ch);
  return shown(c, 1);
}

/** A hollow `size` units square, holding one thing. */
export function slot(inside: Node | null, size = 20): HTMLElement {
  const s = el("div", "k-slot");
  s.style.width = `calc(var(--u) * ${size})`;
  s.style.height = s.style.width;
  s.style.flex = "none";
  add(s, inside);
  return s;
}

export function button(cls: string, kids: readonly Kid[], on: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = el("button", `k-btn ${cls}`, { type: "button" }, ...kids);
  b.addEventListener("click", () => {
    on(b);
  });
  return b;
}

/** Redraws a part of the interface only when what it shows has changed. */
export function when(key: () => string, draw: () => void): () => void {
  let last: string | null = null;
  return () => {
    const k = key();
    if (k === last) return;
    last = k;
    draw();
  };
}

export const centre = (node: Element): Pt => {
  const r = node.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

const ICONS = {
  // Power: a bolt.
  bolt: ["....yyy", "...yyy.", "..yyy..", ".yyyyyy", "...yyy.", "..yyy..", ".yy....", "y......"],
  // Orders: a note with lines on it, pinned.
  orders: [
    "....rr....",
    ".wwwrrwww.",
    ".wwwwwwww.",
    ".wNNNNNNw.",
    ".wwwwwwww.",
    ".wNNNNwww.",
    ".wwwwwwww.",
    ".wNNNNNww.",
    ".wwwwwwww.",
    ".CCCCCCCC.",
  ],
  // Plans: a rolled drawing, blue, with a white line on it.
  plans: [
    ".uuuuuuuu.",
    "uUUUUUUUUu",
    "uUwwwwUUUu",
    "uUwUUwUUUu",
    "uUwUUwwwUu",
    "uUwUUUUwUu",
    "uUwwwwwwUu",
    "uUUUUUUUUu",
    ".mmmmmmmm.",
    "..m....m..",
  ],
  // The depot's books: a crate.
  depot: [
    "NNNNNNNNNN",
    "NnnnnnnnnN",
    "bbbbbbbbbb",
    "nNnnnnnnNn",
    "nnNnnnnNnn",
    "nnnNnnNnnn",
    "nnnnNNnnnn",
    "nnnNnnNnnn",
    "nnNnnnnNnn",
    "bbbbbbbbbb",
  ],
  // The second shift: a moon and a star, for working on into the night.
  shift: [
    "...wwww...",
    "..www.....",
    ".www....w.",
    ".www...www",
    ".www....w.",
    ".wwww.....",
    "..wwwww...",
    "...wwwww..",
    "..........",
    "..........",
  ],
  turn: [
    "...wwww...",
    "..w....w..",
    ".w......w.",
    ".w......w.",
    ".w.....www",
    ".w......w.",
    "..w.......",
    "...wwww...",
  ],
  undo: [
    "...w......",
    "..ww......",
    ".wwwwwww..",
    "..ww....w.",
    "...w.....w",
    ".........w",
    "........w.",
    "...wwwww..",
  ],
  // Taking away: a spade.
  spade: [
    ".......nn.",
    "......nNn.",
    ".....nn...",
    "....nn....",
    "..tSn.....",
    ".tSSs.....",
    "tSSSs.....",
    "SSSs......",
    ".ss.......",
  ],
  // The way back to town: a doorway with the light on.
  town: [
    "..bbbbbb..",
    ".bBBBBBBb.",
    ".bByyyyBb.",
    ".bByYYyBb.",
    ".bByYYyBb.",
    ".bByYYyBb.",
    ".bByYwyBb.",
    ".bByYYyBb.",
    ".bByyyyBb.",
    "bbbbbbbbbb",
  ],
  lookAt: [
    "...wwww...",
    "..w....w..",
    ".w......w.",
    ".w......w.",
    ".w......w.",
    "..w....w..",
    "...wwwww..",
    ".......ww.",
    "........ww",
  ],
} as const;

export type YardIcon = keyof typeof ICONS;

const iconPics = new Map<YardIcon, HTMLCanvasElement>();

/** One of the yard's own icons, with its dark edge. Each call gives a new copy. */
export function yardIcon(name: YardIcon, scale = 1): HTMLCanvasElement {
  let c = iconPics.get(name);
  if (!c) {
    c = outlined(bitmap(ICONS[name], PAL), INK);
    iconPics.set(name, c);
  }
  return pic(c, scale);
}

/** A thing's picture and how many, as one row of an order: "[plank] 8 / 12" with a bar between. */
export function wantRows(art: Art, want: Tally, filled: Tally, leaf = false): HTMLElement[] {
  return ITEMS.filter((k) => (want[k] ?? 0) > 0).map((k) => {
    const have = Math.min(filled[k] ?? 0, want[k] ?? 0);
    const n = want[k] ?? 1;
    const bar = el("i");
    bar.style.setProperty("--v", `${(have / n) * 100}%`);
    const row = el(
      "div",
      "want",
      { title: ITEM[k].name },
      pic(art.item(k), 1),
      el("div", leaf || have >= n ? "k-bar leaf" : "k-bar", {}, bar),
      el("span", "n", { text: `${have} / ${n}` }),
    );
    return row;
  });
}

/** What an order asks for, in words: "12 planks and 12 ingots". */
export function wantWords(want: Tally): string {
  const parts = ITEMS.filter((k) => (want[k] ?? 0) > 0).map(
    (k) => `${want[k]} ${want[k] === 1 ? ITEM[k].name.toLowerCase() : ITEM[k].many}`,
  );
  const last = parts.pop() ?? "";
  return parts.length ? `${parts.join(", ")} and ${last}` : last;
}

export const itemName = (k: Item): string => ITEM[k].name;
