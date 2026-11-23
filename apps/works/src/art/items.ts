/**
 * Every thing the yard gathers and makes, as a tiny picture: small enough to ride a belt, plain
 * enough to know at a glance. Looked up by name once, into a list by the thing's number.
 */

import { ALL_ITEMS, type Item, type ItemName, itemName } from "@sequoia-leaf/factory";
import { INK } from "@sequoia-leaf/kit/palette.ts";
import { bitmap, outlined } from "@sequoia-leaf/kit/pix.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { PAL } from "./pal.ts";

/** A plain square of paper, for the things of later tiers that have no picture of their own yet: the folios. */
const PLAIN = ["aaaaa", "aAAAa", "aAAAa", "aAAAa", "aaaaa"];

const ROWS: Partial<Record<ItemName, readonly string[]>> = {
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
};

/** Each thing's picture with its dark edge, for a belt or a card. */
export type ItemArt = (item: Item) => HTMLCanvasElement;

export function makeItems(): ItemArt {
  const plain = outlined(bitmap(PLAIN, PAL), INK);
  const pics = ALL_ITEMS.map((n) => {
    const rows = ROWS[itemName(n)];
    return rows ? outlined(bitmap(rows, PAL), INK) : plain;
  });
  return (item) => pics[item] ?? plain;
}

/** A fresh copy of a picture, for putting on the page. */
export function copyOf(src: HTMLCanvasElement): HTMLCanvasElement {
  const { c, g } = makeCanvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  return c;
}
