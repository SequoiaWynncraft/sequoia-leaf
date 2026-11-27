import { describe, expect, test } from "bun:test";

import { below, draw32, mix, type Stream } from "@sequoia-leaf/core";

import { planRoom, SENSIBLE } from "../bot.ts";
import { COMMANDS } from "../command.ts";
import { type FigureId, figureIn } from "../content/figures.ts";
import { PAYOUT } from "../content/keepsakes.ts";
import { LEGACY_ERA } from "../content/releases.ts";
import { BOSS_ROOMS, ECONOMY, ROOM_COUNT } from "../content/rooms.ts";
import { resolveFight } from "../fight/engine.ts";
import type { FightSummary } from "../fight/types.ts";
import { planCommands, runView } from "../game.ts";
import { payout } from "../outside.ts";
import { countOn, kindsOn, rackSize } from "../racks.ts";
import {
  abandon,
  choose,
  endingOf,
  fielded,
  foughtOf,
  picksOf,
  pieces,
  playsAsKept,
  type RoomRecord,
  type Run,
  startRun,
  summariseRun,
} from "../run.ts";
import { CAT, EVERYONES, viewWith } from "../testkit.ts";
import { join } from "./carousel.ts";
import { advance, pairings } from "./clock.ts";
import { type Answer, type Call, command, openSitting, paidOff, readCommand, type SittingCommand } from "./commands.ts";
import { decodeSitting, encodeSitting, SITTING_VERSION } from "./keep.ts";
import {
  CHAIRS,
  CLOCK,
  facing,
  kindOf,
  type Member,
  planMs,
  type Seat,
  seatsIn,
  sided,
  sideOf,
  signed,
  type Sitting,
  waitingOn,
} from "./sitting.ts";
import { predict, sittingView } from "./view.ts";

// ---------- a sitting to test with ----------

const HANDLES = ["Mossback", "Sootpaw", "Embertoe", "Quillfeather", "Fernwhistle", "Wrenly", "Pipwick", "Tindra"];
const member = (n: number): Member => ({ id: `leaf-${n}`, name: HANDLES[n] ?? `Guest ${n}` });
const call = (now: number, seed: number, n = 0): Call => ({ now, seed, player: member(n) });
/** The moment the sittings here start, and one long after any of them is over. */
const START = 10_000;
const FAR = START + 3 * 60 * 60_000;

function must(answer: Answer): Sitting {
  if (!answer.ok) throw new Error(`${answer.code}: ${answer.why}`);
  return answer.sitting;
}
const codeOf = (answer: Answer): string => (answer.ok ? "ok" : answer.code);
const seat = (t: Sitting, n: number): Seat => {
  const found = t.seats[n];
  if (!found) throw new Error(`no seat ${n}`);
  return found;
};
/** The moment the stage a sitting stands at ends. */
const deadline = (t: Sitting): number => (t.stage.at === "over" ? t.stage.ended : t.stage.until);

/** A sitting started with this many members in its first seats, and regulars in the rest; with none, eight regulars. */
function started(seed: number, members: number): Sitting {
  let t = openSitting(call(0, seed));
  if (members === 0 && t.stage.at === "open") t.stage.sat = [];
  for (let n = 1; n < members; n++) t = must(command(t, { do: "sit" }, call(n, seed + n, n)));
  return members === CHAIRS ? t : must(command(t, { do: "start" }, call(START, seed * 31)));
}
/** A sitting brought on, deadline by deadline, until it is where a test wants it; with `plans`, its members planning each room as the bot does. */
function until(t: Sitting, there: (t: Sitting) => boolean, plans = false): Sitting {
  let now = t;
  for (let guard = 0; guard < 400 && !there(now); guard++) {
    if (now.stage.at === "over") throw new Error("the sitting ended first");
    if (plans) now = planned(now);
    now = advance(now, deadline(now));
  }
  return now;
}
const planning = (room: number) => (t: Sitting) => t.stage.at === "plan" && t.room === room;
const fighting = (room: number) => (t: Sitting) => t.stage.at === "fight" && t.room === room;

/** A sitting whose members in have each planned the room as the bot does, as if by their own commands. */
function planned(t: Sitting): Sitting {
  if (t.stage.at !== "plan") return t;
  const next = structuredClone(t);
  for (const { who, run } of seatsIn(next)) if (who.is === "member") planRoom(run, SENSIBLE);
  return next;
}
/** A whole sitting of eight members who plan as the bot does: every stage it stood at, in order, the last one over. */
function wholeSitting(seed: number): Sitting[] {
  const stages = [started(seed, CHAIRS)];
  for (let guard = 0; guard < 600; guard++) {
    const now = planned(stages.at(-1) ?? started(seed, CHAIRS));
    if (now.stage.at === "over") break;
    stages[stages.length - 1] = now;
    stages.push(advance(now, deadline(now)));
  }
  return stages;
}
const SITTINGS = [11, 12, 13].map(wholeSitting);
/** Each stage of those sittings with the one its deadline makes, before anybody plans in it. */
const STEPS = SITTINGS.flatMap((stages) =>
  stages.slice(0, -1).map((before): [Sitting, Sitting] => [before, advance(before, deadline(before))]),
);

/** What not winning a fight costs by the run's rule, and for a room past the fifteenth what the sitting adds. */
function costOf(run: Run, outcome: FightSummary, room: number): number {
  if (outcome.result === "win") return 0;
  const standing = outcome.result === "draw" ? 0 : outcome.standing[1];
  const less = run.boons.includes("blanket") ? 1 : 0;
  return (
    Math.max(1, Math.min(ECONOMY.lossMost, ECONOMY.lossBase + standing) - less) + Math.max(0, room - (ROOM_COUNT - 1))
  );
}

/** Brought to the end through the moments `step` gives. */
function through(t: Sitting, step: (now: number) => number): Sitting {
  let at = t;
  for (let now = START; now < FAR && at.stage.at !== "over"; now = step(now)) at = advance(at, now);
  return advance(at, FAR);
}

interface Sent {
  now: number;
  seed: number;
  who: number;
  c: SittingCommand;
}
/** What a member would send at a moment: a figure from the ring, the bot's plan for the room, and now and then something refused. */
function wishes(seen: Sitting, who: number, members: number, dice: Stream): SittingCommand[] {
  const mine = seat(seen, who);
  if (mine.place !== null) return below(dice, 9) === 0 ? [{ do: "buy", offer: 0 }] : [];
  if (who === members - 1 && seen.room >= 3) return [{ do: "leave" }];
  if (seen.stage.at === "carousel") return [{ do: "pick", offer: below(dice, seen.stage.ring.length) }];
  if (seen.stage.at === "fight") return [below(dice, 5) === 0 ? { do: "rustle" } : { do: "watched", room: seen.room }];
  const view = viewWith(runView(mine.run));
  const plan = planCommands(view, SENSIBLE).flatMap((c) => readCommand(c) ?? []);
  // Ready when done planning, now and then not after all.
  const ready: SittingCommand = { do: "ready", on: below(dice, 4) > 0, room: seen.room };
  return below(dice, 6) === 0 ? [...plan, { do: "rustle" }] : [...plan, ready];
}
/** A sitting played by its members' commands, each at a moment: what was sent, how each was answered, and the end. */
function played(seed: number, members: number): { sent: Sent[]; codes: string[]; end: Sitting } {
  let t = started(seed, members);
  const dice: Stream = { rng: mix(seed, 77) };
  const sent: Sent[] = [];
  const codes: string[] = [];
  for (let now = START + 500; now < FAR; now += 700 + below(dice, 6000)) {
    // Only looked at: the sitting itself moves on by the commands alone, over many deadlines at once.
    const seen = advance(t, now);
    if (seen.stage.at === "over") break;
    for (let who = 0; who < members; who++) {
      for (const c of wishes(seen, who, members, dice)) {
        const entry = { now, seed: draw32(dice), who, c };
        const answer = command(t, c, call(now, entry.seed, who));
        sent.push(entry);
        codes.push(codeOf(answer));
        t = answer.sitting;
      }
    }
  }
  return { sent, codes, end: advance(t, FAR) };
}
/** The same commands at the same moments, the sitting brought on through the moments `step` gives between them. */
function again(seed: number, members: number, sent: Sent[], step: (now: number) => number): [string[], Sitting] {
  let t = started(seed, members);
  let now = START;
  const codes = sent.map((entry) => {
    for (now = step(now); now < entry.now; now = step(now)) t = advance(t, now);
    now = entry.now;
    const answer = command(t, entry.c, call(entry.now, entry.seed, entry.who));
    t = answer.sitting;
    return codeOf(answer);
  });
  return [codes, advance(t, FAR)];
}
const places = (t: Sitting): number[] => t.seats.map((s) => s.place ?? 0).toSorted((a, b) => a - b);
/** For a value a test needs there: its absence fails the test. */
const bad = (): never => {
  throw new Error("missing");
};

// ---------- to a moment ----------

describe("bringing a sitting to a moment", () => {
  test("in one call, second by second, and in random steps, it is the same sitting", () => {
    for (const [seed, members] of [
      [1, 8],
      [2, 8],
      [3, 4],
      [4, 2],
      [5, 1],
      [6, 0],
    ] as const) {
      const t = started(seed, members);
      const once = advance(t, FAR);
      const dice: Stream = { rng: seed };
      expect(once.stage.at).toBe("over");
      expect(encodeSitting(through(t, (now) => now + 1000))).toBe(encodeSitting(once));
      expect(encodeSitting(through(t, (now) => now + 1 + below(dice, 40_000)))).toBe(encodeSitting(once));
    }
  });

  test("it does nothing before a deadline, and leaves the sitting given as it was", () => {
    const t = started(7, 2);
    const kept = encodeSitting(t);
    expect(advance(t, deadline(t) - 1)).toBe(t);
    // At it the members' time is up, and the regulars are let in.
    expect(advance(t, deadline(t)).stage).toMatchObject({ at: "carousel", open: CHAIRS });
    expect(encodeSitting(t)).toBe(kept);
  });

  test("and the same with commands done at the same moments", () => {
    for (const [seed, members] of [
      [21, 3],
      [22, 2],
      [23, 5],
    ] as const) {
      const { sent, codes, end } = played(seed, members);
      const dice: Stream = { rng: seed };
      expect(end.stage.at).toBe("over");
      // The members played: they bought, picked, said they were ready and had watched, were refused, and one left.
      expect(codes.filter((code) => code === "ok").length).toBeGreaterThan(40);
      expect(new Set(codes).size).toBeGreaterThan(2);
      expect(sent.some((entry) => entry.c.do === "leave")).toBe(true);
      for (const move of ["pick", "ready", "watched"])
        expect(sent.some((entry, i) => entry.c.do === move && codes[i] === "ok")).toBe(true);
      const bySeconds = again(seed, members, sent, (now) => now + 1000);
      const byChance = again(seed, members, sent, (now) => now + 1 + below(dice, 30_000));
      for (const [theirCodes, theirEnd] of [bySeconds, byChance]) {
        expect(theirCodes).toEqual(codes);
        expect(encodeSitting(theirEnd)).toBe(encodeSitting(end));
      }
    }
  }, 60_000);
});

// ---------- the end ----------

/** A room as a run's record keeps it. */
const roomFought = (room: number, kind: RoomRecord["kind"], result: RoomRecord["result"]): RoomRecord => ({
  room,
  kind,
  result,
  standing: [1, 0],
  boss: null,
});

describe("how a sitting ends", () => {
  test("every sitting of regulars ends, with one winner and every place given once", () => {
    for (let seed = 100; seed < 130; seed++) {
      const t = started(seed, 0);
      expect(t.stage).toEqual({ at: "over", ended: START });
      expect(places(t)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      const won = t.seats.filter((s) => endingOf(s.run) === "won");
      expect(won.map((s) => s.place)).toEqual([1]);
      expect(t.room).toBeLessThan(40);
      expect(t.owed).toEqual([]);
    }
  }, 60_000);

  test("so does one of members, who do nothing or who plan", () => {
    for (const t of [advance(started(31, 8), FAR), advance(started(32, 3), FAR), ...SITTINGS.map((s) => s.at(-1))]) {
      expect(t?.stage.at).toBe("over");
      expect(t ? places(t) : []).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(t?.seats.filter((s) => endingOf(s.run) === "won").map((s) => s.place)).toEqual([1]);
    }
  });

  test("who goes out in the same room is placed by the resolve they had before it, then by seat, below everyone still in", () => {
    let together = 0;
    for (const [before, after] of STEPS) {
      // Out is at 0 resolve: the one seat left in when the sitting ends is placed first, and is not out.
      const out = before.seats.flatMap((s, i) =>
        s.place === null && seat(after, i).place !== null && seat(after, i).run.resolve === 0 ? [i] : [],
      );
      if (before.stage.at !== "fight" || out.length === 0) continue;
      const order = out.toSorted((a, b) => seat(before, b).run.resolve - seat(before, a).run.resolve || a - b);
      const placed = order.map((i) => seat(after, i).place);
      // Those out fill the places below everyone in before the room who is not: all of them, if nobody is.
      const first = seatsIn(before).length - out.length + 1;
      expect(placed).toEqual(order.map((_, i) => first + i));
      if (out.length > 1) together++;
    }
    expect(together).toBeGreaterThan(0);
  });

  test("a room past the fifteenth is a sparring room that costs 1 resolve more than the last", () => {
    const past = STEPS.filter(([before]) => before.stage.at === "fight" && before.room >= ROOM_COUNT);
    expect(past.length).toBeGreaterThan(0);
    for (const [before, after] of past) {
      expect(kindOf(before.room)).toBe("spar");
      for (const s of seatsIn(after)) expect(picksOf(s.run)).toEqual([]);
      for (const s of after.seats) if (s.run.record.length > ROOM_COUNT) expect(s.run.record.at(-1)?.kind).toBe("spar");
    }
    // A room won past the fifteenth clears nothing: the last room lost and then a win after it is not the last room cleared.
    const { run } = seat(started(5, 0), 0);
    run.record = [
      roomFought(ROOM_COUNT - 2, "spar", "win"),
      roomFought(ROOM_COUNT - 1, "boss", "loss"),
      roomFought(ROOM_COUNT - 1, "spar", "win"),
    ];
    expect(summariseRun(run).cleared).toBe(1);
    // Every room's cost, the fifteen and those after: the run's rule, and 1 more for each room past the last.
    for (const [before, after] of STEPS.filter(([b]) => b.stage.at === "fight")) {
      before.seats.forEach((s, i) => {
        const fought = foughtOf(s.run);
        if (s.place !== null || !fought) return;
        const cost = costOf(s.run, fought.outcome, before.room);
        expect(seat(after, i).run.resolve).toBe(Math.max(0, s.run.resolve - cost));
      });
    }
  });

  test("every seat still in is in the sitting's room, by the run's own count", () => {
    for (const stages of SITTINGS) {
      for (const t of stages.filter((s) => s.stage.at === "plan")) {
        for (const s of seatsIn(t)) expect(s.run.room).toBe(Math.min(t.room, ROOM_COUNT - 1));
      }
    }
  });
});

// ---------- sparring ----------

describe("a sparring room", () => {
  test("a pair's fight is one fight: the same setup in both runs, and opposite results", () => {
    let pairs = 0;
    for (const stages of SITTINGS) {
      for (const t of stages.filter((s) => s.stage.at === "fight" && kindOf(s.room) === "spar")) {
        for (const [a, b] of t.pairs) {
          const [home, away] = [foughtOf(seat(t, a).run), foughtOf(seat(t, b).run)];
          if (!home || !away) throw new Error("a pair without its fight");
          pairs++;
          expect(away.setup).toEqual(home.setup);
          expect(home.setup.sides).toEqual([seat(t, a).shown, seat(t, b).shown]);
          expect(home.outcome).toEqual(resolveFight(home.setup));
          expect(away.outcome).toEqual(sided(home.outcome, 1));
          // Who is left standing changes places too, so each run is charged for the other side's.
          expect(away.outcome.standing).toEqual([home.outcome.standing[1], home.outcome.standing[0]]);
          expect([home.outcome.result, away.outcome.result].toSorted()).toEqual(
            home.outcome.result === "draw" ? ["draw", "draw"] : ["loss", "win"],
          );
          // The page of each knows its side, and that the fight plays as it was kept.
          expect(sideOf(home.setup, seat(t, a).who)).toBe(0);
          expect(sideOf(away.setup, seat(t, b).who)).toBe(1);
          expect(playsAsKept({ setup: away.setup, outcome: sided(away.outcome, 1) })).toBe(true);
          expect(facing(t, a)).toBe(b);
          expect(facing(t, b)).toBe(a);
        }
      }
    }
    expect(pairs).toBeGreaterThan(20);
  });

  test("a draw costs both", () => {
    const t = structuredClone(until(started(41, 8), planning(2)));
    const [a, b] = t.pairs[0] ?? [0, 1];
    // Two rocks and no boons, none to pick either: neither attacks, and dusk takes both in the same step.
    for (const s of [seat(t, a), seat(t, b)]) {
      s.run.boons = [];
      s.run.stage = { phase: "plan", picks: [] };
      s.run.bench = s.run.bench.map(() => null);
      s.run.board = s.run.board.map((_, i) =>
        i === 3 ? { id: s.run.nextId++, kind: "rock", stars: 1, items: [], fed: 0, fights: 0 } : null,
      );
    }
    const fought = advance(t, deadline(t));
    const after = advance(fought, deadline(fought));
    for (const i of [a, b]) {
      const { run } = seat(fought, i);
      expect(foughtOf(run)?.outcome.result).toBe("draw");
      expect(seat(after, i).run.resolve).toBe(
        run.resolve - costOf(run, { ...resolveFight(foughtOf(run)?.setup ?? bad()), result: "draw" }, 2),
      );
      expect(run.resolve - seat(after, i).run.resolve).toBe(run.boons.includes("blanket") ? 1 : ECONOMY.lossBase);
    }
  });

  test("the odd one out fights a copy of another's board, and the board copied is untouched", () => {
    const seven = must(command(until(started(42, 8), planning(1)), { do: "leave" }, call(60_000, 5, 7)));
    const t = until(seven, fighting(2));
    if (!t.odd) throw new Error("nobody is odd among seven");
    const [odd, copied] = t.odd;
    expect(t.pairs.flat().toSorted((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6].filter((i) => i !== odd));
    expect(facing(t, odd)).toBe(copied);
    expect(facing(t, copied)).not.toBe(odd);
    const fought = foughtOf(seat(t, odd).run);
    expect(fought?.setup.sides).toEqual([seat(t, odd).shown, seat(t, copied).shown]);
    expect(sideOf(fought?.setup ?? bad(), seat(t, odd).who)).toBe(0);
    // The seat copied fights its own pair's fight, and is paid for that one alone.
    const theirs = foughtOf(seat(t, copied).run);
    const pair = facing(t, copied) ?? -1;
    expect(theirs?.setup).toEqual(foughtOf(seat(t, pair).run)?.setup ?? bad());
    expect(theirs?.setup.seed).not.toBe(fought?.setup.seed);
    const after = advance(t, deadline(t));
    const { run } = seat(t, copied);
    expect(seat(after, copied).run.resolve).toBe(run.resolve - costOf(run, theirs?.outcome ?? bad(), 2));
    expect(seat(after, copied).run.record.length).toBe(run.record.length + 1);
  });

  test("somebody whose opponent left fights the board that seat locked last, alone", () => {
    const room = until(started(43, 8), planning(2));
    const [a, b] = room.pairs[0] ?? [0, 1];
    const left = must(command(room, { do: "leave" }, call(deadline(room) - 1, 9, b)));
    const t = advance(left, deadline(left));
    expect(foughtOf(seat(t, a).run)?.setup.sides).toEqual([seat(t, a).shown, seat(room, b).shown]);
    expect(endingOf(seat(t, b).run)).toBe("left");
    expect(seat(t, b).place).toBe(8);
  });

  test("pairs never repeat two sparring rooms running while another pairing exists", () => {
    let rooms = 0;
    let twos = 0;
    for (const stages of SITTINGS) {
      let last: string[] = [];
      for (const t of stages.filter((s) => s.stage.at === "plan" && kindOf(s.room) === "spar")) {
        const pairs = t.pairs.map((pair) => pair.join("-"));
        const here = seatsIn(t).length;
        expect(t.pairs.flat().length + (t.odd ? 1 : 0)).toBe(here);
        for (const [home, away] of t.pairs) expect(home).toBeLessThan(away);
        if (here > 2) expect(pairs.filter((pair) => last.includes(pair))).toEqual([]);
        else twos += pairs.every((pair) => last.includes(pair)) ? 1 : 0;
        last = pairs;
        rooms++;
      }
    }
    expect(rooms).toBeGreaterThan(20);
    // With two left there is one pairing, and it is drawn again.
    expect(twos).toBeGreaterThan(0);
  });

  test("every way of pairing off is found", () => {
    expect([2, 3, 4, 7, 8].map((n) => pairings(Array.from({ length: n }, (_, i) => i)).length)).toEqual([
      1, 3, 3, 105, 105,
    ]);
    expect(pairings([4, 6, 7]).map((p) => p.odd)).toEqual([4, 6, 7]);
  });

  test("in the forest's rooms everyone meets the same plan, each on their own board", () => {
    const t = until(started(44, 3), fighting(0));
    const foes = t.seats.map((s) => foughtOf(s.run)?.setup.sides[1]);
    expect(new Set(foes.map((foe) => JSON.stringify(foe))).size).toBe(1);
    expect(foes[0]?.who).toBe("The forest");
    expect(new Set(t.seats.map((s) => foughtOf(s.run)?.setup.seed)).size).toBe(CHAIRS);
    expect(t.seats.map((s) => facing(t, t.seats.indexOf(s)) === null || kindOf(t.room) === "spar")).not.toContain(
      false,
    );
  });
});

// ---------- the carousel ----------

/** A figure, or its price, and what it held: the Tongs one held are on the rack beside it. */
const held = (run: Run): number => pieces(run).length + run.acorns + rackSize(run.rack) - countOn(run.rack, "tongs");

describe("the carousel", () => {
  test("the first is open to the members at once, and its figure is who a seat sets out with", () => {
    const t = started(51, 3);
    if (t.stage.at !== "carousel") throw new Error("no carousel");
    expect(t.stage.until).toBe(START + CLOCK.together);
    expect(t.stage.ends).toBe(START + CLOCK.together);
    expect(t.stage.ring.map((offer) => figureIn(CAT, offer.kind).tier)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(t.stage.open).toBe(3);
    // The regulars wait for the members: the whole ring is there to choose from.
    expect(t.stage.ring.every((offer) => offer.by === null)).toBe(true);
    const free = t.stage.ring.findIndex((offer) => offer.by === null);
    const wanted = t.stage.ring[free];
    const took = must(command(t, { do: "pick", offer: free }, call(START + 1000, 3, 1)));
    const { run } = seat(took, 1);
    // The figure holds its component; the Tongs go to the rack instead.
    const holds = wanted?.item === "tongs" ? [] : [wanted?.item ?? "thorn"];
    expect(pieces(run).map((p) => [p.kind, p.items])).toEqual([[wanted?.kind ?? "greg", holds]]);
    expect(run.rack).toEqual(wanted?.item === "tongs" ? { tongs: 1 } : {});
    expect(fielded(run)).toBe(1);
    expect(picksOf(run)).toEqual([]);
    // A taken figure is refused to the next, and nobody takes two.
    expect(codeOf(command(took, { do: "pick", offer: free }, call(START + 2000, 4, 2)))).toBe("taken");
    expect(codeOf(command(took, { do: "pick", offer: free + 1 }, call(START + 2000, 4, 1)))).toBe("picked");
    expect(codeOf(command(took, { do: "pick", offer: 40 }, call(START + 2000, 4, 2)))).toBe("not_in_ring");
    // The dice for the late: whoever took none gets one of what is left, and the room is laid out.
    const after = until(took, (s) => s.stage.at === "plan");
    expect(after.stage).toEqual({ at: "plan", until: deadline(took) + 6 * CLOCK.take + CLOCK.plan, ready: [] });
    for (const s of after.seats) expect(pieces(s.run).length).toBe(1);
    expect(pieces(seat(after, 1).run)).toEqual(pieces(run));
  });

  test("the later ones let seats in two at a time, lowest resolve first", () => {
    let carousels = 0;
    for (const stages of SITTINGS) {
      const laid = stages.findIndex((s, i) => s.stage.at === "carousel" && stages[i - 1]?.stage.at === "fight");
      const t = stages[laid];
      const before = stages[laid - 1];
      if (t?.stage.at !== "carousel" || !before) throw new Error("no second carousel");
      carousels++;
      const { turns, ring } = t.stage;
      expect(BOSS_ROOMS).toContain(before.room);
      expect(ring.map((offer) => figureIn(CAT, offer.kind).tier)).toEqual([2, 2, 2, 2, 2, 3, 3, 3, 3]);
      expect(new Set(ring.map((offer) => offer.kind)).size).toBe(ring.length);
      expect(turns).toEqual(
        seatsIn(t)
          .map((s) => t.seats.indexOf(s))
          .toSorted((a, b) => seat(t, a).run.resolve - seat(t, b).run.resolve || a - b),
      );
      // A pair every 5 seconds, 8 seconds for the last pair, and its takes seen a take's length longer.
      const waits: number[] = [];
      const opened: number[] = [];
      for (let at = laid; stages[at]?.stage.at === "carousel"; at++) {
        const stage = stages[at]?.stage;
        if (stage?.at !== "carousel") break;
        opened.push(stage.open);
        waits.push(stage.until - (at === laid ? deadline(before) : deadline(stages[at - 1] ?? t)));
      }
      const pairsIn = Math.ceil(turns.length / 2);
      expect(opened).toEqual([
        ...Array.from({ length: pairsIn }, (_, i) => Math.min(turns.length, 2 * i + 2)),
        turns.length,
      ]);
      expect(waits).toEqual([...Array.from({ length: pairsIn - 1 }, () => CLOCK.pair), CLOCK.last, CLOCK.take]);
      // Whose turn has not opened is refused; whose has may take.
      const late = turns.at(-1) ?? 0;
      const early = turns[0] ?? 0;
      const free = ring.findIndex((offer) => offer.by === null);
      expect(codeOf(command(t, { do: "pick", offer: free }, call(deadline(before) + 1, 1, late)))).toBe(
        "not_your_turn",
      );
      const took = must(command(t, { do: "pick", offer: free }, call(deadline(before) + 1, 1, early)));
      if (took.stage.at !== "carousel") throw new Error("the carousel ended");
      expect(took.stage.ring[free]?.by).toBe(early);
      // At the end everyone in has taken one, each a different one.
      const over = stages.find((s, i) => i > laid && s.stage.at === "plan");
      const last = stages[stages.indexOf(over ?? t) - 1];
      if (last?.stage.at !== "carousel" || !over) throw new Error("no end");
      const final = advance(last, deadline(last));
      expect(final.stage.at).toBe("plan");
      for (const s of seatsIn(over)) expect(pieces(s.run).length).toBeGreaterThan(0);
    }
    expect(carousels).toBe(SITTINGS.length);
  });

  test("one figure of each carousel holds the Tongs in place of a component", () => {
    for (const seed of [51, 52, 53, 54]) {
      const t = started(seed, 3);
      if (t.stage.at !== "carousel") throw new Error("no carousel");
      expect(t.stage.ring.filter((offer) => offer.item === "tongs")).toHaveLength(1);
    }
  });

  test("everyone in gets one figure of a carousel, the late by the dice as their turn's time is up", () => {
    const t = until(started(52, 8), (s) => s.stage.at === "carousel" && s.room === 5);
    const counts = t.seats.map((s) => held(s.run));
    // Nobody chooses: as each pair's time is up the pair gets one each by the dice, and the next is let in.
    let after = t;
    while (after.stage.at === "carousel") {
      const was = after.stage;
      after = advance(after, deadline(after));
      expect(after.stage.at === "carousel" ? after.stage.ring.filter((o) => o.by !== null).length : was.open).toBe(
        was.open,
      );
    }
    expect(after.stage.at).toBe("plan");
    const taken = seatsIn(after).length;
    expect(taken).toBeGreaterThan(1);
    after.seats.forEach((s, i) => {
      const now = held(s.run);
      expect(now - (counts[i] ?? 0)).toBe(s.place === null ? 1 : 0);
    });
  });

  test("a taken figure goes to the bench; with a full bench it makes three of a kind, or is sold on the spot", () => {
    const run = startRun(5, { era: LEGACY_ERA });
    choose(run, 0);
    const [starter] = pieces(run);
    const others = EVERYONES.filter((kind) => kind !== starter?.kind && figureIn(CAT, kind).tier === 2);
    const [twin = "kettle", ...rest] = others;
    const kinds: FigureId[] = [twin, twin, ...rest, "leafling", "rock", "badger"];
    for (const kind of kinds.slice(0, ECONOMY.bench)) join(run, kind, "bark");
    expect(run.bench.every((p) => p !== null)).toBe(true);
    expect(run.bench.map((p) => p?.items)).toEqual(run.bench.map(() => ["bark"]));
    // No three to make: its price in acorns, its component to the item bench.
    const acorns = run.acorns;
    expect(join(run, "greg", "plume")).toEqual([]);
    expect(pieces(run).length).toBe(1 + ECONOMY.bench);
    expect(run.acorns).toBe(acorns + figureIn(CAT, "greg").tier);
    expect(run.rack).toEqual({ plume: 1 });
    // The third of a kind joins the two there, with what it held.
    const notes = join(run, twin, "thorn");
    expect(notes.map((note) => note.t)).toEqual(["merged"]);
    expect(
      pieces(run)
        .filter((p) => p.kind === twin)
        .map((p) => [p.stars, p.items]),
    ).toEqual([[2, ["stump", "thorn"]]]);
    expect(pieces(run).length).toBe(ECONOMY.bench);
  });
});

// ---------- early ends ----------

/** The places of the ring nobody has taken. */
const free = (t: Sitting): number[] =>
  t.stage.at === "carousel" ? t.stage.ring.flatMap((offer, i) => (offer.by === null ? [i] : [])) : [];
/** Whether a seat of the sittings `carouselPlayed` plays is a member's: the first two. */
const isMember = (n: number): boolean => n < 2;
/** Who took which place of the ring, by place. */
const takers = (t: Sitting): (number | null)[] => (t.stage.at === "carousel" ? t.stage.ring.map((o) => o.by) : []);

/**
 * The carousel after the first boss of a sitting of two members and six regulars (`seed`), the
 * members planning as the bot does: played with each member taking the first figure left `wait` ms
 * after their turn opens (never, for `Infinity`). The moment each seat's turn opened and it took,
 * the turns, the sitting after it, and the room it leads to.
 */
function carouselPlayed(seed: number, wait: number) {
  const before = until(started(seed, 2), (s) => s.stage.at === "fight" && BOSS_ROOMS[0] === s.room, true);
  const laid = deadline(before);
  let t = advance(before, laid);
  if (t.stage.at !== "carousel") throw new Error("no carousel");
  const { turns } = t.stage;
  const opened = new Map<number, number>();
  const took = new Map<number, number>();
  const note = (at: number): void => {
    if (t.stage.at !== "carousel") return;
    for (const n of t.stage.turns.slice(0, t.stage.open)) if (!opened.has(n)) opened.set(n, at);
    for (const { by } of t.stage.ring) if (by !== null && !took.has(by)) took.set(by, at);
  };
  note(laid);
  for (let guard = 0; guard < 60 && t.stage.at === "carousel"; guard++) {
    const stage = t.stage;
    const members = [0, 1].filter((m) => opened.has(m) && !took.has(m) && seat(t, m).place === null);
    const at = Math.min(...members.map((m) => (opened.get(m) ?? 0) + wait));
    const who = members.find((m) => (opened.get(m) ?? 0) + wait === at);
    if (who !== undefined && at < stage.until) {
      t = must(command(t, { do: "pick", offer: free(t)[0] ?? 0 }, call(at, 40 + guard, who)));
      took.set(who, at);
      note(at);
    } else {
      // Whoever's turn is up is given one at the turn's end: noted with the moment it happened.
      const next = stage.until;
      t = advance(t, next);
      note(next);
      if (t.stage.at !== "carousel")
        for (const s of t.seats.keys()) if (!took.has(s) && turns.includes(s)) took.set(s, next);
    }
  }
  return { opened, took, turns, end: t, room: before.room + 1 };
}

describe("a stage ends as soon as nobody has anything left to do", () => {
  test("the first carousel: once every member has taken, the regulars take one by one, and it ends with the last", () => {
    let t = started(53, 3);
    for (const [n, at] of [START + 1000, START + 1500, START + 2000].entries()) {
      t = must(command(t, { do: "pick", offer: free(t)[0] ?? 0 }, call(at, 20 + n, n)));
    }
    // The last member's take ends the members' turn at once: the regulars are let in.
    expect(t.stage).toMatchObject({ at: "carousel", open: CHAIRS, until: START + 2000 + CLOCK.take });
    const moments: number[] = [];
    while (t.stage.at === "carousel") {
      const before = takers(t).filter((by) => by !== null).length;
      moments.push(deadline(t));
      t = advance(t, deadline(t));
      if (t.stage.at === "carousel") expect(takers(t).filter((by) => by !== null).length).toBe(before + 1);
    }
    // Five regulars a take's length apart, and the last take seen as long again.
    expect(moments).toEqual([1, 2, 3, 4, 5, 6].map((k) => START + 2000 + k * CLOCK.take));
    expect(t.stage).toEqual({ at: "plan", until: START + 2000 + 6 * CLOCK.take + CLOCK.plan, ready: [] });
    for (const s of t.seats) expect(pieces(s.run).length).toBe(1);
  });

  test("a later carousel: a regular takes a moment after its turn opens, and a pair's turn ends when both have taken", () => {
    const { opened, took, turns, end, room } = carouselPlayed(55, 1500);
    for (let g = 0; g < turns.length; g += 2) {
      const group = turns.slice(g, g + 2);
      const from = opened.get(group[0] ?? -1) ?? bad();
      for (const n of group) expect(opened.get(n)).toBe(from);
      // Each regular a moment after the turn opens, the second as long again; a member when they take.
      const regulars = group.filter((n) => !isMember(n));
      regulars.forEach((n, k) => expect(took.get(n)).toBe(from + (k + 1) * CLOCK.take));
      for (const n of group.filter(isMember)) expect(took.get(n)).toBe(from + 1500);
      // The next pair is let in the moment this one has both taken.
      const done = Math.max(...group.map((n) => took.get(n) ?? bad()));
      const next = turns[g + 2];
      if (next !== undefined) expect(opened.get(next)).toBe(done);
      else expect(end.stage).toEqual({ at: "plan", until: done + CLOCK.take + planMs(room), ready: [] });
    }
  });

  test("planning ends the moment every member still in is ready; Ready can be taken back, and one who leaves counts no more", () => {
    const t = planned(until(started(56, 3), planning(1)));
    const end = deadline(t);
    const at = (ms: number) => end - 20_000 + ms;
    const after = (s: Sitting, n: number, on: boolean, ms: number) =>
      must(command(s, { do: "ready", on, room: 1 }, call(at(ms), 50 + ms, n)));
    let s = after(after(t, 0, true, 0), 1, true, 100);
    expect(s.stage).toEqual({ at: "plan", until: end, ready: [0, 1] });
    s = after(s, 1, false, 200);
    expect(s.stage).toEqual({ at: "plan", until: end, ready: [0] });
    // The last one ready: the boards lock then, as they would have at the deadline.
    const locked = after(after(s, 2, true, 300), 1, true, 400);
    const late = advance(after(after(s, 2, true, 300), 1, false, 400), end);
    expect(locked.stage).toMatchObject({ at: "fight", done: [] });
    expect(late.stage).toMatchObject({ at: "fight", done: [] });
    expect(deadline(locked) - at(400)).toBe(deadline(late) - end);
    expect(locked.seats.map((x) => x.shown)).toEqual(late.seats.map((x) => x.shown));
    // One not ready leaves: those left are all ready, and planning ends as they go.
    const leaves = (ready: boolean) => must(command(after(s, 2, ready, 300), { do: "leave" }, call(at(500), 7, 1)));
    const left = leaves(true);
    const leftLate = advance(leaves(false), end);
    expect(left.stage).toMatchObject({ at: "fight" });
    expect(deadline(left) - at(500)).toBe(deadline(leftLate) - end);
  });

  test("the fights end the moment every member still in has watched theirs or skipped it", () => {
    const t = until(started(57, 2), fighting(1), true);
    const end = deadline(t);
    const said = (s: Sitting, n: number, ms: number) =>
      must(command(s, { do: "watched", room: 1 }, call(end - 9000 + ms, 9, n)));
    const one = said(t, 1, 0);
    expect(one.stage).toEqual({ at: "fight", until: end, done: [1] });
    expect(said(one, 1, 100).stage).toEqual(one.stage);
    // The second: the takings then, and the next room laid out, as at the deadline.
    const both = said(one, 0, 200);
    const late = advance(t, end);
    if (late.stage.at !== "plan") throw new Error("not planning after the fights");
    expect(both.stage).toEqual({ ...late.stage, until: late.stage.until - end + (end - 9000 + 200) });
    expect(both.seats.map((x) => x.run.resolve)).toEqual(late.seats.map((x) => x.run.resolve));
  });

  test("the page predicts a take, Ready and a fight watched as Leaf does them", () => {
    const ring = started(58, 2);
    const offer = free(ring)[2] ?? 0;
    const taken = predict(sittingView(ring, member(1).id), { do: "pick", offer });
    const leaf = must(command(ring, { do: "pick", offer }, call(START + 900, 3, 1)));
    expect(taken && "view" in taken ? [taken.view.stage, taken.view.run] : null).toEqual([
      sittingView(leaf, member(1).id).stage,
      sittingView(leaf, member(1).id).run,
    ]);
    expect(predict(sittingView(leaf, member(1).id), { do: "pick", offer: offer + 1 })).toEqual({ refused: "picked" });
    expect(predict(sittingView(leaf, member(0).id), { do: "pick", offer })).toEqual({ refused: "taken" });
    const plan = until(started(58, 2), planning(0));
    const ready = predict(sittingView(plan, member(0).id), { do: "ready", on: true, room: 0 });
    const readyLeaf = must(command(plan, { do: "ready", on: true, room: 0 }, call(deadline(plan) - 1, 3, 0)));
    expect(ready && "view" in ready ? ready.view.stage : null).toEqual(readyLeaf.stage);
    const fight = advance(plan, deadline(plan));
    const watched = predict(sittingView(fight, member(1).id), { do: "watched", room: 0 });
    const watchedLeaf = must(command(fight, { do: "watched", room: 0 }, call(deadline(plan) + 1, 3, 1)));
    expect(watched && "view" in watched ? watched.view.stage : null).toEqual(watchedLeaf.stage);
    expect(predict(sittingView(fight, null), { do: "watched", room: 0 })).toEqual({ refused: "not_seated" });
  });

  test("Ready and watched name the room they are for: one that arrives in another room is turned down and counts for nothing", () => {
    const room0 = planned(until(started(59, 1), planning(0)));
    const room1 = planned(until(room0, planning(1), true));
    const now = deadline(room1) - 10_000;
    // A Ready sent while planning room 0, arriving (a retry, say) while room 1 is planned.
    const late = command(room1, readCommand({ do: "ready", on: true, room: 0 }) ?? bad(), call(now, 1));
    expect(codeOf(late)).toBe("moved_on");
    expect(late.sitting.stage).toEqual(room1.stage);
    expect(predict(sittingView(room1, member(0).id), { do: "ready", on: true, room: 0 })).toEqual({
      refused: "moved_on",
    });
    const fight1 = advance(room1, deadline(room1));
    const watchedLate = command(fight1, readCommand({ do: "watched", room: 0 }) ?? bad(), call(deadline(room1) + 1, 2));
    expect(codeOf(watchedLate)).toBe("moved_on");
    expect(watchedLate.sitting.stage).toEqual(fight1.stage);
    // Each read off the wire with its room; without one, it is no command.
    expect(readCommand({ do: "ready", on: true })).toBeNull();
    expect(readCommand({ do: "watched" })).toBeNull();
  });

  test("the last take is seen before the room is laid out: the carousel ends a take's length after it", () => {
    let t = started(53, 1);
    t = must(command(t, { do: "pick", offer: 0 }, call(START + 1000, 20)));
    let before = t;
    while (t.stage.at === "carousel") {
      before = t;
      t = advance(t, deadline(t));
    }
    // The last stage of the carousel any page can read has every seat's take in it.
    if (before.stage.at !== "carousel") throw new Error("no carousel");
    expect(waitingOn(before)).toEqual([]);
    expect(before.stage.ring.filter((o) => o.by !== null).length).toBe(CHAIRS);
    expect(deadline(t) - planMs(0)).toBe(deadline(before));
  });

  test("a turn with nobody in it still in is skipped at once, not waited out", () => {
    // A carousel with a later pair of two regulars that has a pair after it: the first seed that lays one out.
    const laid = [55, 56, 57, 58, 59, 60, 61, 62, 63, 64].flatMap((seed) => {
      const before = until(started(seed, 2), (x) => x.stage.at === "fight" && BOSS_ROOMS[0] === x.room, true);
      const at = structuredClone(advance(before, deadline(before)));
      if (at.stage.at !== "carousel") return [];
      const { turns: order } = at.stage;
      const g = [2, 4].find((p) => order.slice(p, p + 2).every((n) => !isMember(n) && n !== undefined));
      return g === undefined ? [] : [{ t: at, pair: g }];
    })[0];
    const t = laid?.t ?? bad();
    const pair = laid?.pair ?? bad();
    if (t.stage.at !== "carousel") throw new Error("no carousel");
    const { turns } = t.stage;
    // That pair, both gone out since the carousel was laid out.
    turns.slice(pair, pair + 2).forEach((n, k) => {
      const gone = seat(t, n);
      gone.place = CHAIRS - k;
      abandon(gone.run);
    });
    let s = t;
    for (let guard = 0; guard < 40 && s.stage.at === "carousel" && s.stage.open <= pair; guard++) {
      const members = [0, 1].find((m) => s.stage.at === "carousel" && waitingOn(s).includes(m));
      s =
        members === undefined
          ? advance(s, deadline(s))
          : must(command(s, { do: "pick", offer: free(s)[0] ?? 0 }, call(deadline(s) - 1, 70 + guard, members)));
    }
    // Their turn was never a stage of its own: the pair after it was let in at the same moment.
    expect(s.stage.at === "carousel" ? s.stage.open : CHAIRS).toBeGreaterThan(pair + 2);
  });

  test("a member who takes nothing gets one by the dice when their turn's time is up, and the next pair goes on", () => {
    const { opened, took, turns, end } = carouselPlayed(55, Infinity);
    for (const n of [0, 1]) {
      const pair = Math.floor(turns.indexOf(n) / 2);
      const last = pair === Math.floor((turns.length - 1) / 2);
      expect(took.get(n)).toBe((opened.get(n) ?? bad()) + (last ? CLOCK.last : CLOCK.pair));
    }
    expect(end.stage.at).toBe("plan");
    for (const s of seatsIn(end)) expect(took.has(end.seats.indexOf(s))).toBe(true);
  });
});

// ---------- what people do ----------

describe("what people do", () => {
  test("sitting, leaving and starting an open sitting", () => {
    const open = openSitting(call(0, 1));
    expect(open.stage).toEqual({ at: "open", until: CLOCK.open, sat: [member(0)] });
    const two = must(command(open, { do: "sit" }, call(5, 2, 1)));
    expect(codeOf(command(two, { do: "sit" }, call(6, 3, 1)))).toBe("seated");
    expect(codeOf(command(two, { do: "start" }, call(6, 3, 1)))).toBe("not_opener");
    expect(codeOf(command(two, { do: "leave" }, call(6, 3, 4)))).toBe("not_seated");
    expect(codeOf(command(two, { do: "buy", offer: 0 }, call(6, 3, 1)))).toBe("not_started");
    // Whoever opened it leaves: the next to have sat may start it. The last to leave ends it.
    const one = must(command(two, { do: "leave" }, call(7, 4, 0)));
    expect([one.by, one.stage.at === "open" && one.stage.sat]).toEqual([member(1).id, [member(1)]]);
    expect(must(command(one, { do: "leave" }, call(8, 5, 1))).stage).toEqual({ at: "over", ended: 8 });
    const begun = must(command(one, { do: "start" }, call(9, 5, 1)));
    expect(begun.seats.map((s) => s.who.is).join(" ")).toBe(`member${" regular".repeat(7)}`);
    expect(new Set(begun.seats.map((s) => (s.who.is === "regular" ? s.who.figure : s.who.id))).size).toBe(CHAIRS);
    expect(codeOf(command(begun, { do: "sit" }, call(10, 6, 2)))).toBe("not_open");
    expect(codeOf(command(begun, { do: "start" }, call(10, 6, 1)))).toBe("not_open");
  });

  test("a full sitting starts itself, and one nobody started closes", () => {
    const full = started(61, 8);
    expect(full.stage.at).toBe("carousel");
    expect(full.seats.map((s) => s.who.is === "member" && s.who.id)).toEqual(
      Array.from({ length: 8 }, (_, n) => member(n).id),
    );
    const open = openSitting(call(0, 1));
    expect(advance(open, CLOCK.open - 1)).toBe(open);
    expect(advance(open, CLOCK.open)).toEqual({ ...open, stage: { at: "over", ended: CLOCK.open } });
    expect(codeOf(command(open, { do: "sit" }, call(CLOCK.open, 2, 1)))).toBe("table_over");
  });

  test("a command in the wrong stage is refused, by Leaf and by the page's prediction alike", () => {
    const carousel = started(62, 2);
    const plan = until(carousel, planning(0));
    const fight = advance(plan, deadline(plan));
    const buy: SittingCommand = { do: "buy", offer: 0 };
    expect(codeOf(command(carousel, buy, call(START + 1, 1)))).toBe("carousel");
    expect(codeOf(command(fight, buy, call(deadline(plan) + 1, 1)))).toBe("fighting");
    expect(codeOf(command(plan, { do: "pick", offer: 0 }, call(deadline(plan) - 1, 1)))).toBe("no_carousel");
    expect(codeOf(command(plan, buy, call(deadline(plan) - 1, 1, 5)))).toBe("not_seated");
    // The sitting's own moves, each in its own stage alone, by Leaf and by the page alike.
    for (const [t, c, code] of [
      [carousel, { do: "ready", on: true, room: 0 }, "carousel"],
      [fight, { do: "ready", on: true, room: 0 }, "fighting"],
      [carousel, { do: "watched", room: 0 }, "no_fight"],
      [plan, { do: "watched", room: 0 }, "no_fight"],
      [fight, { do: "pick", offer: 0 }, "no_carousel"],
    ] satisfies [Sitting, SittingCommand, string][]) {
      const now = t === carousel ? START + 1 : t === plan ? deadline(plan) - 1 : deadline(plan) + 1;
      expect(codeOf(command(t, c, call(now, 1)))).toBe(code);
      expect(predict(sittingView(t, member(0).id), c)).toEqual({ refused: code });
    }
    for (const t of [carousel, fight]) {
      const now = t === carousel ? START + 1 : deadline(plan) + 1;
      expect(predict(sittingView(t, member(0).id), buy)).toEqual({ refused: codeOf(command(t, buy, call(now, 1))) });
    }
    expect(predict(sittingView(plan, null), buy)).toEqual({ refused: "not_seated" });
    expect(predict(sittingView(plan, member(0).id), { do: "rustle" })).toBeNull();
    expect(predict(sittingView(plan, member(0).id), { do: "leave" })).toBeNull();
  });

  test("a seat's planning is the run's own, predicted by the page as Leaf does it", () => {
    const room = until(started(63, 2), planning(1));
    const now = deadline(room) - 5000;
    // The component the first room left is picked first.
    expect(codeOf(command(room, { do: "buy", offer: 1 }, call(now, 8, 1)))).toBe("pick_component");
    const t = must(command(room, { do: "choose", option: 1 }, call(now, 7, 1)));
    const view = sittingView(t, member(1).id);
    for (const c of [{ do: "buy", offer: 1 }, { do: "xp" }, { do: "hold", on: true }] satisfies SittingCommand[]) {
      const answer = command(t, c, call(now, 8, 1));
      const guess = predict(view, c);
      if (!answer.ok) expect(guess).toEqual({ refused: answer.code });
      else expect(guess).toEqual({ view: sittingView(answer.sitting, member(1).id), notes: answer.notes });
    }
    // Leaf's dice are stirred in before anything is drawn: the same rustle with other dice draws another stall.
    const stalls = [1, 2].map((seed) => seat(must(command(t, { do: "rustle" }, call(now, seed, 1))), 1).run.stall);
    expect(stalls[0]).not.toEqual(stalls[1]);
    expect(must(command(t, { do: "rustle" }, call(now, 1, 1))).rng).not.toBe(t.rng);
    // Nobody else's seat is touched.
    expect(seat(must(command(t, { do: "rustle" }, call(now, 1, 1))), 0)).toEqual(seat(t, 0));
  });

  test("forging on the rack is planning: read off the wire, done at the seat, and predicted by the page as Leaf does it", () => {
    const t = structuredClone(until(started(63, 2), planning(0)));
    seat(t, 1).run.rack = { thorn: 1, bark: 1 };
    const now = deadline(t) - 5000;
    const forging: SittingCommand = { do: "forge", item: "bark", with: "thorn" };
    expect(readCommand({ ...forging, id: "x" })).toEqual(forging);
    const answer = command(t, forging, call(now, 8, 1));
    if (!answer.ok) throw new Error(answer.code);
    expect(seat(answer.sitting, 1).run.rack).toEqual({ hedgehog: 1 });
    expect(predict(sittingView(t, member(1).id), forging)).toEqual({
      view: sittingView(answer.sitting, member(1).id),
      notes: answer.notes,
    });
  });

  test("every command of a run is the member's to plan with or the clock's, and a seat reads only the member's", () => {
    // Every field a command of a run reads, so that each is read by its name alone.
    const fields = { option: 0, offer: 0, from: { on: "bench", at: 0 }, to: { on: "board", at: 0 }, seat: 0 };
    const read = (name: string) =>
      readCommand({ do: name, ...fields, on: true, item: "thorn", with: "bark" })?.do ?? null;
    const whose = Object.entries(COMMANDS).map(([name, spec]): [string, string] => [name, spec.whose]);
    expect(whose.filter(([, w]) => w === "clock").map(([name]) => name)).toEqual(["fight", "take", "abandon"]);
    for (const [name, w] of whose) expect([name, read(name)]).toEqual([name, w === "plan" ? name : null]);
  });

  test("a pick waiting at the lock takes its first option", () => {
    const t = until(started(64, 1), (s) => s.stage.at === "plan" && picksOf(seat(s, 0).run).length > 0);
    const { run } = seat(t, 0);
    const waiting = picksOf(run).map((pick) => pick.options[0]);
    const locked = seat(advance(t, deadline(t)), 0).run;
    expect(locked.stage.phase).toBe("fight");
    expect([...kindsOn(locked.rack), ...locked.boons]).toEqual(expect.arrayContaining(waiting));
  });

  test("leaving a started sitting is going out, and a seat that is out can do nothing", () => {
    const t = until(started(65, 3), planning(1));
    const now = deadline(t) - 1000;
    const left = must(command(t, { do: "leave" }, call(now, 2, 1)));
    expect(seat(left, 1).place).toBe(8);
    expect(endingOf(seat(left, 1).run)).toBe("left");
    expect(left.stage).toEqual(t.stage);
    for (const c of [
      { do: "buy", offer: 0 },
      { do: "rustle" },
      { do: "choose", option: 0 },
    ] satisfies SittingCommand[]) {
      expect(codeOf(command(left, c, call(now + 1, 3, 1)))).toBe("raid_over");
    }
    expect(codeOf(command(left, { do: "leave" }, call(now + 1, 3, 1)))).toBe("out");
    const ring = until(left, (s) => s.stage.at === "carousel", true);
    expect(codeOf(command(ring, { do: "pick", offer: 0 }, call(deadline(ring) - 1, 3, 1)))).toBe("out");
    expect(ring.stage.at === "carousel" && ring.stage.turns).not.toContain(1);
    // The rest goes on without it.
    expect(seat(advance(left, FAR), 1).run).toEqual(seat(left, 1).run);
  });

  test("with no member left in, the regulars play straight to the end", () => {
    const t = until(started(66, 1), planning(1));
    const now = deadline(t) - 1000;
    const left = must(command(t, { do: "leave" }, call(now, 2)));
    expect(left.stage).toEqual({ at: "over", ended: now });
    expect(left.seats.map((s) => s.place ?? 0).toSorted((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // A member out by the forest's doing ends the waiting in the same way.
    const end = advance(started(66, 1), FAR);
    const fell = until(started(66, 1), (s) => seat(s, 0).place !== null);
    expect(fell.stage.at).toBe("over");
    expect(end).toEqual(fell);
  });

  test("a command off the wire is read, or is none", () => {
    expect(readCommand({ do: "pick", offer: 3, id: "x" })).toEqual({ do: "pick", offer: 3 });
    expect(readCommand({ do: "sit" })).toEqual({ do: "sit" });
    expect(readCommand({ do: "buy", offer: 2 })).toEqual({ do: "buy", offer: 2 });
    for (const v of [
      { do: "pick" },
      { do: "pick", offer: -1 },
      { do: "fight" },
      { do: "take" },
      { do: "abandon" },
      null,
      "sit",
    ]) {
      expect(readCommand(v)).toBeNull();
    }
    expect(readCommand({ do: "start", trail: 0 })).toEqual({ do: "start" });
  });
});

// ---------- what a page is shown ----------

describe("what a viewer is shown", () => {
  const keys = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.flatMap(keys);
    if (typeof v !== "object" || v === null) return [];
    return Object.entries(v).flatMap(([key, inner]) => [key].concat(keys(inner)));
  };

  test("no stream, and nothing of another seat but what anyone may see", () => {
    for (const t of SITTINGS.flat()) {
      const view = sittingView(t, member(2).id);
      expect(keys(view)).not.toContain("rng");
      expect(Object.keys(view.run ?? { seed: 0 })).not.toContain("seed");
      expect(view.you).toBe(2);
      for (const [i, s] of view.seats.entries()) {
        expect(Object.keys(s)).toEqual([
          "who",
          "name",
          "resolve",
          "level",
          "streak",
          "place",
          "faces",
          "board",
          "fight",
        ]);
        expect(s.board).toEqual(seat(t, i).shown);
        expect(s.fight).toEqual(t.stage.at === "fight" ? (foughtOf(seat(t, i).run)?.setup ?? null) : null);
      }
      const stranger = sittingView(t, null);
      expect([stranger.you, stranger.run]).toEqual([null, null]);
      expect(stranger.seats).toEqual(view.seats);
      expect(stranger.stage).toEqual(view.stage);
    }
  });

  test("a board is shown as it was at the last lock, not as it changes", () => {
    const t = planned(until(started(71, 8), planning(2)));
    const view = sittingView(t, member(0).id);
    const faces = view.seats[0]?.faces ?? -1;
    const theirs = seat(t, faces);
    expect(signed(theirs)).not.toEqual(theirs.shown);
    expect(view.seats[faces]?.board).toEqual(theirs.shown);
    // Whom a seat faces is shown, with the board they locked last.
    expect(view.run?.foe).toEqual(theirs.shown);
    expect(view.seats[faces]?.name).toBe(member(faces).name);
    expect(JSON.stringify(view)).not.toContain(JSON.stringify(theirs.run.stall));
  });

  test("a pick not yet offered is not shown", () => {
    const t = SITTINGS.flat().find((s) => s.seats.some((x) => picksOf(x.run).length > 1));
    const at = t?.seats.findIndex((x) => picksOf(x.run).length > 1) ?? -1;
    if (!t || at < 0) throw new Error("nobody had two picks waiting");
    const shown = sittingView(t, member(at).id).run;
    const real = picksOf(seat(t, at).run);
    expect(picksOf(shown ?? bad())[0]).toEqual(real[0]);
    expect(
      picksOf(shown ?? bad())
        .slice(1)
        .map((pick) => pick.options),
    ).toEqual(real.slice(1).map(() => []));
    expect(real.slice(1).every((pick) => pick.options.length > 0)).toBe(true);
  });

  test("the carousel's ring, whose turn it is and who took what; and at the end the places", () => {
    const t = started(72, 2);
    const view = sittingView(t, member(1).id);
    expect(view.stage).toEqual(t.stage);
    expect(view.seats.map((s) => s.faces)).toEqual(view.seats.map(() => null));
    const end = sittingView(advance(t, FAR), member(1).id);
    expect(end.stage.at).toBe("over");
    expect(end.seats.map((s) => s.place ?? 0).toSorted((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(end.seats.map((s) => s.name).slice(0, 2)).toEqual([member(0).name, member(1).name]);
  });
});

// ---------- keeping it, and what is owed ----------

describe("a stored sitting", () => {
  test("reads back equal, wherever it stands", () => {
    const open = openSitting(call(0, 1));
    for (const t of [open, advance(open, FAR), started(81, 0), ...SITTINGS.flat()]) {
      expect(decodeSitting(encodeSitting(t))).toEqual(t);
    }
  });

  test("nonsense is refused", () => {
    const t = until(started(82, 3), fighting(2));
    const spoiled = (change: (raw: Sitting) => void, from = t): Sitting | null => {
      const raw = structuredClone(from);
      change(raw);
      return decodeSitting(encodeSitting(raw));
    };
    expect(spoiled(() => {})).toEqual(t);
    expect(decodeSitting("{")).toBeNull();
    expect(decodeSitting(encodeSitting(t).replace(`"v":${SITTING_VERSION}`, '"v":9'))).toBeNull();
    expect(decodeSitting(encodeSitting(t).replace('"little-raid-sitting"', '"little-raid-table"'))).toBeNull();
    expect(spoiled((raw) => void (raw.rng = -1))).toBeNull();
    expect(spoiled((raw) => void raw.seats.pop())).toBeNull();
    expect(spoiled((raw) => void (seat(raw, 3).place = 9))).toBeNull();
    // Parts that contradict each other: a seat out whose run goes on, two in one place, a run not where the sitting is.
    expect(spoiled((raw) => void (seat(raw, 3).place = 5))).toBeNull();
    expect(spoiled((raw) => void (seat(raw, 0).who = seat(raw, 1).who))).toBeNull();
    expect(spoiled((raw) => void (seat(raw, 0).run.stage = { phase: "plan", picks: [] }))).toBeNull();
    expect(spoiled((raw) => void (seat(raw, 0).run.resolve = 0))).toBeNull();
    expect(spoiled((raw) => void (raw.pairs = [[1, 1]]))).toBeNull();
    expect(
      spoiled(
        (raw) =>
          void (raw.pairs = [
            [0, 1],
            [1, 2],
          ]),
      ),
    ).toBeNull();
    expect(spoiled((raw) => void (raw.stage = { at: "open", until: 5, sat: [member(0)] }))).toBeNull();
    expect(spoiled((raw) => void (raw.owed = [{ key: "seat:0", member: "leaf-0", coins: 0 }]))).toBeNull();
    // Who has watched: each seat once, in seat order.
    expect(spoiled((raw) => void (raw.stage = { at: "fight", until: deadline(t), done: [0, 1] }))).not.toBeNull();
    for (const done of [[1, 1], [1, 0], [9]])
      expect(spoiled((raw) => void (raw.stage = { at: "fight", until: deadline(t), done }))).toBeNull();
    const over = advance(t, FAR);
    expect(
      spoiled((raw) => raw.seats.forEach((s) => void (s.place = s.place === 1 ? null : s.place)), over),
    ).toBeNull();
    const open = openSitting(call(0, 1));
    expect(spoiled((raw) => void (raw.by = "somebody-else"), open)).toBeNull();
    expect(spoiled((raw) => void (raw.seats = t.seats), open)).toBeNull();
  });
});

describe("what is owed", () => {
  test("the run's payout, once for each member's seat as it goes out or finishes, and nothing for a regular", () => {
    for (const stages of [...SITTINGS, [advance(started(91, 3), FAR)], [advance(started(92, 1), FAR)]]) {
      const seen = new Set<string>();
      for (const t of stages) {
        const due = t.seats.flatMap((s, i) => {
          const coins = payout(summariseRun(s.run)).coins;
          return s.who.is === "member" && s.place !== null && coins > 0
            ? [{ key: `seat:${i}`, member: s.who.id, coins }]
            : [];
        });
        expect(t.owed.toSorted((a, b) => a.key.localeCompare(b.key))).toEqual(due);
        for (const { key } of t.owed) seen.add(key);
      }
      const end = stages.at(-1);
      const winner = end?.seats.find((s) => s.place === 1);
      if (winner?.who.is === "member") {
        const lines = payout(summariseRun(winner.run)).lines;
        expect(lines).toContainEqual({ why: "win", coins: PAYOUT.win });
      }
      expect(seen.size).toBe(end?.owed.length ?? -1);
    }
  });

  test("what Leaf has paid is taken off, and never owed again", () => {
    const stages = SITTINGS[0] ?? [];
    const mid = stages.find((t) => t.owed.length > 0 && t.stage.at !== "over");
    if (!mid) throw new Error("nobody went out before the end");
    const paid = paidOff(mid, [mid.owed[0]?.key ?? ""]);
    expect(paid.owed).toEqual(mid.owed.slice(1));
    const end = advance(planned(paid), FAR);
    expect(end.owed.map((o) => o.key)).not.toContain(mid.owed[0]?.key);
    expect(
      paidOff(
        end,
        end.owed.map((o) => o.key),
      ).owed,
    ).toEqual([]);
    expect(advance(paidOff(end, ["seat:0"]), FAR + 1).owed).toEqual(end.owed.filter((o) => o.key !== "seat:0"));
  });
});
