/**
 * Reading back what Leaf shows a page of a sitting (`sittingView`), field by field, as `wire.ts`
 * reads the solo table's view: the stage and the seats as a stored sitting reads them (`keep.ts`),
 * each board as a party, each fight as a setup, and the viewer's run as a page is shown a run.
 * Anything else is a view these rules could not have made: null.
 */
import { isEra } from "../content/releases.ts";
import { isParty } from "../party.ts";
import { fields, Nonsense, readRunView } from "../save.ts";
import { readStage, readWho } from "./keep.ts";
import { CHAIRS } from "./sitting.ts";
import type { SeatView, SittingView } from "./view.ts";

const { record, whole, list, one, setup, bad } = fields;

const isKind = (v: unknown): v is SittingView["kind"] => v === "trouble" || v === "spar" || v === "boss";
const chair = (v: unknown, what: string): number => whole(v, 0, CHAIRS - 1, what);
const text = (v: unknown, what: string): string =>
  typeof v === "string" && v.length > 0 && v.length <= 80 ? v : bad(what);

function readSeat(v: unknown): SeatView {
  const s = record(v, "a seat");
  return {
    who: readWho(s.who),
    name: text(s.name, "a seat's name"),
    resolve: whole(s.resolve, -1000, 1000, "a seat's health"),
    level: whole(s.level, 1, 99, "a seat's level"),
    streak: whole(s.streak, -999, 999, "a seat's streak"),
    place: s.place === null ? null : whole(s.place, 1, CHAIRS, "a place"),
    faces: s.faces === null ? null : chair(s.faces, "whom a seat faces"),
    board: one(s.board, isParty, "a seat's board"),
    fight: s.fight === null ? null : setup(s.fight, "a seat's fight"),
  };
}

/** A sitting as Leaf shows it to the page, or null for anything this version could not have sent. */
export function readSittingView(v: unknown): SittingView | null {
  try {
    const r = record(v, "the sitting");
    const seats = list(r.seats, CHAIRS, "the seats").map(readSeat);
    const you = r.you === null ? null : chair(r.you, "your seat");
    if (you !== null && you >= seats.length) bad("your seat");
    const run = r.run === null ? null : (readRunView(r.run) ?? bad("your run"));
    if ((you === null) !== (run === null)) bad("your run");
    return {
      era: one(r.era, isEra, "the era"),
      by: text(r.by, "who opened it"),
      stage: readStage(r.stage),
      room: whole(r.room, 0, 999, "the room"),
      kind: one(r.kind, isKind, "the room's kind"),
      seats,
      you,
      run,
    };
  } catch (err) {
    if (err instanceof Nonsense) return null;
    throw err;
  }
}
