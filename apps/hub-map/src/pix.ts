/** Small pixel pictures, written out as rows of letters, and the helpers that draw them. */
import { P } from "./palette.ts";

export type Ctx = CanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d") as Ctx;
  g.imageSmoothingEnabled = false;
  return [c, g];
}

/** One letter, one colour. A dot is nothing. */
export const KEY: Record<string, string> = {
  k: P.ink,
  "0": P.g0,
  "1": P.g1,
  "2": P.g2,
  "3": P.g3,
  "4": P.g4,
  a: P.bark0,
  b: P.bark1,
  d: P.bark2,
  e: P.bark3,
  f: P.bark4,
  p: P.s0,
  q: P.s1,
  r: P.s2,
  s: P.s3,
  x: P.e0,
  y: P.e1,
  z: P.e2,
  o: P.gold0,
  g: P.gold1,
  h: P.gold2,
  c: P.cream,
  P: P.plum0,
  Q: P.plum1,
  R: P.plum2,
  S: P.plum3,
  T: P.rose,
  U: P.coral,
  w: P.w2,
  W: P.w3,
  B: P.w4,
  t: P.teal,
  n: P.sand1,
  m: P.sand2,
  u: P.red2,
  v: P.red3,
  l: P.snow1,
};

export function art(rows: readonly string[], swap?: Record<string, string>): HTMLCanvasElement {
  const w = Math.max(...rows.map((r) => r.length));
  const [c, g] = makeCanvas(w, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x] as string;
      if (ch === "." || ch === " ") continue;
      g.fillStyle = swap?.[ch] ?? KEY[ch] ?? "#ff00ff";
      g.fillRect(x, y, 1, 1);
    }
  });
  return c;
}

// ---------- trees and small things on the map ----------

const PINE_L = [
  ".....2.....",
  "....321....",
  "....321....",
  "...33210...",
  "...32210...",
  "..3322100..",
  "..2322100..",
  ".332221100.",
  ".232221100.",
  "33222111000",
  "23222111000",
  ".2.211100.0",
  "....ba.....",
  "....ba.....",
];
const PINE_S = [
  "...2...",
  "..321..",
  "..321..",
  ".33210.",
  ".32210.",
  "3322100",
  "2322100",
  ".2.10.0",
  "...b...",
  "...b...",
];
const LEAF_L = [
  "....3443....",
  "..33444322..",
  ".3344433221.",
  ".3444332211.",
  "344433322110",
  "344333222110",
  "333332221110",
  "233322221100",
  ".2322211100.",
  ".2222111000.",
  "..11110000..",
  ".....ba.....",
  ".....ba.....",
];
const LEAF_S = [
  "..3443..",
  ".344322.",
  "34433211",
  "34332211",
  "33322110",
  ".222110.",
  "..1100..",
  "...ba...",
  "...ba...",
];
const BUSH = [".232.", "32211", "22110", ".110."];
const ROCK_A = [".sr...", "srrq..", "srqqp.", "rqqpp.", ".qpp.."];
const ROCK_B = ["..sr.", ".srq.", "srqqp", ".qpp."];
const STUMP = [".ff.", "fedb", "edba", ".ba."];

const DEEP = { "0": "#1c3a26", "1": P.g0, "2": P.g1, "3": P.g2, "4": P.g3 };
const EMBER = { "0": "#3a1c33", "1": P.red0, "2": P.red1, "3": P.red2, "4": P.red3 };

export const TREES = {
  pineL: art(PINE_L),
  pineS: art(PINE_S),
  pineLDeep: art(PINE_L, DEEP),
  pineSDeep: art(PINE_S, DEEP),
  leafL: art(LEAF_L),
  leafS: art(LEAF_S),
  leafLDeep: art(LEAF_L, DEEP),
  emberL: art(LEAF_L, EMBER),
  emberS: art(LEAF_S, EMBER),
  emberPine: art(PINE_L, EMBER),
  bush: art(BUSH),
  bushDeep: art(BUSH, DEEP),
  rockA: art(ROCK_A),
  rockB: art(ROCK_B),
  stump: art(STUMP),
};

// ---------- small moving things ----------

export const CRAB = [
  art(["U.....U", "UkUUUkU", ".UUUUU.", "U.U.U.U"]),
  art(["U.....U", "UkUUUkU", ".UUUUU.", ".U.U.U."]),
];
export const LANTERN = art([".k.", "ghg", "gcg", "ogo"]);
export const BOAT = art([
  "....c.....",
  "....cc....",
  "....ccc...",
  "....cccc..",
  "....a.....",
  "fffffffffe",
  ".edddddde.",
  "..bbbbbb..",
]);

// ---------- icons for the interface ----------

export const ICONS = {
  leaf: art([
    "......kkkk.",
    "....kk344k.",
    "...k34443k.",
    "..k344343k.",
    ".k3443433k.",
    ".k443433k..",
    "k3434332k..",
    "k343332k...",
    "k33322k....",
    ".kakkk.....",
    "kak........",
    ".k.........",
  ]),
  coin: art([
    "..kkkkkk..",
    ".kghhhhok.",
    "kghhgghhok",
    "kghghhohok",
    "kghghhohok",
    "kghghhohok",
    "kghghhohok",
    "kghhoohhok",
    ".kgooook..",
    "..kkkkkk..",
  ]),
  lantern: art([
    "...kkk...",
    "..k.k.k..",
    "..kkkkk..",
    ".kdddddk.",
    ".kohhhok.",
    ".khcchhk.",
    ".khcchhk.",
    ".khhhhok.",
    ".kohhook.",
    ".kdddddk.",
    "..kkkkk..",
  ]),
  banner: art([
    "kk.........",
    "kfkkkkkkkk.",
    "kfgggggggok",
    "kfgg3gggggk",
    "kfg343ggggk",
    "kfgg3ggggok",
    "kfgggggggk.",
    "kfggokgggk.",
    "kfgok.koek.",
    "kfkk...kk..",
    "kf.........",
    "kk.........",
  ]),
  star: art([
    ".....k.....",
    "....khk....",
    "....khk....",
    "kkkkhhhkkkk",
    "khhhhhhhhhk",
    ".kghhhhhgk.",
    "..kghhhgk..",
    "..kghhhgk..",
    ".kghgkghgk.",
    ".kggk.kggk.",
    ".kkk...kkk.",
  ]),
  heart: art([".kk...kk.", "kUUk.kUUk", "kUcUkUUUk", "kUUUUUUUk", ".kUUUUUk.", "..kUUUk..", "...kUk...", "....k...."]),
  cog: art([
    "....kkk....",
    ".kk.ksk.kk.",
    "kssksssksrk",
    ".kssssssrk.",
    "kkssrkkrsrkk",
    "ksssk.ksrrk",
    "kkssrkkrrrkk",
    ".kssrrrrrk.",
    "ksrkrrrkrrk",
    ".kk.krk.kk.",
    "....kkk....",
  ]),
  scroll: art([
    "..kkkkkkk..",
    ".kcccUccck.",
    ".kccccccck.",
    ".kcyyyyyck.",
    ".kccccccck.",
    ".kcyyyycck.",
    ".kccccccck.",
    ".kcyyyyyck.",
    ".kccccccck.",
    ".khhhhhhhk.",
    "..kkkkkkk..",
  ]),
  crab: art([
    ".kk.......kk.",
    "kUUk.....kUUk",
    "kUkUk...kUkUk",
    ".kUk.k.k.kUk.",
    "..kUkckckUk..",
    "..kUUkUkUUk..",
    ".kUUUUUUUUUk.",
    ".kUvUUUUUvUk.",
    "k.kUUUUUUUk.k",
    ".k.kkUkUkk.k.",
    "...k.k.k.k...",
  ]),
  flame: art([
    "....k....",
    "...kUk...",
    "...kUk.k.",
    "..kUUkkUk",
    ".kUUgUkUk",
    ".kUggUUUk",
    "kUUghgUUk",
    "kUghhhgUk",
    "kUghchgUk",
    "kUgghggUk",
    ".kUUUUUk.",
    "..kkkkk..",
  ]),
  vault: art([
    "..kkkkkkkk..",
    ".keeeeeeefk.",
    "keeeeeeeeefk",
    "kkkkkkkkkkkk",
    "kddddhhddddk",
    "kdddh34hdddk",
    "kdddh43hdddk",
    "kddddhhddddk",
    "kbbbbbbbbbbk",
    ".kkkkkkkkkk.",
  ]),
  stall: art([
    ".kkkkkkkkkk.",
    "kUcUcUcUcUck",
    "kUcUcUcUcUck",
    "kvcvcvcvcvck",
    ".kkkkkkkkkk.",
    "..kb....bk..",
    "..kb.g3.bk..",
    ".kffffffffk.",
    ".keeeeeeeek.",
    ".kddddddddk.",
    ".kk......kk.",
  ]),
  hand: art([
    "...k.k.k...",
    "..kckckck..",
    "..kckckckk.",
    "..kckckckck",
    "k.kcccccckk",
    "kckcccccck.",
    ".kcccccccck",
    "..kccccccck",
    "..kccccck..",
    "...kccck...",
    "....kkk....",
  ]),
  laugh: art([
    "..kkkkk..",
    ".kgggggk.",
    "kggggggok",
    "kgkggkgok",
    "kggggggok",
    "kgkkkkgok",
    "kggkkggok",
    ".kgggook.",
    "..kkkkk..",
  ]),
  note: art([
    "...kkkkk.",
    "...khhhk.",
    "...khkkk.",
    "...khk...",
    "...khk...",
    ".kkkhk...",
    "khhhhk...",
    "khhhhk...",
    ".kkkk....",
  ]),
  pin: art(["..kkk..", ".kUUUk.", "kUcUUvk", "kUUUUvk", ".kUUvk.", "..kvk..", "...k..."]),
  sound: art(["....k....", "...kck.k.", "kkkcck..k", "kccccck.k", "kccccck.k", "kkkcck..k", "...kck.k.", "....k...."]),
  mute: art([
    "....k....",
    "...kck...",
    "kkkcck.k.k",
    "kccccck.k.",
    "kccccck.k.",
    "kkkcck.k.k",
    "...kck...",
    "....k....",
  ]),
  face: art(["kkkkkkkk"]),
};
export type IconId = keyof typeof ICONS;

/** A fresh copy of an icon for the page, drawn `scale` times its size. */
export function iconEl(id: IconId, scale = 2): HTMLCanvasElement {
  const src = ICONS[id];
  const [c, g] = makeCanvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  c.style.width = `${src.width * scale}px`;
  c.style.height = `${src.height * scale}px`;
  c.className = "px";
  return c;
}
