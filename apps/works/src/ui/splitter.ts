/**
 * A splitter's own part of its card: its three ways out round its picture, as they lie in the yard,
 * each a button that moves it on a step (`ways.ts`).
 */
import { type Dir, LEFT, RIGHT } from "@sequoia-leaf/factory";
import { el } from "@sequoia-leaf/kit/dom.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { beltTile, woodOf } from "../art/belts.ts";
import type { Art } from "../art/index.ts";
import { FLAG_AT } from "../art/machines.ts";
import { pic } from "./parts.ts";

/** A splitter's ways out (ahead, left, right) as its card shows them: its picture, and each way shut, turned in, led somewhere, and the way put first. */
export interface WaysPrint {
  readonly arms: number;
  readonly dir: Dir;
  readonly tint: number;
  readonly shut: readonly boolean[];
  readonly ins: readonly boolean[];
  readonly led: readonly boolean[];
  /** The way put first (0 ahead, 1 left, 2 right), or -1. */
  readonly first: number;
}

/** Where on a card each side of a splitter is, round its picture: east, south, west, north. */
const SIDES = ["2 / 3", "3 / 2", "2 / 1", "1 / 2"] as const;

/** What a way's button says, and its colour: shut, turned in, put first, open with something to take from it, or with nothing. */
function wayLook(ways: WaysPrint, k: number): { readonly state: string; readonly look: string } {
  if (ways.shut[k] === true) return { state: "Shut", look: "coral" };
  if (ways.ins[k] === true) return { state: "In", look: "wood" };
  if (ways.first === k) return { state: "First", look: "" };
  return ways.led[k] === true ? { state: "Open", look: "green" } : { state: "No belt", look: "slate" };
}

/**
 * A splitter's three ways out round its picture, at its grade: each says whether it is open, shut,
 * open with nothing to take from it, first, or taking things in, and a press (`press`, with the way)
 * moves it on: open, first, shut, in, open, each once the yard may have it. The way put first wears
 * its flag in the picture. A visitor (`press` null) is shown the same, with nothing to press.
 */
export function splitterWays(
  art: Art,
  grade: number,
  ways: WaysPrint,
  press: ((way: number) => void) | null,
): HTMLElement {
  const box = el("div", "ways");
  const d = ways.dir;
  // A copy: the tile is the belts' own in its grade's wood, kept for every splitter that looks the
  // same, and the arrowheads, the grade's mark over them and the flag drawn on it here are this
  // splitter's alone.
  const shared = beltTile(ways.arms, d, 5, woodOf(grade), ways.tint);
  const { c: tile, g } = makeCanvas(shared.width, shared.height);
  g.drawImage(shared, 0, 0);
  [d, LEFT[d], RIGHT[d]].forEach((side, k) => {
    const head = art.m.heads[k]?.[d];
    if (head && ((ways.arms >> (side * 2)) & 3) === 2) g.drawImage(head, 0, 0);
  });
  const pip = art.m.pips[grade - 2];
  if (pip) g.drawImage(pip, 0, 0);
  [d, LEFT[d], RIGHT[d]].forEach((side, k) => {
    const flag = art.m.pennant[side];
    const at = FLAG_AT[side];
    if (ways.first === k && flag && at) g.drawImage(flag.c, at[0] - flag.ax, at[1] - flag.ay);
    const { state, look } = wayLook(ways, k);
    // Seen, a button's place says which way it is; read out, its name has to.
    const named = { "aria-label": `${["Ahead", "Left", "Right"][k]}: ${state}` };
    const way = el(
      press ? "button" : "span",
      `k-btn ${look}`,
      press ? { ...named, type: "button", onclick: () => press(k) } : named,
      state,
    );
    way.style.gridArea = SIDES[side] ?? "";
    box.append(way);
  });
  box.append(pic(tile, 3));
  return box;
}
