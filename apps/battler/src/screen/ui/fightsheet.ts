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

import { fightTitle, opening } from "../logic.ts";
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
} = { up: null, played: null, view: null, box: null, takings: null, carry: null };

/** The last fight the run kept (or the run just ended), played again; the same one as before if it has not changed. */
function played(): Played | null {
  const setup = S.run?.last ?? S.ended?.run.last ?? null;
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
    const across = p.setup.sides[1];
    return figureDesc(u.kind, u.stars, {
      unit: u,
      whose: u.side === 0 ? "Yours" : `${opening(across.who)}'s`,
      party: p.setup.sides[u.side],
    });
  });
}

/** What "Carry on" does: whoever runs the room says. */
export function onCarry(fn: () => void): void {
  SH.carry = fn;
}

export const sheetUp = (): "after" | "again" | null => SH.up;
/** Whether there is a last fight to look back on. */
export const hasLastFight = (): boolean => (S.run?.last ?? null) !== null;

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

/**
 * Opens the sheet: `after` as a fight ends, with how Leaf decided it came out (`leaf`), room for the
 * takings and "Carry on"; `again` from "Last fight", with a button to put it away.
 */
export function openSheet(how: "after" | "again", leaf?: { outcome: FightSummary; kept: boolean }): void {
  const p = played();
  const bottom = document.getElementById("bottom");
  if (!p || !bottom) return;
  closeSheet(false);
  const result = leaf?.outcome.result ?? p.fight.result ?? "draw";
  const title = fightTitle(result, leaf?.outcome.ticks ?? p.fight.tick);
  const view = tallyView(foughtRef, "sheet");
  view.across(p.setup.sides[1].who);
  if (leaf?.kept !== false) {
    view.show(
      p.fight.units,
      tally(
        p.events,
        p.fight.units.map((u) => u.id),
      ),
    );
  }
  const close =
    how === "again"
      ? el(
          "button",
          "k-btn wood icon sm",
          { type: "button", "aria-label": "Put it away", onclick: () => closeSheet() },
          icon("close"),
        )
      : null;
  const takings = el("div", "takings k-col tight", {});
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

/** A line of what the room paid, as it is counted out. */
export function sheetTaking(label: string, value: Node | string): void {
  const list = SH.takings;
  if (!list || SH.up !== "after") return;
  list.append(el("div", "k-row pay k-rise", {}, el("span", "k-grow", { text: label }), value));
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

/** Opens "Last fight", or puts it away if it is up. */
export function toggleLastFight(): void {
  if (SH.up === "again") closeSheet();
  else if (S.mode === "plan" && hasLastFight() && (S.run?.choices.length ?? 0) === 0) openSheet("again");
}
