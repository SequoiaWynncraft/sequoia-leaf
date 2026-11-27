/**
 * What a page is shown of a sitting, for one viewer: the stage and when it ends, every seat as far
 * as anyone may see it, and the viewer's own run as a page is shown a run. Never a stream, never a
 * pick drawn and not yet offered, and of another seat's board only what it locked last.
 */
import { isPredicted, plan } from "../command.ts";
import type { RoomKind } from "../content/rooms.ts";
import type { FightSetup } from "../fight/types.ts";
import { runView } from "../game.ts";
import type { Party } from "../party.ts";
import { foughtOf, type Note, type RunView } from "../run.ts";
import type { SittingCommand } from "./commands.ts";
import { facing, kindOf, nameOf, notPlanning, type Sitting, type Stage, type Who } from "./sitting.ts";

/** A seat as anyone at the sitting sees it. */
export interface SeatView {
  who: Who;
  name: string;
  resolve: number;
  level: number;
  streak: number;
  /** Its place once it is out or the sitting is over, 1 the winner; null while it is in. */
  place: number | null;
  /** The seat it faces in a sparring room being planned or fought. The odd one out faces a seat that does not face it back: it fights a copy. */
  faces: number | null;
  /** Its board as it was at the last lock. */
  board: Party;
  /** The fight it is in while the fights are watched, to play from; which side is its own is `sideOf`. */
  fight: FightSetup | null;
}

export interface SittingView {
  /** The Leaf id of whoever opened it. */
  by: string;
  /** Where it stands and when that ends; in a carousel the ring, who took what, and whose turn it is (`turns` up to `open`). */
  stage: Stage;
  room: number;
  kind: RoomKind;
  seats: SeatView[];
  /** The viewer's seat, and their run; null for somebody not seated. */
  you: number | null;
  run: RunView | null;
}

export function sittingView(t: Sitting, viewer: string | null): SittingView {
  const you = t.seats.findIndex((seat) => seat.who.is === "member" && seat.who.id === viewer);
  const mine = t.seats[you];
  const fights = t.stage.at === "fight";
  const paired = (fights || t.stage.at === "plan") && kindOf(t.room) === "spar";
  return {
    by: t.by,
    stage: t.stage,
    room: t.room,
    kind: kindOf(t.room),
    seats: t.seats.map(({ who, run, place, shown }, i) => ({
      who,
      name: nameOf(who),
      resolve: run.resolve,
      level: run.level,
      streak: run.streak,
      place,
      faces: paired && place === null ? facing(t, i) : null,
      board: shown,
      fight: fights ? (foughtOf(run)?.setup ?? null) : null,
    })),
    you: mine ? you : null,
    run: mine ? runView(mine.run) : null,
  };
}

/**
 * What one of the viewer's own commands that draws nothing does to the page's copy, by the rules
 * Leaf will use: the copy after it and what happened, or the refusal Leaf would give. Null for a
 * command that must wait for Leaf.
 */
export function predict(
  view: SittingView,
  c: SittingCommand,
): { view: SittingView; notes: Note[] } | { refused: string } | null {
  if (!isPredicted(c)) return null;
  const stop = notPlanning(view.stage.at);
  if (stop) return { refused: stop };
  if (!view.run) return { refused: "not_seated" };
  const run = structuredClone(view.run);
  const done = plan(run, c);
  if (!done) return null;
  if (!done.ok) return { refused: done.code };
  // The viewer's own row is read from their run, as Leaf's is.
  const seats = view.seats.map((seat, i) => (i === view.you ? { ...seat, level: run.level } : seat));
  return { view: { ...view, seats, run }, notes: done.notes };
}
