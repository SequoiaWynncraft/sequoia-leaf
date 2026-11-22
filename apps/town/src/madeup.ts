/**
 * The made-up guild: the answer to the questions in `guild.ts` when there is no server (the lab
 * site, the tours, the tests). Nothing here talks to a server, and nobody here is a real member. It
 * keeps a little memory of its own (how far along the quests are, how many raids and lands there
 * have been), as a server would, and hands it to whoever made it to be kept.
 *
 * So that visitors and members dozing in town can be seen without a server, it has four stand-in
 * members with made-up looks: two in the game, two gone a while. Beside the real guild (`quiet`)
 * they never exist, and all it does is send the town's own to call at the member's camp.
 */

import type { Look } from "@sequoia-leaf/kit/skin.ts";
import { LOST_CRAB, PIECES, PRESENTS, STALLS, WARES } from "@sequoia-leaf/town/catalogue.ts";
import { CALLERS, capital, FIRST_CALL, folk, GIFTS, NOTES, WHILE_AWAY } from "@sequoia-leaf/town/folk.ts";
import { type Letter, letter } from "@sequoia-leaf/town/mail.ts";

import type {
  Away,
  AwayLine,
  Guild,
  Happening,
  Mate,
  MateCamp,
  Me,
  Moment,
  Person,
  Quest,
  Rester,
  Visitor,
} from "./guild.ts";
import { lineFor } from "./news.ts";

const RANKS = ["Seedling", "Sapling", "Ranger", "Warden", "Elder"] as const;

const YOU: Look = {
  skin: "#eec39a",
  hair: "#6f3826",
  light: "#a35d3b",
  eye: "#243a66",
  top: "#b84d84",
  legs: "#3d2050",
  shoes: "#3b1f19",
  style: "short",
  sleeves: "long",
  detail: "scarf",
  trim: "#f5b95e",
};

/** A stand-in member: made up, for looking at the town without a server. */
interface Standin {
  name: string;
  rank: string;
  level: number;
  at: Visitor["at"];
  /** Gone this many minutes ago, dozing in town; or in the game now. */
  gone: number | null;
}

/** The four stand-ins: two in the game, two gone a while and dozing. They never exist on a live server. */
export const STANDINS: readonly Standin[] = [
  { name: "Quillfeather", rank: "Elder", level: 104, at: "town", gone: null },
  { name: "Fernwhistle", rank: "Seedling", level: 12, at: "table", gone: null },
  { name: "Wrenly", rank: "Ranger", level: 72, at: "town", gone: 180 },
  { name: "Kestrelle", rank: "Warden", level: 88, at: "works", gone: 40 },
];

const standinId = (name: string): string => `standin-${name.toLowerCase()}`;
const person = (s: Standin): Person => ({ id: standinId(s.name), name: s.name, you: false });

const RAIDS = ["the Hollow Vault", "the Sunken Orchard", "the Clockwork Canopy", "the Amber Deep"] as const;
const LANDS = [
  "Emberfall Ridge",
  "Mossgate Crossing",
  "the Lantern Shallows",
  "Thistle Reach",
  "Old Root Hollow",
] as const;

/** The board as it was first pinned up: where each quest starts, and what it needs. */
const pinned = { claim: true, ends: null } as const;
const BOARD: readonly Quest[] = [
  {
    id: "raids",
    title: "Three raids with the guild",
    have: 3,
    need: 3,
    unit: "raids",
    reward: 300,
    pays: "leaf",
    ...pinned,
  },
  {
    id: "planks",
    title: "Forty planks down the belt",
    have: 31,
    need: 40,
    unit: "planks",
    reward: 150,
    pays: "coins",
    ...pinned,
  },
  {
    id: "hold",
    title: "Hold a territory for an hour",
    have: 38,
    need: 60,
    unit: "min",
    reward: 250,
    pays: "leaf",
    ...pinned,
  },
];

/** The made-up guild's moments, in turn, each skipped while its own limit holds it back. */
const ORDER: readonly Moment[] = ["level", "raid", "war", "milestone"];
/** The least time between any two of the made-up guild's moments, of any kind, in seconds. */
export const GAP = 90;
/** The least time between two of one kind, in seconds: a stand-in levels at most once in ten minutes, a territory at most once in five. */
const EVERY: Readonly<Partial<Record<Moment, number>>> = { level: 600, war: 300 };

/** Leaf each for a raid, and the most raids the made-up guild will credit for one absence. */
const RAID_LEAF = 80;
const RAIDS_AWAY = 4;

interface Memory {
  progress: Record<string, number>;
  raids: number;
  lands: number;
  /** How many times somebody has looked in at the member's camp: each visit's letter is named by it. */
  calls: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, most: number): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(most, Math.floor(v)) : 0;

/** Reads the guild's memory back, putting anything that makes no sense back to how it began. */
function recall(text: string | null | undefined): Memory {
  const m: Memory = { progress: {}, raids: 2, lands: 0, calls: 0 };
  for (const q of BOARD) m.progress[q.id] = q.have;
  if (!text) return m;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return m;
  }
  if (!isRecord(raw) || raw.v !== 1) return m;
  if (isRecord(raw.progress))
    for (const q of BOARD) {
      const have = raw.progress[q.id];
      if (typeof have === "number") m.progress[q.id] = Math.max(q.have, whole(have, q.need));
    }
  if (typeof raw.raids === "number") m.raids = whole(raw.raids, 1e6);
  if (typeof raw.lands === "number") m.lands = whole(raw.lands, 1e6);
  if (typeof raw.calls === "number") m.calls = whole(raw.calls, 1e9);
  return m;
}

/** A number in [0, 1) that is always the same for the same two numbers. */
function mix(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const COUNT = ["No", "One", "Two", "Three", "Four"] as const;
const MILESTONES = ["Ten raids", "A week of wars", "First lantern", "Fifty raids"] as const;

export interface Opts {
  /** The memory a guild made earlier handed over, if any. */
  memory?: string | null;
  /** Called with the memory whenever it changes, to be kept. */
  keep?: (text: string) => void;
  random?: () => number;
  /** The time now, in milliseconds since 1970. */
  now?: () => number;
  /**
   * Beside the real guild: it has no stand-ins, no news, no quests and no Leaf; all it still does is
   * send the town's own to call at the member's camp.
   */
  quiet?: boolean;
}

/** The made-up guild, and a way to set off one of its moments at once (for looking at the town). */
export type MadeUp = Guild & { stir: (kind: Moment) => void };

export function makeGuild(o: Opts = {}): MadeUp {
  const random = o.random ?? Math.random;
  const now = o.now ?? Date.now;
  const mem = recall(o.memory);
  const ears = new Set<(h: Happening) => void>();
  const standins = o.quiet ? [] : STANDINS;
  // The stand-ins' levels, because people level.
  const levels = new Map(standins.map((s) => [s.name, s.level]));
  let turn = 0;
  let nextIn = 7;
  let plankIn = 5.5;
  let callIn = 34;
  /** Seconds the guild has been stepped, and when it last told anything, and each kind of moment last. */
  let clock = 0;
  let lastAt = -Infinity;
  const lastOf = new Map<Moment, number>();
  /** When the stand-ins who have gone were last seen: kept from the first time asked, so that they stay put. */
  const since = now();

  const kept = (): void => {
    o.keep?.(JSON.stringify({ v: 1, ...mem }));
  };
  const tell = (h: Happening): void => {
    lastAt = clock;
    for (const fn of ears) fn(h);
  };
  /** Whether long enough has passed since the last moment for another. */
  const free = (): boolean => clock - lastAt >= GAP;
  /** Whether a kind of moment's own limit has passed since the last of it. */
  const due = (kind: Moment): boolean => clock - (lastOf.get(kind) ?? -Infinity) >= (EVERY[kind] ?? 0);
  const pick = <T>(list: readonly T[]): T | undefined =>
    list[Math.min(list.length - 1, Math.floor(random() * list.length))];
  /** Some of the stand-ins, in a random order. */
  function some(n: number): Person[] {
    const pool = [...standins];
    const out: Person[] = [];
    while (out.length < n && pool.length > 0) {
      const at = Math.min(pool.length - 1, Math.floor(random() * pool.length));
      out.push(...pool.splice(at, 1).map(person));
    }
    return out;
  }

  /** The next of its moments in turn that its own limit lets through; a raid always may. */
  function nextInTurn(): Moment {
    for (let i = 0; i < ORDER.length; i++) {
      const kind = ORDER[(turn + i) % ORDER.length];
      if (kind && due(kind)) {
        turn += i + 1;
        return kind;
      }
    }
    return "raid";
  }

  /** Whether moving a quest along by so much would finish it, which is a moment of its own. */
  function finishes(id: string, by: number): boolean {
    const q = BOARD.find((b) => b.id === id);
    const have = mem.progress[id] ?? q?.have ?? 0;
    return q !== undefined && have < q.need && have + by >= q.need;
  }

  /** Moves a quest along; says so once, the moment it is done. */
  function progress(id: string, by: number, text: string): void {
    const q = BOARD.find((b) => b.id === id);
    if (!q) return;
    const have = mem.progress[id] ?? q.have;
    if (have >= q.need) return;
    mem.progress[id] = Math.min(q.need, have + by);
    if ((mem.progress[id] ?? 0) >= q.need) tell({ kind: "quest", id, text, tone: q.pays === "leaf" ? "leaf" : "gold" });
    kept();
  }

  function stir(kind: Moment): void {
    lastOf.set(kind, clock);
    if (kind === "call") {
      const who = pick(CALLERS);
      if (!who) return;
      mem.calls++;
      kept();
      // Now and then a note, now and then a present with it, and often just the visit.
      const r = random();
      const gift = r < 0.4 ? (pick(GIFTS) ?? "") : "";
      const note = r < 0.7 ? (pick(NOTES[who]) ?? "") : "";
      tell({ kind: "call", id: `c-${mem.calls}`, who: folk(who).name, note, gift });
      return;
    }
    if (standins.length === 0) return;
    if (kind === "raid") {
      // Two or three of them, and now and then the member with them.
      const who = some(2 + Math.floor(random() * 2));
      if (random() < 0.3) who.unshift({ id: "you", name: "You", you: true });
      mem.raids++;
      kept();
      tell({ kind: "party", who, raid: RAIDS[mem.raids % RAIDS.length] ?? "a raid" });
    } else if (kind === "war") {
      const land = LANDS[mem.lands % LANDS.length] ?? "new ground";
      mem.lands++;
      kept();
      tell({ kind: "war", who: some(2), land, held: random() < 0.5 });
      progress("hold", 11, "You held a territory for an hour. See the board.");
    } else if (kind === "level") {
      const [who] = some(1);
      if (!who) return;
      const level = (levels.get(who.name) ?? 1) + 1;
      levels.set(who.name, level);
      tell({ kind: "reached", who, level });
    } else {
      const [who] = some(1);
      if (who) tell({ kind: "milestone", who, label: pick(MILESTONES) ?? "Ten raids" });
    }
  }

  const visitors = (): Visitor[] =>
    standins.flatMap((s) =>
      s.gone === null ? [{ id: standinId(s.name), name: s.name, rank: s.rank, at: s.at, skin: "" }] : [],
    );
  const resting = (): Rester[] =>
    standins
      .flatMap((s) =>
        s.gone === null
          ? []
          : [{ id: standinId(s.name), name: s.name, rank: s.rank, at: s.at, skin: "", seen: since - s.gone * 60_000 }],
      )
      .toSorted((a, b) => b.seen - a.seen);
  const about = (): { present: Mate[]; resting: Mate[] } => ({
    present: visitors().map((v) => ({ id: v.id, name: v.name, rank: v.rank, at: v.at, seen: null })),
    resting: resting().map((r) => ({ id: r.id, name: r.name, rank: r.rank, at: r.at, seen: r.seen })),
  });

  return {
    me(): Me {
      return {
        name: "You",
        rank: "Ranger",
        level: 64,
        voice: 560,
        look: YOU,
        xp: 6240,
        next: 10000,
        skin: "skins/player.png",
        ranks: RANKS,
        week: ["7 raids", "2 wars", "3 lanterns hung"],
      };
    },
    quests: () => BOARD.map((q) => Object.assign({}, q, { have: mem.progress[q.id] ?? q.have })),
    boardNote: () => null,
    wares: () => WARES,
    pieces: () => PIECES,
    stalls: () => STALLS,
    presents: () => PRESENTS,
    // Nobody's camp may be visited yet.
    camp: (): MateCamp | null => null,
    mail(from, to): Letter[] {
      if (from <= 0) return [letter("m-first", folk(FIRST_CALL.who).name, FIRST_CALL.note, FIRST_CALL.gift)];
      const hours = Math.max(0, (to - from) / 3_600_000);
      const seed = Math.floor(from / 1000);
      const out: Letter[] = [];
      if (hours >= 1) {
        const w = WHILE_AWAY[Math.floor(mix(seed, 1) * WHILE_AWAY.length)] ?? WHILE_AWAY[0];
        if (w) out.push(letter(`m-${seed}-a`, folk(w.who).name, w.note, w.gift));
      }
      if (hours >= 6) {
        const who = CALLERS[Math.floor(mix(seed, 4) * CALLERS.length)] ?? "pipwick";
        const notes = NOTES[who];
        const text = notes[Math.floor(mix(seed, 5) * notes.length)] ?? "This is for you.";
        const gift = GIFTS[Math.floor(mix(seed, 6) * GIFTS.length)] ?? "pinecone";
        out.push(letter(`m-${seed}-b`, folk(who).name, text, gift));
      }
      return out;
    },
    lostCrab: () => LOST_CRAB,
    away(from, to): Away {
      const crab: AwayLine = { art: "crab", text: `Crab No. ${LOST_CRAB} is still missing.` };
      if (from <= 0) {
        const first = folk(FIRST_CALL.who).name;
        return {
          first: true,
          hours: 0,
          lines: [
            { art: "leaf", text: "Three raids with the guild", pay: { kind: "leaf", amount: 3 * RAID_LEAF } },
            { art: "folk", text: `${first} ${FIRST_CALL.did}`, who: [first] },
            crab,
          ],
        };
      }
      const hours = Math.max(0, (to - from) / 3_600_000);
      const seed = Math.floor(from / 1000);
      const lines: AwayLine[] = [];
      const raids = Math.min(RAIDS_AWAY, Math.floor(hours / 3));
      if (raids > 0)
        lines.push({
          art: "leaf",
          text: `${COUNT[raids] ?? raids} raid${raids === 1 ? "" : "s"} with the guild`,
          pay: { kind: "leaf", amount: raids * RAID_LEAF },
        });
      if (hours >= 1) {
        const w = WHILE_AWAY[Math.floor(mix(seed, 1) * WHILE_AWAY.length)] ?? WHILE_AWAY[0];
        if (w) {
          const who = capital(folk(w.who).name);
          lines.push({ art: "folk", text: `${who} ${w.did}`, who: [folk(w.who).name] });
        }
      }
      if (hours >= 6)
        lines.push({
          art: "banner",
          text: `The guild took ${LANDS[Math.floor(mix(seed, 3) * LANDS.length)] ?? "new ground"}.`,
        });
      lines.push(crab);
      return { first: false, hours, lines };
    },
    hear(fn) {
      ears.add(fn);
      return () => ears.delete(fn);
    },
    say(h, feed) {
      const line = lineFor(h);
      if (line) feed(line[0], line[1]);
    },
    step(dt) {
      clock += dt;
      callIn -= dt;
      if (o.quiet) {
        // Beside the real guild the town's own are all it has, and call in their own time.
        if (callIn > 0) return;
        callIn = 46 + random() * 30;
        stir("call");
        return;
      }
      // Anything due waits until the last moment is ninety seconds gone: the plank that finishes
      // the quest, then the guild's own moments, then a call (which is due more often, and so
      // would otherwise take every turn).
      plankIn -= dt;
      if (plankIn <= 0 && (free() || !finishes("planks", 1))) {
        plankIn = 5.5;
        progress("planks", 1, "Forty planks down the belt. See the board.");
      }
      nextIn -= dt;
      if (nextIn <= 0 && free()) {
        nextIn = GAP + random() * 30;
        stir(nextInTurn());
      }
      if (callIn <= 0 && free()) {
        callIn = 46 + random() * 30;
        stir("call");
      }
    },
    visitors,
    resting,
    about,
    heard: () => true,
    here: () => undefined,
    stay: () => undefined,
    told: () => null,
    stir,
  };
}
