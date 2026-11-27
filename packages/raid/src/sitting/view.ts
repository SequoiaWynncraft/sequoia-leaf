/**
 * What a page is shown of a sitting, for one viewer: the stage and when it ends, every seat as far
 * as anyone may see it, and the viewer's own run as a page is shown a run. Never a stream, never a
 * pick drawn and not yet offered, and of another seat's board only what it locked last.
 */
import { isPredicted, plan } from "../command.ts";
import { catalogOf } from "../content/catalog.ts";
import type { Era } from "../content/releases.ts";
import type { RoomKind } from "../content/rooms.ts";
import type { FightSetup } from "../fight/types.ts";
import { runView } from "../game.ts";
import type { Party } from "../party.ts";
import type { Rack } from "../racks.ts";
import { foughtOf, type Note, type Piece, type RunView } from "../run.ts";
import { cannotTake, join } from "./carousel.ts";
import type { SittingCommand } from "./commands.ts";
import { facing, kindOf, marked, nameOf, notNow, notPlanning, type Sitting, type Stage, type Who } from "./sitting.ts";

/**
 * A seat's table as it stands now, as anyone at a live table may scout it, as in TFT: its board and
 * bench (each figure with what it holds), its rack, its acorns, its level and XP. Never its stall,
 * its picks or anything drawn and not yet shown.
 */
export interface SeatTable {
  board: (Piece | null)[];
  bench: (Piece | null)[];
  /** What nobody on it holds, as how many of each kind. */
  rack: Rack;
  acorns: number;
  level: number;
  xp: number;
}

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
  /** Its table as it stands now, to scout. */
  table: SeatTable;
}

export interface SittingView {
  /** The sitting's era: what the page reads the catalogue by (`catalogOf`). */
  era: Era;
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

/** A run's table, as a seat shows it to be scouted. */
const tableOf = (run: Pick<RunView, "board" | "bench" | "rack" | "acorns" | "level" | "xp">): SeatTable => ({
  board: run.board,
  bench: run.bench,
  rack: run.rack,
  acorns: run.acorns,
  level: run.level,
  xp: run.xp,
});

/** The viewer's copy with their run as it is after something they did: their own row, level and table, read from it as Leaf's are. */
function withRun(view: SittingView, run: RunView): SittingView {
  const seats = view.seats.map((seat, i) =>
    i === view.you ? { ...seat, level: run.level, table: tableOf(run) } : seat,
  );
  return { ...view, seats, run };
}

export function sittingView(t: Sitting, viewer: string | null): SittingView {
  const you = t.seats.findIndex((seat) => seat.who.is === "member" && seat.who.id === viewer);
  const mine = t.seats[you];
  const fights = t.stage.at === "fight";
  const paired = (fights || t.stage.at === "plan") && kindOf(t.room) === "spar";
  return {
    era: t.era,
    by: t.by,
    stage: t.stage,
    room: t.room,
    kind: kindOf(t.room),
    seats: t.seats.map(({ who, run, place, shown }, i) => ({
      who,
      name: nameOf(catalogOf(t), who),
      resolve: run.resolve,
      level: run.level,
      streak: run.streak,
      place,
      faces: paired && place === null ? facing(t, i) : null,
      board: shown,
      fight: fights ? (foughtOf(run)?.setup ?? null) : null,
      table: tableOf(run),
    })),
    you: mine ? you : null,
    run: mine ? runView(mine.run) : null,
  };
}

type Predicted = { view: SittingView; notes: Note[] } | { refused: string };

type Own = Extract<SittingCommand, { do: "pick" | "ready" | "watched" }>;
const isOwn = (c: SittingCommand): c is Own => c.do === "pick" || c.do === "ready" || c.do === "watched";

/** What one of the sitting's own moves does to the viewer's copy, their seat being `you` and still in. */
function ownMove(view: SittingView, c: Own, you: number, run: RunView): Predicted | null {
  const { stage } = view;
  if (stage.at === "carousel" && c.do === "pick") {
    const cannot = cannotTake(stage, you, c.offer);
    const wanted = stage.ring[c.offer];
    if (cannot || !wanted) return { refused: cannot ?? "not_in_ring" };
    const after = structuredClone(run);
    const notes = join(after, wanted.kind, wanted.item);
    const ring = stage.ring.map((offer, i) => (i === c.offer ? { ...offer, by: you } : offer));
    return { view: withRun({ ...view, stage: { ...stage, ring } }, after), notes };
  }
  if (stage.at === "plan" && c.do === "ready")
    return { view: { ...view, stage: { ...stage, ready: marked(stage.ready, you, c.on) } }, notes: [] };
  if (stage.at === "fight")
    return { view: { ...view, stage: { ...stage, done: marked(stage.done, you, true) } }, notes: [] };
  return null;
}

/**
 * The sitting's own moves the page shows before Leaf answers, as Leaf does them: a figure taken from
 * the ring (it joins the viewer's run), ready or not, and a fight watched. Ending a stage early is
 * Leaf's alone. Null for any other command.
 */
function predictOwn(view: SittingView, c: SittingCommand): Predicted | null {
  if (!isOwn(c)) return null;
  const { stage, you, run } = view;
  const stop = notNow(stage.at, c.do);
  if (stop) return { refused: stop };
  if (c.do !== "pick" && c.room !== view.room) return { refused: "moved_on" };
  if (you === null || !run) return { refused: "not_seated" };
  if (view.seats[you]?.place !== null) return { refused: "out" };
  return ownMove(view, c, you, run);
}

/**
 * What one of the viewer's own commands that draws nothing does to the page's copy, by the rules
 * Leaf will use: the copy after it and what happened, or the refusal Leaf would give. Null for a
 * command that must wait for Leaf.
 */
export function predict(view: SittingView, c: SittingCommand): Predicted | null {
  const own = predictOwn(view, c);
  if (own) return own;
  if (!isPredicted(c)) return null;
  const stop = notPlanning(view.stage.at);
  if (stop) return { refused: stop };
  if (!view.run) return { refused: "not_seated" };
  const run = structuredClone(view.run);
  // The seat plans in the sitting's era, as it does at Leaf.
  run.era = view.era;
  const done = plan(run, c);
  if (!done) return null;
  if (!done.ok) return { refused: done.code };
  return { view: withRun(view, run), notes: done.notes };
}
