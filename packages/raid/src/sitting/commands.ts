/**
 * What people do at a sitting: open one, sit, leave, start it, plan their own seat's room with the
 * run's own commands, take a figure from the carousel, say they are ready to fight, and say they
 * have watched their fight (or skipped it). The last three end the stage early once nobody in it has
 * anything left to do (`settle`). Each command is done at a moment of
 * Leaf's clock: the sitting is brought to that moment first (`advance`), Leaf's dice for the call
 * are stirred into the sitting's stream (and into the seat's run, for a command of the run's)
 * before anything is drawn, and the command is done or refused with a code and a sentence.
 */
import { mix } from "@sequoia-leaf/core";

import { act, isPlanning, type PlanningCommand, readRunCommand } from "../command.ts";
import { eraAt } from "../content/releases.ts";
import { isRecord, isWhole } from "../party.ts";
import { abandon, type Note } from "../run.ts";
import { cannotTake, take } from "./carousel.ts";
import { advance, begin, gone, settle } from "./clock.ts";
import {
  CHAIRS,
  CLOCK,
  marked,
  type Member,
  notNow,
  notPlanning,
  type Refusal,
  refuse,
  type Seat,
  seatsIn,
  type Sitting,
} from "./sitting.ts";

/** What Leaf tells a sitting about a call: its clock, its dice for the call, and who is calling. */
export interface Call {
  readonly now: number;
  /** A whole number from 0 up to 2^32 that nobody outside Leaf could have known (`Ctx.seed`). */
  readonly seed: number;
  readonly player: Member;
}

export type SittingCommand =
  /** Sit down at an open sitting. The eighth to sit starts it. */
  | { do: "sit" }
  /** Get up. Before the start the seat is free again; after it the seat is out, in the last place among those in. */
  | { do: "leave" }
  /** Start it, for whoever opened it: regulars take the empty seats. */
  | { do: "start" }
  /** Take the figure at a place in the carousel's ring. */
  | { do: "pick"; offer: number }
  /** Ready to fight (or, `on` false, not after all), while planning. */
  | { do: "ready"; on: boolean }
  /** Done with the room's fight: watched to its end, or skipped. */
  | { do: "watched" }
  /** The run's own planning commands, for the caller's seat; the rest of a run's are the clock's (its spec's `whose`). */
  | PlanningCommand;

type Did = { ok: true; notes: Note[] } | Refusal;
/** A command answered: the sitting after it and what happened in the caller's run, or the refusal and the sitting only brought to the moment. */
export type Answer = { ok: true; sitting: Sitting; notes: Note[] } | (Refusal & { sitting: Sitting });

const did: Did = { ok: true, notes: [] };
/** A member as a sitting keeps them: a name no longer than a party is signed with. */
const asMember = ({ id, name }: Member): Member => ({ id, name: name.slice(0, 80) });
const seatOf = (t: Sitting, id: string): Seat | undefined =>
  t.seats.find((seat) => seat.who.is === "member" && seat.who.id === id);

/** A new sitting, open, with whoever opened it sat down. Nobody starting it, it closes by itself. */
export function openSitting(call: Call): Sitting {
  return {
    rng: mix(call.seed >>> 0, 0x5171),
    era: eraAt(call.now),
    by: call.player.id,
    room: 0,
    stage: { at: "open", until: call.now + CLOCK.open, sat: [asMember(call.player)] },
    seats: [],
    pairs: [],
    odd: null,
    owed: [],
  };
}

function sit(t: Sitting, { player, now }: Call): Did {
  const { stage } = t;
  if (stage.at !== "open") return refuse(stage.at === "over" ? "table_over" : "not_open");
  if (stage.sat.some((m) => m.id === player.id)) return refuse("seated");
  stage.sat.push(asMember(player));
  if (stage.sat.length >= CHAIRS) begin(t, stage.sat, now);
  return did;
}

function start(t: Sitting, { player, now }: Call): Did {
  const { stage } = t;
  if (stage.at !== "open") return refuse(stage.at === "over" ? "table_over" : "not_open");
  if (player.id !== t.by) return refuse("not_opener");
  begin(t, stage.sat, now);
  return did;
}

/**
 * Getting up. Before the start: the seat is free again, the next to have sat may start it, and with
 * nobody left the sitting is over. After it: the seat is out as at 0 resolve, in the last place
 * among those in; and with no member left in, the regulars wait for nothing more.
 */
function leave(t: Sitting, { player, now }: Call): Did {
  const { stage } = t;
  if (stage.at === "over") return refuse("table_over");
  if (stage.at === "open") {
    const at = stage.sat.findIndex((m) => m.id === player.id);
    if (at < 0) return refuse("not_seated");
    stage.sat.splice(at, 1);
    const next = stage.sat[0];
    if (!next) t.stage = { at: "over", ended: now };
    else if (t.by === player.id) t.by = next.id;
    return did;
  }
  const seat = seatOf(t, player.id);
  if (!seat) return refuse("not_seated");
  if (seat.place !== null) return refuse("out");
  seat.place = seatsIn(t).length;
  abandon(seat.run);
  if (!gone(t, [seat], now)) settle(t, now);
  return did;
}

/** The caller's seat at a started sitting, still in; or why not. */
function seatIn(t: Sitting, id: string): number | Refusal {
  const at = t.seats.findIndex((s) => s.who.is === "member" && s.who.id === id);
  if (at < 0) return refuse("not_seated");
  return t.seats[at]?.place === null ? at : refuse("out");
}

function pickOffer(t: Sitting, offer: number, { player, now }: Call): Did {
  const { stage } = t;
  if (stage.at !== "carousel") return refuse(notNow(stage.at, "pick") ?? "no_carousel");
  const seat = seatIn(t, player.id);
  if (typeof seat !== "number") return seat;
  const cannot = cannotTake(stage, seat, offer);
  if (cannot) return refuse(cannot);
  const notes = take(t, stage, seat, offer);
  settle(t, now);
  return { ok: true, notes };
}

/** Ready to fight, or not after all: when every member still in is, planning ends at that moment. */
function ready(t: Sitting, on: boolean, { player, now }: Call): Did {
  const { stage } = t;
  if (stage.at !== "plan") return refuse(notNow(stage.at, "ready") ?? "carousel");
  const seat = seatIn(t, player.id);
  if (typeof seat !== "number") return seat;
  stage.ready = marked(stage.ready, seat, on);
  settle(t, now);
  return did;
}

/** Done with the room's fight: when every member still in is, the fights end at that moment. */
function watchedFight(t: Sitting, { player, now }: Call): Did {
  const { stage } = t;
  if (stage.at !== "fight") return refuse(notNow(stage.at, "watched") ?? "no_fight");
  const seat = seatIn(t, player.id);
  if (typeof seat !== "number") return seat;
  stage.done = marked(stage.done, seat, true);
  settle(t, now);
  return did;
}

/** One of the run's own commands, done to the caller's seat by the code Leaf's solo table uses. A seat that is out is refused by its run, which is over. */
function plan(t: Sitting, c: PlanningCommand, { player, seed }: Call): Did {
  const stop = notPlanning(t.stage.at);
  if (stop) return refuse(stop);
  const seat = seatOf(t, player.id);
  if (!seat) return refuse("not_seated");
  seat.run.rng = mix(seat.run.rng, seed);
  // A seat plans in the sitting's era: the one its room was laid out in.
  seat.run.era = t.era;
  return act(seat.run, c);
}

// ---------- the sitting's own commands ----------

/** One of the sitting's own commands, said once: how it is read off the wire, and what it does at a moment. */
interface SeatSpec<C extends SittingCommand> {
  readonly read: (v: Record<string, unknown>) => C | null;
  readonly run: (t: Sitting, c: C, call: Call) => Did;
}
type SeatDo = Exclude<SittingCommand, PlanningCommand>["do"];
type SeatCommandOf<D extends SeatDo> = Extract<SittingCommand, { do: D }>;

const SEAT: { readonly [D in SeatDo]: SeatSpec<SeatCommandOf<D>> } = {
  sit: { read: () => ({ do: "sit" }), run: (t, _, call) => sit(t, call) },
  leave: { read: () => ({ do: "leave" }), run: (t, _, call) => leave(t, call) },
  start: { read: () => ({ do: "start" }), run: (t, _, call) => start(t, call) },
  pick: {
    read: (v) => (isWhole(v.offer, 0, 63) ? { do: "pick", offer: v.offer } : null),
    run: (t, c, call) => pickOffer(t, c.offer, call),
  },
  ready: {
    read: (v) => (typeof v.on === "boolean" ? { do: "ready", on: v.on } : null),
    run: (t, c, call) => ready(t, c.on, call),
  },
  watched: { read: () => ({ do: "watched" }), run: (t, _, call) => watchedFight(t, call) },
};
const seatSpec = <D extends SeatDo>(name: D): SeatSpec<SeatCommandOf<D>> => SEAT[name];
const isSeatDo = (name: unknown): name is SeatDo => typeof name === "string" && Object.hasOwn(SEAT, name);

/** A command off the wire, or null: the sitting's own, or one of the run's a member plans with. */
export function readCommand(v: unknown): SittingCommand | null {
  if (!isRecord(v)) return null;
  if (isSeatDo(v.do)) return seatSpec(v.do).read(v);
  const c = readRunCommand(v);
  return c && isPlanning(c) ? c : null;
}

const carryOut = (t: Sitting, c: SittingCommand, call: Call): Did =>
  isPlanning(c) ? plan(t, c, call) : seatSpec(c.do).run(t, c, call);

/**
 * Does a command at a moment. The sitting given is not changed. Done, the answer's sitting is the
 * one to keep; refused, it is the sitting brought to the moment and nothing more.
 */
export function command(t: Sitting, c: SittingCommand, call: Call): Answer {
  const brought = advance(t, call.now);
  const next = structuredClone(brought);
  next.rng = mix(next.rng, call.seed);
  const done = carryOut(next, c, call);
  return done.ok ? { ok: true, sitting: advance(next, call.now), notes: done.notes } : { ...done, sitting: brought };
}

/** A sitting with some of what it owed paid: Leaf says which keys, once it has paid them. */
export const paidOff = (t: Sitting, keys: readonly string[]): Sitting => ({
  ...t,
  owed: t.owed.filter((o) => !keys.includes(o.key)),
});
