/**
 * All of the yard's art, made once when the page opens. Pictures are looked up by name here, once,
 * into lists indexed by the number of the thing or kind of piece (`icon`, and `item` in `items.ts`).
 */

import {
  type Dir,
  isItem,
  type Item,
  item as thing,
  ITEM_COUNT,
  type Kind,
  type Land,
  LEFT,
  NONE,
  RIGHT,
} from "@sequoia-leaf/factory";
import { BARK, CREAM, GOLD, GREEN, INK, PAPER, SKY } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { whole } from "@sequoia-leaf/kit/say.ts";
import { widthOf, write } from "@sequoia-leaf/kit/text.ts";
import { hash, makeCanvas, must, vnoise } from "@sequoia-leaf/kit/util.ts";

import { pageOf } from "../kinds/index.ts";
import type { Parts } from "../kinds/kind.ts";
import { arms, TILE } from "./belts.ts";
import { type Ground, makeGround } from "./ground.ts";
import { type ItemArt, makeItems, makePlain } from "./items.ts";
import { type Machines, makeMachines } from "./machines.ts";
import { headsOn, meeting } from "./meeting.ts";
import { bush, fern, trunk } from "./nature.ts";
import { bm, DEEP, spr, type Sprite } from "./pal.ts";

/** One piece of the undergrowth over land the yard does not own. */
export interface Under {
  x: number;
  y: number;
  pic: number;
}

export interface Art {
  ground: Ground;
  item: ItemArt;
  m: Machines;
  /** Each of the land's redwoods, by its place in the land's `trees`, with where its foot goes. */
  trunks: { s: Sprite; x: number; y: number; tree: number }[];
  /** The shade a standing redwood throws at its own foot, its corner `SHADE` from the foot. */
  shade: HTMLCanvasElement;
  /** Bushes and ferns for uncleared land, and where they grow on each plot (by the plot's place in the land's list). */
  growth: Sprite[];
  under: Under[][];
  /** The "!" over a machine in trouble, the bolt over one with no power, and the "z" over a sleeper. */
  bang: Sprite;
  bolt: Sprite;
  zed: Sprite;
  /** A crate as it is carried out of the gate. */
  parcel: Sprite;
  sign: (price: number) => Sprite;
  /**
   * What lies over a sorter's tile, facing a way: its gate, the arrowhead on the side it sends to
   * (its right with `right`, else its left), and the board that shows the thing it sends there;
   * with no thing (`NONE`), the board is bare.
   */
  sorter: (dir: Dir, item: number, right?: boolean) => HTMLCanvasElement;
  /** A splitter taking things in from behind and from its left, for the card of what lets it. */
  waysIn: HTMLCanvasElement;
  /** A machine's picture for a button or a card, as it stands at a grade (the first, unless said). */
  icon: (kind: Kind, grade?: number, carrying?: Item) => HTMLCanvasElement;
}

const WILD = [DEEP[1], DEEP[2], GREEN[0], GREEN[1], GREEN[2]];

function undergrowth(land: Land): Under[][] {
  return land.plots.map((plot, n) => {
    const out: Under[] = [];
    for (let ty = plot.y; ty < plot.y + plot.h; ty++)
      for (let tx = plot.x; tx < plot.x + plot.w; tx++) {
        const i = ty * land.w + tx;
        if (land.water[i] === 1 || (land.tree[i] ?? -1) >= 0) continue;
        // What lies in the ground shows through here and there, so a plot says what it holds.
        const thick = vnoise(tx / 2.6, ty / 2.6, 130 + n);
        const keep = (land.deposit[i] === NONE ? 0.62 : 0.3) + (thick - 0.5) * 0.7;
        if (hash(tx, ty, 120 + n) > keep) continue;
        out.push({
          x: tx * TILE + 3 + Math.floor(hash(tx, ty, 121) * 10),
          y: ty * TILE + 8 + Math.floor(hash(tx, ty, 122) * 8),
          pic: Math.floor(hash(tx, ty, 123) * 5),
        });
      }
    return out.toSorted((a, b) => a.y - b.y);
  });
}

/** Each redwood's trunk, drawn from its north-west tile, its foot at the bottom of its second row. */
const redwoods = (land: Land): Art["trunks"] =>
  land.trees.flatMap((tiles, tree) => {
    const first = tiles[0];
    if (first === undefined) return [];
    const tx = first % land.w;
    const ty = Math.floor(first / land.w);
    const s = trunk(12, 70, 3 + tx * 1.3 + ty * 0.7, 58, 30);
    return [{ s, x: (tx + 1) * TILE, y: (ty + 2) * TILE - 1, tree }];
  });

/** Where the corner of a redwood's shade is, from its foot. */
export const SHADE = { x: -TILE - 6, y: -4 } as const;

/** The shade at a redwood's foot: rows narrowing downward, each a third dark. */
function rootShade(): HTMLCanvasElement {
  const { c, g } = makeCanvas(44, 7);
  g.fillStyle = "rgba(20,10,28,0.3)";
  for (let k = 0; k < 7; k++) g.fillRect(k, k, 44 - k * 2, 1);
  return c;
}

function signMaker(): (price: number) => Sprite {
  const made = new Map<number, Sprite>();
  return (price) => {
    const had = made.get(price);
    if (had) return had;
    const text = whole(price);
    const probe = makeCanvas(4, 4).g;
    const tw = widthOf(probe, text, 1);
    const w = tw + 13;
    const { c, g } = makeCanvas(w, 22);
    const post = Math.floor(w / 2) - 1;
    R(g, post, 11, 3, 11, BARK[1]);
    R(g, post, 11, 1, 11, BARK[3]);
    R(g, 0, 0, w, 12, BARK[1]);
    R(g, 1, 1, w - 2, 10, PAPER[1]);
    R(g, 1, 10, w - 2, 1, PAPER[0]);
    R(g, 3, 3, 3, 5, GOLD[1]);
    R(g, 2, 4, 5, 3, GOLD[1]);
    R(g, 3, 4, 1, 1, CREAM);
    R(g, 5, 6, 1, 1, GOLD[0]);
    write(g, text, 9, 2, { px: 1, colour: INK, shadow: false });
    const s = spr(c, post + 1, 22);
    made.set(price, s);
    return s;
  };
}

/**
 * What lies over a sorter pointing east: a framed board across the belt, things passing under it,
 * and an arrowhead on the way out to its side (left, or right), in brass once it is set to a thing.
 * Turned for the other ways, with the thing on the board the right way up whichever way it points.
 */
function sorterTops(plain: ItemArt): Art["sorter"] {
  const made = new Map<number, HTMLCanvasElement>();
  return (dir, item, right = false) => {
    const key = ((right ? 4 : 0) + dir) * (ITEM_COUNT + 1) + (isItem(item) ? item : ITEM_COUNT);
    const had = made.get(key);
    if (had) return had;
    const set = isItem(item);
    const { c, g } = makeCanvas(TILE, TILE);
    // The arrowhead, on the edge things leave by to its side: drawn pointing north, and turned.
    g.save();
    g.translate(8, 8);
    g.rotate((((right ? RIGHT : LEFT)[dir] + 1) * Math.PI) / 2);
    g.translate(-8, -8);
    const [dark, body] = set ? [GOLD[0], GOLD[1]] : [BARK[1], BARK[2]];
    R(g, 4, 2, 8, 1, INK);
    R(g, 5, 1, 6, 1, INK);
    R(g, 6, 0, 4, 1, INK);
    R(g, 5, 2, 6, 1, dark);
    R(g, 6, 1, 4, 1, body);
    R(g, 7, 0, 2, 1, body);
    g.restore();
    // The board: a slate in a wooden frame, dark so that pale things and dark both show on it.
    R(g, 3, 3, 10, 10, BARK[2]);
    R(g, 3, 3, 10, 1, BARK[4]);
    R(g, 3, 12, 10, 1, BARK[1]);
    R(g, 4, 4, 8, 8, SKY[0]);
    if (set) {
      const pic = plain(item);
      const w = Math.min(8, pic.width);
      const h = Math.min(8, pic.height);
      g.drawImage(pic, (pic.width - w) >> 1, (pic.height - h) >> 1, w, h, 4 + ((8 - w) >> 1), 4 + ((8 - h) >> 1), w, h);
    }
    made.set(key, c);
    return c;
  };
}

/**
 * The depot typed out for a slot, 22 pixels square with its edge: the whole building as the yard has
 * it (the purple roof with the Works' wheel, the chimney, the lit window, the order board, the open
 * door's warm light with a crate in it), small. The yard's picture is 54 pixels by 66, and a slot cut
 * from it showed only some of its roof.
 */
export const DEPOT_PIC = [
  "............SSSSSS..",
  "............hhhhhh..",
  "..nnnnnnnnnnnssshn..",
  "..bbbbbbbbbbbssshb..",
  "..ZvvvoVoVVVVhhhhV..",
  "..ZVVoooooVVVssshV..",
  "..ZVooyYyooVVssshV..",
  "..ZZZoYxYoZZZssshZ..",
  ".zzzooyYyoovvhhhhzz.",
  ".zzzZoooooZzzSSShzz.",
  ".zzzZzozozZzzzzzZzz.",
  "ZZZZZZZZZZZZZZZZZZZZ",
  "nbnnbnnnbnnnbnnnbnnb",
  "nbxxxxnnbSSnbnxxxxnb",
  "nbxYYxnnSSSSbnxNNxnb",
  "nbxyyxnSSDDSSnxNNxnb",
  "nbxxxxSSoooDSSxxxxnb",
  "ssshttSDnnnDDSShtttt",
  "ssshSSSryyyyrSshSSSS",
  "ssshSSSryYYyrSshSSSS",
];

/** A copy of each kind's picture, for a button or a card. */
function icons(parts: Parts): Art["icon"] {
  return (kind, grade = 1, carrying = thing("plank")) => {
    const src = must(pageOf(kind), "a kind's page").picture(parts, grade, carrying);
    const { c, g } = makeCanvas(src.width, src.height);
    g.drawImage(src, 0, 0);
    return c;
  };
}

export function makeArt(land: Land): Art {
  const m = makeMachines();
  const item = makeItems();
  const sorter = sorterTops(makePlain());
  return {
    ground: makeGround(land),
    item,
    m,
    trunks: redwoods(land),
    shade: rootShade(),
    growth: [
      bush(18, 12, 301, WILD),
      bush(24, 15, 302, WILD),
      bush(14, 10, 303, WILD),
      fern(8, 321, [GREEN[1], GREEN[2], GREEN[0]]),
      fern(10, 322, [GREEN[0], GREEN[1], GREEN[2]]),
    ],
    under: undergrowth(land),
    bang: bm(["rr", "rr", "rr", "rr", "..", "rr"], 1, 6),
    bolt: bm(["..yy", ".yy.", "yyyy", ".yy.", "yy..", "y..."], 2, 6),
    zed: bm(["www", ".w.", "www"], 1, 3),
    parcel: bm(["NNNNNNN", "NnnynnN", "nnnynnb", "nnnnnnb", "nbbbbbb"], 3, 5),
    sign: signMaker(),
    sorter,
    waysIn: meeting(m, arms(2, 2, 1, 1), headsOn(m, [0, 2]), 1),
    icon: icons({ m, item, sorter, depot: bm(DEPOT_PIC, 0, 0).c }),
  };
}
