/**
 * The round tracker along the top, one bar for every table: where the table is ("2-4", "Room 17"), a
 * picture for each round it shows (those played dim, the one being played lit with a marker under
 * it, the rest plain), and at a live table the stage now, its seconds left, and under the whole bar
 * a thin bar draining to Leaf's deadline on the page's own clock. A solo run's has no clock.
 *
 * It keeps its size whatever it says: the rounds are drawn again only when they change, the words
 * and the seconds sit in places of their own width, and the bar drains on a transform.
 */
import { link } from "@sequoia-leaf/kit/card.ts";
import { el } from "@sequoia-leaf/kit/dom.ts";

import { pic } from "./cards.ts";

/** One round's picture on the tracker. */
export interface Slot {
  /** Its picture, its own copy. */
  pic: HTMLCanvasElement;
  /** Its classes beyond `k-slot pip`: how it stands (`past`, `now`, or none), and its kind and how it came out. */
  cls: string;
  /** What it is called, read out. */
  label: string;
  /** Its card: what pointing at it, or a tap on a phone, shows. */
  ref: string;
  /** What a press on it does, if it does something of its own (the opponent's swords scout them). */
  press?: () => void;
  /** Whether it is the keyboard's one stop on the tracker (the arrows walk along the rest). */
  stop?: boolean;
}

/** The time a stage has left, as Leaf's clock tells it. */
export interface Clock {
  /** The stage now: "Planning", "Fight", "Carousel". */
  label: string;
  seconds: number | null;
  /** The milliseconds left to the deadline, and of how many in all: what the bar under drains by. */
  left: number;
  full: number;
}

export interface Track {
  /** Where the table is: a word a phone leaves out, and the number ("Room ", "17"; "", "2-4"); null for none. */
  where: readonly [string, string] | null;
  slots: readonly Slot[];
  /** What the slots are drawn from: they are drawn again only when it changes. */
  key: string;
  /** The stage's clock, at a live table. */
  clock: Clock | null;
}

/** What the bar under drains to, and from how full, so that it is set going again only when the deadline moves. */
const DRAIN: { box: HTMLElement | null; end: number; from: number; anim: Animation | null } = {
  box: null,
  end: 0,
  from: 0,
  anim: null,
};

/** How full the bar under is now, as it drains. */
function fullNow(): number {
  const { anim, from } = DRAIN;
  const t = anim?.currentTime;
  const ms = anim?.effect?.getTiming().duration;
  return typeof t === "number" && typeof ms === "number" && ms > 0 ? from * Math.max(0, 1 - t / ms) : 0;
}

/**
 * Drains the bar under the tracker from what is left now to nothing at the deadline. A deadline
 * brought forward (a stage ending early) takes it there sooner from where it is; a new stage fills it.
 */
function drain(box: HTMLElement, clock: Clock | null): void {
  const fill = box.querySelector<HTMLElement>(".drain > i");
  if (!fill || !clock) {
    DRAIN.anim?.cancel();
    DRAIN.anim = null;
    DRAIN.end = 0;
    return;
  }
  const end = performance.now() + clock.left;
  // Moved by less than a tick: the bar is already on its way there.
  if (DRAIN.box === box && DRAIN.anim && Math.abs(end - DRAIN.end) < 300) return;
  const share = clock.full > 0 ? Math.min(1, Math.max(0, clock.left / clock.full)) : 0;
  const now = DRAIN.box === box ? fullNow() : 0;
  DRAIN.box = box;
  DRAIN.end = end;
  DRAIN.from = share < now ? now : share;
  DRAIN.anim?.cancel();
  DRAIN.anim = fill.animate([{ transform: `scaleX(${DRAIN.from})` }, { transform: "scaleX(0)" }], {
    duration: Math.max(1, clock.left),
    easing: "linear",
    fill: "forwards",
  });
}

/** One round's picture, as a button with its card. */
function slotOf(slot: Slot): HTMLElement {
  const button = el(
    "button",
    `k-slot pip ${slot.cls}`.trim(),
    { type: "button", "aria-label": slot.label, onclick: slot.press ?? null },
    pic(slot.pic),
  );
  button.tabIndex = slot.stop ? 0 : -1;
  link(button, slot.ref, { acts: slot.press !== undefined });
  return button;
}

/** The parts of a tracker with a clock, built once into it: the stage and its seconds, and the bar under. */
function clockParts(box: HTMLElement): void {
  if (box.querySelector(".when")) return;
  box.append(
    el("span", "when", { role: "timer", "aria-live": "off" }, el("span", "stage"), el("b", "secs")),
    el("i", "drain", { "aria-hidden": "true" }, el("i")),
  );
}

/** Draws a tracker into its box: the rounds when they change, the where, the stage, its seconds and the bar every time. */
export function drawTrack(box: HTMLElement, track: Track): void {
  box.classList.toggle("timed", track.clock !== null);
  if (box.dataset.key !== track.key) {
    box.dataset.key = track.key;
    const kept = [...box.querySelectorAll(":scope > .when, :scope > .drain")];
    box.replaceChildren(...whereOf(track.where), ...track.slots.map(slotOf), ...kept);
  }
  drawClock(box, track.clock);
}

/** Where the table is, before the rounds: on a phone the number alone. */
function whereOf(where: Track["where"]): HTMLElement[] {
  if (!where) return [];
  const [word, number] = where;
  return [el("b", "where k-gold", {}, word ? el("span", "wide-only", { text: word }) : null, number)];
}

/** The stage, its seconds and the bar under; none of them with no clock. */
function drawClock(box: HTMLElement, clock: Clock | null): void {
  if (!clock) {
    for (const part of box.querySelectorAll(":scope > .when, :scope > .drain")) part.remove();
    drain(box, null);
    return;
  }
  clockParts(box);
  const { label, seconds } = clock;
  const when = box.querySelector(".when");
  const stage = box.querySelector(".when .stage");
  const secs = box.querySelector(".when .secs");
  const text = seconds === null ? "" : String(seconds);
  if (stage && stage.textContent !== label) stage.textContent = label;
  if (secs && secs.textContent !== text) secs.textContent = text;
  when?.classList.toggle("short", seconds !== null && seconds <= 5);
  when?.setAttribute("aria-label", seconds === null ? label : `${label}, ${seconds} seconds left`);
  drain(box, clock);
}
