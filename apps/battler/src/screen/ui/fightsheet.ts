/**
 * The sheet of a fight: the tally of a fight that is over, titled with how it went and how long it
 * took ("Room won · 14 s"). It rises over the table as a fight ends, with what the room paid listed
 * beside it as it is counted out into the purse, and a "Carry on" button. While planning, "Last
 * fight" opens it again for the fight the run kept, until the next fight takes its place.
 *
 * The fight is played again from the setup the run kept to be counted, so the sheet says the same
 * after a reload as it did when the fight ended. As a fight ends, its title is how Leaf decided it
 * came out, and a fight these rules would play otherwise has no tally.
 */
import { register } from "@sequoia-leaf/kit/card.ts";
import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import {
  type Fight,
  type FightEvent,
  type FightSetup,
  type FightSummary,
  openFight,
  stepFight,
  tally,
} from "@sequoia-leaf/raid";

import { acrossName, fightTitle } from "../logic.ts";
import { acrossOf, OWN, ownResult } from "../sides.ts";
import { snd } from "../sounds.ts";
import { S } from "../state.ts";
import { figureDesc } from "./cards.ts";
import { type TallyView, tallyView } from "./tally.ts";

/** A fight played through again from its setup: everyone as they ended, and everything that happened. */
interface Played {
  key: string;
  setup: FightSetup;
  fight: Fight;
  events: FightEvent[];
}

const SH: {
  up: "after" | "again" | null;
  played: Played | null;
  view: TallyView | null;
  box: HTMLElement | null;
  takings: HTMLElement | null;
  carry: (() => void) | null;
  look: (() => void) | null;
} = { up: null, played: null, view: null, box: null, takings: null, carry: null, look: null };

/** A fight played again from its setup: the same one as before if it has not changed. */
function played(setup: FightSetup | null): Played | null {
  if (!setup) return null;
  const key = JSON.stringify(setup);
  if (SH.played?.key === key) return SH.played;
  const fight = openFight(setup);
  const events = [...fight.opening];
  while (!fight.over) events.push(...stepFight(fight));
  SH.played = { key, setup, fight, events };
  return SH.played;
}

/** A figure in the fight the sheet shows, as a card names it. */
export const foughtRef = (id: number): string => `fought:${id}`;

/** Says what each figure in the sheet's fight is: its card as it stood when the fight ended. */
export function registerFought(): void {
  register("fought", (raw) => {
    const p = SH.played;
    const u = p?.fight.units[Number(raw)];
    if (!p || !u) return null;
    const across = acrossOf(p.setup);
    return figureDesc(u.kind, u.stars, {
      unit: u,
      whose: u.side === OWN.side(p.setup) ? "Yours" : `${acrossName(across)}'s`,
      party: p.setup.sides[u.side],
    });
  });
}

/** What "Carry on", and putting the last fight away, do: whoever runs the room says. */
export function onCarry(carry: () => void, look: () => void): void {
  SH.carry = carry;
  SH.look = look;
}

export const sheetUp = (): "after" | "again" | null => SH.up;

/** Keeps the sheet clear of the bar along the top, however tall the window is. */
export function placeSheet(): void {
  const box = SH.box;
  if (!box) return;
  const bottom = document.getElementById("bottom")?.getBoundingClientRect().top ?? window.innerHeight;
  // On an upright phone it may cover the buttons and the track, which have nothing to do then; the purse stays in view.
  const narrow = window.matchMedia("(max-aspect-ratio: 4/5), (max-width: 620px)").matches;
  const hud = document.getElementById(narrow ? "purse" : "hud")?.getBoundingClientRect().bottom ?? 0;
  box.style.setProperty("--room", `${Math.max(160, Math.floor(bottom - hud - 12))}px`);
}

/** A line of what a room paid: what for, and how much. */
export type Taking = readonly [label: string, value: Node | string];

/** The list of what a room paid, every line in its place and hidden until it is counted out. */
const takingsOf = (lines: readonly Taking[] = []): HTMLElement =>
  el(
    "div",
    "takings k-col tight",
    {},
    ...lines.map(([label, value]) => el("div", "k-row pay due", {}, el("span", "k-grow", { text: label }), value)),
  );

/**
 * Opens the sheet: `after` as a fight ends, for that fight as Leaf decided it (`leaf`), with the
 * lines of what the room paid (`takings`) and "Carry on"; `again` for the last fight the run kept,
 * with a button to put it away. Every line is in its place from the start, hidden until it is
 * counted out (`sheetTaking`), so the sheet never grows as they come.
 */
export function openSheet(
  how: "after" | "again",
  leaf?: { setup: FightSetup; outcome: FightSummary; kept: boolean },
  lines?: readonly Taking[],
): void {
  const p = played(leaf?.setup ?? S.run?.last ?? null);
  const bottom = document.getElementById("bottom");
  if (!p || !bottom) return;
  closeSheet(false);
  const result = leaf?.outcome.result ?? ownResult(p.setup, p.fight.result ?? "draw");
  const title = fightTitle(result, leaf?.outcome.ticks ?? p.fight.tick);
  const view = tallyView(foughtRef, "sheet");
  view.across(acrossOf(p.setup));
  if (leaf?.kept !== false) {
    view.show(
      p.fight.units,
      tally(
        p.events,
        p.fight.units.map((u) => u.id),
      ),
      OWN.side(p.setup),
    );
  }
  const close =
    how === "again"
      ? el(
          "button",
          "k-btn wood icon sm",
          { type: "button", "aria-label": "Put it away", onclick: () => SH.look?.() },
          icon("close"),
        )
      : null;
  const takings = takingsOf(lines);
  const carry =
    how === "after"
      ? el("button", "k-btn wide", { type: "button", id: "carry", onclick: () => SH.carry?.() }, "Carry on")
      : null;
  const aside =
    how === "after"
      ? el("div", "fs-aside k-col", {}, el("div", "k-label", { text: "The room paid" }), takings, carry)
      : null;
  const box = el(
    "section",
    `k-panel k-rise ${how}`,
    { id: "fsheet", role: "dialog", "aria-label": title, "data-result": result },
    el("header", "k-head", {}, el("h1", "k-title", { text: title }), close),
    el(
      "div",
      "k-body",
      {},
      el("div", "k-row fs-tabs", {}, view.switcher, view.tabs),
      el("div", "fs-main", {}, view.el, aside),
    ),
  );
  bottom.prepend(box);
  SH.up = how;
  SH.view = view;
  SH.box = box;
  SH.takings = takings;
  placeSheet();
  if (how === "again") snd.open();
  // The keyboard is on "Carry on" at once, so Enter goes on.
  if (carry) carry.focus({ preventScroll: true });
}

/** Shows the `at`th line of what the room paid as it is counted out, in the place kept for it. */
export function sheetTaking(at: number): void {
  const line = SH.takings?.children[at];
  if (SH.up !== "after" || !line) return;
  line.classList.remove("due");
  line.classList.add("k-rise");
}

/** Puts the sheet away. */
export function closeSheet(sound = true): void {
  if (!SH.box) return;
  if (sound && SH.up === "again") snd.close();
  SH.box.remove();
  SH.view?.drop();
  SH.box = null;
  SH.view = null;
  SH.takings = null;
  SH.up = null;
}
