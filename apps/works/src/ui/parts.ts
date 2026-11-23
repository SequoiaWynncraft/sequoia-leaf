/** Small pieces the yard's interface is put together from: its own icons, and a few helpers over the kit's. */

import {
  ALL_ITEMS,
  type Counts,
  type Item,
  ITEM_INFO,
  KIND_INFO,
  kindNamed,
  RECIPE,
  type Unlocks,
} from "@sequoia-leaf/factory";
import { add, el, shown, when } from "@sequoia-leaf/kit/dom.ts";
import { INK } from "@sequoia-leaf/kit/palette.ts";
import { bitmap, outlined } from "@sequoia-leaf/kit/pix.ts";
import { makeCanvas, must, type Pt } from "@sequoia-leaf/kit/util.ts";

import type { Art } from "../art/index.ts";
import { PAL } from "../art/pal.ts";

export { when } from "@sequoia-leaf/kit/dom.ts";

/**
 * A part of the interface kept by what it prints: `print` works out every value it shows of the
 * yard and the purse, as plain data, and `draw` draws it from that alone. It is drawn again exactly
 * when the print differs, so no value it shows can be missing from what it is kept by.
 */
export function shows<P>(print: () => P, draw: (p: P) => void): () => void {
  let p = print();
  return when(
    () => JSON.stringify((p = print())),
    () => {
      draw(p);
    },
  );
}

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
  // Top yards: a cup.
  board: ["oyyyyyyo", "y.yYYy.y", "y.yYyy.y", ".oyyyyo.", "..oyyo..", "...yy...", "...yy...", "..oyyo.."],
  // Projects: a rolled drawing, blue, with a white line on it.
  projects: [
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
  // Select: an area marked out in dashes, and the pointer that marks it.
  select: [
    "ww.ww.ww..",
    "w.......w.",
    "..........",
    "w.......w.",
    "w...y.....",
    "....yy..w.",
    "w...yyy...",
    "ww.wyyyy..",
    "....yy.y..",
    ".....yy...",
  ],
  // Throwing a blueprint away: a bin.
  bin: ["...ww...", "wwwwwwww", "........", ".wwwwww.", ".w.ww.w.", ".w.ww.w.", ".w.ww.w.", ".wwwwww."],
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
  // Colouring lines: a brush with paint on it.
  brush: [
    "........nN",
    ".......nNn",
    "......nNn.",
    ".....tSn..",
    "....tSs...",
    "...cCs....",
    "..cCCC....",
    ".rcCC.....",
    "rrqC......",
    ".rr.......",
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
export function wantRows(art: Art, wants: readonly (readonly [Item, number, number])[], leaf = false): HTMLElement[] {
  return wants.map(([k, have, n]) => {
    const bar = el("i");
    bar.style.setProperty("--v", `${(have / n) * 100}%`);
    const row = el(
      "div",
      "want",
      { title: ITEM_INFO[k]?.name ?? "" },
      pic(art.item(k), 1),
      el("div", leaf || have >= n ? "k-bar leaf" : "k-bar", {}, bar),
      el("span", "n", { text: `${have} / ${n}` }),
    );
    return row;
  });
}

/** What an order asks for, in words: "12 planks and 12 ingots". */
export function wantWords(want: Counts): string {
  const parts = ALL_ITEMS.filter((k) => (want[k] ?? 0) > 0).map(
    (k) => `${want[k]} ${want[k] === 1 ? (ITEM_INFO[k]?.name ?? "").toLowerCase() : (ITEM_INFO[k]?.many ?? "")}`,
  );
  const last = parts.pop() ?? "";
  return parts.length ? `${parts.join(", ")} and ${last}` : last;
}

/** More than one of a kind of piece, in words: "belts", "benches", "studies". */
const plural = (name: string): string => {
  const w = name.toLowerCase();
  if (/(ch|sh|s)$/.test(w)) return `${w}es`;
  return /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`;
};
/** The ending of a word for so many: "" for one, "s" for more. */
const s = (n: number): string => (n === 1 ? "" : "s");
/** A list in words: "a, b and c". */
const listed = (parts: readonly string[]): string =>
  parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}` : (parts[0] ?? "");

/** What a node or research unlocks besides machines, recipes and plots, in words: "Paint", "grade 2 belts and tunnels". */
export function unlockWords(u: Unlocks): string[] {
  const tools = (u.tools ?? []).map((t) => (t === "paint" ? "Paint" : t === "select" ? "Select" : "Upgrading an area"));
  const byGrade = new Map<number, string[]>();
  for (const [name, grade] of Object.entries(u.grades ?? {})) {
    const k = kindNamed(name);
    if (k === null || grade === undefined) continue;
    byGrade.set(grade, [...(byGrade.get(grade) ?? []), plural(KIND_INFO[k]?.name ?? "")]);
  }
  return [
    ...tools,
    ...[...byGrade].map(([grade, names]) => `grade ${grade} ${listed(names)}`),
    ...(u.blueprints
      ? [`${u.blueprints.count} blueprint${s(u.blueprints.count)} of ${u.blueprints.pieces} pieces`]
      : []),
    ...(u.span !== undefined ? [`tunnels up to ${u.span} tiles`] : []),
    ...(u.crate !== undefined ? [`a crate holds ${u.crate}`] : []),
    ...(u.reach !== undefined ? [`pylons reach ${u.reach - 100}% further`] : []),
    ...(u.depot !== undefined ? [`the depot gives ${u.depot} power`] : []),
    ...(u.away !== undefined ? [`the yard runs ${u.away} hours unwatched`] : []),
    ...(u.stops !== undefined ? [`${u.stops} cart stop${s(u.stops)}`] : []),
    ...(u.hooks !== undefined ? [`${u.hooks} orders on the board`] : []),
    ...(u.board ? ["side orders"] : []),
  ];
}

/** A recipe's parts, in words: "planks and ingots", or with counts where it takes more than one of a part: "2 planks and 1 pot". */
export function partsWords(k: Item): string {
  const r = RECIPE[k];
  if (!r) return "";
  const counted = r.need.some((c) => c > 1);
  return r.from
    .map((p, i) => {
      const c = r.need[i] ?? 1;
      const one = (ITEM_INFO[p]?.name ?? "").toLowerCase();
      const many = ITEM_INFO[p]?.many ?? "";
      return counted ? `${c} ${c === 1 ? one : many}` : many;
    })
    .join(" and ");
}
