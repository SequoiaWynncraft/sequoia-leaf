/**
 * The card of a number a goal raises, or of an unlock that is one thing or none (a perk): the picture
 * of what it changes, looked up in a table with an entry for each (`PERK_ART`), so that a new one
 * without a picture does not build, and the rules' sentence for it.
 */
import {
  CRATE,
  kind as kindOf,
  type Numbered,
  PYLON,
  SPLITTER,
  STOP,
  TUNNEL,
  type Unlock,
} from "@sequoia-leaf/factory";
import type { Description } from "@sequoia-leaf/kit/card.ts";

import type { Art } from "../art/index.ts";
import { FLAG_AT } from "../art/machines.ts";
import { stump } from "../art/nature.ts";
import { yardIcon } from "./parts.ts";

/** The unlocks shown as a perk that are not a number: blueprints, and each that is one thing or none. */
const FLAGS = ["blueprints", "board", "first", "ins", "felling", "mouths"] as const;
type Flag = (typeof FLAGS)[number];
const isFlag = (is: string): is is Flag => FLAGS.some((f) => f === is);

/** The picture of what each kind of number changes. */
export const PERK_ART: Readonly<Record<Numbered | Flag, (art: Art) => HTMLCanvasElement>> = {
  stops: (art) => art.icon(STOP),
  crate: (art) => art.m.crate[1]?.[0]?.c ?? art.icon(CRATE),
  reach: (art) => art.m.pylon[1]?.[2]?.c ?? art.icon(PYLON),
  depot: (art) => art.m.fly[0] ?? art.icon(kindOf("depot")),
  span: (art) => art.icon(TUNNEL),
  away: () => yardIcon("moon"),
  hooks: () => yardIcon("orders"),
  range: () => yardIcon("map"),
  blueprints: () => yardIcon("print"),
  board: () => yardIcon("orders"),
  first: (art) => {
    const c = art.icon(SPLITTER);
    const flag = art.m.pennant[0];
    const [x, y] = FLAG_AT[0];
    if (flag) c.getContext("2d")?.drawImage(flag.c, x - flag.ax, y - flag.ay);
    return c;
  },
  ins: (art) => art.waysIn,
  felling: () => stump(5, false),
  mouths: (art) => art.icon(TUNNEL),
};

/** A number a goal raises, as it will be: the picture of what it changes, and the rules' sentence for it, which says what it was before. */
export function perkCard(art: Art, u: Unlock): Description | null {
  const of = u.is === "number" ? u.of : isFlag(u.is) ? u.is : null;
  if (of === null) return null;
  const shown = "amount" in u && u.amount !== undefined ? `${u.name} ${u.amount}` : u.name;
  return { name: shown, icon: PERK_ART[of](art), tag: u.says };
}
