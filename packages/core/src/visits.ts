/**
 * Who played, when, where and for how long: the rules that make visits into sessions, and the
 * staff's report of them (who is where, each player's time, the days, how far players get in each
 * game, and anything out of the ordinary). Pure functions over plain rows; Leaf's store reads the
 * rows and writes what these decide.
 */

import { DAY_MS, utcDay } from "./quests.ts";

const HOUR_MS = 60 * 60 * 1000;

// ---------- devices ----------

/** What a page says it is played on, from its own width when it signed in. */
export const DEVICES = ["phone", "desktop"] as const;
export type Device = (typeof DEVICES)[number];

/** A page narrower than this, in CSS pixels, when it signs in is a phone's. */
export const PHONE_WIDTH = 700;

/** The device a page of this width (in CSS pixels) is on. */
export const deviceForWidth = (width: number): Device => (width < PHONE_WIDTH ? "phone" : "desktop");

/** The device a page named, or null for anything that is not one. */
export const readDevice = (named: unknown): Device | null => DEVICES.find((d) => d === named) ?? null;

// ---------- visits and sessions ----------

export interface VisitRules {
  /** An open visit not heard of for this long is closed at the last time it was. */
  readonly silentMs: number;
  /** Visits by one player less than this apart are one session. */
  readonly sessionGapMs: number;
  /** Visits and sessions are kept this long after they end. */
  readonly keptMs: number;
}

export const VISIT_RULES: VisitRules = {
  silentMs: 90_000,
  sessionGapMs: 5 * 60_000,
  keptMs: 180 * DAY_MS,
};

/** How many whole seconds a stay from `enteredAt` to `leftAt` lasted; never fewer than none. */
export const visitSeconds = (enteredAt: number, leftAt: number): number =>
  Math.max(0, Math.floor((leftAt - enteredAt) / 1000));

/**
 * Whether a visit begun at `at` belongs to the player's last session, which ended at `endedAt`
 * (null while one of its visits is still open): it does when less than the gap came between.
 */
export const joinsSession = (endedAt: number | null, at: number, rules: VisitRules = VISIT_RULES): boolean =>
  endedAt === null || at - endedAt < rules.sessionGapMs;

/** Whether an open visit last heard of at `heardAt` has gone silent by `now`, so is to be closed at `heardAt`. */
export const silentSince = (heardAt: number, now: number, rules: VisitRules = VISIT_RULES): boolean =>
  now - heardAt >= rules.silentMs;

// ---------- out of the ordinary ----------

export interface OddRules {
  /** Coins a player's balance may rise in any hour before it is worth a look. */
  readonly coinsInAnHour: number;
  /** Sessions a player may begin in a UTC day before it is worth a look. */
  readonly sessionsInADay: number;
  /** How long one visit may last before it is worth a look. */
  readonly visitMs: number;
}

export const ODD_RULES: OddRules = { coinsInAnHour: 5000, sessionsInADay: 20, visitMs: 12 * HOUR_MS };

export const ODD_KINDS = ["coins_in_an_hour", "sessions_in_a_day", "long_visit", "refused_in_a_day"] as const;
export type OddKind = (typeof ODD_KINDS)[number];

/**
 * Something about one player worth a look. `at` is when it began (the hour's first entry, the UTC
 * day, the visit's start) and `value` how much: the Coins risen, the sessions begun, the visit's
 * seconds, the commands refused.
 */
export interface Odd {
  readonly playerId: string;
  readonly kind: OddKind;
  readonly at: number;
  readonly value: number;
}

/** One entry in a player's Coins ledger. */
export interface CoinMove {
  readonly playerId: string;
  readonly at: number;
  readonly amount: number;
}

/** What a player's commands came to on one UTC day (`day` is its first moment). */
export interface CommandDay {
  readonly playerId: string;
  readonly day: number;
  readonly done: number;
  readonly refused: number;
}

/** The rows the report is made from. */
export interface VisitRow {
  readonly playerId: string;
  readonly place: string;
  readonly enteredAt: number;
  /** Null while the player is there. */
  readonly leftAt: number | null;
}

export interface SessionRow {
  readonly playerId: string;
  readonly startedAt: number;
}

const byPlayer = <A extends { readonly playerId: string }>(rows: readonly A[]): Map<string, A[]> => {
  const out = new Map<string, A[]>();
  for (const row of rows) {
    const those = out.get(row.playerId);
    if (those) those.push(row);
    else out.set(row.playerId, [row]);
  }
  return out;
};

const dayOf = (at: number): number => utcDay(at) * DAY_MS;

/**
 * For each player and UTC day, the most their Coins rose in an hour that began that day, when it
 * is more than the rules allow. An hour is counted from each entry on, to an hour after it.
 */
function coinRises(coins: readonly CoinMove[], from: number, limit: number): Odd[] {
  const out: Odd[] = [];
  for (const [playerId, moves] of byPlayer(coins)) {
    const sorted = moves.toSorted((a, b) => a.at - b.at);
    const best = new Map<number, { at: number; rise: number }>();
    let end = 0;
    let sum = 0;
    for (const [i, start] of sorted.entries()) {
      for (; end < sorted.length && (sorted[end]?.at ?? Infinity) < start.at + HOUR_MS; end++) {
        sum += sorted[end]?.amount ?? 0;
      }
      if (start.at >= from) {
        const day = dayOf(start.at);
        const was = best.get(day);
        if (!was || sum > was.rise) best.set(day, { at: start.at, rise: sum });
      }
      sum -= sorted[i]?.amount ?? 0;
    }
    for (const { at, rise } of best.values()) {
      if (rise > limit) out.push({ playerId, kind: "coins_in_an_hour", at, value: rise });
    }
  }
  return out;
}

/** Everything out of the ordinary from `from` to `now`, newest first. A list to look at; nothing is done about it. */
export function oddities(
  input: {
    readonly coins: readonly CoinMove[];
    readonly sessions: readonly SessionRow[];
    readonly visits: readonly VisitRow[];
    readonly commands: readonly CommandDay[];
    readonly from: number;
    readonly now: number;
  },
  rules: OddRules = ODD_RULES,
): Odd[] {
  const out = coinRises(input.coins, input.from, rules.coinsInAnHour);
  const begun = new Map<string, { playerId: string; day: number; count: number }>();
  for (const s of input.sessions) {
    if (s.startedAt < input.from) continue;
    const day = dayOf(s.startedAt);
    const key = `${s.playerId} ${day}`;
    const was = begun.get(key) ?? { playerId: s.playerId, day, count: 0 };
    begun.set(key, { ...was, count: was.count + 1 });
  }
  for (const { playerId, day, count } of begun.values()) {
    if (count > rules.sessionsInADay) out.push({ playerId, kind: "sessions_in_a_day", at: day, value: count });
  }
  for (const v of input.visits) {
    const end = v.leftAt ?? input.now;
    if (end < input.from || end - v.enteredAt <= rules.visitMs) continue;
    out.push({ playerId: v.playerId, kind: "long_visit", at: v.enteredAt, value: visitSeconds(v.enteredAt, end) });
  }
  for (const c of input.commands) {
    if (c.day + DAY_MS <= input.from || c.refused <= c.done) continue;
    out.push({ playerId: c.playerId, kind: "refused_in_a_day", at: c.day, value: c.refused });
  }
  return out.toSorted((a, b) => b.at - a.at || a.playerId.localeCompare(b.playerId) || a.kind.localeCompare(b.kind));
}

// ---------- the report ----------

/** What Leaf keeps of a player for good. */
export interface SeenRow {
  readonly playerId: string;
  readonly name: string;
  readonly guest: boolean;
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  readonly secondsTotal: number;
}

/** Something a player did in a game, as the play service logged it. `data` is as it was stored. */
export interface DoneRow {
  readonly playerId: string;
  readonly at: number;
  readonly game: string;
  readonly kind: string;
  readonly data: unknown;
}

/** A player's part in the Works, as far as the report needs it: when they first did anything there, and how many story orders they have filled. */
export interface WorksRow {
  readonly playerId: string;
  readonly firstAt: number;
  readonly storyOrders: number;
}

/**
 * What the games log that the report reads (`Done.log` in the play service); the games log them by
 * these names. A raid run is `raid_started` (`trail`), then a `raid_room` for each room fought
 * (`room`, `kind`, `won` true for one won, `resolve` left, the fight's `seconds`), then `raid_ended`
 * (`trail`, `rooms_won`, `ended`: `won`, `lost` or `left`, and the `coins` it paid); the Works logs
 * `works_plot` and `works_plan` for what was bought (`plot` or `plan`, and its `price`),
 * `works_order` for a standing order handed over (`order`, `title`, `pay`) and `works_story` for each
 * story order finished (`order`, its number in the story, `title`, `pay`).
 */
export const LOGGED = {
  raidStarted: "raid_started",
  raidRoom: "raid_room",
  raidEnded: "raid_ended",
  worksPlot: "works_plot",
  worksPlan: "works_plan",
  worksOrder: "works_order",
  worksStory: "works_story",
  townBought: "town_bought",
  townPet: "town_pet",
  townTrophy: "town_trophy",
} as const;

/** How many of the last things a player did the report shows. */
export const DONE_SHOWN = 5;

export interface Report {
  readonly now: number;
  /** Who is in which place now, and since when; by place, then name. */
  readonly here: readonly {
    readonly playerId: string;
    readonly name: string;
    readonly guest: boolean;
    readonly place: string;
    readonly since: number;
  }[];
  /** Everyone who spent any time in the game in the period, most time first. */
  readonly players: readonly {
    readonly playerId: string;
    readonly name: string;
    readonly guest: boolean;
    readonly firstSeenAt: number;
    readonly lastSeenAt: number;
    /** All their time, ever, in seconds. */
    readonly secondsTotal: number;
    /** Their sessions in the period, and their seconds in it, in all and by place. */
    readonly sessions: number;
    readonly seconds: number;
    readonly places: Readonly<Record<string, number>>;
    /** The last few things they did, newest first. */
    readonly done: readonly DoneRow[];
  }[];
  /** Each UTC day of the period, oldest first. Hours are to two places. */
  readonly days: readonly {
    readonly day: number;
    readonly players: number;
    readonly newPlayers: number;
    readonly sessions: number;
    readonly hours: number;
    readonly places: Readonly<Record<string, number>>;
  }[];
  /** Raid runs begun in the period, and how many rooms each won (so far, for one still going). */
  readonly raid: { readonly began: number; readonly byRoomsWon: readonly { roomsWon: number; runs: number }[] };
  /** Players who first went to the Works in the period, and how many story orders each player there in the period has filled. */
  readonly works: {
    readonly began: number;
    readonly byStoryOrders: readonly { storyOrders: number; players: number }[];
  };
  /** Anything out of the ordinary, newest first, with the player's name as last known. */
  readonly odd: readonly (Odd & { readonly name: string })[];
}

/** One day of the report as it is counted up. */
interface DayTally {
  readonly day: number;
  readonly players: Set<string>;
  newPlayers: number;
  sessions: number;
  ms: number;
  readonly places: Record<string, number>;
}

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const hours = (ms: number): number => Math.round((ms / HOUR_MS) * 100) / 100;

const addTo = (to: Record<string, number>, key: string, n: number): void => {
  to[key] = (to[key] ?? 0) + n;
};

/** A histogram of counts, by count, smallest first. */
function tally(counts: Iterable<number>): [number, number][] {
  const by = new Map<number, number>();
  for (const n of counts) by.set(n, (by.get(n) ?? 0) + 1);
  return [...by].toSorted((a, b) => a[0] - b[0]);
}

/** How many rooms each raid run begun in these rows won, from each player's rows in order. */
function raidRuns(rows: readonly DoneRow[]): number[] {
  const runs: number[] = [];
  for (const those of byPlayer(rows).values()) {
    let run: number | null = null;
    for (const row of those) {
      if (row.kind === LOGGED.raidStarted) {
        run = runs.length;
        runs.push(0);
      } else if (row.kind === LOGGED.raidRoom && run !== null && isRecord(row.data) && row.data["won"] === true) {
        runs[run] = (runs[run] ?? 0) + 1;
      } else if (row.kind === LOGGED.raidEnded) {
        run = null;
      }
    }
  }
  return runs;
}

/**
 * The staff's report of the period from `from` to `now`. `visits` and `sessions` are those that
 * reach into the period; `seen` holds what is kept of each player; `done` the last few things each
 * did; `raid` the raid's logged rows in the period, in the order they were logged; `works` each
 * player in the Works in the period.
 */
export function activityReport(
  input: {
    readonly now: number;
    readonly from: number;
    readonly visits: readonly VisitRow[];
    readonly sessions: readonly SessionRow[];
    readonly seen: readonly SeenRow[];
    readonly done: readonly DoneRow[];
    readonly raid: readonly DoneRow[];
    readonly works: readonly WorksRow[];
    readonly coins: readonly CoinMove[];
    readonly commands: readonly CommandDay[];
  },
  rules: OddRules = ODD_RULES,
): Report {
  const { now, from } = input;
  const seen = new Map(input.seen.map((s) => [s.playerId, s]));
  const nameOf = (id: string) => seen.get(id)?.name ?? id;

  const here = input.visits
    .filter((v) => v.leftAt === null)
    .map((v) => ({
      playerId: v.playerId,
      name: nameOf(v.playerId),
      guest: seen.get(v.playerId)?.guest ?? false,
      place: v.place,
      since: v.enteredAt,
    }))
    .toSorted((a, b) => a.place.localeCompare(b.place) || a.name.localeCompare(b.name));

  // Each visit's time inside the period, by player and place, and by UTC day.
  const timeOf = new Map<string, { ms: number; places: Record<string, number>; open: number | null }>();
  const firstDay = utcDay(from);
  const lastDay = utcDay(now);
  const days = Array.from({ length: Math.max(0, lastDay - firstDay + 1) }, (_, k): DayTally => ({
    day: (firstDay + k) * DAY_MS,
    players: new Set(),
    newPlayers: 0,
    sessions: 0,
    ms: 0,
    places: {},
  }));
  const dayAt = (at: number) => days[utcDay(at) - firstDay];
  for (const v of input.visits) {
    const start = Math.max(v.enteredAt, from);
    const end = Math.min(v.leftAt ?? now, now);
    if (end < start) continue;
    const t = timeOf.get(v.playerId) ?? { ms: 0, places: {}, open: null };
    t.ms += end - start;
    addTo(t.places, v.place, end - start);
    if (v.leftAt === null) t.open = v.enteredAt;
    timeOf.set(v.playerId, t);
    dayAt(start)?.players.add(v.playerId);
    for (let at = start; at < end;) {
      const next = Math.min(end, dayOf(at) + DAY_MS);
      const d = dayAt(at);
      if (d) {
        d.players.add(v.playerId);
        d.ms += next - at;
        addTo(d.places, v.place, next - at);
      }
      at = next;
    }
  }
  const sessionsOf = new Map<string, number>();
  for (const s of input.sessions) {
    sessionsOf.set(s.playerId, (sessionsOf.get(s.playerId) ?? 0) + 1);
    if (s.startedAt >= from) {
      const d = dayAt(s.startedAt);
      if (d) d.sessions++;
    }
  }
  for (const s of input.seen) {
    if (s.firstSeenAt < from) continue;
    const d = dayAt(s.firstSeenAt);
    if (d) d.newPlayers++;
  }
  const doneOf = byPlayer(input.done);

  const players = [...timeOf]
    .map(([playerId, t]) => {
      const kept = seen.get(playerId);
      const openFor = t.open === null ? 0 : visitSeconds(t.open, now);
      return {
        playerId,
        name: nameOf(playerId),
        guest: kept?.guest ?? false,
        firstSeenAt: kept?.firstSeenAt ?? from,
        lastSeenAt: t.open === null ? (kept?.lastSeenAt ?? now) : now,
        secondsTotal: (kept?.secondsTotal ?? 0) + openFor,
        sessions: sessionsOf.get(playerId) ?? 0,
        seconds: Math.floor(t.ms / 1000),
        places: Object.fromEntries(Object.entries(t.places).map(([place, ms]) => [place, Math.floor(ms / 1000)])),
        done: (doneOf.get(playerId) ?? []).toSorted((a, b) => b.at - a.at).slice(0, DONE_SHOWN),
      };
    })
    .toSorted((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));

  return {
    now,
    here,
    players,
    days: days.map((d) => ({
      day: d.day,
      players: d.players.size,
      newPlayers: d.newPlayers,
      sessions: d.sessions,
      hours: hours(d.ms),
      places: Object.fromEntries(Object.entries(d.places).map(([place, ms]) => [place, hours(ms)])),
    })),
    raid: (() => {
      const runs = raidRuns(input.raid.filter((r) => r.at >= from));
      return { began: runs.length, byRoomsWon: tally(runs).map(([roomsWon, n]) => ({ roomsWon, runs: n })) };
    })(),
    works: {
      began: input.works.filter((w) => w.firstAt >= from).length,
      byStoryOrders: tally(input.works.map((w) => w.storyOrders)).map(([storyOrders, n]) => ({
        storyOrders,
        players: n,
      })),
    },
    odd: oddities(
      { coins: input.coins, sessions: input.sessions, visits: input.visits, commands: input.commands, from, now },
      rules,
    ).map((odd) => ({
      playerId: odd.playerId,
      kind: odd.kind,
      at: odd.at,
      value: odd.value,
      name: nameOf(odd.playerId),
    })),
  };
}
