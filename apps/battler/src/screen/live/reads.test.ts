import { describe, expect, test } from "bun:test";

import { LEGACY_ERA, planRoom, SENSIBLE, startRun } from "@sequoia-leaf/raid";
import { advance } from "@sequoia-leaf/raid/sitting/clock.ts";
import { type Call, command, openSitting } from "@sequoia-leaf/raid/sitting/commands.ts";
import { CHAIRS, CLOCK, type Member, seatsIn, type Sitting } from "@sequoia-leaf/raid/sitting/sitting.ts";
import { sittingView } from "@sequoia-leaf/raid/sitting/view.ts";

import {
  clockLine,
  clockText,
  facingLine,
  figureBox,
  focusAfter,
  ordinal,
  paidLines,
  placeText,
  playerRows,
  ringMoves,
  secondsTo,
  turnLine,
  turnOf,
  waitingLine,
} from "./reads.ts";

const NAMES = ["Mossback", "Sootpaw", "Embertoe", "Quillfeather", "Fernwhistle", "Wrenly", "Pipwick", "Tindra"];
const member = (n: number): Member => ({ id: `leaf-${n}`, name: NAMES[n] ?? `Guest ${n}` });
const call = (now: number, seed: number, n = 0): Call => ({ now, seed, player: member(n) });
const deadline = (t: Sitting): number => (t.stage.at === "over" ? t.stage.ended : t.stage.until);
function must(answer: ReturnType<typeof command>): Sitting {
  if (!answer.ok) throw new Error(answer.why);
  return answer.sitting;
}

/** A sitting of `members` members (the rest regulars), started at `at`. */
function started(seed: number, members: number, at = 1000): Sitting {
  let t = openSitting(call(0, seed));
  for (let n = 1; n < members; n++) t = must(command(t, { do: "sit" }, call(n, seed + n, n)));
  return members === CHAIRS ? t : must(command(t, { do: "start" }, call(at, seed * 7)));
}
/** On to the first moment `there` holds, every member planning each room as the bot does. */
function until(t: Sitting, there: (t: Sitting) => boolean): Sitting {
  let now = t;
  for (let guard = 0; guard < 400 && !there(now); guard++) {
    if (now.stage.at === "over") throw new Error("the sitting ended first");
    if (now.stage.at === "plan") {
      now = structuredClone(now);
      for (const { who, run } of seatsIn(now)) if (who.is === "member") planRoom(run, SENSIBLE);
    }
    now = advance(now, deadline(now));
  }
  return now;
}

describe("the clock at the top", () => {
  test("says the stage and the whole seconds left of it, counted to Leaf's own deadline", () => {
    const open = openSitting(call(0, 3));
    expect(clockText(sittingView(open, "leaf-0"), 0)).toBe("Waiting to start");
    const begun = started(3, 1, 1000);
    const carousel = sittingView(begun, "leaf-0");
    expect(clockText(carousel, 1000)).toBe(`Carousel · ${CLOCK.together / 1000} s`);
    // The member's take: the regulars' turn, whose length is nobody's to count.
    const took = must(command(begun, { do: "pick", offer: 0 }, call(1500, 5)));
    expect(clockText(sittingView(took, "leaf-0"), 1500)).toBe("Carousel");
    const plan = until(begun, (t) => t.stage.at === "plan");
    const at = deadline(plan) - CLOCK.plan;
    expect(clockText(sittingView(plan, "leaf-0"), at)).toBe("Planning · 30 s");
    expect(clockText(sittingView(plan, "leaf-0"), at + 1500)).toBe("Planning · 29 s");
    expect(clockText(sittingView(plan, "leaf-0"), deadline(plan) + 400)).toBe("Planning · 0 s");
    const fight = until(plan, (t) => t.stage.at === "fight");
    expect(clockText(sittingView(fight, "leaf-0"), deadline(fight) - 6200)).toBe("The fight · 7 s");
  });

  test("in a carousel counts the member's own turn down while it is theirs, and nothing while others choose", () => {
    const later = until(started(5, CHAIRS), (t) => t.stage.at === "carousel" && t.room > 0);
    if (later.stage.at !== "carousel") throw new Error("not a carousel");
    const [first = 0, , third = 0] = later.stage.turns;
    const ends = later.stage.ends;
    expect(clockText(sittingView(later, member(first).id), ends - 3200)).toBe("Carousel · 4 s");
    expect(clockText(sittingView(later, member(third).id), ends - 3200)).toBe("Carousel");
  });

  test("seconds are whole, never below 0", () => {
    expect(secondsTo(10_000, 9_001)).toBe(1);
    expect(secondsTo(10_000, 10_000)).toBe(0);
    expect(secondsTo(10_000, 12_000)).toBe(0);
  });
});

describe("the players' list", () => {
  test("is in seat order: the members as they sat, then the regulars, with their health, the member's own lit", () => {
    const t = started(9, 2);
    const rows = playerRows(sittingView(t, "leaf-1"));
    expect(rows.map((r) => r.seat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(rows.slice(0, 2).map((r) => r.name)).toEqual(["Mossback", "Sootpaw"]);
    expect(rows.map((r) => r.you)).toEqual([false, true, false, false, false, false, false, false]);
    expect(rows.every((r) => r.resolve === 20 && r.fill === 1 && r.place === null)).toBe(true);
    // A regular's article is a capital, as a name starts a line.
    expect(rows.slice(2).every((r) => /^[A-Z]/.test(r.name))).toBe(true);
  });

  test("a seat out shows its place, its health no lower than 0; the member's opponent is marked", () => {
    const fought = until(started(4, 1), (t) => t.seats.some((s) => s.place !== null));
    const view = sittingView(fought, "leaf-0");
    const rows = playerRows(view);
    const out = rows.filter((r) => r.place !== null);
    expect(out.length).toBeGreaterThan(0);
    for (const r of out) expect(view.seats[r.seat]?.place).toBe(r.place);
    expect(rows.every((r) => r.resolve >= 0 && r.fill >= 0 && r.fill <= 1)).toBe(true);
    const spar = until(started(4, 1), (t) => t.stage.at === "plan" && t.room === 2);
    const sparView = sittingView(spar, "leaf-0");
    const facing = playerRows(sparView).filter((r) => r.facing);
    expect(facing.map((r) => r.seat)).toEqual([sparView.seats[0]?.faces ?? -1]);
    expect(facingLine(sparView)).toBe(`Against ${facing[0]?.name ?? ""}`);
  });

  test("places in words", () => {
    expect([1, 2, 3, 4, 5, 8, 11, 12, 13, 21].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "5th",
      "8th",
      "11th",
      "12th",
      "13th",
      "21st",
    ]);
    expect(placeText(5)).toBe("5th of 8");
  });
});

describe("the carousel's turn", () => {
  test("the first is the members' at once, until they have taken one", () => {
    const t = started(2, 1, 1000);
    expect(turnOf(sittingView(t, "leaf-0"), 1000)).toEqual({ at: "choosing", seconds: 12 });
    expect(turnLine(sittingView(t, "leaf-0"), 1000)).toBe("Your turn: choose one.");
    const took = must(command(t, { do: "pick", offer: 4 }, call(2000, 99)));
    expect(turnOf(sittingView(took, "leaf-0"), 2000)).toEqual({ at: "taken", offer: 4 });
    expect(turnLine(sittingView(took, "leaf-0"), 2000)).toMatch(/^You took [A-Z][\w #'-]+\.$/);
    expect(turnOf(sittingView(took, null), 2000)).toEqual({ at: "none" });
  });

  test("a later one is the member's exactly when the rules let them take, and the wait says how many take first", () => {
    const later = until(started(5, CHAIRS), (t) => t.stage.at === "carousel" && t.room > 0);
    let waited = 0;
    for (let n = 0; n < CHAIRS; n++) {
      const id = member(n).id;
      for (let now = deadline(later) - CLOCK.pair + 1; now < deadline(later) + 4 * CLOCK.pair; now += 500) {
        const at = advance(later, now);
        if (at.stage.at !== "carousel") break;
        const turn = turnOf(sittingView(at, id), now);
        const picked = command(
          at,
          { do: "pick", offer: at.stage.ring.findIndex((o) => o.by === null) },
          call(now, 7, n),
        );
        const may = picked.ok || picked.code === "picked" || picked.code === "taken";
        expect(turn.at === "choosing" || turn.at === "taken").toBe(may);
        if (turn.at === "waiting") {
          const { turns, ring } = at.stage;
          const before = turns.slice(0, turns.indexOf(n)).filter((s) => !ring.some((o) => o.by === s));
          expect(turn.before).toBe(before.length);
          expect(turnLine(sittingView(at, id), now)).toBe(
            `Your turn after ${before.length} ${before.length === 1 ? "player" : "players"}.`,
          );
          waited++;
        }
      }
    }
    expect(waited).toBeGreaterThan(0);
  });
});

/** A sitting as member `n` is shown it. */
const view = (t: Sitting, n: number) => sittingView(t, member(n).id);

describe("whom a stage waits for", () => {
  test("once the member is ready or has watched, the others still to: by name for one, by count for more", () => {
    let t = until(started(6, 3), (s) => s.stage.at === "plan");
    const at = deadline(t) - 10_000;
    expect(waitingLine(view(t, 0))).toBe("");
    t = must(command(t, { do: "ready", on: true, room: t.room }, call(at, 1, 0)));
    expect(waitingLine(view(t, 0))).toBe("Waiting for 2 players.");
    expect(waitingLine(view(t, 1))).toBe("");
    t = must(command(t, { do: "ready", on: true, room: t.room }, call(at + 1, 2, 1)));
    expect(clockLine(view(t, 0), at + 1)).toBe(`Waiting for ${NAMES[2] ?? ""}.`);
    const fight = must(command(t, { do: "ready", on: true, room: t.room }, call(at + 2, 3, 2)));
    expect(fight.stage.at).toBe("fight");
    const watched = must(command(fight, { do: "watched", room: fight.room }, call(at + 3, 4, 2)));
    expect(waitingLine(view(watched, 2))).toBe("Waiting for 2 players.");
  });
});

describe("what a room paid", () => {
  test("how it went, then health, acorns and a level, as the run changed", () => {
    const before = startRun(1, { era: LEGACY_ERA });
    const after = { ...before, resolve: before.resolve - 4, acorns: before.acorns + 6, level: before.level + 1 };
    expect(paidLines("loss", before, after)).toEqual(["Room lost", "-4 health", "+6 acorns", `Level ${after.level}`]);
    expect(paidLines("win", before, { ...before, acorns: before.acorns + 3 })).toEqual(["Room won", "+3 acorns"]);
    expect(paidLines(null, before, before)).toEqual([]);
  });
});

/** A ring of nine, with the places in `taken` taken. */
const ring = (taken: number[]) => Array.from({ length: 9 }, (_, i) => ({ by: taken.includes(i) ? 3 : null }));

describe("the ring as the sitting changes", () => {
  test("a new carousel is laid out; in the same one only the places taken since move, so a figure being pressed keeps its button", () => {
    expect(ringMoves(null, [], 0, ring([]))).toBe("lay");
    expect(ringMoves(0, ring([]), 5, ring([]))).toBe("lay");
    // Somebody else takes place 2 while the member's finger is on place 6: only 2 moves.
    expect(ringMoves(5, ring([]), 5, ring([2]))).toEqual([2]);
    expect(ringMoves(5, ring([2]), 5, ring([2, 6]))).toEqual([6]);
    expect(ringMoves(5, ring([2, 6]), 5, ring([2, 6]))).toEqual([]);
  });
});

describe("the ring's buttons", () => {
  test("a figure's button is round the figure where it is drawn, dropping in or bobbing as well", () => {
    const still = figureBox({ x: 40, y: 30 }, 20, 0);
    const lifted = figureBox({ x: 40, y: 30 }, 20, 12);
    expect(lifted.y).toBe(still.y - 12);
    expect([lifted.x, lifted.w, lifted.h]).toEqual([still.x, still.w, still.h]);
    // The box holds the figure (20 tall over its feet) and its held mark under them.
    expect(still.y).toBeLessThanOrEqual(30 - 20);
    expect(still.y + still.h).toBeGreaterThanOrEqual(30 + 9);
  });
});

describe("the ring drawn again", () => {
  test("the figure that had the keyboard keeps it while it stands; taken, the next still standing has it", () => {
    expect(focusAfter(ring([]), 4)).toBe(4);
    expect(focusAfter(ring([1, 2]), 4)).toBe(4);
    expect(focusAfter(ring([4]), 4)).toBe(5);
    expect(focusAfter(ring([4, 5, 6, 7, 8]), 4)).toBe(0);
    expect(focusAfter(ring([0, 1, 2, 3, 4, 5, 6, 7, 8]), 4)).toBeNull();
  });
});
