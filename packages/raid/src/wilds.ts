/**
 * The Wilds' rules in a run (`content/wilds.ts`; `wing.ts` says which one holds). After the boss in
 * room 5, and after every boss after it, a pick of two rules waits (`rulePicks`), drawn from the
 * run's stream, never the rule just played. Taking one (`takeRule`) lays the wing's first room out
 * under it, and every room after it in the wing is laid out under it too (`enterRoom`): under Stumps
 * new stumps, who waits sits only on open seats (`foeOf`), and the member's figures on a seat that
 * closed move to the nearest open one, each saying so (`shifted`).
 */
import { type Met, shuffled } from "@sequoia-leaf/core";

import { isRuleId, RULE_IDS, type RuleId, WILDS } from "./content/wilds.ts";
import { foeOf, roomAt } from "./endless.ts";
import { SEATS } from "./hex.ts";
import type { Choice, Note, Run, Spot } from "./run.ts";
import { closedNow, nearestOpen, ruleOf, seatOpen, wingOf } from "./wing.ts";

/** What a pick of rules offers: `WILDS.offers` of them, drawn from the run's stream, never the rule just `played`. */
export const ruleOptions = (run: Run, played: RuleId | null): RuleId[] =>
  shuffled(
    run,
    RULE_IDS.filter((id) => id !== played),
  ).slice(0, WILDS.offers);

/** The pick of a rule a room just fought (its place, from 0) leaves waiting: after each boss of the Wilds from `WILDS.first` on. */
export function rulePicks(run: Run, fought: number): Choice[] {
  if (run.endless !== "wilds" || fought < WILDS.first || roomAt(fought)?.kind !== "boss") return [];
  const played = ruleOf({ room: fought, wing: run.wing })?.id ?? null;
  return [{ kind: "rule", options: ruleOptions(run, played) }];
}

const ALL_SEATS = Array.from({ length: SEATS }, (_, seat) => seat);
/** Draws the room's stumps from the run's stream. */
function drawStumps(run: Run): void {
  if (run.wing)
    run.wing.stumps = shuffled(run, ALL_SEATS)
      .slice(0, WILDS.stumps)
      .toSorted((a, b) => a - b);
}

/** The member's figures on a closed seat move to the nearest open empty one (with none, to the bench), and each says so. */
function moveOff(run: Run): Note[] {
  const closed = closedNow(run);
  const notes: Note[] = [];
  run.board.forEach((piece, seat) => {
    if (!piece || !closed.has(seat)) return;
    const open = nearestOpen(seat, closed, (s) => run.board[s] === null);
    const slot = run.bench.indexOf(null);
    if (open < 0 && slot < 0) return;
    const to: Spot = open >= 0 ? { on: "board", at: open } : { on: "bench", at: slot };
    run.board[seat] = null;
    (to.on === "board" ? run.board : run.bench)[to.at] = piece;
    notes.push({ t: "shifted", piece: piece.id, from: seat, to });
  });
  return notes;
}

/** Takes the rule picked for the wing the run has come to, and lays the room out under it: whoever is on a closed seat, on either side, moves off it. */
export function takeRule(run: Run, rule: RuleId): Note[] {
  run.wing = { rule, at: wingOf(run.room), stumps: [] };
  if (rule === "stumps") drawStumps(run);
  run.foe = { ...run.foe, figures: seatOpen(run.foe.figures, closedNow(run)) };
  return moveOff(run);
}

/** Lays out the room a run has come to, from the room's seed: under Stumps new stumps first, then who waits there, then the member's figures off the closed seats. */
export function enterRoom(run: Run, seed: number, met?: Met): Note[] {
  if (ruleOf(run)?.id === "stumps") drawStumps(run);
  run.foe = foeOf(run, seed, met);
  return moveOff(run);
}

/**
 * A run read back whose wing's rule these rules no longer have (`kept`: the wing as it was stored,
 * read as none): while it is in that wing and planning, it picks a rule again for the rest of it.
 */
export function pickAgain(run: Run, kept: unknown): void {
  const lost =
    typeof kept === "object" &&
    kept !== null &&
    "rule" in kept &&
    !isRuleId(kept.rule) &&
    "at" in kept &&
    kept.at === wingOf(run.room);
  const { stage } = run;
  if (!lost || run.endless !== "wilds" || stage.phase !== "plan" || stage.picks[0]?.kind === "rule") return;
  stage.picks.unshift({ kind: "rule", options: ruleOptions(run, null) });
}
