/**
 * "Who is about", on the page: a small wooden button beside the purse with how many are in the game
 * now, and the panel it opens, with who is in town, who is elsewhere in the game and who was seen
 * lately, each with their face, name, and rank or "Guest" (`about.ts` says who goes where, and the
 * words). It keeps itself up to date while it is open: the room's roster as it changes, the guild's
 * lists as they come, every half minute; its order holds meanwhile, with whoever has gone dimmed
 * where they were and whoever is new at the end of their part (`held`). Choosing somebody shows their card (`person`), with "Find
 * in town" for somebody drawn here, which puts the panel away and shows where they are (`locate`);
 * and for anybody else, "Visit yard" if they have a yard, which goes through the Works' door to it,
 * and "Visit camp" if they have a camp. The button is there only while the town is on the stage.
 */

import { WORKS_STATS } from "@sequoia-leaf/factory/stats.ts";
import { close, link } from "@sequoia-leaf/kit/card.ts";
import { el, icon as glyph } from "@sequoia-leaf/kit/dom.ts";
import { member } from "@sequoia-leaf/kit/live.ts";
import { known, people } from "@sequoia-leaf/kit/person.ts";
import { faceFor } from "@sequoia-leaf/kit/skin.ts";
import { tip } from "@sequoia-leaf/kit/tip.ts";
import { RAID_STATS } from "@sequoia-leaf/raid/stats.ts";
import { TOWN_STATS } from "@sequoia-leaf/town/stats.ts";

import { type About, type AboutRow, ALONE, held, partsOf, whoIsAbout } from "./about.ts";
import { type Actor, G, hooks } from "./game.ts";
import { guild } from "./guild.ts";
import { $, closePanel, openPanel, pic, when } from "./hud.ts";
import { leafNow } from "./players.ts";
import { drawnAs, visitorOf } from "./visitors.ts";

/** The panel's name, as `G.panel` has it while it is open. */
export const ABOUT = "about";

/** The member's own id: their account's on the guild's server; with the made-up guild, a word of its own. */
const myId = (): string => member()?.id ?? "you";

/** Who is about now, as the panel shows it: from where everybody is (`guild.whereabouts`), by Leaf's clock. */
export function aboutNow(): About {
  const me = guild.me();
  return whoIsAbout({
    me: { id: myId(), name: me.name, rank: me.rank === "" ? null : me.rank },
    all: guild.whereabouts(),
    now: leafNow(),
  });
}

// ---------- faces ----------

const pictures = new WeakMap<HTMLCanvasElement, number>();
let picturesSeen = 0;
/** A number for a face's picture, so that a row can say which one it shows. */
const pictureNo = (c: HTMLCanvasElement): number => {
  let n = pictures.get(c);
  if (n === undefined) pictures.set(c, (n = ++picturesSeen));
  return n;
};

/** Whoever a row is drawn as in town, if anybody: the member, somebody live or visiting, or dozing. */
const figureOf = (r: AboutRow): Actor | null => (r.you ? G.player : drawnAs(r.id));

/** Somebody's face: as they are drawn in town, or else from their skin, fetched once. */
const faceOf = (r: AboutRow): HTMLCanvasElement => figureOf(r)?.body?.face ?? faceFor(r.id, r.name, !r.you);

// ---------- the panel ----------

/** Says what a row shows: who, the line under their name, which picture of their face, and whether they have gone. */
const rowKey = (r: AboutRow): string => `${r.id}/${r.name}/${r.line}/${pictureNo(faceOf(r))}/${r.gone ? "gone" : ""}`;

/** Says what the panel shows, so that it is drawn again only when that changes. */
const keyOf = (a: About): string =>
  partsOf(a)
    .map((p) => `${p.title}|${p.rows.map(rowKey).join("|")}`)
    .join("|");

/** One line of the panel, standing for whoever it is: choosing it shows their card. */
function rowOf(r: AboutRow): HTMLElement {
  const face = faceOf(r);
  const b = el(
    "button",
    r.gone ? "k-thing about-row gone" : "k-thing about-row",
    { type: "button" },
    el("span", "k-thing-pic", {}, pic(face, 2)),
    el(
      "span",
      "about-who",
      {},
      el("b", "k-thing-name", { text: r.name }),
      r.line === "" ? null : el("span", "k-dim", { text: r.line }),
    ),
    r.you ? el("span", "k-info-tagged", { text: "You" }) : null,
  );
  known({ id: r.id, name: r.name, line: r.line, face });
  // The card goes beside the list, not over it.
  link(b, `person:${r.id}`, { side: true });
  return b;
}

/** The rows on the page, by what each shows. */
let rows = new Map<string, HTMLElement>();

/** Draws the list. A row that shows what it showed stays as it is, so that a card beside it stays too. */
function fill(list: HTMLElement, a: About): void {
  const was = rows;
  rows = new Map();
  if (a.alone) {
    list.replaceChildren(el("div", "k-dim", { text: ALONE }));
    return;
  }
  const row = (r: AboutRow): HTMLElement => {
    const b = was.get(rowKey(r)) ?? rowOf(r);
    rows.set(rowKey(r), b);
    return b;
  };
  list.replaceChildren(
    ...partsOf(a).flatMap((p) => [
      el("div", "k-label", { text: p.title }),
      el("div", "about-part", {}, ...p.rows.map(row)),
    ]),
  );
}

/** Puts the card and the panel away, and then does `then`. */
const away = (then: () => void) => (): void => {
  close();
  closePanel();
  then();
};

/** The card's buttons: "Find in town" for somebody in town and drawn here; "Visit yard" and "Visit camp" for anybody else with one. */
function initPeople(locate: (a: Actor) => void): void {
  people({
    stats: { works: WORKS_STATS, raid: RAID_STATS, town: TOWN_STATS },
    actions: (p) => {
      const you = p.id === myId();
      const inTown = aboutNow().rows.get(p.id)?.part === "In town";
      const a = inTown ? (you ? G.player : visitorOf({ id: p.id, name: p.name, you })) : null;
      return [
        ...(a ? [{ label: "Find in town", on: away(() => locate(a)) }] : []),
        ...(p.games?.works?.placed && !you ? [{ label: "Visit yard", on: away(() => hooks.goIn("works", p.id)) }] : []),
        ...(p.games?.town?.placed && !you
          ? [{ label: "Visit camp", on: away(() => hooks.visitCamp(p.id, p.name)) }]
          : []),
      ];
    },
  });
}

/** Opens "Who is about". */
export function openAbout(): void {
  openPanel({
    id: ABOUT,
    title: "Who is about",
    art: glyph("visit"),
    build(body) {
      const list = el("div", "about");
      body.append(list);
      // Sorted when it is opened; while it stays open its order holds (`held`).
      let shown = aboutNow();
      return when(
        () => {
          shown = held(shown, aboutNow());
          return keyOf(shown);
        },
        () => {
          fill(list, shown);
        },
      );
    },
  });
}

// ---------- the button ----------

let button: HTMLButtonElement | null = null;
let count: HTMLElement | null = null;
/** Seconds until the number is counted again. */
let recount = 0;

/** Puts the button beside the purse. `locate` shows where somebody found in town is. */
export function initAbout(locate: (a: Actor) => void): void {
  initPeople(locate);
  count = el("span", "", { text: "1" });
  button = el(
    "button",
    "k-btn wood about-btn",
    { type: "button", id: "about", "aria-label": "Who is about" },
    glyph("visit"),
    count,
  );
  button.addEventListener("click", () => {
    if (G.panel === ABOUT) closePanel();
    else openAbout();
  });
  tip(button, "Who is about");
  $("purse").after(button);
  stepAbout(1);
}

/** Keeps the button's number up to date, a few times a second, and the button there only while the town is on the stage. */
export function stepAbout(dt: number): void {
  if (!button || !count) return;
  const inTown = G.where === "town";
  if (button.hidden === inTown) button.hidden = !inTown;
  if (!inTown) {
    if (G.panel === ABOUT) closePanel();
    return;
  }
  recount -= dt;
  if (recount > 0) return;
  recount = 0.3;
  const n = String(aboutNow().count);
  if (count.textContent !== n) {
    count.textContent = n;
    button.setAttribute("aria-label", `Who is about: ${n} in the game`);
  }
}
