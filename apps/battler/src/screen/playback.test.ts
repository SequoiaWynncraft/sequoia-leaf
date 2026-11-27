import { describe, expect, test } from "bun:test";

import { type FightEvent, type FightSetup, LEGACY_ERA, playsAsKept, recordFight, summarise } from "@sequoia-leaf/raid";
import { isUnitKind, specOf, type Stars, TROUBLE_IDS, type UnitKind } from "@sequoia-leaf/raid/content/figures.ts";
import { CASTS } from "@sequoia-leaf/raid/fight/abilities.ts";
import { at, CAT, EVERYONES, partyOfFigures } from "@sequoia-leaf/raid/testkit.ts";

import type { Speed } from "./keep.ts";
import { leadOf, LOOKS, SWING_LEAD, VOICES } from "./looks.ts";
import {
  advance,
  holdFor,
  keepNewest,
  type Lead,
  LOOK,
  openPlayback,
  type Playback,
  sparksFor,
  STOP_GAP,
  stopFor,
} from "./playback.ts";

/** A party seated as a member would seat it: reach 1 in front, reach 2 behind them, the rest at the back. */
function seated(kinds: readonly UnitKind[], stars: Stars = 1): ReturnType<typeof at>[] {
  const used = new Map<number, number>();
  return kinds.map((kind) => {
    const range = specOf(CAT, kind).range;
    const row = range <= 1 ? 0 : range === 2 ? 1 : 3;
    const col = used.get(row) ?? 0;
    used.set(row, col + 1);
    return at(kind, col % 7, row, stars);
  });
}
const setupOf = (
  ours: readonly UnitKind[],
  theirs: readonly UnitKind[],
  seed: number,
  stars: Stars = 1,
): FightSetup => ({
  seed,
  era: LEGACY_ERA,
  sides: [partyOfFigures(seated(ours, stars)), partyOfFigures(seated(theirs, stars))],
});

/** Every figure, the banner's member, the forest's own and its bosses, in fights of eight against eight. */
const SETUPS: readonly FightSetup[] = [
  setupOf(EVERYONES.slice(0, 8), EVERYONES.slice(8, 16), 1),
  setupOf(EVERYONES.slice(16, 24), EVERYONES.slice(0, 8), 2, 2),
  setupOf([...EVERYONES.slice(24), "banner-1", "glorp", "worm", "fogowl"], EVERYONES.slice(8, 16), 3, 2),
  // Graid at five, falling and rising in true forms, and Seqwawa standing them back up.
  setupOf(["worm", "moth", "rock", "greg", "whitefox", "seqwawa"], EVERYONES.slice(18, 26), 5, 2),
  setupOf(
    EVERYONES.slice(8, 16),
    TROUBLE_IDS.filter((k) => k !== "oldbramble" && k !== "hoardmagpie"),
    4,
  ),
  setupOf(
    ["greg", "whitefox", "hearthcat", "badger", "crab40", "apothecary", "heron", "kettle"],
    ["oldbramble", "hoardmagpie", "toadstool", "gust"],
    5,
    3,
  ),
];

/** Plays a fight as the page does, a frame at a time, holding the clock on hard blows and falls; gives back what it showed and the lead-ins as they began, with the clock then. */
function playAsThePage(
  setup: FightSetup,
  speed: Speed,
): { shown: FightEvent[]; leads: { lead: Lead; clock: number }[]; pb: Playback } {
  const pb = openPlayback(setup, leadOf);
  const shown: FightEvent[] = [];
  const leads: { lead: Lead; clock: number }[] = [];
  for (let frame = 0; frame < 200_000 && !pb.fight.over; frame++) {
    const moved = advance(pb, 1 / 60, speed);
    for (const lead of moved.begun) leads.push({ lead, clock: pb.clock });
    for (const cue of moved.happened) {
      shown.push(cue.ev);
      if (cue.ev.t === "hit" && cue.ev.hard) holdFor(pb, "hard", speed);
      if (cue.ev.t === "fall") holdFor(pb, "fall", speed);
    }
  }
  return { shown, leads, pb };
}

describe("the fight on the table", () => {
  test("is the rules' own fight, event for event, to the same end, at every speed", () => {
    for (const setup of SETUPS) {
      const kept = recordFight(setup);
      for (const speed of [1, 2, 4] as const) {
        const { shown, pb } = playAsThePage(setup, speed);
        expect(shown).toEqual([...kept.opening, ...kept.steps.flat()]);
        expect(playsAsKept({ setup, outcome: summarise(pb.fight) })).toBe(true);
      }
    }
  });

  test("begins each lead-in its full length before what it leads into", () => {
    for (const setup of SETUPS.slice(0, 3)) {
      const { leads, pb } = playAsThePage(setup, 1);
      expect(leads.length).toBeGreaterThan(50);
      for (const { lead, clock } of leads) {
        expect(lead.at - lead.from).toBe(Math.min(LOOK, leadOf(lead.ev, pb.ahead)));
        // Begun within a frame of when it was due, before the step it leads into is shown.
        expect(clock - lead.from).toBeLessThan(1);
        expect(clock).toBeLessThan(lead.at);
      }
    }
  });

  test("lunges in time for a blow to peak as its hit lands", () => {
    // Two figures that touch from the start, so nothing keeps either busy before a blow.
    const setup = setupOf(["crab40"], ["rock"], 9);
    const { leads, shown } = playAsThePage(setup, 1);
    const swings = leads.filter((l) => l.lead.ev.t === "swing");
    expect(swings.length).toBe(shown.filter((ev) => ev.t === "swing").length);
    for (const { lead } of swings) expect(lead.at - lead.from).toBe(SWING_LEAD);
  });

  test("starts a leaper on its way so that it comes down as its ability goes off", () => {
    const setup = setupOf(["fogowl", "crab40"], ["rock", "slug", "kettle"], 12);
    const { leads } = playAsThePage(setup, 1);
    const casts = leads.filter((l) => l.lead.ev.t === "cast" && l.lead.ev.kind === "fogowl");
    const leaps = leads.filter((l) => l.lead.ev.t === "leap");
    // One already beside the enemy furthest away swoops where it stands, without a leap.
    const paired = casts.flatMap(({ lead }) => {
      const owl = lead.ev.t === "cast" ? lead.ev.id : -1;
      const leap = leaps.find((l) => l.lead.at === lead.at && l.lead.ev.t === "leap" && l.lead.ev.id === owl);
      return leap ? [{ cast: lead, leap: leap.lead }] : [];
    });
    expect(paired.length).toBeGreaterThan(0);
    for (const { cast, leap } of paired) {
      // The wind-up comes first, then the leap, and both end as the ability goes off.
      expect(cast.from).toBeLessThan(leap.from);
      expect(leap.at - leap.from).toBe(LOOKS.fogowl?.leap ?? 0);
    }
  });
});

describe("the hit-stop", () => {
  test("is shorter the faster the fight is watched, and almost nothing at 4x", () => {
    for (const w of ["hard", "many", "fall", "big"] as const) {
      expect(stopFor(w, 2)).toBeLessThan(stopFor(w, 1));
      expect(stopFor(w, 4)).toBeLessThan(stopFor(w, 2));
      expect(stopFor(w, 4)).toBeLessThan(1 / 60);
    }
    expect(stopFor("hard", 1)).toBeLessThan(stopFor("fall", 1));
    expect(stopFor("fall", 1)).toBeLessThan(stopFor("big", 1));
  });

  test("holds the clock, and blows close together hold only as long as the longest", () => {
    const pb = openPlayback(setupOf(["crab7"], ["crab12"], 1), leadOf);
    advance(pb, 1, 1);
    const before = pb.clock;
    holdFor(pb, "hard", 1);
    holdFor(pb, "hard", 1);
    expect(pb.held).toBeCloseTo(stopFor("hard", 1));
    advance(pb, stopFor("hard", 1) / 2, 1);
    holdFor(pb, "fall", 1);
    // A fall just after a hard hit: the two together hold for as long as a fall.
    expect(pb.held + stopFor("hard", 1) / 2).toBeCloseTo(stopFor("fall", 1));
    advance(pb, pb.held, 1);
    expect(pb.clock).toBeCloseTo(before);
    advance(pb, STOP_GAP, 1);
    holdFor(pb, "hard", 1);
    expect(pb.held).toBeCloseTo(stopFor("hard", 1));
  });
});

describe("what the table shows of it", () => {
  test("keeps half as many sparks on a phone, dropping the oldest", () => {
    expect(sparksFor(390, 844)).toBe(sparksFor(1280, 760) / 2);
    const sparks = Array.from({ length: 10 }, (_, i) => i);
    keepNewest(sparks, 4);
    expect(sparks).toEqual([6, 7, 8, 9]);
  });

  test("has a look and a sound of its own for every ability", () => {
    const casting = [...Object.keys(CASTS), "toadstool"].filter(isUnitKind);
    expect(casting.length).toBe(Object.keys(CASTS).length + 1);
    for (const kind of casting) {
      expect(LOOKS[kind]).toBeDefined();
      expect(VOICES[kind]).toBeDefined();
    }
    for (const look of Object.values(LOOKS)) expect(look.wind + (look.leap ?? 0)).toBeLessThanOrEqual(LOOK);
  });
});
