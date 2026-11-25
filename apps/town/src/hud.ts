/**
 * What sits over whichever place is on the stage, built from the kit: the purse, the corner
 * buttons, the guild feed, the dock along the bottom, the one panel that is open, a card for
 * whoever was tapped, and at somebody else's camp the strip that says whose it is. The town and the camp each say what goes in the dock and in a panel
 * (`ui.ts`, `campui.ts`); everything here is the same for both.
 */

import { $, add, el, icon as glyph, pic, replay, shown, when } from "@sequoia-leaf/kit/dom.ts";
import { folkName } from "@sequoia-leaf/kit/mark.ts";
import type { Currency } from "@sequoia-leaf/kit/purse.ts";
import { type PurseBar, purseBar } from "@sequoia-leaf/kit/pursebar.ts";
import { whole } from "@sequoia-leaf/kit/say.ts";
import { type Scope, scope } from "@sequoia-leaf/kit/scope.ts";
import { faceFor, facesCame } from "@sequoia-leaf/kit/skin.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { tip, tipOff } from "@sequoia-leaf/kit/tip.ts";
import { pick, type Pt } from "@sequoia-leaf/kit/util.ts";
import { DOING, type Doing } from "@sequoia-leaf/town/folk.ts";

import { hop, say } from "./actors.ts";
import { type Actor, after, G, hooks, show, watch } from "./game.ts";
import type { Count, Me, Tone } from "./guild.ts";
import { span } from "./letter.ts";

export { $, pic, when };

export type Kid = Node | string | null;

/**
 * Somebody's face for a card, a chip or a letter, `scale` units to each of a member's face pixels:
 * a member's from their skin, and one of the town's own as its own small picture.
 */
export function faceOf(a: Actor, scale = 1): HTMLCanvasElement | null {
  if (a.folk) return pic(a.folk.art.face, Math.max(1, scale / 2));
  return a.body ? pic(a.body.face, scale) : null;
}

/** Somebody's name for a card or a list: one of the town's own with its mark, a member as they are. */
export function nameOf(a: Actor, classes = ""): HTMLElement {
  return a.folk ? folkName(a.who.name, classes) : el("span", classes, { text: a.who.name });
}

/** A hollow `size` units square, holding one thing. */
export function slot(inside: Node | null, size = 20): HTMLElement {
  const s = el("div", "k-slot");
  s.style.width = `calc(var(--u) * ${size})`;
  s.style.height = s.style.width;
  s.style.flex = "none";
  add(s, inside);
  return s;
}

export function button(cls: string, kids: readonly Kid[], on: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = el("button", `k-btn ${cls}`, { type: "button" }, ...kids);
  b.addEventListener("click", () => {
    on(b);
  });
  return b;
}

/** Numbers under a heading, as the kit's person card has them: the heading on a rule, then a line each, its number at the right. */
export function sheet(title: string, rows: readonly Count[]): HTMLElement {
  return el(
    "div",
    "k-info-stats listed",
    {},
    el("div", "k-info-over", { text: title }),
    ...rows.map(([label, value]) =>
      el("span", "k-info-stat", {}, el("span", "k-label", { text: label }), el("b", "", { text: value })),
    ),
  );
}

/** The member's level, how far through it they are, and its bar. */
export function levelBar(me: Pick<Me, "level" | "xp" | "next">): HTMLElement[] {
  const fill = el("i");
  fill.style.setProperty("--v", `${Math.min(100, (me.xp / me.next) * 100)}%`);
  return [
    el(
      "div",
      "k-row",
      {},
      el("span", "k-grow", { text: `Level ${me.level}` }),
      el("span", "k-dim", { text: `${whole(me.xp)} / ${whole(me.next)} XP` }),
    ),
    el("div", "k-bar", {}, fill),
  ];
}

export const centre = (node: Element): Pt => {
  const r = node.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

// ---------- the purse ----------

/** The purse as every page shows it (`pursebar.ts`), once the interface is built. */
let purse: PurseBar | null = null;

/** Where a currency's icon is in the purse, for things to fly to and from. */
export const purseAt = (kind: Currency): Pt => purse?.at(kind) ?? { x: 30, y: 30 };

// ---------- the guild feed ----------

const waiting: (readonly [string, Tone])[] = [];
let quiet = false;

export function feed(text: string, tone: Tone = "gold"): void {
  if (quiet) {
    waiting.push([text, tone]);
    while (waiting.length > 3) waiting.shift();
    return;
  }
  const f = $("feed");
  const row = el("div", tone === "gold" ? "k-toast" : `k-toast ${tone}`, { text });
  f.append(row);
  while (f.children.length > 3) f.firstElementChild?.remove();
  setTimeout(() => {
    row.classList.add("gone");
  }, 11000);
  setTimeout(() => {
    row.remove();
  }, 12000);
}

/**
 * While the member is inside a game the interface is put away and news is held back; on the way
 * out it comes back, and what was held is said.
 */
export function hush(on: boolean): void {
  quiet = on;
  document.body.classList.toggle("inside", on);
  if (on) {
    tipOff();
    return;
  }
  for (const [text, tone] of waiting.splice(0)) feed(text, tone);
}

// ---------- the dock ----------

/** One button of the dock: somewhere to go, or something to open. */
export interface DockEntry {
  id: string;
  name: string;
  about?: string | undefined;
  art: HTMLCanvasElement;
  press: () => void;
}

const dockButtons = new Map<string, HTMLElement>();

/** Puts these buttons in the dock, in place of whatever was there. */
export function setDock(entries: readonly DockEntry[]): void {
  const dock = $("dock");
  dock.replaceChildren();
  dockButtons.clear();
  dock.style.setProperty("--n", String(Math.max(1, entries.length)));
  for (const e of entries) {
    const b = el("button", "k-slot", { type: "button", "aria-label": e.name }, shown(e.art, 1));
    b.addEventListener("click", e.press);
    tip(b, e.name, e.about);
    dockButtons.set(e.id, b);
    dock.append(b);
  }
  litFor = null;
}

/** Where a button of the dock is on the page, for what flies to it. */
export const dockAt = (id: string): Pt => centre(dockButtons.get(id) ?? $("dock"));

function markDock(): void {
  for (const [id, b] of dockButtons) {
    const lit = G.panel === id || (G.panel === null && G.near === id);
    b.classList.toggle("lit", lit);
    if (lit) b.setAttribute("aria-current", "true");
    else b.removeAttribute("aria-current");
  }
  document.body.classList.toggle("panel-open", G.panel !== null);
}

// ---------- the panel ----------

/** A panel: what it is called, the picture by its name, and what goes in it. */
export interface PanelSpec {
  id: string;
  title: string;
  art: Node | null;
  /**
   * Fills the panel's body, with a scope that closes as the panel is put away, however that happens;
   * gives back how to bring it up to date, if it ever needs it.
   */
  build: (body: HTMLElement, life: Scope) => (() => void) | null;
}

let refresh: (() => void) | null = null;
let onShut: (() => void) | null = null;
/** The control the panel was opened from (a button of the dock or the corner), which has the focus back when it closes. */
let opener: HTMLElement | null = null;

/**
 * Opens a panel in place of the one open. Opened from a control that has the focus, the focus goes
 * into the panel (a door's way in, or else the panel itself, named by its title), so that Tab goes
 * on through what is in it; opened by walking up to a place, the focus stays where it was.
 */
export function openPanel(spec: PanelSpec): void {
  if (G.panel === spec.id) return;
  const p = $("panel");
  // Read before the panel is emptied, which takes the focus off anything in it.
  const from = document.activeElement;
  // From inside the panel (one panel's button opening another), the focus stays in it, and so does the opener.
  const inside = from !== null && p.contains(from);
  const control = from instanceof HTMLElement && from !== document.body && !inside ? from : null;
  closeCard();
  tipOff();
  onShut?.();
  const life = scope();
  onShut = () => life.close();
  G.panel = spec.id;
  p.dataset.panel = spec.id;
  p.hidden = true;
  p.replaceChildren();
  const x = el(
    "button",
    "k-btn wood icon sm",
    { type: "button", "aria-label": "Close", onclick: closePanel },
    glyph("close"),
  );
  p.append(el("header", "k-head", {}, spec.art, el("h2", "k-title", { id: "panel-title", text: spec.title }), x));
  const body = el("div", "k-body k-scroll");
  p.append(body);
  refresh = spec.build(body, life);
  refresh?.();
  p.hidden = false;
  replay(p, "slide");
  sfx.open();
  markDock();
  opener = control ?? (inside ? opener : null);
  const first = body.querySelector<HTMLElement>(".k-btn.wide[data-first]");
  if (first) first.focus({ preventScroll: true });
  else if (control || inside) p.focus({ preventScroll: true });
}

export function closePanel(): void {
  if (!G.panel) return;
  G.panel = null;
  const p = $("panel");
  // The focus was in the panel: it goes back to what opened it.
  const back = p.contains(document.activeElement) || document.activeElement === document.body ? opener : null;
  opener = null;
  p.hidden = true;
  p.replaceChildren();
  if (back?.isConnected) back.focus({ preventScroll: true });
  refresh = null;
  const shut = onShut;
  onShut = null;
  shut?.();
  tipOff();
  sfx.close();
  markDock();
}

/**
 * What the open panel, or else the tray, covers of the page, so the camera can keep the member
 * clear of it: everything below `top` when it lies along the bottom (`under`), else everything
 * right of `left`.
 */
export function covered(): { top: number; left: number; under: boolean } | null {
  const tray = $("tray");
  const box = G.panel ? $("panel").getBoundingClientRect() : tray.hidden ? null : tray.getBoundingClientRect();
  return box && { top: box.top, left: box.left, under: !G.panel || box.width > window.innerWidth * 0.7 };
}

/** Brings the open panel up to date now. */
export function refreshPanel(): void {
  refresh?.();
}

// ---------- somebody's card ----------

let cardUntil = 0;
let doingEl: HTMLElement | null = null;
let doingOf: (() => string) | null = null;

function keep(): void {
  cardUntil = performance.now() + 7000;
}

/** Puts away the card of whoever was tapped. Says whether one was up. */
export function closeCard(): boolean {
  if (!show.card) return false;
  show.card = null;
  $("card").hidden = true;
  return true;
}

/** What one of the town's own is doing, in a line for its card. */
const doingLine = (a: Actor): string => {
  const d: Doing = a.doing === "table" || a.doing === "home" || a.doing === "grove" ? "walk" : a.doing;
  return DOING[d];
};

/**
 * A card for somebody who was tapped. A real member's says who they are: their name and rank, under
 * that what `doing` says of them while it says anything (at one of the games, away for how long),
 * and for one dozing in town how long ago they dozed off; another player live in town has a wave
 * (`waveTo`). One of the town's own says what it is, what it is doing, and has a wave; `doing` says
 * that middle line, if the usual one will not do. Either line is said again while the card is up.
 */
export function showCard(a: Actor, doing: (() => string) | null = null, waveTo: (() => void) | null = null): void {
  const c = $("card");
  c.hidden = true;
  c.replaceChildren();
  const x = el(
    "button",
    "k-btn wood icon sm",
    { type: "button", "aria-label": "Close", onclick: closeCard },
    glyph("close"),
  );
  doingEl = el("div", "k-dim");
  doingOf = doing;
  const f = a.folk;
  if (!f) {
    // A real member: their name and rank, and what they are about, if anything.
    doingEl = doing ? el("div", "k-dim") : null;
    const asleep = a.dozing;
    c.append(
      el(
        "div",
        "k-row top",
        {},
        slot(faceOf(a, 3), 28),
        el(
          "div",
          "k-grow",
          {},
          el("div", "k-title k-member", { text: a.who.name }),
          a.who.rank ? el("div", "k-dim", { text: a.who.rank }) : null,
          doingEl,
          asleep === null
            ? null
            : el("div", "k-dim", { text: `Left ${span(Math.max(0, (Date.now() - asleep) / 60000))} ago.` }),
        ),
        x,
      ),
    );
    if (waveTo)
      c.append(
        el(
          "div",
          "k-row",
          {},
          button("sm", ["Wave"], () => {
            keep();
            waveTo();
          }),
        ),
      );
    show.card = a;
    keep();
    c.hidden = false;
    replay(c, "k-rise");
    return;
  }
  const job = f.t.job;
  const wave = button("sm", ["Wave"], () => {
    keep();
    const p = G.player;
    if (p) {
      say(p, "o/", 1.4);
      hop(p);
    }
    after(0.45, () => {
      hop(a, 2);
      say(a, pick(f.t.waves, Math.random()), 2);
    });
  });
  const other =
    job === "counter"
      ? button("wood sm", ["Treasury"], () => {
          hooks.visit("treasury");
        })
      : typeof job === "object"
        ? button("wood sm", ["Stall"], () => {
            G.stall = job.stall;
            hooks.visit("market");
          })
        : button("wood sm", ["Cheer"], () => {
            keep();
            sfx.cheer();
            if (G.player) hop(G.player, 2);
            after(0.3, () => {
              hop(a, 3);
              say(a, pick(f.t.cheers, Math.random()), 2);
            });
          });
  c.append(
    el(
      "div",
      "k-row top",
      {},
      slot(faceOf(a, 3), 28),
      el("div", "k-grow", {}, folkName(a.who.name, "k-title"), el("div", "k-dim", { text: f.t.what })),
      x,
    ),
    doingEl,
    el("div", "k-row", {}, wave, other),
  );
  show.card = a;
  keep();
  c.hidden = false;
  replay(c, "k-rise");
}

// ---------- the corner ----------

let faceButton: HTMLElement | null = null;
let faceDoes: () => void = () => undefined;
let hammer: HTMLButtonElement | null = null;
let hammerDoes: (() => void) | null = null;

/** The member's face on its button, redrawn once their own skin has loaded. */
export function refreshFace(): void {
  const f = G.player?.body?.face;
  if (faceButton && f) faceButton.replaceChildren(pic(f, 1.5));
}

/** What the member's face in the corner opens, wherever they are. */
export function setFace(does: () => void): void {
  faceDoes = does;
}

/**
 * The hammer in the corner, which turns decorating on and off. It is only there where there is
 * something of the member's own to decorate; `null` puts it away.
 */
export function setHammer(does: (() => void) | null, on = false): void {
  hammerDoes = does;
  if (!hammer) return;
  hammer.hidden = does === null;
  hammer.classList.toggle("wood", !on);
  hammer.setAttribute("aria-pressed", on ? "true" : "false");
}

/** How many new things are in the camp's Storage, hung on the hammer; for none, nothing is. */
export function setHammerNew(n: number): void {
  hammer?.replaceChildren(glyph("hammer"), ...(n > 0 ? [el("span", "k-chip lit", { text: n })] : []));
}

/** Where the hammer is on the page, for what flies into Storage. */
export const hammerAt = (): Pt => centre(hammer ?? $("corner"));

let strip: (() => void) | null = null;

/** A button of the strip: its picture and its name, which on a narrow screen is said by its tip alone. */
export function wayButton(picture: "home" | "back", name: string, does: () => void): HTMLButtonElement {
  const b = button(`wood sm way-${picture}`, [glyph(picture), el("span", "t", { text: name })], does);
  b.setAttribute("aria-label", name);
  tip(b, name);
  return b;
}

/** The buttons a camp gives the strip, and what keeps them as they should show (called as the strip is). */
export interface StripWays {
  readonly els: readonly HTMLElement[];
  readonly follow: () => void;
}

/**
 * Under the top bar at somebody else's camp: their face, whose camp it is, the buttons the camp
 * gives (`ways`), and the way to the member's own; `null` puts it away. Only the face, and what
 * `ways` follows, are drawn again, as they change, so a button keeps the keyboard.
 */
export function setStrip(
  host: { readonly id: string; readonly name: string } | null,
  home: () => void,
  ways: StripWays = { els: [], follow: () => undefined },
): void {
  const at = $("visit");
  at.hidden = host === null;
  const face = el("span", "k-thing-pic");
  if (host)
    at.replaceChildren(
      el(
        "div",
        "k-plaque",
        {},
        face,
        el("b", "k-name", { text: `${host.name}'s camp` }),
        ...ways.els,
        wayButton("home", "My camp", home),
      ),
    );
  const faces =
    host &&
    when(
      () => String(facesCame()),
      () => face.replaceChildren(pic(faceFor(host.id, host.name, true), 2)),
    );
  strip =
    faces &&
    ((): void => {
      faces();
      ways.follow();
    });
  strip?.();
}

/** Builds the town's interface; `gear` (the settings menu's, `settings.ts`) goes in its corner. */
export function initHud(gear: HTMLElement): void {
  purse = purseBar($("purse"), {
    about: {
      leaf: "Earned with the guild in Wynncraft: raids, wars, quests and milestones.",
      coins: "Earned in town: the Works, The Little Raid and Cinfy's chest.",
    },
  });

  const corner = $("corner");
  hammer = el("button", "k-btn wood icon", { type: "button", "aria-label": "Decorate", hidden: true }, glyph("hammer"));
  hammer.addEventListener("click", () => {
    hammerDoes?.();
  });
  tip(hammer, "Decorate");
  faceButton = el("button", "k-btn wood icon", { type: "button", "aria-label": "You" });
  faceButton.addEventListener("click", () => {
    faceDoes();
  });
  tip(faceButton, "You");
  corner.append(hammer, faceButton, gear);
  refreshFace();

  hooks.feed = feed;
  watch(() => {
    refresh?.();
  });
}

// ---------- each moment ----------

let slow = 0;
let litFor: string | null = null;

export function tickHud(dt: number): void {
  purse?.tick(dt);
  const lit = `${G.panel}/${G.near}`;
  if (lit !== litFor) {
    litFor = lit;
    markDock();
  }
  slow -= dt;
  if (slow > 0) return;
  slow = 0.3;
  refresh?.();
  strip?.();
  const of = show.card;
  if (of) {
    if (doingEl) {
      const line = doingOf ? doingOf() : doingLine(of);
      doingEl.textContent = line;
      doingEl.hidden = line === "";
    }
    if (performance.now() > cardUntil || of.away) closeCard();
  }
}
