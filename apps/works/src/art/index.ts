/** All of the yard's art, made once when the page opens. */

import { BARK, CREAM, GOLD, GREEN, INK, PAPER } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { widthOf, write } from "@sequoia-leaf/kit/text.ts";
import { hash, makeCanvas, must, vnoise } from "@sequoia-leaf/kit/util.ts";

import type { Kind, Land } from "../sim/index.ts";
import { beltTile, TILE } from "./belts.ts";
import { type Ground, paintGround } from "./ground.ts";
import { type ItemArt, makeItems } from "./items.ts";
import { type Machines, makeMachines } from "./machines.ts";
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
  /** A machine's picture for a button or a card. */
  icon: (kind: Kind) => HTMLCanvasElement;
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
        const keep = (land.deposit[i] ? 0.3 : 0.62) + (thick - 0.5) * 0.7;
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

const bare = (): HTMLCanvasElement => beltTile([2, 0, 1, 0], 0, 5, 1);

/** A length of belt with something standing on it. */
const onBelt = (top: HTMLCanvasElement): HTMLCanvasElement => {
  const { c, g } = makeCanvas(16, 16);
  g.drawImage(bare(), 0, 0);
  g.drawImage(top, 0, 0);
  return c;
};

/** A picture of each kind of thing that can be built, as it looks standing idle: for the toolbar and the cards. */
function icons(m: Machines, item: ItemArt): (kind: Kind) => HTMLCanvasElement {
  // A belt is known by what rides on it.
  const belt = (): HTMLCanvasElement => {
    const { c, g } = makeCanvas(16, 16);
    g.drawImage(bare(), 0, 0);
    const plank = item("plank");
    g.drawImage(plank, 8 - (plank.width >> 1), 7 - (plank.height >> 1));
    return c;
  };
  const tunnel = (): HTMLCanvasElement => {
    const hood = must(m.hood[0], "hood");
    const { c, g } = makeCanvas(18, 20);
    g.drawImage(beltTile([0, 0, 1, 0], 0, 5, 0), 1, 3);
    g.drawImage(hood.c, 0, 0);
    return c;
  };
  const pics: Record<Kind, () => HTMLCanvasElement> = {
    belt,
    gatherer: () => must(m.gnome[0]?.[0], "gnome").c,
    mill: () => must(m.saw[0], "saw").c,
    bench: () => must(m.bench[0], "bench").c,
    workshop: () => must(m.workshop[1]?.[0], "workshop").c,
    splitter: () => onBelt(m.splitter),
    joiner: () => onBelt(m.joiner),
    tunnel,
    crate: () => must(m.crate[0]?.[0], "crate").c,
    pylon: () => must(m.pylon[0]?.[2], "pylon").c,
    wheel: () => must(m.wheel[0], "wheel").c,
    boiler: () => must(m.boiler[1], "boiler").c,
    depot: () => m.depot.c,
  };
  return (kind) => {
    const src = pics[kind]();
    const { c, g } = makeCanvas(src.width, src.height);
    g.drawImage(src, 0, 0);
    return c;
  };
}

export function makeArt(land: Land): Art {
  const m = makeMachines();
  const item = makeItems();
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
    icon: icons(m, item),
  };
}
