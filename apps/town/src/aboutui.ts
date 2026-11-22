/**
 * "Who is about", on the page: a small wooden button beside the purse with how many are in the game
 * now, and the panel it opens, with who is in town, who is elsewhere in the game and who was seen
 * lately, each with their face, name, and rank or "Guest" (`about.ts` says who goes where, and the
 * words). It keeps itself up to date while it is open: the room's roster as it changes, the guild's
 * lists as they come, every half minute. Choosing somebody in town puts the panel away and shows
 * where they are (`locate`). The button is there only while the town is on the stage.
 */

import { el, icon as glyph } from "@sequoia-leaf/kit/dom.ts";
import { member, where } from "@sequoia-leaf/kit/live.ts";
import { bake, type Body, paintSkin } from "@sequoia-leaf/kit/skin.ts";
import { tip } from "@sequoia-leaf/kit/tip.ts";

import { type About, type AboutRow, ALONE, whoIsAbout } from "./about.ts";
import { type Actor, G } from "./game.ts";
import { guild } from "./guild.ts";
import { $, closePanel, openPanel, pic, when } from "./hud.ts";
import { skinOf } from "./live.ts";
import { knownRanks, roomNow } from "./players.ts";
import { drawnAs, lookFor, visitorOf } from "./visitors.ts";

/** The panel's name, as `G.panel` has it while it is open. */
export const ABOUT = "about";

/** The member's own id: their account's on the guild's server; with the made-up guild, a word of its own. */
const myId = (): string => member()?.id ?? "you";

/** Who is about now, as the panel shows it. */
export function aboutNow(): About {
  const me = guild.me();
  const { present, resting } = guild.about();
  return whoIsAbout({
    me: { id: myId(), name: me.name, rank: me.rank === "" ? null : me.rank },
    room: roomNow(),
    present,
    resting,
    ranks: knownRanks,
    now: Date.now(),
  });
}

// ---------- faces ----------

/** Faces of those not drawn in town, by id: a look of their own at first, their own skin once it has come. */
const faces = new Map<string, { face: HTMLCanvasElement }>();
/** Goes up whenever a face arrives, so that the panel draws it. */
let facesCame = 0;
const bodies = new WeakMap<Body, number>();
let bodiesSeen = 0;
const bodyNo = (b: Body | null | undefined): number => {
  if (!b) return 0;
  let n = bodies.get(b);
  if (n === undefined) bodies.set(b, (n = ++bodiesSeen));
  return n;
};

/** Whoever a row is drawn as in town, if anybody: the member, somebody live or visiting, or dozing. */
const figureOf = (r: AboutRow): Actor | null => (r.you ? G.player : drawnAs(r.id));

/** Somebody's face: as they are drawn in town, or else from their skin, fetched once. */
function faceOf(r: AboutRow): HTMLCanvasElement {
  const body = figureOf(r)?.body;
  if (body) return body.face;
  const had = faces.get(r.id);
  if (had) return had.face;
  const got = { face: bake(paintSkin(lookFor(r.name))).face };
  faces.set(r.id, got);
  if (where().mode === "live" && !r.you) {
    const img = new Image();
    img.addEventListener("load", () => {
      try {
        got.face = bake(img).face;
        facesCame++;
      } catch {
        // A picture that cannot be read: the look of their own stays.
      }
    });
    img.src = skinOf(r.id);
  }
  return got.face;
}

// ---------- the panel ----------

/** Says what the panel shows, so that it is drawn again only when that changes. */
const keyOf = (a: About): string =>
  [
    facesCame,
    ...a.parts.flatMap((p) => [
      p.title,
      ...p.rows.map((r) => `${r.id}/${r.line}/${bodyNo(figureOf(r)?.body)}/${visitorOf(person(r)) ? 1 : 0}`),
    ]),
  ].join("|");

const person = (r: AboutRow): { id: string; name: string; you: boolean } => ({ id: r.id, name: r.name, you: r.you });

/** One line of the panel. In town, a button: choosing them shows where they are, if they are drawn here. */
function rowOf(r: AboutRow, inTown: boolean, locate: (a: Actor) => void): HTMLElement {
  const kids = [
    el("span", "k-thing-pic", {}, pic(faceOf(r), 2)),
    el(
      "span",
      "about-who",
      {},
      el("span", "k-thing-name", { text: r.name }),
      r.line === "" ? null : el("span", "k-d", { text: r.line }),
    ),
    r.you ? el("span", "k-info-tagged", { text: "you" }) : null,
  ];
  const a = inTown ? (r.you ? G.player : visitorOf(person(r))) : null;
  if (!a) return el("div", "k-thing about-row", {}, ...kids);
  const b = el("button", "k-thing about-row", { type: "button", "aria-label": `Show where ${r.name} is` }, ...kids);
  b.addEventListener("click", () => {
    closePanel();
    locate(a);
  });
  return b;
}

function fill(list: HTMLElement, a: About, locate: (a: Actor) => void): void {
  if (a.alone) {
    list.replaceChildren(el("p", "k-d", { text: ALONE }));
    return;
  }
  list.replaceChildren(
    ...a.parts.flatMap((p) => [
      el("div", "k-label", { text: p.title }),
      el("div", "about-part", {}, ...p.rows.map((r) => rowOf(r, p.title === "In town", locate))),
    ]),
  );
}

/** Opens "Who is about". */
export function openAbout(locate: (a: Actor) => void): void {
  openPanel({
    id: ABOUT,
    title: "Who is about",
    art: glyph("visit"),
    build(body) {
      const list = el("div", "about");
      body.append(list);
      let now = aboutNow();
      return when(
        () => {
          now = aboutNow();
          return keyOf(now);
        },
        () => {
          fill(list, now, locate);
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

/** Puts the button beside the purse. `locate` shows where somebody chosen in town is. */
export function initAbout(locate: (a: Actor) => void): void {
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
    else openAbout(locate);
  });
  tip(button, "Who is about", "Who is in town, who is elsewhere in the game, and who was here lately.");
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
