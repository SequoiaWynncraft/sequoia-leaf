/**
 * What the town's things say about themselves, in the kit's one card (`card.ts`):
 *
 * - `thing:<id>` a thing for a camp (in the market, the tray, set out in the camp, a present, a
 *   trophy): its picture, name and kind, what it does when touched, how many the member has, and
 *   where it comes from (a stall and its price, a present, or what earns it);
 * - `stall:<id>` a market stall: who keeps it and what it sells.
 *
 * People keep the card they have (`hud.ts`).
 */
import { type Description, type Entry, link, register, type Stat } from "@sequoia-leaf/kit/card.ts";
import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import { coinsText, whole } from "@sequoia-leaf/kit/say.ts";
import { owned } from "@sequoia-leaf/town/camp.ts";
import { PRESENTS, STALLS } from "@sequoia-leaf/town/catalogue.ts";
import { folkNamed } from "@sequoia-leaf/town/folk.ts";
import { KIND_NAMES, thingOf } from "@sequoia-leaf/town/things.ts";

import { type CampArt, pictureOf } from "./campart.ts";
import { folkArt } from "./folkart.ts";
import { mine } from "./leaf.ts";

export const thingRef = (id: string): string => `thing:${id}`;
export const stallRef = (id: string): string => `stall:${id}`;

/** What is said of a trophy not yet won, before what wins it. */
export const TO_WIN = "Not won yet.";

/** A thing's picture for its card: a trophy's small carving, anything else as it stands. */
function pictureFor(art: CampArt, id: string): HTMLCanvasElement | null {
  return art.small[id] ?? pictureOf(art, id, 0, 0)?.c ?? null;
}

/** Where a camp thing comes from: the stalls that sell it, or how it is had. */
function whereFrom(id: string): { rows: Entry[]; words: string } {
  const thing = thingOf(id);
  const stalls = STALLS.flatMap((s) => {
    const stock = s.stock.find((k) => k.thing === id);
    return stock ? [{ ref: stallRef(s.id), note: coinsText(stock.price) }] : [];
  });
  if (stalls.length > 0) return { rows: stalls, words: "" };
  if (thing?.kind === "trophies") return { rows: [], words: "Won, never bought." };
  if (thing?.kind === "characters") return { rows: [], words: "Pulls at the Grove." };
  if (PRESENTS.some((p) => p === id))
    return { rows: [], words: "A present. Townsfolk leave them when they drop by your camp." };
  if (thing?.kind === "home") return { rows: [], words: "Every camp has one." };
  return { rows: [], words: "" };
}

function thingDesc(art: CampArt, id: string): Description | null {
  const thing = thingOf(id);
  if (!thing) return null;
  const have = owned(mine(), id);
  const won = thing.kind !== "trophies" || mine().earned.includes(id);
  const from = whereFrom(id);
  const stats: Stat[] = [{ label: "You have", value: have > 0 ? String(have) : "none" }];
  if (thing.seats > 0) stats.push({ label: "Seats", value: String(thing.seats) });
  if (thing.light > 0) stats.push({ label: "Lights", value: "yes" });
  return {
    name: thing.name,
    icon: pictureFor(art, id),
    tag: KIND_NAMES[thing.kind],
    stats,
    blocks: [
      ...(thing.about ? [{ body: won ? thing.about : `${TO_WIN} ${thing.about}` }] : []),
      ...(thing.does ? [{ title: "Touched", body: thing.does }] : []),
      ...(from.words ? [{ title: "From", body: from.words }] : []),
    ],
    rows: [{ label: "Sold at", things: from.rows }],
  };
}

function stallDesc(id: string): Description | null {
  const s = STALLS.find((x) => x.id === id);
  if (!s) return null;
  const keeper = folkNamed(s.by);
  return {
    name: s.name,
    icon: keeper ? folkArt(keeper).face : icon("home"),
    tag: `Kept by ${s.by}, in the market.`,
    rows: [
      {
        label: "Sells",
        things: s.stock.map((k) => ({ ref: thingRef(k.thing), note: whole(k.price) })),
      },
    ],
  };
}

/** Says what the town's things are. */
export function registerCards(art: CampArt): void {
  register("thing", (id) => thingDesc(art, id));
  register("stall", (id) => stallDesc(id));
}

/** A thing's name in a row, as a link to its card. */
export function named(text: string, ref: string, cls = ""): HTMLElement {
  const name = el("span", `k-pix${cls ? ` ${cls}` : ""}`, { text });
  link(name, ref);
  return name;
}
