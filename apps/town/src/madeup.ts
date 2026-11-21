/**
 * The made-up guild: the only answer there is today to the questions in `guild.ts`. Nobody here is
 * a real member and nothing here talks to a server. It keeps a little memory of its own (how far
 * along the quests are, how many raids and lands there have been), as a server would, and hands it
 * to whoever made it to be kept.
 */

import type { Look } from "@sequoia-leaf/kit/skin.ts";

import type { Activity, Away, AwayLine, Guild, Happening, Listing, Me, Member, Moment, Quest, Ware } from "./guild.ts";

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

const CINFY: Member = {
  name: "Cinfy",
  rank: "Keeper of the Treasury",
  level: 99,
  voice: 520,
  look: {
    skin: "#f6dcc2",
    hair: "#f1e2a6",
    light: "#fff8d8",
    eye: "#5a296e",
    top: "#5a296e",
    legs: "#3d2050",
    shoes: "#2a1733",
    style: "long",
    sleeves: "long",
    detail: "buttons",
    trim: "#f5b95e",
    glasses: true,
  },
};

const MATES: readonly Member[] = [
  {
    name: "Mossback",
    rank: "Warden",
    level: 91,
    voice: 300,
    look: {
      skin: "#d9a57c",
      hair: "#3b7340",
      light: "#62a658",
      eye: "#3b1f19",
      top: "#6f3826",
      legs: "#2f5c34",
      shoes: "#3b1f19",
      style: "hood",
      sleeves: "long",
      detail: "belt",
      trim: "#d49045",
    },
  },
  {
    name: "Pipwick",
    rank: "Sapling",
    level: 34,
    voice: 760,
    look: {
      skin: "#f0c8a0",
      hair: "#e0823a",
      light: "#f5b95e",
      eye: "#2f5884",
      top: "#2f8a8a",
      legs: "#593d29",
      shoes: "#3b1f19",
      style: "short",
      sleeves: "short",
      detail: "scarf",
      trim: "#f5b95e",
    },
  },
  {
    name: "Quillfeather",
    rank: "Elder",
    level: 104,
    voice: 380,
    look: {
      skin: "#8a5a3c",
      hair: "#e8e4f0",
      light: "#ffffff",
      eye: "#f5b95e",
      top: "#5a296e",
      legs: "#3d2050",
      shoes: "#2a1733",
      style: "long",
      sleeves: "long",
      detail: "belt",
      trim: "#f5b95e",
    },
  },
  {
    name: "Tindra",
    rank: "Ranger",
    level: 67,
    voice: 680,
    look: {
      skin: "#f2cfae",
      hair: "#e88fb4",
      light: "#ffc2d8",
      eye: "#3b7340",
      top: "#f3e6c8",
      legs: "#b84d84",
      shoes: "#542a1f",
      style: "long",
      sleeves: "short",
      detail: "apron",
      trim: "#b84d84",
    },
  },
  {
    name: "Bramblewick",
    rank: "Ranger",
    level: 58,
    voice: 340,
    look: {
      skin: "#d9a57c",
      hair: "#6f3826",
      light: "#8a4a30",
      eye: "#3b1f19",
      top: "#4b8c4a",
      legs: "#79553a",
      shoes: "#3b1f19",
      style: "cap",
      sleeves: "short",
      trim: "#e8c860",
    },
  },
  {
    name: "Embertoe",
    rank: "Warden",
    level: 88,
    voice: 420,
    look: {
      skin: "#f5d2b4",
      hair: "#c2382e",
      light: "#e67967",
      eye: "#3b1f19",
      top: "#4a4a52",
      legs: "#2e2e36",
      shoes: "#1a0f1e",
      style: "short",
      sleeves: "long",
      detail: "apron",
      trim: "#8a4a30",
    },
  },
  {
    name: "Sootpaw",
    rank: "Sapling",
    level: 41,
    voice: 880,
    look: {
      skin: "#f2dcc8",
      hair: "#2b2530",
      light: "#e88fb4",
      eye: "#62a658",
      top: "#3a3340",
      legs: "#2b2530",
      shoes: "#2b2530",
      style: "ears",
      sleeves: "long",
      hands: "#f3ede0",
      detail: "scarf",
      trim: "#e67967",
    },
  },
  {
    name: "Wrenly",
    rank: "Ranger",
    level: 72,
    voice: 600,
    look: {
      skin: "#f0c8a0",
      hair: "#3f6fb0",
      light: "#7aa8e0",
      eye: "#3b1f19",
      top: "#efe2c0",
      legs: "#243a66",
      shoes: "#3b1f19",
      style: "short",
      sleeves: "long",
      detail: "buttons",
      trim: "#d49045",
      glasses: true,
    },
  },
  {
    name: "Fernwhistle",
    rank: "Seedling",
    level: 12,
    voice: 720,
    look: {
      skin: "#7a4a30",
      hair: "#4b8c4a",
      light: "#8fd07a",
      eye: "#f5b95e",
      top: "#f0c040",
      legs: "#6f3826",
      shoes: "#2a1733",
      style: "long",
      sleeves: "long",
      detail: "buttons",
      trim: "#fff3cf",
    },
  },
];

const RAIDS = ["the Hollow Vault", "the Sunken Orchard", "the Clockwork Canopy", "the Amber Deep"] as const;
const LANDS = [
  "Emberfall Ridge",
  "Mossgate Crossing",
  "the Lantern Shallows",
  "Thistle Reach",
  "Old Root Hollow",
] as const;

/** The board as it was first pinned up: where each quest starts, and what it needs. */
const BOARD: readonly Quest[] = [
  { id: "raids", title: "Three raids with guild-mates", have: 3, need: 3, unit: "raids", reward: 20, pays: "leaf" },
  { id: "planks", title: "Forty planks down the belt", have: 31, need: 40, unit: "planks", reward: 150, pays: "coins" },
  { id: "hold", title: "Hold a territory for an hour", have: 38, need: 60, unit: "min", reward: 15, pays: "leaf" },
];

const WARES: readonly Ware[] = [
  {
    id: "crown",
    name: "Leaf crown",
    about: "A wreath of gold leaves.",
    price: 60,
    once: true,
    worn: true,
    thanks: ["It suits you. Everything suits gold.", "it suits you"],
  },
  {
    id: "jar",
    name: "Jar of fireflies",
    about: "They follow you about.",
    price: 35,
    once: true,
    worn: true,
    thanks: ["Don't shake it. They hold grudges.", "don't shake it"],
  },
  {
    id: "cocoa",
    name: "Fireside cocoa",
    about: "A round for everyone there.",
    price: 12,
    once: false,
    worn: false,
    thanks: ["Sent over. They had better say thanks.", "cocoa's up!"],
  },
];

const STALLS: readonly Listing[] = [
  {
    id: "bread",
    by: "Bramblewick",
    what: "Raid bread",
    about: "Still warm.",
    price: 8,
    worn: false,
    word: "baked this morning!",
  },
  {
    id: "run",
    by: "Quillfeather",
    what: "A guided run",
    about: "The Hollow Vault, tonight.",
    price: 15,
    worn: false,
    word: "bring snacks",
  },
  {
    id: "plate",
    by: "Tindra",
    what: "Name plate",
    about: "Hand-painted, gold corners.",
    price: 30,
    worn: true,
    word: "I did the corners twice",
  },
  {
    id: "water",
    by: "Sootpaw",
    what: "Jar of pond water",
    about: "Probably haunted.",
    price: 3,
    worn: true,
    word: "no refunds. meow.",
  },
];

/** What a guild-mate goes off to do, and how likely each is. */
const ERRANDS: readonly (readonly [Activity, number])[] = [
  ["fire", 5],
  ["bench", 1],
  ["play", 2],
  ["table", 3],
  ["treasury", 2],
  ["quests", 2],
  ["market", 3],
  ["stall", 2],
  ["works", 2],
  ["pond", 3],
  ["tree", 1],
  ["pole", 1],
  ["garden", 2],
];

const LOST_CRAB = 7;
const ORDER: readonly Moment[] = ["level", "raidOut", "raidBack", "land"];
/** Leaf each for a raid, and the most raids the made-up guild will credit for one absence. */
const RAID_LEAF = 12;
const RAIDS_AWAY = 4;

interface Memory {
  progress: Record<string, number>;
  raids: number;
  lands: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, most: number): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(most, Math.floor(v)) : 0;

/** Reads the guild's memory back, putting anything that makes no sense back to how it began. */
function recall(text: string | null | undefined): Memory {
  const m: Memory = { progress: {}, raids: 2, lands: 0 };
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
const VISITS = [
  "left a mushroom by your gate.",
  "waved down your path.",
  "asked where you were.",
  "saved you a seat by the fire.",
] as const;

export interface Opts {
  /** The memory a guild made earlier handed over, if any. */
  memory?: string | null;
  /** Called with the memory whenever it changes, to be kept. */
  keep?: (text: string) => void;
  random?: () => number;
}

/** The made-up guild, and a way to set off one of its moments at once (for looking at the town). */
export type MadeUp = Guild & { stir: (kind: Moment) => void };

export function makeGuild(o: Opts = {}): MadeUp {
  const random = o.random ?? Math.random;
  const mem = recall(o.memory);
  const ears = new Set<(h: Happening) => void>();
  // Its own copy of everybody, because people level.
  const roster: Member[] = structuredClone([...MATES]);
  let party: string[] = [];
  let raid = "";
  let turn = 0;
  let nextIn = 7;
  let plankIn = 5.5;

  const kept = (): void => {
    o.keep?.(JSON.stringify({ v: 1, ...mem }));
  };
  const tell = (h: Happening): void => {
    for (const fn of ears) fn(h);
  };
  const pick = <T>(list: readonly T[]): T | undefined =>
    list[Math.min(list.length - 1, Math.floor(random() * list.length))];

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
    if (kind === "raidOut") {
      if (party.length > 0) return;
      const pool = roster.map((m) => m.name);
      const out: string[] = [];
      while (out.length < 4 && pool.length > 0) {
        const at = Math.min(pool.length - 1, Math.floor(random() * pool.length));
        out.push(...pool.splice(at, 1));
      }
      if (out.length < 4) return;
      party = out;
      raid = RAIDS[mem.raids % RAIDS.length] ?? "a raid";
      tell({ kind: "raidOut", who: party, raid });
    } else if (kind === "raidBack") {
      if (party.length === 0) return;
      const who = party;
      party = [];
      mem.raids++;
      kept();
      tell({ kind: "raidBack", who, raid, leaf: RAID_LEAF });
    } else if (kind === "land") {
      const name = LANDS[mem.lands % LANDS.length] ?? "new ground";
      mem.lands++;
      kept();
      tell({ kind: "land", name });
      progress("hold", 11, "You held a territory for an hour. See the board.");
    } else {
      const m = pick(roster.filter((r) => !party.includes(r.name)));
      if (!m) return;
      m.level++;
      tell({ kind: "level", who: m.name, level: m.level });
    }
  }

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
    keeper: () => CINFY,
    roster: () => roster,
    quests: () => BOARD.map((q) => Object.assign({}, q, { have: mem.progress[q.id] ?? q.have })),
    wares: () => WARES,
    stalls: () => STALLS,
    lostCrab: () => LOST_CRAB,
    doing(): Activity {
      const total = ERRANDS.reduce((n, [, w]) => n + w, 0);
      let at = random() * total;
      for (const [what, weight] of ERRANDS) {
        at -= weight;
        if (at < 0) return what;
      }
      return "fire";
    },
    away(from, to): Away {
      const crab: AwayLine = { art: "crab", text: `Crab No. ${LOST_CRAB} is still missing.` };
      if (from <= 0)
        return {
          first: true,
          hours: 0,
          lines: [
            { art: "leaf", text: "Three raids with the guild", pay: { kind: "leaf", amount: 3 * RAID_LEAF } },
            { art: "mates", text: "Tindra left a mushroom by your gate.", who: ["Tindra"] },
            crab,
          ],
        };
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
        const who = roster[Math.floor(mix(seed, 1) * roster.length)]?.name ?? "Mossback";
        const what = VISITS[Math.floor(mix(seed, 2) * VISITS.length)] ?? VISITS[0];
        lines.push({ art: "mates", text: `${who} ${what}`, who: [who] });
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
    step(dt) {
      plankIn -= dt;
      if (plankIn <= 0) {
        plankIn = 5.5;
        progress("planks", 1, "Forty planks down the belt. See the board.");
      }
      nextIn -= dt;
      if (nextIn > 0) return;
      nextIn = 18 + random() * 4;
      stir(ORDER[turn % ORDER.length] ?? "level");
      turn++;
    },
    stir,
  };
}
