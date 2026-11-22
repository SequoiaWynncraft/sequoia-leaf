/**
 * The small pictures: one for every trait, component, finished item and boon, the three kinds of
 * room, and the few signs the buttons carry. Typed as rows of letters like the figures, baked once
 * with a dark edge, and handed out as fresh little canvases to put on the page.
 */
import { GOLD, INK } from "@sequoia-leaf/kit/palette.ts";
import { bitmap, outlined } from "@sequoia-leaf/kit/pix.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";
import { type BoonId, BOONS } from "@sequoia-leaf/raid/content/boons.ts";
import { isComponentId, type ItemId } from "@sequoia-leaf/raid/content/items.ts";
import type { RoomKind } from "@sequoia-leaf/raid/content/rooms.ts";
import type { TraitId } from "@sequoia-leaf/raid/content/traits.ts";

import { PAL } from "./pal.ts";

const TRAIT_ROWS: Readonly<Record<TraitId, readonly string[]>> = {
  ember: [
    "....r....",
    "...rr....",
    "...rrr.r.",
    "..rryr.rr",
    "..ryyrrrr",
    ".rryYyrrr",
    ".rryYYyrr",
    ".rryYYyr.",
    "..rrrrr..",
  ],
  moss: [
    "....l....",
    "...lLl...",
    "...lLl...",
    ".l..l..l.",
    "lLl.l.lLl",
    "lLLlllLLl",
    ".lLLlLLl.",
    "..llGll..",
    "....G....",
  ],
  mist: [
    "...UUU...",
    "..UWWWU..",
    ".UWWWWWUU",
    "UWWWWWWWU",
    "UWWWWWWWU",
    ".UUUUUUU.",
    ".........",
    "..U..U...",
    ".U..U..U.",
  ],
  burrow: [
    ".........",
    "...fff...",
    "..fEEEf..",
    ".fEEEEEf.",
    "fEEmmmEEf",
    "fEmmmmmEf",
    "fEmmmmmEf",
    "fEEEEEEEf",
    ".fffffff.",
  ],
  feather: [
    ".......ww",
    ".....wwcw",
    "....wcwww",
    "...wcwww.",
    "..wcwww..",
    ".wcwww...",
    ".cwww....",
    "cww......",
    "c........",
  ],
  crab: [".........", "rr.....rr", "r.w...w.r", ".rrrrrrr.", "rrrrrrrrr", ".RrrrrrR.", "R.R...R.R", "........."],
  gnome: [
    "....r....",
    "....rr...",
    "...rrr...",
    "...rrrr..",
    "..rrrrr..",
    "..rrrrrr.",
    ".rrrrrrr.",
    "RRRRRRRRR",
    "..wwwww..",
  ],
  bulwark: [
    ".sssssss.",
    "sttttSSSs",
    "sttttSSSs",
    "sttttSSSs",
    "sttttSSSs",
    ".sttSSSs.",
    ".sttSSSs.",
    "..stSSs..",
    "...sss...",
  ],
  fang: [
    "wwwwwwwww",
    "wwwwwwwwc",
    ".wwwwwwc.",
    ".wwwwwcc.",
    "..wwwwc..",
    "..wwwcc..",
    "...wwc...",
    "...wc....",
    "....c....",
  ],
  slinger: [
    "b.......b",
    "bb.....bb",
    ".bb...bb.",
    "..bbSbb..",
    "...bbb...",
    "....b....",
    "....b....",
    "....b....",
    "....b....",
  ],
  sage: [
    "....v....",
    "....v....",
    "...vWv...",
    "..vWWWv..",
    "vvWWWWWvv",
    "..vWWWv..",
    "...vWv...",
    "....v....",
    "....v....",
  ],
  mender: [
    ".........",
    ".ll...ll.",
    "lLLl.lLLl",
    "lLLLlLLLl",
    "lLwwwwwLl",
    ".lLLLLLl.",
    "..lLLLl..",
    "...lLl...",
    "....l....",
  ],
  sneak: [".........", ".VVVVVVV.", "VVVVVVVVV", "VwwVVVwwV", "VwkVVVkwV", "VVVVVVVVV", ".VVV.VVV.", "........."],
  greg: ["..GGGGG..", ".GGGGGGG.", "GkGGGGGkG", "GGGGGGGGG", "GkkkkkkkG", "GLLLLLLLG", ".GLLLLLG.", "..GGGGG.."],
};

const ITEM_ROWS: Readonly<Record<ItemId, readonly string[]>> = {
  thorn: [
    ".......b..",
    "......bb..",
    ".....bBb..",
    "....bBBb..",
    "...bBBb...",
    "..bBBBb...",
    ".bBBNBb...",
    "bBBNNb....",
    "bBNNb.....",
    ".bbb......",
  ],
  plume: [
    ".......hh.",
    ".....hhph.",
    "....hphhh.",
    "...hphhh..",
    "..hphhh...",
    ".hphhh....",
    ".phhh.....",
    "phh.......",
    "p.........",
  ],
  glowcap: [
    "...uuuu...",
    "..uUUUUu..",
    ".uUWUUUUu.",
    "uUUUUUWUUu",
    "uUUUUUUUUu",
    ".aaaaaaaa.",
    "...cccc...",
    "...ccCc...",
    "...ccCc...",
    "..ccccCc..",
  ],
  bark: [
    ".nnnnnnn..",
    "nNNnNNNnn.",
    "nNnnNNnNn.",
    "nNNnNnnNnn",
    "nnNnNNnNNn",
    "nNNnnNnNNn",
    "nNnNNNnnNn",
    ".nNNnNNnNn",
    ".nnNNnNNnn",
    "..nnnnnnn.",
  ],
  chestnut: [
    "...BBBB...",
    "..BnnnnB..",
    ".BnNNnnnB.",
    "BnNNnnnnnB",
    "BnnnnnnnnB",
    "BnnnccnnnB",
    "BnnccccnbB",
    ".BnccccbB.",
    "..BBbbBB..",
    "...bbbb...",
  ],
  blackthorn: [
    "..w....m..",
    ".wWw..m...",
    "..w..mm.w.",
    "....mm.wWw",
    ".m.mm...w.",
    "..mmm.....",
    ".w.mm.m...",
    "wWw.mm....",
    ".w...mm...",
    "......mm..",
  ],
  wasptail: [
    ".........t",
    "........tt",
    ".......yy.",
    "......xx..",
    ".....yy...",
    "....xx....",
    "...yy.....",
    "..xx......",
    ".UU.......",
    "UU........",
  ],
  glowthorn: [
    ".......U..",
    "......UU..",
    ".....UuU..",
    "....UuuU..",
    "...UuuU.W.",
    "..UuuuU...",
    ".UuuauU...",
    "UuuaaU..W.",
    "UuaaU.....",
    ".UUU......",
  ],
  hedgehog: [
    "..b.b.b...",
    ".bbnbnbb..",
    "bbnbnbnbb.",
    ".bnbnbnbbb",
    "bbbnbnbncc",
    ".bnbnbncck",
    "bbbnbncccc",
    ".bbbbccc..",
    "..b..b....",
  ],
  conker: [
    "......c...",
    ".....c....",
    "....c.....",
    "....c.....",
    "...BBBB...",
    "..BnNNnB..",
    ".BnNnnnnB.",
    ".BnnnccnB.",
    ".BnncccbB.",
    "..BBbbBB..",
  ],
  hummingbird: [
    "..........",
    "...ll.....",
    "..lLLl....",
    "kklkLl....",
    "..lLLll...",
    "...lhLLl..",
    "...hhlLLl.",
    "....hllLLl",
    ".....l.lll",
    "..........",
  ],
  mothlantern: [
    "....bb....",
    "...bbbb...",
    "..b....b..",
    "..bYYYYb..",
    "..bYwwYb..",
    "..bYcNcb..",
    "..bYwwYb..",
    "..bYYYYb..",
    "..bbbbbb..",
    "...b..b...",
  ],
  quilt: [
    ".rr....uu.",
    "rrrr..uuuu",
    "rrryyllluu",
    ".rryylllu.",
    ".uuurrryy.",
    ".uuurrryy.",
    ".llyyuurr.",
    ".llyyuurr.",
    ".rrlllyyu.",
    ".rrlllyyu.",
  ],
  honeycake: [
    "..........",
    "....yy....",
    "..yyYYyy..",
    ".yYYYYYYy.",
    "yYYyyYYYYy",
    "oyyYYyyyyo",
    "oNNooNNNNo",
    "oNNNNNNNNo",
    ".oNNNNNNo.",
    "..oooooo..",
  ],
  fairyring: [
    "...rr.rr..",
    "..rwr.rrr.",
    "...c...c..",
    "rr......rr",
    "rwr....rwr",
    ".c......c.",
    "...rr.rr..",
    "..rrr.rwr.",
    "...c...c..",
    "..........",
  ],
  lichen: [
    "...tttt...",
    "..t....t..",
    "..t....t..",
    "...tssst..",
    "..sGGGGs..",
    ".sGlGGlGs.",
    ".sGGLLGGs.",
    ".sGlGGGGs.",
    "..sGGlGs..",
    "...ssss...",
  ],
  stewpot: [
    "...W..W...",
    "..W..W....",
    "...W..W...",
    ".TTTTTTTT.",
    "TssssssssT",
    ".TsSSsssT.",
    ".TsSsssTT.",
    ".TssssssT.",
    "..TTTTTT..",
    "..T....T..",
  ],
  stump: [
    "..nnnnnn..",
    ".nooooooN.",
    "nooNNNNooN",
    "noNooooNoN",
    "noNoNNoNoN",
    "noNoNNoNoN",
    "noNooooNoN",
    "nooNNNNooN",
    ".nooooooN.",
    "..NNNNNN..",
  ],
  hollowlog: [
    "..........",
    "..nnnnnnn.",
    ".nNNNNNNNn",
    "nmmnNnNNNn",
    "mmmmnNNnNn",
    "mmmmnNnNNn",
    "nmmnNNNNNn",
    ".nnnnnnnn.",
    "..l...G...",
    "..........",
  ],
  hoard: [
    "....BB....",
    "...BnnB...",
    "...BncB...",
    ".BB.BB.BB.",
    "BnnBBBBnnB",
    "BncBnnBncB",
    ".BBBncBBB.",
    "BnnBBBBnnB",
    "BncB..BncB",
    ".BB....BB.",
  ],
};

/** A boon that is not a charm has a picture of its own; a charm is its kin's sign on a string. */
const BOON_ROWS: Readonly<Partial<Record<BoonId, readonly string[]>>> = {
  deeppockets: [
    "..........",
    ".nnnnnnnn.",
    ".nNNNNNNn.",
    ".nNyNNyNn.",
    ".nNNNNNNn.",
    ".nnNNNNnn.",
    "..nNooNn..",
    "..nNooNn..",
    "...nnnn...",
    "..........",
  ],
  regular: [
    "..W.W.....",
    "...W......",
    ".wwwwww...",
    ".wNNNNwww.",
    ".wNNNNw.w.",
    ".wNNNNw.w.",
    ".wNNNNwww.",
    ".wNNNNw...",
    ".wwwwww...",
    "..........",
  ],
  quickstudy: [
    "..........",
    ".vvvv.vvvv",
    "vwwwwvwwwv",
    "vwkkwvwkwv",
    "vwwwwvwwwv",
    "vwkkwvwkwv",
    "vwwwwvwwwv",
    "vvvvvvvvvv",
    ".VVVVVVVV.",
    "..........",
  ],
  windfall: [
    ".B....B...",
    "BBB..BBB..",
    "yyy..yyy.B",
    "yYy..yYyBBB",
    ".y....y.yyy",
    "...B....yYy",
    "..BBB....y.",
    "..yyy.....",
    "..yYy.....",
    "...y......",
  ],
  basket: [
    "...nnnn...",
    "..n....n..",
    ".n......n.",
    "NNNNNNNNNN",
    "NnNnNnNnNn",
    "nNnNnNnNnN",
    "NnNnNnNnNn",
    ".NnNnNnNn.",
    ".nNnNnNnN.",
    "..nnnnnn..",
  ],
  widestall: [
    "nnnnnnnnnn",
    "rrwwrrwwrr",
    "rrwwrrwwrr",
    "rrwwrrwwrr",
    ".r.w.r.w.r",
    "n........n",
    "n........n",
    "nNNNNNNNNn",
    "nBBBBBBBBn",
    "n........n",
  ],
  haggler: [
    "....cccccc",
    "...ccccccc",
    "..cckccccc",
    ".cccccRRcc",
    "ccccccRccc",
    ".cccccRRcc",
    "..ccccccRc",
    "...cccRRcc",
    "....cccccc",
    "..........",
  ],
  secondwind: [
    "..UUUU....",
    ".U....U...",
    "U..rr.rrU.",
    "U.rhhrhhr.",
    "U.rhhhhhr.",
    ".U.rhhhr..",
    "..U.rhr.U.",
    "...U.r.U..",
    "....UUU...",
    "..........",
  ],
  headstart: [
    "......y...",
    "......yy..",
    "yyyyyyyyy.",
    "yYYYYYYYyy",
    "yyyyyyyyy.",
    "......yy..",
    "......y...",
    ".U.U.U....",
    "U.U.U.....",
    "..........",
  ],
  extrachair: [
    ".n........",
    ".n........",
    ".n........",
    ".nNNNNNN..",
    ".nnnnnnn..",
    ".nrrrrrn..",
    ".nnnnnnn..",
    ".n.....n..",
    ".n.....n..",
    ".n.....n..",
  ],
  blanket: [
    "..........",
    ".pppppppp.",
    "pvpvpvpvpp",
    "ppppppppvp",
    "pvpvpvpvpp",
    "ppppppppvp",
    "pvpvpvpvpp",
    ".pppppppp.",
    ".y.y.y.y..",
    "..........",
  ],
  smallfry: [
    "..........",
    "..........",
    ".uu...ll..",
    "uUuu.lLll.",
    "ukuk.lklk.",
    "uuuu.llll.",
    ".aa...GG..",
    "..........",
    "tttt.tttt.",
    "..........",
  ],
  formation: [
    "....y.....",
    "...yYy....",
    "....y.....",
    "..........",
    ".y.....y..",
    "yYy...yYy.",
    ".y.....y..",
    "..........",
    "tttttttttt",
    "..........",
  ],
};

const ROOM_ROWS: Readonly<Record<RoomKind, readonly string[]>> = {
  trouble: ["..l....", ".lLl.c.", ".lLLl..", "c.lLLl.", "...lLl.", "..g.l..", ".g....."],
  spar: [".bbbbb.", "bbbbbbb", "bcccccb", "ckccckc", "ccccccc", ".ccrcc.", "..ccc.."],
  boss: ["y..y..y", "yy.y.yy", "yyyyyyy", "yYrYrYy", "yyyyyyy", "ooooooo", "......."],
};

export type Glyph =
  | "acorn"
  | "rustle"
  | "pin"
  | "up"
  | "play"
  | "fast"
  | "skip"
  | "book"
  | "help"
  | "door"
  | "swords"
  | "hand"
  | "figure"
  | "brush"
  | "leaf"
  | "coin";

const GLYPH_ROWS: Readonly<Record<Glyph, readonly string[]>> = {
  acorn: [
    "....bb....",
    "....b.....",
    ".BBBBBBBB.",
    "BnBnBnBnBB",
    "BBnBnBnBnB",
    ".oyyyyyyo.",
    ".oyYyyyyo.",
    ".oyYyyyyo.",
    "..oyyyyo..",
    "...oyyo...",
    "....oo....",
  ],
  rustle: [
    "..wwwww...",
    ".ww...ww.w",
    "ww.....www",
    "w.....wwww",
    "..........",
    "..........",
    "wwww.....w",
    "www.....ww",
    "w.ww...ww.",
    "...wwwww..",
  ],
  pin: [
    "...rrrr...",
    "..rhhrrr..",
    "..rhrrrr..",
    "..rrrrrr..",
    "...RRRR...",
    ".RRRRRRRR.",
    "....tt....",
    "....tt....",
    "....tt....",
    "....t.....",
  ],
  up: ["....ww....", "...wwww...", "..wwwwww..", ".wwwwwwww.", "wwwwwwwwww", "...wwww...", "...wwww...", "...wwww..."],
  play: ["ww......", "wwww....", "wwwwww..", "wwwwwwww", "wwwwwwww", "wwwwww..", "wwww....", "ww......"],
  fast: [
    "ww...ww...",
    "www..www..",
    "wwww.wwww.",
    "wwwwwwwwww",
    "wwwwwwwwww",
    "wwww.wwww.",
    "www..www..",
    "ww...ww...",
  ],
  skip: [
    "ww...ww.ww",
    "www..ww.ww",
    "wwww.ww.ww",
    "wwwwwww.ww",
    "wwwwwww.ww",
    "wwww.ww.ww",
    "www..ww.ww",
    "ww...ww.ww",
  ],
  book: [
    ".vvvv.vvvv",
    "vwwwwvwwwv",
    "vwwwwvwwwv",
    "vwwwwvwwwv",
    "vwwwwvwwwv",
    "vwwwwvwwwv",
    "vvvvvvvvvv",
    ".VVVVVVVV.",
  ],
  help: ["..wwww..", ".ww..ww.", ".ww..ww.", "....ww..", "...ww...", "...ww...", "........", "...ww...", "...ww..."],
  door: [
    ".nnnnnnn..",
    ".nNNNNNn..",
    ".nNNNNNn.w",
    ".nNNNNNnww",
    ".nNNNyNwww",
    ".nNNNNNnww",
    ".nNNNNNn.w",
    ".nNNNNNn..",
    ".nnnnnnn..",
  ],
  swords: [
    "t.......t",
    "tt.....tt",
    ".tt...tt.",
    "..tt.tt..",
    "...ttt...",
    "..tt.tt..",
    "ntt...ttn",
    "nn.....nn",
    "n.n...n.n",
  ],
  hand: [
    "...kk.....",
    "..kwwk....",
    "..kwwk....",
    "..kwwk....",
    "..kwwkkk..",
    "..kwwkwwkk",
    "kkkwwwwwwk",
    "kwkwwwwwwk",
    "kwwwwwwwwk",
    ".kwwwwwwwk",
    "..kwwwwwk.",
    "..kkkkkkk.",
  ],
  figure: ["..www..", ".wwwww.", ".wwwww.", "..www..", ".wwwww.", "wwwwwww", "wwwwwww", ".ccccc."],
  brush: [
    ".......nn",
    "......nNn",
    ".....nNn.",
    "....nNn..",
    "...tTn...",
    "..rrt....",
    ".rhrr....",
    "rhrr.....",
    "rrr......",
  ],
  leaf: [
    "........GG..",
    "......GGllG.",
    "....GGlllwG.",
    "...GllllwlG.",
    "..GlllllwlG.",
    "..GllllwllG.",
    ".GllllwlllG.",
    ".GlllwlllG..",
    ".GllwlllG...",
    ".GlwlGGG....",
    ".Gw.........",
    "Gd..........",
  ],
  coin: [
    "....oooo....",
    "..ooyyyyoo..",
    ".oyyYYYYyyo.",
    ".oyYwyyoYyo.",
    "oyYwyyyyoYyo",
    "oyYyyooyoYyo",
    "oyYyyooyoYyo",
    "oyYyyyyyoYyo",
    ".oyYyyyoYyo.",
    ".oyyYYYYyyo.",
    "..ooyyyyoo..",
    "....oooo....",
  ],
};

const baked = new Map<string, HTMLCanvasElement>();
function bakedOf(key: string, rows: readonly string[], edge = true): HTMLCanvasElement {
  let c = baked.get(key);
  if (!c) {
    const pic = bitmap(rows, PAL);
    c = edge ? outlined(pic, INK) : pic;
    baked.set(key, c);
  }
  return c;
}
/** A fresh copy of a baked picture, to put on the page (a canvas can only be in one place). */
function copy(src: HTMLCanvasElement): HTMLCanvasElement {
  const { c, g } = makeCanvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  return c;
}

/** The kept picture of a trait, for drawing on the table. Do not put it on the page. */
export const traitPic = (id: TraitId): HTMLCanvasElement => bakedOf(`t:${id}`, TRAIT_ROWS[id]);
export const traitIcon = (id: TraitId): HTMLCanvasElement => copy(traitPic(id));
export const itemPic = (id: ItemId): HTMLCanvasElement => bakedOf(`i:${id}`, ITEM_ROWS[id]);
export const itemIcon = (id: ItemId): HTMLCanvasElement => copy(itemPic(id));
export const glyphPic = (id: Glyph): HTMLCanvasElement => bakedOf(`g:${id}`, GLYPH_ROWS[id], id !== "hand");
export const glyph = (id: Glyph): HTMLCanvasElement => copy(glyphPic(id));
export const roomIcon = (kind: RoomKind): HTMLCanvasElement => copy(bakedOf(`r:${kind}`, ROOM_ROWS[kind]));

/** A boon's picture: its own, or for a charm its kin's sign hanging on a string. */
export function boonIcon(id: BoonId): HTMLCanvasElement {
  const rows = BOON_ROWS[id];
  if (rows) return copy(bakedOf(`b:${id}`, rows));
  const kin = BOONS[id].charm;
  if (!kin) return copy(glyphPic("acorn"));
  const sign = traitPic(kin);
  const { c, g } = makeCanvas(sign.width, sign.height + 3);
  g.fillStyle = PAL.c ?? "#e9d8b8";
  g.fillRect(Math.floor(sign.width / 2) - 1, 0, 1, 3);
  g.fillRect(Math.floor(sign.width / 2) + 1, 0, 1, 3);
  g.fillRect(Math.floor(sign.width / 2), 0, 1, 1);
  g.drawImage(sign, 0, 3);
  return c;
}

/**
 * Halves a picture typed as letters: each square of two by two becomes the letter most of it is,
 * so a ten-pixel item keeps its shape and colours at five.
 */
function halved(rows: readonly string[]): string[] {
  const out: string[] = [];
  for (let y = 0; y < rows.length; y += 2) {
    let line = "";
    for (let x = 0; x < (rows[0]?.length ?? 0); x += 2) {
      const seen = new Map<string, number>();
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        const ch = rows[y + dy]?.[x + dx] ?? ".";
        if (ch !== ".") seen.set(ch, (seen.get(ch) ?? 0) + 1);
      }
      let best = ".";
      let most = 0;
      for (const [ch, n] of seen) {
        if (n <= most) continue;
        best = ch;
        most = n;
      }
      line += best;
    }
    out.push(line);
  }
  return out;
}

/**
 * What a figure holds, as it is shown under its base: the item at half size, a finished one with a
 * gold edge and a loose component with the plain dark one, so a component waiting for its pair
 * stands out. Do not put it on the page.
 */
export function heldPic(id: ItemId): HTMLCanvasElement {
  const key = `h:${id}`;
  let c = baked.get(key);
  if (!c) {
    const pic = bitmap(halved(ITEM_ROWS[id]), PAL);
    c = outlined(pic, isComponentId(id) ? INK : GOLD[2]);
    baked.set(key, c);
  }
  return c;
}
