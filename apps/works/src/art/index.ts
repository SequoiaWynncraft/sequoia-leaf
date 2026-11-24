/**
 * All of the yard's art, made once when the page opens. Pictures are looked up by name here, once,
 * into lists indexed by the number of the thing or kind of piece (`icon`, and `item` in `items.ts`).
 */

import {
  ALL_KINDS,
  type Dir,
  isItem,
  item as thing,
  ITEM_COUNT,
  type Kind,
  type KindName,
  kindName,
  type Land,
  LEFT,
  NONE,
  RIGHT,
} from "@sequoia-leaf/factory";
import { BARK, CREAM, GOLD, GREEN, INK, PAPER, SKY } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { widthOf, write } from "@sequoia-leaf/kit/text.ts";
import { hash, makeCanvas, must, vnoise } from "@sequoia-leaf/kit/util.ts";

import { type Arms, arms, beltTile, marksOf, TILE, woodOf } from "./belts.ts";
import { type Ground, paintGround } from "./ground.ts";
import { type ItemArt, makeItems, makePlain } from "./items.ts";
import { gathererHat, lookOf, type Machines, makeMachines } from "./machines.ts";
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
  /** The redwoods that stand in the yard, each with where its foot goes. */
  trunks: { s: Sprite; x: number; y: number }[];
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
  /** A machine's picture for a button or a card, as it stands at a grade (the first, unless said). */
  icon: (kind: Kind, grade?: number) => HTMLCanvasElement;
}

const WILD = [DEEP[1], DEEP[2], GREEN[0], GREEN[1], GREEN[2]];

function undergrowth(land: Land): Under[][] {
  return land.plots.map((plot, n) => {
    const out: Under[] = [];
    for (let ty = plot.y; ty < plot.y + plot.h; ty++)
      for (let tx = plot.x; tx < plot.x + plot.w; tx++) {
        const i = ty * land.w + tx;
        if (land.water[i] === 1 || land.trunk[i] === 1) continue;
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

function redwoods(land: Land): Art["trunks"] {
  const out: Art["trunks"] = [];
  for (let ty = 0; ty < land.h; ty++)
    for (let tx = 0; tx < land.w; tx++) {
      const here = land.trunk[ty * land.w + tx] === 1;
      const first = here && land.trunk[ty * land.w + tx - 1] !== 1 && land.trunk[(ty - 1) * land.w + tx] !== 1;
      if (!first) continue;
      const s = trunk(12, 70, 3 + tx * 1.3 + ty * 0.7, 58, 30);
      out.push({ s, x: (tx + 1) * TILE, y: (ty + 2) * TILE - 1 });
    }
  return out;
}

function signMaker(): (price: number) => Sprite {
  const made = new Map<number, Sprite>();
  return (price) => {
    const had = made.get(price);
    if (had) return had;
    const text = price.toLocaleString("en-US");
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

/** A piece of belt running east, with nothing on it, in a line's colour or in none. */
export const bare = (tint = 0): HTMLCanvasElement => beltTile(arms(2, 0, 1, 0), 0, 5, 1, tint);

/**
 * A tile where belts meet at a grade, as the yard lays it: its belt in the grade's wood (`wood`, as
 * `beltTile` takes it), what marks it, and over that the grade's mark. `a` and `main` as `beltTile`
 * takes them.
 */
export function meetingTile(
  m: Machines,
  a: Arms,
  main: Dir,
  top: HTMLCanvasElement | undefined,
  grade: number,
  wood = woodOf(grade),
): HTMLCanvasElement {
  const { c, g } = makeCanvas(16, 16);
  g.drawImage(beltTile(a, main, 5, wood), 0, 0);
  if (top) g.drawImage(top, 0, 0);
  const pip = m.pips[grade - 2];
  if (pip) g.drawImage(pip, 0, 0);
  return c;
}
/** A tile where belts meet, pointing east, at a grade, for a button: at the first grade, with the lighter slats a button shows a belt with. */
const meeting = (m: Machines, a: Arms, top: HTMLCanvasElement | undefined, grade: number): HTMLCanvasElement =>
  meetingTile(m, a, 0, top, grade, grade >= 2 ? woodOf(grade) : 1);

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

/** What a kind's picture is put together from: the machines' art, the things', and a sorter's top. */
interface Parts {
  readonly m: Machines;
  readonly item: ItemArt;
  readonly sorter: Art["sorter"];
}

/**
 * How each kind of piece is pictured, standing idle at a grade: for the toolbar and the cards. Every
 * kind in the tables has its entry, or this does not build; `pictures.test.ts` walks the tables
 * against it too.
 */
export const KIND_PIC: Readonly<Record<KindName, (p: Parts, grade: number) => HTMLCanvasElement>> = {
  // A belt is known by what rides on it. At the first grade its button has lighter slats than the yard's.
  belt: ({ item }, grade) => {
    const { c, g } = makeCanvas(16, 16);
    g.drawImage(grade >= 2 ? beltTile(arms(2, 0, 1, 0), 0, 5, woodOf(grade), 0, marksOf(grade)) : bare(), 0, 0);
    const plank = item(thing("plank"));
    g.drawImage(plank, 8 - (plank.width >> 1), 7 - (plank.height >> 1));
    return c;
  },
  // A gatherer in his grade's hat; of the second grade with his rake stood beside him, of the third his wheelbarrow too.
  gatherer: ({ m }, grade) => {
    const gnome = must(m.gnome[gathererHat(grade)]?.[0], "gnome").c;
    if (grade < 2) return gnome;
    const barrow = grade >= 3 ? m.barrow : null;
    const left = barrow ? barrow.width - 4 : 0;
    const { c, g } = makeCanvas(left + gnome.width + 5, gnome.height);
    if (barrow) g.drawImage(barrow, 0, gnome.height - barrow.height);
    g.drawImage(m.rake.c, left + gnome.width - 2, gnome.height - m.rake.c.height);
    g.drawImage(gnome, left, 0);
    return c;
  },
  mill: ({ m }, grade) => must(m.saw[lookOf(grade)]?.[0], "saw").c,
  bench: ({ m }, grade) => must(m.bench[lookOf(grade)]?.[0], "bench").c,
  workshop: ({ m }, grade) => must(m.workshop[lookOf(grade)]?.[1]?.[0], "workshop").c,
  splitter: ({ m }, grade) => meeting(m, arms(2, 2, 1, 2), m.splitter[0], grade),
  joiner: ({ m }, grade) => meeting(m, arms(2, 1, 1, 1), m.joiner[0], grade),
  tunnel: ({ m }, grade) => {
    const hood = must(m.hood[lookOf(grade)]?.[0], "hood");
    const { c, g } = makeCanvas(18, 20);
    g.drawImage(beltTile(arms(0, 0, 1, 0), 0, 5, woodOf(grade)), 1, 3);
    g.drawImage(hood.c, 0, 0);
    return c;
  },
  crate: ({ m }) => must(m.crate[0]?.[0], "crate").c,
  pylon: ({ m }) => must(m.pylon[0]?.[2], "pylon").c,
  wheel: ({ m }) => must(m.wheel[0], "wheel").c,
  boiler: ({ m }) => must(m.boiler[1], "boiler").c,
  depot: ({ m }) => m.depot.c,
  study: ({ m }, grade) => must(m.study[lookOf(grade)]?.[2], "study").c,
  stop: ({ m }) => must(m.stop[0], "stop").c,
  sorter: ({ m, sorter }, grade) => meeting(m, arms(2, 0, 1, 2), sorter(0, thing("plank")), grade),
};

/** A copy of each kind's picture, for a button or a card. */
function icons(parts: Parts): Art["icon"] {
  const made = ALL_KINDS.map((k) => KIND_PIC[kindName(k)]);
  return (kind, grade = 1) => {
    const src = must(made[kind], "a kind's picture")(parts, grade);
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
    ground: paintGround(land),
    item,
    m,
    trunks: redwoods(land),
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
    icon: icons({ m, item, sorter }),
  };
}
