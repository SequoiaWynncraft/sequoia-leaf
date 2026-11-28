import type { KeptPiece } from "../cells.ts";
/**
 * The Study: takes folios in from any side, holds up to 20 of each kind, and works as a machine does
 * on one folio at a time that the research first in the line still wants (100 half-ticks at its
 * grade's pace); then the folio goes toward the research. One the research has stopped wanting
 * meanwhile (another Study gave it the last) stays in the Study. Its work belongs to the research
 * first in the line: when another comes first, every Study's work is dropped (`studies`).
 */
import { STUDY_HOLDS, TICKS } from "../content/machines.ts";
import type { Goal, Item } from "../tables.ts";
import type { Counts, Holders, Wire, Yard } from "../yard.ts";
import { keep, stockOnto, workOnto } from "./holder.ts";
import { kind, type Words } from "./kind.ts";
import type { Kit } from "./kit.ts";
import { everySide } from "./line.ts";
import { as, holding, list, NO_POWER, rateOf, slow } from "./say.ts";

/** The work in studying one folio, in half-ticks. */
const WORK = TICKS.study * 2;

/** The first folio a Study holds that a piece of research still wants, or `NONE`. */
function wanted(k: Kit, y: Yard, g: Goal, h: Holders, r: number): number {
  const want = k.GOALS[g]?.want;
  const got = y.got[g];
  if (!want || !got) return k.NONE;
  for (let f = 0; f < k.FOLIOS.length; f++) {
    const n = k.FOLIOS[f] ?? k.NONE;
    if ((h.stock[r * k.ITEM_COUNT + n] ?? 0) > 0 && (want[n] ?? 0) > (got[n] ?? 0)) return n;
  }
  return k.NONE;
}

/** It studies a folio the research first in the line still wants, and when it is done the folio goes toward the research. Says whether it had one to study. */
function work(k: Kit, y: Yard, i: number, r: number, speed: number, wire: Wire): boolean {
  const g = y.line[0];
  if (g === undefined) return false;
  const h = y.holders;
  if (h.making[r] === k.NONE) {
    if (h.idle[r] === 1) return false;
    const found = wanted(k, y, g, h, r);
    if (found === k.NONE) {
      h.idle[r] = 1;
      return false;
    }
    h.making[r] = found;
  }
  h.work[r] = (h.work[r] ?? 0) + speed;
  if ((h.work[r] ?? 0) < WORK) return true;
  h.work[r] = (h.work[r] ?? 0) - WORK;
  const n = h.making[r] ?? k.NONE;
  h.making[r] = k.NONE;
  if (k.giveGoal(y, g, n, 1) > 0) {
    k.take(h, r, n);
    k.roomBeside(y, i, wire.waiting);
  }
  return true;
}

/** The folios the research first in the line still wants. */
const still = (k: Kit, y: Yard, g: Goal): Item[] =>
  k.FOLIOS.filter((n) => (k.GOALS[g]?.want[n] ?? 0) > (y.got[g]?.[n] ?? 0));

function condition(k: Kit, y: Yard, i: number, lit: boolean): number {
  if (!lit) return as("unpowered", true);
  const g = y.line[0];
  if (g === undefined) return as("idle");
  const r = k.holderOf(y, i);
  for (const n of k.FOLIOS)
    if ((k.GOALS[g]?.want[n] ?? 0) > (y.got[g]?.[n] ?? 0) && k.held(y.holders, r, n) > 0) return as("working");
  return as("waiting");
}

function words(k: Kit, y: Yard, i: number, state: string): Words {
  if (state === "unpowered") return { line: NO_POWER };
  const g = y.line[0];
  const r = k.holderOf(y, i);
  const holds = (y.holders.count[r] ?? 0) > 0 ? `Holds ${holding(k, y, r)}. ` : "";
  if (g === undefined) return { line: `${holds}Nothing is being studied.` };
  const name = k.GOALS[g]?.title ?? "";
  if (state === "working") return { line: `Studying ${name}${slow(k, y, i)}.` };
  const missing = still(k, y, g);
  return { line: `${holds}Waiting for ${list(k, missing)} for ${name}.`, missing };
}

/** What it needs a minute: the folios the research first in line still wants, in the shares it wants them. */
function flow(k: Kit, y: Yard, i: number, _made: Counts, needed: Counts): void {
  const g = y.line[0];
  if (g === undefined || !k.GOALS[g]) return;
  let left = 0;
  for (let f = 0; f < k.FOLIOS.length; f++) left += wantsMore(k, y, g, k.FOLIOS[f] ?? k.NONE);
  if (left <= 0) return;
  const studies = rateOf(k, y, i, null).effective;
  for (let f = 0; f < k.FOLIOS.length; f++) {
    const n = k.FOLIOS[f] ?? k.NONE;
    const more = wantsMore(k, y, g, n);
    if (more > 0) needed[n] = (needed[n] ?? 0) + (studies * more) / left;
  }
}

/** How many more of a folio a piece of research wants than it has been given. */
const wantsMore = (k: Kit, y: Yard, g: Goal, n: number): number =>
  Math.max(0, (k.GOALS[g]?.want[n] ?? 0) - (y.got[g]?.[n] ?? 0));

/** A kept Study: its folios, and its work on one it holds that `studied`, the research first in line, wants. */
function onto(k: Kit, y: Yard, i: number, r: number, o: KeptPiece, studied: Goal | undefined): void {
  stockOnto(k, y, i, r, o, 1e6);
  const m = o.making;
  const wants = m !== undefined && studied !== undefined && k.isFolio(m) && (k.GOALS[studied]?.want[m] ?? 0) > 0;
  const making = wants && m !== undefined && k.held(y.holders, r, m) > 0 ? m : k.NONE;
  if (making !== k.NONE) y.holders.making[r] = making;
  if (studied !== undefined) workOnto(k, y, r, o, making === k.NONE ? Math.max(...k.PACE) : WORK);
}

export const study = kind({
  name: "study",
  info: {
    name: "Study",
    cost: 200,
    draw: 6,
    gives: 0,
    what: "Takes in folios from any side, and puts 1 every 5 seconds towards the research being studied. Holds up to 20 of each kind.",
  },
  graded: true,
  holds: true,
  studies: true,
  work: WORK,
  does: ["Studies", "folios"],
  rules: {
    sides: everySide,
    wants: (k, _y, _i, n) => k.isFolio(n),
    room: (k, y, i, n) => k.held(y.holders, k.holderOf(y, i), n) < STUDY_HOLDS,
    give: keep,
    work,
    condition,
    words,
    flow,
    most: (k, _y, _i, n) => (k.isFolio(n) ? STUDY_HOLDS : 0),
    onto,
  },
});
