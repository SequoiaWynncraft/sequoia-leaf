/**
 * Bringing a sitting to a moment. Everything that happens by itself at a sitting happens at a
 * deadline (`stage.until`), and is worked out from the sitting alone: `advance` does every deadline
 * that has passed, in order, each at its own moment and never at the moment asked for. So a sitting
 * brought to a moment in one call, or through any moments on the way, is the same sitting. Nothing
 * here reads a clock, and every draw comes from the sitting's stream or a seat's own.
 */
import { draw32, pick, shuffled } from "@sequoia-leaf/core";

import { fondOf, planRoom } from "../bot.ts";
import { available, type Catalog, catalogOf } from "../content/catalog.ts";
import { type FigureId, traitsOf } from "../content/figures.ts";
import { favourites } from "../content/reach.ts";
import { eraAt } from "../content/releases.ts";
import { BOSS_ROOMS, ROOM_COUNT } from "../content/rooms.ts";
import type { TraitId } from "../content/traits.ts";
import { resolveFight } from "../fight/engine.ts";
import type { FightSetup } from "../fight/types.ts";
import { opposition } from "../foe.ts";
import { COLS } from "../hex.ts";
import { payout } from "../outside.ts";
import type { Party } from "../party.ts";
import {
  choose,
  endingOf,
  fielded,
  foughtOf,
  move,
  picksOf,
  type Run,
  startRun,
  summariseRun,
  takeTakings,
} from "../run.ts";
import { onTrail } from "../way.ts";
import { layCarousel, turnCarousel } from "./carousel.ts";
import {
  CAROUSELS,
  CHAIRS,
  CLOCK,
  kindOf,
  later,
  type Member,
  planMs,
  type Seat,
  seatsIn,
  sided,
  signed,
  type Sitting,
  STEP_MS,
  TRAIL,
  waitingOn,
  watched,
  type Who,
} from "./sitting.ts";

// ---------- starting, and a room laid out ----------

/**
 * Starts a sitting at a moment: the members who sat take the first seats in the order they sat,
 * regulars the rest (each one of the raid's figures, no two alike, fond of one of its own traits),
 * every seat gets a run of its own, and the first carousel is laid out.
 */
/** The traits a regular may be fond of: its own the set reaches by figures, or all its own if none is. */
function fondOfAny(cat: Catalog, figure: FigureId): readonly TraitId[] {
  const mine = favourites(cat, traitsOf(cat, figure));
  return mine.length > 0 ? mine : traitsOf(cat, figure);
}
export function begin(t: Sitting, sat: readonly Member[], at: number): void {
  t.era = eraAt(at);
  const regulars = shuffled(t, available(catalogOf(t), { for: "regular" })).slice(0, CHAIRS - sat.length);
  const whos: Who[] = [
    ...sat.map((member): Who => ({ is: "member", id: member.id, name: member.name })),
    // Fond of one of its traits the set reaches by figures (`favourites`), as a sparring room's regular is.
    ...regulars.map((figure): Who => ({ is: "regular", figure, habit: pick(t, fondOfAny(catalogOf(t), figure)) })),
  ];
  t.seats = whos.map((who) => {
    const run = startRun(draw32(t), { era: t.era, way: onTrail(TRAIL) });
    return { who, run, shown: signed({ who, run }), place: null };
  });
  t.room = 0;
  const first = CAROUSELS[0];
  if (first) layCarousel(t, at, first);
  else layRoom(t, at);
}

/** Every way of pairing some seats off, the lowest of a pair first: with an odd number, each of them in turn is the odd one out. */
export function pairings(seats: readonly number[]): { pairs: [number, number][]; odd: number | null }[] {
  const [first, ...rest] = seats;
  if (first === undefined) return [{ pairs: [], odd: null }];
  if (seats.length % 2 === 1) {
    return seats.flatMap((odd) => pairings(seats.filter((s) => s !== odd)).map((p) => ({ pairs: p.pairs, odd })));
  }
  return rest.flatMap((other) =>
    pairings(rest.filter((s) => s !== other)).map((p) => {
      const pairs: [number, number][] = [[first, other], ...p.pairs];
      return { pairs, odd: null };
    }),
  );
}

/**
 * Pairs those still in off for a sparring room, by the dice, with no pair of the last sparring room
 * among them while such a pairing exists. The odd one out fights a copy of another's board, by the dice.
 */
function pairOff(t: Sitting): void {
  const here = t.seats.flatMap((seat, i) => (seat.place === null ? [i] : []));
  const all = pairings(here);
  const again = (pairs: [number, number][]): boolean =>
    pairs.some(([a, b]) => t.pairs.some(([c, d]) => a === c && b === d));
  const fresh = all.filter((p) => !again(p.pairs));
  const { pairs, odd } = pick(t, fresh.length > 0 ? fresh : all);
  t.pairs = pairs;
  t.odd =
    odd === null
      ? null
      : [
          odd,
          pick(
            t,
            here.filter((s) => s !== odd),
          ),
        ];
}

/**
 * Lays the room out for planning: a sparring room's pairs are drawn, and each seat is shown the
 * board its opponent last locked; in the forest's rooms everyone meets the same plan of the room.
 */
export function layRoom(t: Sitting, at: number): void {
  if (kindOf(t.room) === "spar") {
    pairOff(t);
    const meet = (seat: number, other: number): void => {
      const [here, there] = [t.seats[seat], t.seats[other]];
      if (here && there) here.run.foe = structuredClone(there.shown);
    };
    for (const [home, away] of t.pairs) {
      meet(home, away);
      meet(away, home);
    }
    if (t.odd) meet(t.odd[0], t.odd[1]);
  } else {
    const forest = opposition(catalogOf(t), draw32(t), t.room, TRAIL);
    for (const { run } of seatsIn(t)) run.foe = structuredClone(forest);
  }
  t.stage = { at: "plan", until: later(t, at, planMs(t.room)), ready: [] };
}

// ---------- the lock ----------

/** A run made ready to fight: a pick still waiting takes its first option, and with nobody on the board the first on the bench steps up. */
function ready(run: Run): void {
  for (let n = picksOf(run).length; n > 0; n--) choose(run, 0);
  const slot = run.bench.findIndex((p) => p !== null);
  if (fielded(run) === 0) move(run, { on: "bench", at: slot }, { on: "board", at: Math.floor(COLS / 2) });
}

/**
 * One fight, decided: a seat's board against a party, from a seed of the sitting's. It is written
 * into the seat's run as the fight it is fighting, and for a pair into the away seat's run too, the
 * same setup, with how it came out for that side. Gives back how many steps it lasted.
 */
function fight(t: Sitting, home: Seat, across: Party, away: Seat | null): number {
  const setup: FightSetup = {
    seed: draw32(t),
    era: t.era,
    sides: [structuredClone(home.shown), structuredClone(across)],
  };
  const outcome = resolveFight(setup);
  home.run.stage = { phase: "fight", fight: { setup, outcome } };
  if (away) away.run.stage = { phase: "fight", fight: { setup: structuredClone(setup), outcome: sided(outcome, 1) } };
  return outcome.ticks;
}

/** The fights of a sparring room: each pair's one fight; and alone against the other's last board, the odd one out and anyone whose opponent has left. */
function spar(t: Sitting): number {
  let longest = 0;
  const bout = (a: number, b: number, both: boolean): void => {
    const [home, away] = [t.seats[a], t.seats[b]];
    if (!home || !away || home.place !== null) return;
    longest = Math.max(longest, fight(t, home, away.shown, both && away.place === null ? away : null));
  };
  for (const [home, away] of t.pairs) {
    if (t.seats[home]?.place === null) bout(home, away, true);
    else bout(away, home, false);
  }
  if (t.odd) bout(t.odd[0], t.odd[1], false);
  return longest;
}

/**
 * The lock, when planning ends: the regulars plan, as the bot does; every board is locked as it
 * stands and becomes what the seat shows; the room's fights are decided; and the sitting waits for
 * the longest of them, and a little more.
 */
function lock(t: Sitting, at: number): void {
  const here = seatsIn(t);
  for (const seat of here) {
    if (seat.who.is === "regular") planRoom(seat.run, fondOf(seat.who.habit));
    ready(seat.run);
    seat.shown = signed(seat);
  }
  const longest =
    kindOf(t.room) === "spar" ? spar(t) : Math.max(0, ...here.map((seat) => fight(t, seat, seat.run.foe, null)));
  t.stage = { at: "fight", until: later(t, at, longest * STEP_MS + CLOCK.after), done: [] };
}

// ---------- the takings ----------

/** A member's seat that is out or has finished is owed its run's payout, once. */
function owe(t: Sitting, seat: Seat): void {
  const coins = payout(summariseRun(seat.run)).coins;
  if (seat.who.is === "member" && coins > 0) {
    t.owed.push({ key: `seat:${t.seats.indexOf(seat)}`, member: seat.who.id, coins });
  }
}

/**
 * After seats have gone out (each with its place): with one seat left in, or none, the sitting is
 * over at that moment, the last one in is first, and whoever is first has won their raid. Those who
 * went out, and at the end the winner, are owed. Says whether it is over.
 */
export function gone(t: Sitting, out: readonly Seat[], at: number): boolean {
  const left = seatsIn(t);
  if (left.length > 1) {
    for (const seat of out) owe(t, seat);
    return false;
  }
  for (const seat of left) seat.place = 1;
  const first = t.seats.find((seat) => seat.place === 1);
  if (first) first.run.stage = { phase: "over", ending: "won" };
  for (const seat of [...out, ...left]) owe(t, seat);
  t.stage = { at: "over", ended: at };
  return true;
}

/**
 * A room past the fifteenth is a sparring room whatever the run takes it for: it is recorded as
 * one, it leaves no component to pick, and not winning it costs `cost` resolve more.
 */
function pastTheLast(run: Run, cost: number): void {
  const fought = run.record.at(-1);
  if (fought) fought.kind = "spar";
  if (run.stage.phase !== "plan") return;
  run.stage.picks = run.stage.picks.filter((c) => c.kind !== "component");
  run.resolve = Math.max(0, run.resolve - cost);
  if (run.resolve === 0) run.stage = { phase: "over", ending: "lost" };
}

/**
 * The takings, when the fights have been watched: every seat's run is paid by the run's own rules
 * and moves on; whoever is at 0 resolve is out, placed below everyone still in, and among those out
 * in the same room by the resolve they had before it, then by seat. Then the next room, or after
 * each of the first two bosses a carousel first.
 */
function takings(t: Sitting, at: number): void {
  const here = seatsIn(t);
  const before = new Map(here.map((seat) => [seat, seat.run.resolve]));
  const past = t.room - (ROOM_COUNT - 1);
  for (const { run } of here) {
    const won = foughtOf(run)?.outcome.result === "win";
    takeTakings(run, undefined, true);
    if (past > 0) pastTheLast(run, won ? 0 : past);
  }
  const out = here
    .filter((seat) => endingOf(seat.run) !== null)
    .toSorted((a, b) => (before.get(b) ?? 0) - (before.get(a) ?? 0) || t.seats.indexOf(a) - t.seats.indexOf(b));
  const left = here.length - out.length;
  out.forEach((seat, i) => {
    seat.place = left + 1 + i;
  });
  if (gone(t, out, at)) return;
  const boss = BOSS_ROOMS.indexOf(t.room);
  const ring = boss < 0 ? undefined : CAROUSELS[boss + 1];
  t.room += 1;
  if (ring) layCarousel(t, at, ring);
  else layRoom(t, at);
}

// ---------- to a moment ----------

/**
 * A stage nobody in it has anything left to do in ends at this moment: its deadline is brought
 * forward to `now` and kept, so that `advance` does it at its own moment, as it does any deadline.
 * With no member still in, nothing waits at all. The deadline set when the stage began stays the
 * most it can last.
 */
export function settle(t: Sitting, now: number): void {
  const { stage } = t;
  if (stage.at === "open" || stage.at === "over") return;
  if (watched(t) && waitingOn(t).length > 0) return;
  stage.until = Math.min(stage.until, now);
}

const due = (t: Sitting, now: number): boolean => t.stage.at !== "over" && t.stage.until <= now;

/** A sitting moves into the era of a moment: the stage it lays out then, and every seat's run, draw from it. */
function enter(t: Sitting, at: number): void {
  t.era = eraAt(at);
  for (const { run } of t.seats) run.era = t.era;
}

/**
 * Does the deadline a sitting stands at, at its own moment. A stage draws in the era it began in,
 * to its end: a carousel's last turns, and at the lock the regulars' planning, are in the era the
 * members planned in. What the deadline lays out next (the room, the takings' stall, a carousel) is
 * in the deadline's era.
 */
function step(t: Sitting): void {
  const { stage } = t;
  switch (stage.at) {
    case "open":
      t.stage = { at: "over", ended: stage.until };
      return;
    case "carousel":
      if (!turnCarousel(t, stage)) return;
      enter(t, stage.until);
      return layRoom(t, stage.until);
    case "plan":
      lock(t, stage.until);
      return enter(t, stage.until);
    case "fight":
      enter(t, stage.until);
      return takings(t, stage.until);
    case "over":
      return;
  }
}

/**
 * A sitting brought to a moment: every deadline that has passed is done, in order, and nothing
 * else. The sitting given is not changed, and is given back as it is when nothing was due.
 */
export function advance(t: Sitting, now: number): Sitting {
  if (!due(t, now)) return t;
  const next = structuredClone(t);
  while (due(next, now)) step(next);
  return next;
}
