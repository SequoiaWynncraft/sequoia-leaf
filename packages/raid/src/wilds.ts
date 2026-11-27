/**
 * The Wilds' rules in a run (`content/wilds.ts`; `room.ts` says which one holds). After the boss in
 * room 5, and after every boss after it, a pick of two rules waits (`rulePicks`), drawn from the
 * run's stream, never the rule just played. Taking one (`takeRule`) lays the wing's first room out
 * under it, and every room after it in the wing is laid out under it too (`enterRoom`): what the
 * rule draws for a room drawn first (Stumps' stumps, `RuleRow.draws`), who waits sits only on open
 * seats (`foeOf`), and the member's figures on a seat that closed move to the nearest open one,
 * each saying so (`shifted`).
 */
import { type Met, shuffled } from "@sequoia-leaf/core";

import { ROOM_RULES } from "./content/rules.ts";
import { isRuleId, RULE_IDS, type RuleId, WILDS } from "./content/wilds.ts";
import { foeOf } from "./foe.ts";
import { closedNow, roomOf } from "./room.ts";
import type { Choice, Note, Run, Spot } from "./run.ts";
import { courseOf } from "./way.ts";
import { nearestOpen, seatOpen, wingOf } from "./wing.ts";

/** What a pick of rules offers: `WILDS.offers` of them, drawn from the run's stream, never the rule just `played`. */
export const ruleOptions = (run: Run, played: RuleId | null): RuleId[] =>
  shuffled(
    run,
    RULE_IDS.filter((id) => id !== played),
  ).slice(0, WILDS.offers);

/** The pick of a rule a room just fought (its place, from 0) leaves waiting: on a course that binds each wing (the Wilds), after each boss from `WILDS.first` on. */
export function rulePicks(run: Run, fought: number): Choice[] {
  const course = courseOf(run.way);
  if (course.binds !== "wing" || fought < WILDS.first || course.rooms(fought)?.kind !== "boss") return [];
  const played = roomOf(run, fought).named[0] ?? null;
  return [{ kind: "rule", options: ruleOptions(run, played) }];
}

/** Draws what the rule in force in the room draws for it (Stumps' stumps), from the run's stream; nothing under none. */
function drawFor(run: Run): void {
  const [rule] = roomOf(run).named;
  if (run.wing && rule) run.wing.stumps = ROOM_RULES[rule].draws(run);
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
  drawFor(run);
  run.foe = { ...run.foe, figures: seatOpen(run.foe.figures, closedNow(run)) };
  return moveOff(run);
}

/** Lays out the room a run has come to, from the room's seed: what its rule draws first (under Stumps new stumps), then who waits there, then the member's figures off the closed seats. */
export function enterRoom(run: Run, seed: number, met?: Met): Note[] {
  drawFor(run);
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
  if (!lost || courseOf(run.way).binds !== "wing" || stage.phase !== "plan" || stage.picks[0]?.kind === "rule") return;
  stage.picks.unshift({ kind: "rule", options: ruleOptions(run, null) });
}
