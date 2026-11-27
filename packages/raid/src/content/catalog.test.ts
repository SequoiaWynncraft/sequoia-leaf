/**
 * What exists, when: the releases on Leaf's clock, the catalogue each era has, and every draw a
 * millisecond before each release and at it, as the content has them and as a made-up spread of
 * releases would. A run and a sitting picked up across a release draw from the new era from their
 * next move, and what was drawn before stays as drawn.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { type Ctx, isRefused } from "@sequoia-leaf/core";

import { boardMet } from "../foe.ts";
import { RAID, type Table } from "../game.ts";
import { advance } from "../sitting/clock.ts";
import { command, openSitting } from "../sitting/commands.ts";
import type { Sitting } from "../sitting/sitting.ts";
import { abc, at as placed, partyOfFigures } from "../testkit.ts";
import { type Banner, BANNERS, GROVE } from "./banners.ts";
import {
  available,
  type Catalog,
  catalogAt,
  everyFigure,
  type Figure,
  type Purpose,
  RARITY_IDS,
  type Roster,
} from "./catalog.ts";
import { FIGURE_IDS, type FigureId, isFigureId, TIERS } from "./figures.ts";
import { MEMBER_IDS } from "./members.ts";
import { type Era, eraAt, eraOf, LAST_ERA, LEGACY_ERA, type ReleaseId, RELEASES } from "./releases.ts";

const releaseOf = (id: ReleaseId) => RELEASES.find((r) => r.id === id) ?? RELEASES[0];
/** The releases that open on a day of their own, and the two moments each is looked at: a millisecond before, and at it. */
const DATED = RELEASES.filter((r) => r.at > 0);
const MOMENTS = DATED.flatMap((r) => [
  { release: r.id, t: r.at - 1, said: `a millisecond before ${r.id}` },
  { release: r.id, t: r.at, said: `at ${r.id}` },
]);

describe("the releases", () => {
  test("open in order on Leaf's clock: the base, the expansion's first and gaz-stall at once, each banner's on its day", () => {
    expect(RELEASES.map((r) => [r.id, r.at])).toEqual([
      ["base", 0],
      ["groot", 0],
      ["gaz-stall", 0],
      ["groot-night", Date.UTC(2026, 11, 8)],
      ["penguin-month", Date.UTC(2026, 11, 22)],
      ["up-the-tree", Date.UTC(2027, 0, 5)],
    ]);
    for (const r of DATED) {
      const before = RELEASES.indexOf(r);
      expect([eraAt(r.at - 1), eraAt(r.at)].map(Number)).toEqual([before, before + 1]);
    }
    // What no era means stays the era of the expansion's first release, whatever opens after it.
    expect([eraAt(0), LEGACY_ERA, LAST_ERA, eraAt(Number.MAX_SAFE_INTEGER)]).toEqual([
      eraOf("gaz-stall"),
      eraOf("groot"),
      eraOf("up-the-tree"),
      eraOf("up-the-tree"),
    ]);
    expect(Number(LEGACY_ERA)).toBe(2);
  });
});

describe("the catalogue", () => {
  test("draws in the order it drew in when eras came in, which each era only adds to; every figure has a release", () => {
    // As they were drawn when eras came in: Seqwawa, of the expansion's first release, before the first
    // banner's headliner; Groot Night's after all of them, everyone's first and then its headliner; then Penguin Month's.
    const night: readonly FigureId[] = ["peep", "crab31", "munch", "clutch", "crab8", "commodore"];
    const penguins: readonly FigureId[] = ["dibs", "jet", "larp", "flurry", "pomp", "yule"];
    const drawn = [...FIGURE_IDS, ...MEMBER_IDS].filter((id) => !night.includes(id) && !penguins.includes(id));
    expect(catalogAt(LEGACY_ERA).order).toEqual(drawn);
    expect(catalogAt(eraOf("base")).order).toEqual(drawn.filter((id) => id !== "seqwawa"));
    expect(catalogAt(eraOf("groot-night")).order).toEqual([...drawn, ...night]);
    expect(catalogAt(eraOf("penguin-month")).order).toEqual([...drawn, ...night, ...penguins]);
    expect(catalogAt(LAST_ERA).order).toEqual([...drawn, ...night, ...penguins]);
    // No era moves a figure past another; from the era live when eras came in, each only adds at the end.
    for (const [r, next] of RELEASES.slice(1).map((n, i) => [RELEASES[i] ?? n, n] as const)) {
      const [was, is] = [catalogAt(eraOf(r.id)), catalogAt(eraOf(next.id))];
      expect(is.order.filter((id) => was.order.includes(id))).toEqual([...was.order]);
      if (was.era >= LEGACY_ERA) expect(is.order.slice(0, was.order.length)).toEqual([...was.order]);
    }
    // Every figure stored data may name (`isFigureId`) is in the catalogue with every release open, and nothing else is.
    expect(abc(everyFigure())).toEqual(abc([...FIGURE_IDS, ...MEMBER_IDS]));
    expect(everyFigure().every(isFigureId)).toBe(true);
  });
  test("gives each figure the rarity the pulls give it as, and a banner's headliner to whoever pulls it", () => {
    const base = catalogAt(eraOf("base"));
    const by = (prize: string) => base.order.filter((id) => base.figures[id]?.prize === prize);
    expect(RARITY_IDS.map((r) => by(r).length)).toEqual([7, 7, 6, 3, 2, 3, 1]);
    expect([by("Druid"), by("Yggdrasil")]).toEqual([["crab40", "apothecary"], ["banner-1"]]);
    // A banner opens no earlier than its release, which brings its headliner: it is in no catalogue before.
    for (const banner of BANNERS) {
      expect(banner.from).toBeGreaterThanOrEqual(releaseOf(banner.opens).at);
      expect(catalogAt(eraOf(banner.opens)).figures[banner.headliner]?.access).toEqual({ headliner: banner.id });
      const before = RELEASES[RELEASES.findIndex((r) => r.id === banner.opens) - 1];
      if (before) expect(catalogAt(eraOf(before.id)).figures[banner.headliner]).toBeUndefined();
    }
  });
});

// ---------- every draw, a millisecond before a release and at it ----------

/**
 * When a figure is first open: as its release opens. When it joins the pulls: then, or as the next
 * release that joins as it opens does.
 */
const opens = (f: Figure): number => releaseOf(f.since).at;
function joins(f: Figure): number {
  const at = RELEASES.findIndex((r) => r.id === f.since);
  const r = RELEASES[at];
  return r?.joins === "opening" ? r.at : (RELEASES.slice(at + 1).find((n) => n.joins === "opening")?.at ?? Infinity);
}
/** A roster of every figure there is. */
const EVERYTHING: Roster = Object.fromEntries(everyFigure().map((id) => [id, 0]));
const shared = (f: Figure): boolean => f.access === "shared";
/** Whether a banner is open at a moment of Leaf's clock, by its own dates. */
const openAt = (banner: Banner, t: number): boolean => banner.from <= t && t < banner.until;
/** One of everyone's figures at a moment: a grove figure always, a banner's headliner while its banner is open. */
function everyones({ access }: Figure, t: number): boolean {
  return access === "shared" || BANNERS.some((b) => b.id === access.headliner && openAt(b, t));
}

/** A draw, and what it should give at a moment: every figure that suits it, once it is open (or has joined the pulls). */
interface Case {
  readonly name: string;
  readonly purpose: Purpose;
  readonly suits: (f: Figure, t: number) => boolean;
  readonly from: (f: Figure) => number;
}
const CASES: readonly Case[] = [
  ...TIERS.map((tier): Case => ({
    name: `the stall at ${tier} acorns`,
    purpose: { for: "stall", figures: { pool: "fair" }, tier },
    suits: (f, t) => everyones(f, t) && f.tier === tier,
    from: opens,
  })),
  ...TIERS.map((tier): Case => ({
    name: `the stall at ${tier} acorns, with every figure pulled`,
    purpose: { for: "stall", figures: { pool: "own", roster: EVERYTHING }, tier },
    suits: (f) => f.tier === tier,
    from: opens,
  })),
  {
    name: "the first pick",
    purpose: { for: "starter" },
    suits: (f, t) => everyones(f, t) && f.tier === 1,
    from: opens,
  },
  { name: "a regular", purpose: { for: "regular" }, suits: everyones, from: opens },
  ...TIERS.map((tier): Case => ({
    name: `the carousel at ${tier} acorns`,
    purpose: { for: "carousel", tier },
    suits: (f, t) => everyones(f, t) && f.tier === tier,
    from: opens,
  })),
  ...RARITY_IDS.map((rarity): Case => ({
    name: `the grove's ${rarity}`,
    purpose: { for: "pull", pool: GROVE, rarity },
    suits: (f) => shared(f) && f.prize === rarity,
    from: joins,
  })),
  // A banner's prizes are what it opened with, from its release on; its headliner is its top prize.
  ...BANNERS.flatMap((banner) =>
    RARITY_IDS.map((rarity): Case => ({
      name: `${banner.id}'s ${rarity}`,
      purpose: { for: "pull", pool: banner.id, rarity },
      suits: (f) =>
        rarity === "Yggdrasil"
          ? f.access !== "shared" && f.access.headliner === banner.id
          : shared(f) && f.prize === rarity,
      from: (f) =>
        rarity === "Yggdrasil" || joins(f) <= releaseOf(banner.opens).at
          ? Math.max(opens(f), releaseOf(banner.opens).at)
          : Infinity,
    })),
  ),
  {
    name: "the exchange",
    purpose: { for: "exchange" },
    suits: (f) => shared(f) && (f.prize === "Dryad" || f.prize === "Druid"),
    from: joins,
  },
  { name: "the almanac", purpose: { for: "almanac", roster: {} }, suits: everyones, from: opens },
  {
    name: "the almanac, every figure pulled",
    purpose: { for: "almanac", roster: EVERYTHING },
    suits: () => true,
    from: opens,
  },
];

/** Every case at every moment that differs from what it should give, by the catalogues of each era (`eras`) and every figure's own (`ever`). */
function differing(eras: (era: Era) => Catalog, ever: Catalog): string[] {
  return MOMENTS.flatMap(({ t, said }) =>
    CASES.flatMap((c) => {
      const want = ever.order.filter((id) => {
        const f = ever.figures[id];
        return f !== undefined && c.suits(f, t) && c.from(f) <= t;
      });
      const got = available(eras(eraAt(t)), c.purpose);
      return abc(got).join() === abc(want).join() ? [] : [`${c.name}, ${said}: ${got.join(" ")} for ${want.join(" ")}`];
    }),
  );
}

/**
 * A made-up spread of the same figures over the releases: Greg with the expansion's first (open
 * at once, but in the pulls only from the next release, as a figure made during a banner is), the
 * Reed Heron and the Emberkit with Groot Night, the Jay with Penguin Month, the Rock in January.
 */
const MOVED: Partial<Record<FigureId, ReleaseId>> = {
  greg: "groot",
  heron: "groot-night",
  emberkit: "groot-night",
  jay: "penguin-month",
  rock: "up-the-tree",
};
function madeUp(era: Era): Catalog {
  const real = catalogAt(LAST_ERA);
  const figures: Partial<Record<FigureId, Figure>> = {};
  const order: FigureId[] = [];
  for (const { id: release } of RELEASES.slice(0, era)) {
    for (const id of real.order) {
      const f = real.figures[id];
      const since = MOVED[id] ?? f?.since;
      if (!f || since !== release) continue;
      // Who is everyone's is the era's own, by the banners' dates.
      figures[id] = { ...f, since, everyones: catalogAt(era).figures[id]?.everyones ?? f.everyones };
      order.push(id);
    }
  }
  // Its earlier eras are the made-up spread's too: what a banner's pool was when it opened.
  return { ...catalogAt(era), figures, order, earlier: madeUp };
}

// ---------- a headliner is everyone's only while its banner is open ----------

/** The headliners, and what everyone's ways have of them: the stall at five acorns, the regulars, the carousel, the almanac, a board met. */
const HEADLINERS = BANNERS.map((b) => b.headliner);
function everyonesWays(cat: Catalog): Record<string, FigureId[]> {
  const of = (ids: readonly FigureId[]): FigureId[] => ids.filter((id) => HEADLINERS.includes(id));
  const met = (id: FigureId): boolean =>
    cat.figures[id] !== undefined &&
    boardMet(cat, { player: "p", name: "A member", of: 1, data: partyOfFigures([placed(id, 3, 0)]) }) !== null;
  return {
    stall: of(available(cat, { for: "stall", figures: { pool: "fair" }, tier: 5 })),
    regular: of(available(cat, { for: "regular" })),
    carousel: of(available(cat, { for: "carousel", tier: 5 })),
    starter: of(available(cat, { for: "starter" })),
    almanac: of(available(cat, { for: "almanac", roster: {} })),
    met: HEADLINERS.filter(met),
  };
}
/** The grove's Treants in a release's era. */
const groveTreants = (release: ReleaseId) =>
  available(catalogAt(eraOf(release)), { for: "pull", pool: GROVE, rarity: "Treant" });
/** Every one of everyone's ways with these headliners, and the starter with none: a headliner costs five acorns. */
const all = (...ids: FigureId[]) => ({ stall: ids, regular: ids, carousel: ids, starter: [], almanac: ids, met: ids });

describe("a headliner is everyone's only while its banner is open", () => {
  test("every banner opens and closes on a release's moment, but the first's opening, inside gaz-stall's era", () => {
    const moments = new Set<number>(RELEASES.map((r) => r.at));
    const off = BANNERS.flatMap((b) => [
      ...(moments.has(b.from) ? [] : [`${b.id} from`]),
      ...(moments.has(b.until) ? [] : [`${b.id} until`]),
    ]);
    expect(off).toEqual(["banner-1 from"]);
    const first = BANNERS.find((b) => b.id === "banner-1");
    expect(first && eraAt(first.from)).toBe(eraOf("gaz-stall"));
  });

  test("era by era: owners' only before gaz-stall, then each headliner for its banner's two weeks", () => {
    expect(RELEASES.map((r) => everyonesWays(catalogAt(eraOf(r.id))))).toEqual([
      all(),
      all(),
      all("banner-1"),
      all("commodore"),
      all("yule"),
      all(),
    ]);
  });

  test("a millisecond before each release and at it, as Leaf's clock has the era", () => {
    const got = MOMENTS.map(({ t, said }) => [said, everyonesWays(catalogAt(eraAt(t)))]);
    const want = MOMENTS.map(({ t, said }) => [
      said,
      all(...BANNERS.filter((b) => openAt(b, t)).map((b) => b.headliner)),
    ]);
    expect(got).toEqual(want);
    expect(got.slice(0, 2)).toEqual([
      ["a millisecond before groot-night", all("banner-1")],
      ["at groot-night", all("commodore")],
    ]);
  });

  test("a member who pulled one keeps it for a run with their own figures, at every era, and nobody else has it there", () => {
    for (const r of RELEASES) {
      const cat = catalogAt(eraOf(r.id));
      const own = (roster: Roster): readonly FigureId[] =>
        available(cat, { for: "stall", figures: { pool: "own", roster }, tier: 5 });
      expect([own({ "banner-1": 2 }), own({ greg: 0 })]).toEqual([["banner-1"], ["greg"]]);
      expect(available(cat, { for: "almanac", roster: { "banner-1": 2 } })).toContain("banner-1");
      const board = { player: "p", name: "A member", of: 1, data: partyOfFigures([placed("banner-1", 3, 0, 1)]) };
      expect(boardMet(cat, board, true)).not.toBeNull();
      // It is still its banner's prize, and nothing else's.
      expect(cat.figures["banner-1"]?.access).toEqual({ headliner: "banner-1" });
    }
    // Seqwawa still joins the pulls on 8 December.
    expect([groveTreants("gaz-stall").includes("seqwawa"), groveTreants("groot-night").includes("seqwawa")]).toEqual([
      false,
      true,
    ]);
  });
});

describe("a millisecond before each release, and at it", () => {
  test("every stall, first pick, regular, carousel, pull, the exchange and the almanac give what is open then", () => {
    expect(differing(catalogAt, catalogAt(LAST_ERA))).toEqual([]);
  });
  test("and so they would if the releases brought figures: a made-up spread of them", () => {
    expect(differing(madeUp, madeUp(LAST_ERA))).toEqual([]);
    const night = releaseOf("groot-night").at;
    const [before, at] = [madeUp(eraAt(night - 1)), madeUp(eraAt(night))];
    const five: Purpose = { for: "stall", figures: { pool: "fair" }, tier: 5 };
    const treants: Purpose = { for: "pull", pool: GROVE, rarity: "Treant" };
    // Greg is on the stall from the first, and in the pulls only from the next release.
    expect([available(before, five).includes("greg"), available(before, treants).includes("greg")]).toEqual([
      true,
      false,
    ]);
    expect(available(at, treants)).toContain("greg");
    // The first banner pays out of what it opened with, to its end.
    expect(available(at, { for: "pull", pool: "banner-1", rarity: "Treant" })).not.toContain("greg");
    expect([available(before, { for: "regular" }), available(before, { for: "exchange" })].flat()).not.toContain(
      "heron",
    );
    expect(available(at, { for: "exchange" })).toContain("heron");
    expect(available(at, { for: "starter" })).toContain("emberkit");
  });
});

// ---------- picked up across a release ----------

const ctxAt = (now: number, seed = 1): Ctx => ({
  now,
  player: { id: "10000000-0000-0000-0000-00000000ca7a", guest: false },
  seed,
  room: 1e9,
  awards: [],
  postcards: {},
});
function done(table: Table, c: unknown, now: number, seed = 1): Table {
  const read = RAID.command(c);
  if (!read) throw new Error(`no command ${JSON.stringify(c)}`);
  const answer = RAID.apply(table, read, ctxAt(now, seed));
  if (isRefused(answer)) throw new Error(`refused ${JSON.stringify(c)}: ${answer.refused}`);
  return answer.state;
}

/** The era of each seat's run at a sitting. */
const seats = (t: Sitting): Era[] => t.seats.map((seat) => seat.run.era);

describe("picked up across a release", () => {
  test.each(DATED.map((r) => [r.id, r.at] as const))(
    "a run moves into %s's era with its next command; what it drew and the fight it locked stay as they were",
    (_id, at) => {
      let table = RAID.create(ctxAt(at - 1));
      for (const c of [{ do: "start", trail: 0 }, { do: "choose", option: 0 }, { do: "fight" }])
        table = done(table, c, at - 1);
      const [old, now] = [eraAt(at - 1), eraAt(at)];
      expect([
        table.era,
        table.held.main?.era,
        table.held.main?.stage.phase === "fight" && table.held.main.stage.fight.setup.era,
      ]).toEqual([old, old, old]);
      // Leaf's clock passes the release: the table is in the new era, and so is the page's view; the run is as it was.
      const later = RAID.advance(table, ctxAt(at));
      expect([later.era, RAID.view(later, ctxAt(at)).era, later.held.main?.era]).toEqual([now, now, old]);
      expect(later.held.main?.stall).toEqual(table.held.main?.stall);
      // Its next command moves it: it draws its next stall from the new era, and the fight it took stays the old era's.
      const taken = done(later, { do: "take" }, at);
      expect([taken.held.main?.era, taken.held.main?.last?.era]).toEqual([now, old]);
      const sold = new Set(
        TIERS.flatMap((tier) => available(catalogAt(now), { for: "stall", figures: { pool: "fair" }, tier })),
      );
      expect((taken.held.main?.stall ?? []).filter((kind) => kind !== null && !sold.has(kind))).toEqual([]);
    },
  );

  test.each(DATED.map((r) => [r.id, r.at] as const))(
    "a sitting takes %s's era at the first deadline at or after it, in one call or many",
    (_id, at) => {
      const member = { id: "10000000-0000-0000-0000-00000000ca7b", name: "A member" };
      const opened = openSitting({ now: at - 90_000, seed: 3, player: member });
      const started = command(opened, { do: "start" }, { now: at - 90_000, seed: 4, player: member });
      if (!started.ok) throw new Error(started.why);
      const old = eraAt(at - 1);
      expect([started.sitting.era, ...seats(started.sitting)]).toEqual(Array.from({ length: 9 }, () => old));
      let stepped = started.sitting;
      for (let now = at - 90_000; now <= at + 120_000; now += 1000) stepped = advance(stepped, now);
      const once = advance(started.sitting, at + 120_000);
      expect(once).toEqual(stepped);
      expect([once.era, ...seats(once)]).toEqual(Array.from({ length: 9 }, () => eraAt(at)));
      expect(advance(started.sitting, at - 1).era).toBe(old);
    },
  );
});

describe("a live table across a release", () => {
  test.each(DATED.map((r) => [r.id, r.at] as const))(
    "plans a room begun before %s in the era it began in, the regulars' lock too; the next room is the new era's",
    (_id, at) => {
      const member = { id: "10000000-0000-0000-0000-00000000ca7c", name: "A member" };
      // Started 20 seconds before: the carousel ends 8 seconds before, and the room's planning, begun then, locks after.
      const opened = openSitting({ now: at - 20_000, seed: 5, player: member });
      const started = command(opened, { do: "start" }, { now: at - 20_000, seed: 6, player: member });
      if (!started.ok) throw new Error(started.why);
      const [old, now] = [eraAt(at - 1), eraAt(at)];
      const planning = advance(started.sitting, at - 1);
      expect([planning.stage.at, planning.era]).toEqual(["plan", old]);
      const lock = planning.stage.at === "plan" ? planning.stage.until : 0;
      expect(lock).toBeGreaterThan(at);
      // The member rerolls after the release: in the era the room began in.
      const rerolled = command(planning, { do: "rustle" }, { now: at + 1000, seed: 7, player: member });
      if (!rerolled.ok) throw new Error(rerolled.why);
      expect([rerolled.sitting.era, rerolled.sitting.seats[0]?.run.era]).toEqual([old, old]);
      // At the lock everyone's fight, the regulars' planned with the rest, is the room's era; what comes next is the new one.
      const locked = advance(rerolled.sitting, lock);
      expect(locked.stage.at).toBe("fight");
      const setups = locked.seats.flatMap((seat) =>
        seat.run.stage.phase === "fight" ? [seat.run.stage.fight.setup.era] : [],
      );
      expect(setups).toEqual(Array.from({ length: 8 }, () => old));
      expect([locked.era, ...seats(locked)]).toEqual(Array.from({ length: 9 }, () => now));
    },
  );
});

// ---------- nothing else lists the figures ----------

/** The repository's own TypeScript files, from its root, skipping what is installed. */
function sources(dir: string, from: string): string[] {
  return readdirSync(join(from, dir)).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".")) return [];
    const path = join(dir, name);
    if (statSync(join(from, path)).isDirectory()) return sources(path, from);
    return name.endsWith(".ts") ? [path] : [];
  });
}

test("no list of figures or of prizes is named outside the catalogue's own files", () => {
  const root = join(import.meta.dir, "../../../..");
  const named = ["apps", "packages"]
    .flatMap((dir) => sources(dir, root))
    .filter((path) => !path.startsWith(join("packages", "raid", "src", "content")))
    .filter((path) => /\b(FIGURE_IDS|MEMBER_IDS|PRIZES)\b/.test(readFileSync(join(root, path), "utf8")));
  expect(named).toEqual([]);
});
