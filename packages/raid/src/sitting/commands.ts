/**
 * What people do at a sitting: open one, sit, leave, start it, plan their own seat's room with the
 * run's own commands, and take a figure from the carousel. Each command is done at a moment of
 * Leaf's clock: the sitting is brought to that moment first (`advance`), Leaf's dice for the call
 * are stirred into the sitting's stream (and into the seat's run, for a command of the run's)
 * before anything is drawn, and the command is done or refused with a code and a sentence.
 */
import { mix } from "@sequoia-leaf/core";

import { readCommand as readRunCommand, type RunCommand } from "../command.ts";
import { act } from "../game.ts";
import { abandon, type Note } from "../run.ts";
import { hasTaken, take } from "./carousel.ts";
import { advance, begin, gone } from "./clock.ts";
import {
  CHAIRS,
  CLOCK,
  type Member,
  notPlanning,
  type Refusal,
  refuse,
  type Seat,
  seatsIn,
  type Sitting,
  watched,
} from "./sitting.ts";

/** What Leaf tells a sitting about a call: its clock, its dice for the call, and who is calling. */
export interface Call {
  readonly now: number;
  /** A whole number from 0 up to 2^32 that nobody outside Leaf could have known (`Ctx.seed`). */
  readonly seed: number;
  readonly player: Member;
}

/** The run's own commands a seat plans with. Setting out, the fight, the takings and walking home are the sitting's, on the clock. */
const SEAT_DOES = ["choose", "redraw", "buy", "sell", "move", "bench", "rustle", "hold", "xp", "give"] as const;
export type SeatCommand = Extract<RunCommand, { do: (typeof SEAT_DOES)[number] }>;
export const isSeatCommand = (c: { do: string }): c is SeatCommand => SEAT_DOES.some((name) => name === c.do);

export type SittingCommand =
  /** Sit down at an open sitting. The eighth to sit starts it. */
  | { do: "sit" }
  /** Get up. Before the start the seat is free again; after it the seat is out, in the last place among those in. */
  | { do: "leave" }
  /** Start it, for whoever opened it: regulars take the empty seats. */
  | { do: "start" }
  /** Take the figure at a place in the carousel's ring. */
  | { do: "pick"; offer: number }
  | SeatCommand;

/** A command off the wire, or null. */
export function readCommand(v: unknown): SittingCommand | null {
  if (typeof v === "object" && v !== null && "do" in v) {
    if (v.do === "sit" || v.do === "leave" || v.do === "start") return { do: v.do };
    if (v.do === "pick") {
      const offer = "offer" in v ? v.offer : null;
      return typeof offer === "number" && Number.isInteger(offer) && offer >= 0 && offer < 64
        ? { do: "pick", offer }
        : null;
    }
  }
  const c = readRunCommand(v);
  return c && isSeatCommand(c) ? c : null;
}

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
  if (!gone(t, [seat], now) && !watched(t)) stage.until = now;
  return did;
}

function pickOffer(t: Sitting, offer: number, { player }: Call): Did {
  const { stage } = t;
  if (stage.at !== "carousel") return refuse(stage.at === "over" ? "table_over" : "no_carousel");
  const seat = t.seats.findIndex((s) => s.who.is === "member" && s.who.id === player.id);
  if (seat < 0) return refuse("not_seated");
  if (t.seats[seat]?.place !== null) return refuse("out");
  const turn = stage.turns.indexOf(seat);
  if (turn < 0 || turn >= stage.open) return refuse("not_your_turn");
  if (hasTaken(stage, seat)) return refuse("picked");
  const wanted = stage.ring[offer];
  if (!wanted) return refuse("not_in_ring");
  if (wanted.by !== null) return refuse("taken");
  return { ok: true, notes: take(t, stage, seat, offer) };
}

/** One of the run's own commands, done to the caller's seat by the code Leaf's solo table uses. A seat that is out is refused by its run, which is over. */
function plan(t: Sitting, c: SeatCommand, { player, seed }: Call): Did {
  const stop = notPlanning(t.stage.at);
  if (stop) return refuse(stop);
  const seat = seatOf(t, player.id);
  if (!seat) return refuse("not_seated");
  seat.run.rng = mix(seat.run.rng, seed);
  return act(seat.run, c, undefined);
}

function carryOut(t: Sitting, c: SittingCommand, call: Call): Did {
  if (isSeatCommand(c)) return plan(t, c, call);
  switch (c.do) {
    case "sit":
      return sit(t, call);
    case "leave":
      return leave(t, call);
    case "start":
      return start(t, call);
    case "pick":
      return pickOffer(t, c.offer, call);
  }
}

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
