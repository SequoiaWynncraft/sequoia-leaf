/**
 * Every thing the yard gathers and makes, as a tiny picture: small enough to ride a belt, plain
 * enough to know at a glance. Looked up by name once, into a list by the thing's number.
 */

import { ALL_ITEMS, type Item, type ItemName, itemName } from "@sequoia-leaf/factory";
import { INK } from "@sequoia-leaf/kit/palette.ts";
import { bitmap, outlined } from "@sequoia-leaf/kit/pix.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { PAL } from "./pal.ts";

/** Every thing's picture, typed. Each thing in the tables has one: a new one without a picture does not build. */
export const ROWS: Readonly<Record<ItemName, readonly string[]>> = {
  // A couple of fallen branches, one still in leaf.
  deadfall: ["..n...l.", ".nNn.lG.", "..nNn...", "b..nNn..", "nb..nNn.", ".nNn.nb.", "..nb...."],
  stone: ["..tSS..", ".tSSSs.", "tSSSsss", "SSSsssh", "Ssssshh", ".sshhh."],
  ore: ["..sSS..", ".sSyYs.", "sSSsyss", "SYysssh", "sysyshh", ".sshhh."],
  clay: ["..qrr..", ".qrrRR.", "qrrRRRR", "rrRRRRQ", "rRRRRQQ", ".RRQQQ."],
  sand: ["...a....", "..awa...", ".aaaAa..", "aawaaAA.", "aAaAaAAC"],
  resin: ["...Y...", "..YwY..", ".yYYyo.", ".yYyyo.", ".oyyoo.", "..ooo.."],
  // Two sawn boards, the pale side up.
  plank: [".aaaaaaa", "aaaAaaAC", "ACCCCCCn", ".aaaaaaa", "aaAaaaAC", "ACCCCCCn"],
  brick: ["qqqqqqqq", "rrrRrrrR", "RRRRRRRR", "rRrrrRrr", "RQQQQQQQ"],
  ingot: [".twwwwt.", "twwwtttS", "ttttttSs", "SSSSSSsh"],
  pot: [".RrrrrR.", "..QQQQ..", ".qrrRRR.", "qrrRRRRQ", "rrRRRRRQ", ".RRRRQQ."],
  glass: ["UUUUUUU", "UwUuuuU", "UUwuuuU", "UuuwuuU", "UuuuuuU", "UUUUUUU"],
  // A stoppered flask of lamp oil.
  oil: ["..nn...", "..cc...", ".cccc..", "cyYyyc.", "cyyyoc.", ".cooc.."],
  // A hammer.
  tool: [".tSSSs..", "tSSSSs..", ".Ss.Nn..", "....nNn.", ".....nNn", "......nb"],
  gear: ["..y.y..", ".yYyyy.", "yyo.oyy", ".y...y.", "yyo.oyy", ".yyyoo.", "..o.o.."],
  // A square of timber, braced corner to corner.
  frame: ["NNNNNNN", "Nn...nn", "N.n.n.n", "N..n..n", "N.n.n.n", "Nn...nn", "Nnnnnnb"],
  hamper: ["..NNNN..", ".N....N.", "cwcwcwcw", "NnNnNnNn", "nNnNnNnb", ".nNnNnb."],
  // A whorled shell under a sea-green glaze.
  shell: ["..UUU..", ".UwUuU.", "UUuuUuu", "UuUUuum", "Uuuuumm", ".ummmm."],
  lantern: ["..x..", ".xxx.", "xYwYx", "xYwYx", "xYYYx", ".xxx."],
  // A boiler block with a brass flywheel.
  engine: [".h..yyy.", ".h.yoooy", "SSSyo.oy", "StSyoooy", "SSSSyyy.", "hshshsh."],
  pole: [".y.....", ".Npppp.", ".Npvppp", ".Npppp.", ".N.p...", ".N.....", ".N.....", "sNs...."],
  // A pack with its flap buckled down.
  kit: ["..bbbb..", ".GGGGGG.", "GlGGGGGg", "GGGyyGGg", "GGGGGGgg", ".gggggg."],
  beacon: ["Y..w..Y", ".YwwwY.", "..YwY..", "..xYx..", "...N...", "...N...", "..sNs.."],
  // A crab in brass, with the key to wind it.
  crab: ["....S....", "yy.SSS.yy", "y.w.S.w.y", ".yyyyyyy.", "yyyoyoyyy", ".oyyyyyo.", "o.o...o.o"],
  // A folio: a bound book lying shut, its pages showing along two edges and a ribbon out of them.
  // The Timber folio is bound in bark with a leaf on its cover, the Brass folio in brass with a boss.
  timber: ["bNNNNN.", "bNNlNNc", "bNlGlNc", "bNNlNNc", "bNNNNNc", "bCCCCrc", ".....r."],
  brass: ["oyyyyy.", "oyyYyyc", "oyYwYyc", "oyyYyyc", "oyyyyyc", "bCCCCrc", ".....r."],
  // A length of iron pipe with a brass collar at each end.
  pipe: [".y....y.", "tYtttYts", "SySSSySs", "soshsosh", ".o....o."],
  // A clay rocket on its stick, a spark off its tip.
  firework: ["Y...w", "..q..", ".qrR.", ".wwR.", ".rRQ.", ".RRQ.", "..N..", "..N.."],
  // A brass spyglass drawn out, its lens to the right.
  spyglass: ["......YYU", "...YYYyyU", "YYYyyyyyU", "oooyyyooU", "...oooooU"],
  // A round clock in a brass rim, its hands at three.
  clock: ["..yyy..", ".ycxcy.", "ycwxwcy", "ycwxxxy", "ycwwwCy", ".yCcCo.", "..ooo.."],
  // A brass ring round the sun on a stand, a world on the ring and one beyond it.
  orrery: [
    "..l......",
    "...oyyyo.",
    ".oy..u..y",
    "y..YwY..y",
    "y..YYY..y",
    ".yo...oy.",
    "..oyyyo..",
    "....o....",
    "..ooooo..",
  ],
  // Tier 5. Salvage: a bent iron rail, a loop of copper and a shard of glass, out of the old workings.
  salvage: ["J.....j", "jJ...jJ", ".jJ.jJ.", "..jJJ..", ".iJr.w.", "iJ...J.", "J.....i"],
  // A twist of copper scrap, green at one end.
  copper: ["gg.....", "gRr....", ".rRq...", "..RrRq.", "...rRRq", "....QRQ"],
  // Dull dark clinker with two dim embers in it.
  slag: ["..ijj..", ".iIjiI.", "jIQIijj", "iIjIQIi", ".IIiII.", "..III.."],
  // A low heap of grey chips.
  gravel: ["...t...", "..tSs..", ".tSsSh.", "tSsShsh", "SshSshh"],
  // A coil of copper wire seen from the side, one end loose.
  wire: [".rrrr..", "rR..Rr.", "R.rr.R.", "rR..Rr.", ".RQQR..", "....QQq"],
  // Copper windings on an iron core: a spool.
  coil: ["j.....j", "JrRrRrJ", "jRrRrRj", "JrRrRrJ", "jRrRrRj", "i.....i"],
  // A glass bulb with a cream filament and a brass cap.
  bulb: ["..CCC..", ".CcwcC.", "CcwYwcC", ".CcwcC.", "..CcC..", "..yoy..", "..ooo.."],
  // The Spark folio, bound in copper, a cream zigzag on its cover.
  spark: ["QRRRRR.", "QRwRRRc", "QRRwRRc", "QRwRRRc", "QRRwRRc", "bCCCCrc", ".....r."],
  // A telegraph key on its board: a brass arm, a dark knob, two copper posts.
  telegraph: ["....x..", "..yyyx.", ".r.o..r", ".r....r", "NNNNNNN", "nnnnnnb"],
  // Three small bulbs on a sagging dark line.
  lights: ["I.....I", ".I...I.", ".cIIIc.", ".w.c.w.", "...w..."],
  // A near-black puddle with one pale glint.
  tar: ["..TTT..", ".TTjTT.", "TTjwTTT", "TTTTTjT", ".TTTTT."],
  // A black lump with a hard pale edge on top.
  pitch: ["..ttt..", ".tKKKt.", "tKKIKKj", "KKIKKKK", "KKKKKIK", ".KKKKK."],
  // A small drum, dark brown, one lighter band.
  creosote: [".EEEEE.", "EffffFx", "fffffFx", "EEEEEEx", "fffffFx", "fffffFx", ".xxxxx."],
  // A square can with a spout, pale straw.
  spirit: [".....t.", "....t..", ".LLLL..", ".cLLLC.", ".cLLLC.", ".LLLLC.", ".CCCCC."],
  // A black slab with a pale edge line.
  tarmac: ["ttttttt", "IIiIIiI", "KKKKKKK", "KKKKKKK"],
  // A squared beam, dark brown, a darker end grain.
  sleeper: ["EEEEEE.", "FFFFFFb", "FFFFFFx", "ffffffb"],
  // A small pot with a brush handle standing in it, amber.
  varnish: ["....n..", "...n...", "..xn...", ".oooooo", ".MoMMMB", ".MMMMMB", "..BBBB."],
  // Three pale lilac shards in dark rock, one with a cream glint.
  crystal: ["...w...", "..PO..P", "P.PO.PO", "PO.HOPO", "OHiHiOH", "iIIIIIi"],
  // A sack with a pale green-grey spill at its mouth.
  feed: [".tgt...", "..n....", ".CccC..", "CcccCC.", "CcccCCt", ".CCCC.t"],
  // A square plate crossed by fine teal lines, on dark.
  lattice: ["WWWWWWW", "WKKWKKW", "WKKWKKW", "WWWWWWW", "WKKWKKW", "WWWWWWW"],
  // The Star folio, bound in dark lilac, one cream star on its cover.
  star: ["XHHHHH.", "XHHwHHc", "XHwwwHc", "XHHwHHc", "XHwHwHc", "bCCCCOc", ".....O."],
  // A shallow pale dish on a short mast, tilted up to the left.
  dish: ["t......", "ct.....", "cct....", ".cctt..", "..ccSt.", "....i..", "...iIi."],
};

/** Each thing's picture with its dark edge, for a belt or a card. */
export type ItemArt = (item: Item) => HTMLCanvasElement;

export function makeItems(): ItemArt {
  const pics = ALL_ITEMS.map((n) => outlined(bitmap(ROWS[itemName(n)], PAL), INK));
  const none = makeCanvas(1, 1).c;
  return (item) => pics[item] ?? none;
}

/** Each thing's picture without its dark edge, for setting on a board that gives it one. */
export function makePlain(): ItemArt {
  const pics = ALL_ITEMS.map((n) => bitmap(ROWS[itemName(n)], PAL));
  const none = makeCanvas(1, 1).c;
  return (item) => pics[item] ?? none;
}

/** A fresh copy of a picture, for putting on the page. */
export function copyOf(src: HTMLCanvasElement): HTMLCanvasElement {
  const { c, g } = makeCanvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  return c;
}
