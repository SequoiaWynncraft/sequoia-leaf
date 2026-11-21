/**
 * Teaching by doing: for a member's first run, one nudge at a time in the place it matters. A hand
 * points at the thing, one line says what to do with it, and the nudge is gone for good once the
 * thing has been done (or, for the ones that only point something out, once it has been seen).
 * Which nudges have been given is kept with the prefs.
 */
import { el, unit } from "@sequoia-leaf/kit/dom.ts";

import { fielded, pieces, type Run } from "../../game/index.ts";
import { glyph } from "../art/icons.ts";
import { fightOn } from "../fightview.ts";
import { canBuy, type Doing, nudgeFor, type NudgeId } from "../logic.ts";
import { pawns, wiggle } from "../pawns.ts";
import { snd } from "../sounds.ts";
import { boardToPage, V } from "../stage.ts";
import { prefsChanged, S } from "../state.ts";
import { pic } from "./cards.ts";
import { pageUp } from "./pages.ts";

const LINES: Readonly<Record<NudgeId, string>> = {
  pick: "Pick who sets out with you.",
  buy: "Buy a figure: tap it.",
  setout: "One may fight for now. Set out.",
  watch: "They fight by themselves. Hurry them, or skip, down here.",
  field: "Drag it onto the board. Or tap it, then tap a hex.",
  three: "Three the same become one, with a star more.",
  item: "Drag it onto a figure. Two components make an item.",
  trait: "Two of a kin switch a trait on. Tap it to read it.",
  save: "Every ten acorns you keep earns one more each room.",
  rustle: "Nothing you want? Rustle the stall. One a room is free.",
};
/** Nudges that only point something out, and go by themselves after this many seconds. */
const LINGER: Partial<Record<NudgeId, number>> = { watch: 6, three: 9, trait: 9, save: 9 };

let now: { id: NudgeId; since: number } | null = null;

const teach = (id: NudgeId): void => {
  if (!S.prefs.taught.includes(id)) S.prefs.taught.push(id);
};

/** Whether the thing a nudge asks for has been done. */
function done(id: NudgeId, run: Run): boolean {
  switch (id) {
    case "pick":
      return pieces(run).length > 0;
    case "buy":
      return pieces(run).length > 1;
    case "setout":
      return run.phase !== "plan" || run.room > 0;
    case "field":
      return fielded(run) >= 2;
    case "item":
      return pieces(run).some((p) => p.items.length > 0);
    case "rustle":
      return run.rustles === 0;
    case "three":
      return pieces(run).some((p) => p.stars > 1);
    case "watch":
    case "trait":
    case "save":
      return false;
  }
}

const of = (sel: string): DOMRect | null => document.querySelector(sel)?.getBoundingClientRect() ?? null;

/** The box on the page a nudge points at. */
function target(id: NudgeId, run: Run): DOMRect | null {
  switch (id) {
    case "pick":
      return of("#picks");
    case "buy": {
      const at = run.stall.findIndex((_, i) => canBuy(run, i));
      return of(`[data-offer="${at}"]`);
    }
    case "setout":
      return of("#setout");
    case "watch":
      return of("#speeds");
    case "field": {
      const piece = run.bench.find((p) => p !== null);
      const p = piece ? pawns.get(piece.id) : undefined;
      if (!p) return null;
      wiggle(p.id, 1.4);
      const at = boardToPage(p.x - 8, p.y - 20);
      const end = boardToPage(p.x + 8, p.y + 2);
      return new DOMRect(at.x, at.y, end.x - at.x, end.y - at.y);
    }
    case "three":
      return of("#stall");
    case "item":
      return of("#rack [data-item]");
    case "trait":
      return of("#traits .trait.lit") ?? of("#traits .trait");
    case "save":
      return of("#acorns");
    case "rustle":
      return of("#rustle");
  }
}

function put(id: NudgeId, r: DOMRect): void {
  const box = document.getElementById("nudge");
  if (!box) return;
  if (box.dataset.id !== id) {
    box.replaceChildren(el("div", "k-say", { text: LINES[id] }), pic(glyph("hand"), 2, "hand"));
    box.dataset.id = id;
    snd.nudge();
  }
  box.hidden = false;
  // Above the thing where there is room, with the hand pointing down at it; otherwise below, pointing up.
  const above = r.top > 120;
  box.classList.toggle("below", !above);
  const w = Math.min(140 * unit(), window.innerWidth - 16);
  const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  box.style.width = `${w}px`;
  box.style.left = `${Math.round(x)}px`;
  box.style.setProperty("--hand", `${Math.round(r.left + r.width / 2 - x)}px`);
  if (above) {
    box.style.top = "";
    box.style.bottom = `${Math.round(window.innerHeight - r.top + 4)}px`;
  } else {
    box.style.bottom = "";
    box.style.top = `${Math.round(Math.min(r.bottom + 4, window.innerHeight - 58 * unit()))}px`;
  }
}

function hide(): void {
  const box = document.getElementById("nudge");
  if (!box) return;
  box.hidden = true;
  box.dataset.id = "";
}

/** Shows the nudge that is due, if any. */
export function renderNudge(): void {
  const run = S.run;
  if (!run || pageUp() || S.mode === "front" || S.mode === "over" || S.mode === "after") {
    hide();
    return;
  }
  if (now && done(now.id, run)) {
    teach(now.id);
    now = null;
    prefsChanged();
    return;
  }
  // Anything already done without being asked needs no nudge later.
  let learnt = false;
  for (const id of ["buy", "field", "item", "three"] as const) {
    if (!S.prefs.taught.includes(id) && done(id, run) && run.room >= 1) {
      teach(id);
      learnt = true;
    }
  }
  if (learnt) prefsChanged();
  const doing: Doing = fightOn() ? "fight" : run.choices.length > 0 ? "pick" : S.mode === "plan" ? "plan" : "other";
  const id = nudgeFor(run, doing, S.prefs.taught);
  if (!id) {
    now = null;
    hide();
    return;
  }
  const r = target(id, run);
  if (!r || r.width === 0) {
    hide();
    return;
  }
  if (now?.id !== id) now = { id, since: V.t };
  put(id, r);
}

/** Every moment: a nudge that only points something out goes after it has been up a while. */
export function stepNudge(): void {
  if (!now) return;
  const linger = LINGER[now.id];
  if (linger === undefined || V.t - now.since < linger) return;
  teach(now.id);
  now = null;
  prefsChanged();
}
