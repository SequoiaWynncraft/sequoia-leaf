/**
 * What the town's things say about themselves, in the kit's one card (`card.ts`):
 *
 * - `thing:<id>` a thing for a camp (in the market, the tray, set out in the camp, a present, a
 *   trophy): its picture, name and kind, what it does when touched, how many the member has, and
 *   where it comes from (a stall and its price, the Treasury, a present, or what earns it);
 * - `ware:<id>` something Cinfy sells at the Treasury to wear or to share;
 * - `stall:<id>` a market stall: who keeps it and what it sells.
 *
 * People keep the card they have (`hud.ts`).
 */
import { type Description, type Entry, link, register, type Stat } from "@sequoia-leaf/kit/card.ts";
import { amount, el, icon } from "@sequoia-leaf/kit/dom.ts";

import { owned } from "./camp.ts";
import { type CampArt, pictureOf } from "./campart.ts";
import { folkNamed } from "./folk.ts";
import { folkArt } from "./folkart.ts";
import { G } from "./game.ts";
import { guild } from "./guild.ts";
import { camp } from "./record.ts";
import type { Sprites } from "./sprites.ts";
import { KIND_NAMES, thingOf } from "./things.ts";

export const thingRef = (id: string): string => `thing:${id}`;
export const wareRef = (id: string): string => `ware:${id}`;
export const stallRef = (id: string): string => `stall:${id}`;

/** What is said of a trophy not yet won, before what wins it. */
export const TO_WIN = "Not won yet.";

/** A thing's picture for its card: a trophy's small carving, anything else as it stands. */
function pictureFor(art: CampArt, id: string): HTMLCanvasElement | null {
  return art.small[id] ?? pictureOf(art, id, 0, 0)?.c ?? null;
}

/** Where a camp thing comes from: the stalls that sell it, the Treasury, or how it is had. */
function whereFrom(id: string): { rows: Entry[]; words: string } {
  const thing = thingOf(id);
  const stalls = guild.stalls().flatMap((s) => {
    const stock = s.stock.find((k) => k.thing === id);
    return stock ? [{ ref: stallRef(s.id), note: `${stock.price.toLocaleString("en-US")} Coins` }] : [];
  });
  const piece = guild.pieces().find((k) => k.thing === id);
  if (stalls.length > 0 || piece)
    return {
      rows: stalls,
      words: piece ? `Cinfy sells it at the Treasury, for ${piece.price.toLocaleString("en-US")} Leaf.` : "",
    };
  if (thing?.kind === "trophies") return { rows: [], words: "Won, never bought." };
  if (guild.presents().includes(id))
    return { rows: [], words: "A present: the town's own leave them when they drop by." };
  if (thing?.kind === "home") return { rows: [], words: "Every camp has one." };
  return { rows: [], words: "" };
}

function thingDesc(art: CampArt, id: string): Description | null {
  const thing = thingOf(id);
  if (!thing) return null;
  const have = owned(camp, id);
  const won = thing.kind !== "trophies" || camp.earned.includes(id);
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
      { body: won ? thing.about : `${TO_WIN} ${thing.about}` },
      ...(thing.does ? [{ title: "Touched", body: thing.does }] : []),
      ...(from.words ? [{ title: "From", body: from.words }] : []),
    ],
    rows: [{ label: "Sold at", things: from.rows }],
  };
}

function wareDesc(sprites: Sprites, id: string): Description | null {
  const w = guild.wares().find((x) => x.id === id);
  if (!w) return null;
  const pic = id === "crown" ? sprites.crown : id === "jar" ? sprites.jar : id === "cocoa" ? sprites.mug : null;
  const yours = w.once && G.owned.has(id);
  return {
    name: w.name,
    icon: pic,
    tag: w.worn ? "Something to wear" : "For everybody at the fire",
    aside: amount("leaf", w.price),
    stats: [{ label: "You have", value: w.once ? (yours ? "it" : "none") : "as many as you like" }],
    blocks: [{ body: w.about }],
  };
}

function stallDesc(id: string): Description | null {
  const s = guild.stalls().find((x) => x.id === id);
  if (!s) return null;
  const keeper = folkNamed(s.by);
  return {
    name: s.name,
    icon: keeper ? folkArt(keeper).face : icon("home"),
    tag: `Kept by ${s.by}, in the market.`,
    rows: [
      {
        label: "Sells",
        things: s.stock.map((k) => ({ ref: thingRef(k.thing), note: k.price.toLocaleString("en-US") })),
      },
    ],
  };
}

/** Says what the town's things are. */
export function registerCards(sprites: Sprites, art: CampArt): void {
  register("thing", (id) => thingDesc(art, id));
  register("ware", (id) => wareDesc(sprites, id));
  register("stall", (id) => stallDesc(id));
}

/** A thing's name in a row, as a link to its card. */
export function named(text: string, ref: string, cls = ""): HTMLElement {
  const name = el("span", `k-pix${cls ? ` ${cls}` : ""}`, { text });
  link(name, ref);
  return name;
}
