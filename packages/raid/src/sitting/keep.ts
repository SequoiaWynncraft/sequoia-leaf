/**
 * A sitting as Leaf stores it, and read back. It is plain data, so keeping it is writing it out.
 * Reading goes as a run's does (`save.ts`): the shape first, field by field into a fresh sitting,
 * each seat's run by the run's own reader, then whether the parts agree with each other. Anything
 * else is refused: a sitting that does not read is not one. One of a version above this Leaf's is a
 * newer Leaf's (`sittingIsNewer`), refused too, and left as it is.
 */
import { newerThan } from "@sequoia-leaf/core";

import { isFigureId } from "../content/figures.ts";
import { isComponentId } from "../content/items.ts";
import { isEra, LEGACY_ERA } from "../content/releases.ts";
import { isTraitId, renamedTrait } from "../content/traits.ts";
import { isParty } from "../party.ts";
import { endingOf } from "../run.ts";
import { checkRun, fields, Nonsense, partyAsShare } from "../save.ts";
import {
  CHAIRS,
  type Member,
  type Offer,
  type Owed,
  type Seat,
  type Sitting,
  type Stage,
  type Who,
} from "./sitting.ts";

const GAME = "little-raid-sitting";
/**
 * 3: the sitting, each seat's run and each fight's setup keep their era. 2: what Greg has eaten is
 * a share of his health (`feed`), where it was meals of 3% each; its runs keep the Wilds' wing as
 * version 1's did. A sitting of versions 1 and 2 is read as well, of `LEGACY_ERA`.
 */
export const SITTING_VERSION = 3;
const READS: readonly number[] = [1, 2, SITTING_VERSION];

export const encodeSitting = (t: Sitting): string =>
  JSON.stringify({
    game: GAME,
    v: SITTING_VERSION,
    rng: t.rng,
    era: t.era,
    by: t.by,
    room: t.room,
    stage: t.stage,
    seats: t.seats,
    pairs: t.pairs,
    odd: t.odd,
    owed: t.owed,
  });

const { record, whole, list, one, unique, bad } = fields;
const UINT = 0xffffffff;
/** A moment of Leaf's clock. */
const moment = (v: unknown, what: string): number => whole(v, 0, Number.MAX_SAFE_INTEGER, what);
const text = (v: unknown, most: number, what: string): string =>
  typeof v === "string" && v.length > 0 && v.length <= most ? v : bad(what);
/** A seat's number. */
const chair = (v: unknown, what: string): number => whole(v, 0, CHAIRS - 1, what);

function readMember(v: unknown): Member {
  const m = record(v, "a member");
  return { id: text(m.id, 64, "a member's id"), name: text(m.name, 80, "a member's name") };
}
export function readWho(v: unknown): Who {
  const w = record(v, "whose a seat is");
  if (w.is === "member") return { is: "member", ...readMember(w) };
  if (w.is !== "regular") return bad("whose a seat is");
  return {
    is: "regular",
    figure: one(w.figure, isFigureId, "a regular"),
    habit: one(renamedTrait(w.habit), isTraitId, "a regular"),
  };
}
/** A seat, its run kept by a sitting of version 1 (`meals`) or since. */
function readSeat(v: unknown, meals: boolean): Seat {
  const s = record(v, "a seat");
  const run = checkRun(s.run, false, meals);
  if (!run.ok) return bad("a seat's run");
  const shown = one(s.shown, isParty, "a seat's board");
  return {
    who: readWho(s.who),
    run: run.run,
    // Its board as shown across the table, its Greg's meals read as shares as the run's are.
    shown: meals ? partyAsShare(shown) : shown,
    place: s.place === null ? null : whole(s.place, 1, CHAIRS, "a place"),
  };
}
function readOffer(v: unknown): Offer {
  const o = record(v, "the ring");
  return {
    kind: one(o.kind, isFigureId, "the ring"),
    item: one(o.item, isComponentId, "the ring"),
    by: o.by === null ? null : chair(o.by, "the ring"),
  };
}
export function readStage(v: unknown): Stage {
  const s = record(v, "the stage");
  if (s.at === "over") return { at: "over", ended: moment(s.ended, "the end") };
  const until = moment(s.until, "the deadline");
  if (s.at === "plan" || s.at === "fight") return { at: s.at, until };
  if (s.at === "open") {
    const sat = list(s.sat, CHAIRS - 1, "who has sat").map(readMember);
    unique(
      sat.map((m) => m.id),
      "who has sat",
    );
    return { at: "open", until, sat };
  }
  if (s.at !== "carousel") return bad("the stage");
  const turns = unique(
    list(s.turns, CHAIRS, "the turns").map((x) => chair(x, "the turns")),
    "the turns",
  );
  const ring = list(s.ring, 32, "the ring").map(readOffer);
  unique(
    ring.flatMap((offer) => (offer.by === null ? [] : [offer.by])),
    "the ring",
  );
  return { at: "carousel", until, ring, turns, open: whole(s.open, 0, turns.length, "the turns") };
}
/** Two different seats. */
function readTwo(v: unknown, what: string): [number, number] {
  const [a, b] = list(v, 2, what).map((x) => chair(x, what));
  return a === undefined || b === undefined || a === b ? bad(what) : [a, b];
}
function readOwed(v: unknown): Owed {
  const o = record(v, "what is owed");
  return {
    key: text(o.key, 64, "what is owed"),
    member: text(o.member, 64, "what is owed"),
    coins: whole(o.coins, 1, 1_000_000, "what is owed"),
  };
}

/** Whether each seat agrees with where the sitting stands: in exactly while its run goes on, its run where the stage is, and a winner once it is over. */
function seatsAgree({ stage, seats }: Sitting): void {
  const phase = stage.at === "fight" ? "fight" : stage.at === "over" ? "over" : "plan";
  for (const { run, place } of seats) {
    if ((place === null) !== (endingOf(run) === null)) bad("who is out");
    if (place === null && run.stage.phase !== phase) bad("where a run stands");
  }
  if (stage.at === "over" && seats.length > 0 && !seats.some((seat) => seat.place === 1)) bad("the winner");
}

/** Whether the parts of a sitting agree: eight seats once started, nobody twice, each place once, and the seats with the stage. */
function agree(t: Sitting): void {
  const { stage, seats } = t;
  const started = stage.at !== "open" && (stage.at !== "over" || seats.length > 0);
  if (seats.length !== (started ? CHAIRS : 0)) bad("the seats");
  if (stage.at === "open" && !stage.sat.some((m) => m.id === t.by)) bad("who opened it");
  unique(
    seats.map((seat) => (seat.who.is === "member" ? `member:${seat.who.id}` : `regular:${seat.who.figure}`)),
    "the seats",
  );
  unique(
    seats.flatMap((seat) => (seat.place === null ? [] : [seat.place])),
    "the places",
  );
  seatsAgree(t);
}

function read(v: unknown): Sitting {
  const r = record(v, "the sitting");
  if (r.game !== GAME || !READS.some((version) => version === r.v)) bad("the version");
  const pairs = list(r.pairs, CHAIRS / 2, "the pairs").map((p) => readTwo(p, "the pairs"));
  unique(pairs.flat(), "the pairs");
  const t: Sitting = {
    rng: whole(r.rng, 0, UINT, "the random stream"),
    era: r.v === SITTING_VERSION ? one(r.era, isEra, "the era") : LEGACY_ERA,
    by: text(r.by, 64, "who opened it"),
    room: whole(r.room, 0, 999, "the room"),
    stage: readStage(r.stage),
    seats: list(r.seats, CHAIRS, "the seats").map((seat) => readSeat(seat, r.v === 1)),
    pairs,
    odd: r.odd === null ? null : readTwo(r.odd, "the odd one out"),
    owed: list(r.owed, CHAIRS, "what is owed").map(readOwed),
  };
  unique(
    t.owed.map((o) => o.key),
    "what is owed",
  );
  agree(t);
  return t;
}

/** Whether the text Leaf stored is a sitting a newer Leaf wrote, beside this one in a deploy. */
export const sittingIsNewer = (stored: string): boolean => newerThan(stored, SITTING_VERSION);

/** A sitting from the text Leaf stored, or null for anything that is not one. */
export function decodeSitting(stored: string): Sitting | null {
  try {
    return read(JSON.parse(stored));
  } catch (err) {
    if (err instanceof Nonsense || err instanceof SyntaxError) return null;
    throw err;
  }
}
