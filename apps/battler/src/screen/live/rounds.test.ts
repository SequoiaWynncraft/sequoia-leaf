import { describe, expect, test } from "bun:test";

import { planRoom, SENSIBLE } from "@sequoia-leaf/raid";
import { ROOMS } from "@sequoia-leaf/raid/content/rooms.ts";
import { advance } from "@sequoia-leaf/raid/sitting/clock.ts";
import { type Call, command, openSitting } from "@sequoia-leaf/raid/sitting/commands.ts";
import { CLOCK, planMs, seatsIn, type Sitting } from "@sequoia-leaf/raid/sitting/sitting.ts";
import { type SittingView, sittingView } from "@sequoia-leaf/raid/sitting/view.ts";

import { seatName } from "./reads.ts";
import { AHEAD, bannerOf, roundsOf, roundTitle, stageBegan, stageClock } from "./rounds.ts";

const ME = { id: "leaf-0", name: "Mossback" };
const call = (now: number, seed: number): Call => ({ now, seed, player: ME });
const at = (t: Sitting): number => (t.stage.at === "over" ? t.stage.ended : t.stage.until);

/** The member and seven regulars, played on (the member planning as the bot does) to the first moment `there` holds. */
function table(there: (t: Sitting) => boolean, seed = 3): Sitting {
  const opened = command(openSitting(call(0, seed)), { do: "start" }, call(1000, seed * 7));
  if (!opened.ok) throw new Error(opened.why);
  let t = opened.sitting;
  for (let guard = 0; guard < 400 && !there(t); guard++) {
    if (t.stage.at === "over") throw new Error("the sitting ended first");
    if (t.stage.at === "plan") {
      t = structuredClone(t);
      for (const { who, run } of seatsIn(t)) if (who.is === "member") planRoom(run, SENSIBLE);
    }
    t = advance(t, at(t));
  }
  return t;
}
const viewAt = (there: (t: Sitting) => boolean): SittingView => sittingView(table(there), ME.id);
const planningIn = (room: number) => viewAt((t) => t.stage.at === "plan" && t.room === room);

describe("the round tracker's rounds, from the sitting's schedule", () => {
  test("a stage is a wing: its carousel first, then its rooms by kind, the one being played marked", () => {
    const view = viewAt((t) => t.stage.at === "carousel");
    const { where, rounds, now } = roundsOf(view);
    expect([where, now]).toEqual(["1-1", 0]);
    const wing = ROOMS.filter((r) => r.wing === 1).map((r) => r.kind);
    expect(rounds.map((r) => r.kind)).toEqual(["carousel", ...wing]);
    expect(rounds.map((r) => r.at)).toEqual(["1-1", "1-2", "1-3", "1-4", "1-5", "1-6"]);
    // The boss has one plan: its name is known before it is played. A room of many plans says only its kind.
    expect(rounds.map((r) => r.name)).toEqual(["Carousel", "Forest", "Forest", "Fight", "Fight", "Boss: Snag"]);
  });

  test("a forest room being played is named by the party in it, and shown by the figure that leads it", () => {
    const view = planningIn(0);
    const { where, rounds, now } = roundsOf(view);
    expect([where, now]).toEqual(["1-2", 1]);
    expect(rounds[1]?.name).toBe(`Forest: ${view.run?.foe.title}`);
    expect(rounds[1]?.lead).toBe(view.run?.foe.figures[0]?.kind ?? null);
  });

  test("a sparring room being played names the opponent, and the odd one out's copy", () => {
    const view = planningIn(2);
    const { where, rounds, now } = roundsOf(view);
    expect([where, now]).toEqual(["1-4", 3]);
    const faces = view.you === null ? null : (view.seats[view.you]?.faces ?? null);
    const them = faces === null ? undefined : view.seats[faces];
    if (!them || faces === null) throw new Error("nobody faced");
    const copy = them.faces === view.you ? "" : "copy of ";
    expect(rounds[3]).toMatchObject({ kind: "spar", name: `Fight: ${copy}${seatName(them)}`, against: faces });
    // Only the round being played knows whom.
    expect(rounds[4]).toMatchObject({ name: "Fight", against: null });
    // Its card's title holds a player's name, which may break anywhere; a room's does not.
    const fight = rounds[3];
    const carousel = rounds[0];
    expect([fight && roundTitle(fight).member, carousel && roundTitle(carousel).member]).toEqual([true, undefined]);
  });

  test("the second wing's carousel opens the second stage", () => {
    const view = viewAt((t) => t.stage.at === "carousel" && t.room > 0);
    const { where, rounds, now } = roundsOf(view);
    expect([where, now, view.room]).toEqual(["2-1", 0, 5]);
    expect(rounds.map((r) => r.kind)).toEqual(["carousel", ...ROOMS.filter((r) => r.wing === 2).map((r) => r.kind)]);
    expect(rounds.at(-1)?.name).toBe("Boss: Swipe");
  });

  test("past the fifteenth room there are no stages: the round by its count, and the next ones, all sparring", () => {
    const spar = planningIn(2);
    const view: SittingView = { ...spar, room: 15 };
    const { where, rounds, now } = roundsOf(view);
    // Fifteen rooms and three carousels are behind it.
    expect([where, now, rounds.length]).toEqual(["Round 19", 0, AHEAD]);
    expect(rounds.map((r) => r.at)).toEqual(Array.from({ length: AHEAD }, (_, k) => `Round ${19 + k}`));
    expect(new Set(rounds.map((r) => r.kind))).toEqual(new Set(["spar"]));
    expect(rounds[0]?.name.startsWith("Fight: ")).toBe(true);
  });
});

describe("the round banner", () => {
  test("says the round's number, then what it is, for each kind of round", () => {
    expect(bannerOf(viewAt((t) => t.stage.at === "carousel"))).toEqual(["Round 1-1", "Carousel"]);
    const forest = planningIn(0);
    expect(bannerOf(forest)).toEqual(["Round 1-2", `Forest: ${forest.run?.foe.title}`]);
    const spar = planningIn(2);
    const [head, name] = bannerOf(spar);
    expect(head).toBe("Round 1-4");
    expect(name).toMatch(/^Fight: (copy of )?\S/);
    expect(bannerOf(planningIn(4))).toEqual(["Round 1-6", "Boss: Snag"]);
    expect(bannerOf({ ...spar, room: 15 })[0]).toBe("Round 19");
  });

  test("shows as a stage begins: a new stage, or the same in another room; never at the start or the end", () => {
    const t = table((s) => s.stage.at === "plan" && s.room === 0);
    const plan = sittingView(t, ME.id);
    const fight = sittingView(advance(t, at(t)), ME.id);
    expect(fight.stage.at).toBe("fight");
    expect(stageBegan(fight, plan)).toBe(true);
    expect(stageBegan(plan, plan)).toBe(false);
    expect(stageBegan({ ...plan, room: 1 }, plan)).toBe(true);
    expect(stageBegan({ ...plan, stage: { at: "over", ended: 0 } }, plan)).toBe(false);
  });
});

describe("the tracker's clock", () => {
  test("counts planning and a fight to their deadlines, and a carousel to the end of the turn being taken", () => {
    const plan = planningIn(0);
    if (plan.stage.at !== "plan") throw new Error("not planning");
    expect(stageClock(plan, plan.stage.until - 12_400)).toEqual({
      label: "Planning",
      seconds: 13,
      end: plan.stage.until,
      most: planMs(0),
    });
    const carousel = viewAt((t) => t.stage.at === "carousel");
    if (carousel.stage.at !== "carousel") throw new Error("not a carousel");
    expect(stageClock(carousel, carousel.stage.ends - 3000)).toEqual({
      label: "Carousel",
      seconds: 3,
      end: carousel.stage.ends,
      most: CLOCK.together,
    });
    const fight = viewAt((t) => t.stage.at === "fight");
    expect(stageClock(fight, 0)).toMatchObject({ label: "Fight", most: null });
  });
});
