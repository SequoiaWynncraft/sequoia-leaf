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

import { CALLERS, capital, folk, GIFTS, NOTES, WHILE_AWAY } from "./folk.ts";
import type {
  Away,
  AwayLine,
  Guild,
  Happening,
  MateCamp,
  Me,
  Moment,
  Person,
  Quest,
  Rester,
  Stall,
  Stock,
  Visitor,
  Ware,
} from "./guild.ts";
import { type Letter, letter } from "./mail.ts";

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

const WARES: readonly Ware[] = [
  {
    id: "crown",
    name: "Leaf crown",
    about: "A wreath of gold leaves.",
    price: 1200,
    once: true,
    worn: true,
    thanks: ["It suits you. Everything suits gold.", "it suits you"],
  },
  {
    id: "jar",
    name: "Jar of fireflies",
    about: "They follow you about.",
    price: 800,
    once: true,
    worn: true,
    thanks: ["Don't shake it. They hold grudges.", "don't shake it"],
  },
  {
    id: "cocoa",
    name: "Fireside cocoa",
    about: "A round for everyone there.",
    price: 60,
    once: false,
    worn: false,
    thanks: ["Sent over. They had better say thanks.", "cocoa's up!"],
  },
  {
    id: "plate",
    name: "Name plate",
    about: "Hand-painted, gold corners.",
    price: 600,
    once: true,
    worn: true,
    thanks: ["Tindra did the corners twice.", "very smart"],
  },
  {
    id: "water",
    name: "Jar of pond water",
    about: "Probably haunted.",
    price: 100,
    once: true,
    worn: true,
    thanks: ["No refunds. It knows where you live.", "no refunds"],
  },
];

/** What each stall sells, as a thing and its price in Coins. Everything is always on sale. */
const stock = (...list: readonly (readonly [string, number])[]): Stock[] =>
  list.map(([thing, price]) => ({ thing, price }));

/** The market's stalls, each kept by one of the town's own (`folk.ts`). */
const STALLS: readonly Stall[] = [
  {
    id: "lamps",
    by: "Sootpaw",
    name: "Lamps and oddments",
    words: ["no refunds. meow.", "one careful owner", "it's probably not haunted"],
    stock: stock(
      ["lantern-post", 450],
      ["paper-lantern", 300],
      ["candle-stump", 180],
      ["firefly-lamp", 550],
      ["glowcap", 600],
      ["moth-lantern", 700],
      ["brazier", 750],
      ["fairy-lights", 900],
      ["rock", 25],
      ["barrel", 350],
      ["gnome", 280],
      ["gnome-fishing", 325],
      ["gnome-napping", 325],
      ["crab-statue", 475],
      ["wind-chime", 400],
      ["birdhouse", 300],
      ["bird-bath", 500],
      ["cook-pot", 450],
      ["music-box", 850],
      ["telescope", 1300],
      ["well", 1600],
      ["my-stall", 2000],
    ),
  },
  {
    id: "seats",
    by: "Bramblewick",
    name: "Seats, rugs and flags",
    words: ["carried it here myself!", "good choice. sat on it all morning.", "mind the splinters"],
    stock: stock(
      ["stump", 150],
      ["cushion", 220],
      ["log-seat", 300],
      ["bench", 550],
      ["rocker", 800],
      ["picnic", 1100],
      ["hammock", 1200],
      ["rug-moss", 200],
      ["rug-woven", 375],
      ["pennant", 250],
      ["windsock", 350],
      ["bunting", 450],
      ["weathervane", 600],
      ["guild-banner", 650],
    ),
  },
  {
    id: "plants",
    by: "Tindra",
    name: "Plants, fences and paths",
    words: ["water it. or don't. it's hardy.", "I grew that one!", "it likes being talked to"],
    stock: stock(
      ["flower-pot", 120],
      ["potted-fern", 150],
      ["pumpkin", 180],
      ["sunflower", 200],
      ["toadstool", 220],
      ["berry-bush", 280],
      ["worm-pot", 325],
      ["flower-bed", 350],
      ["sapling", 400],
      ["fairy-ring", 450],
      ["stepping-stones", 35],
      ["plank-path", 35],
      ["log-fence", 50],
      ["picket", 55],
      ["stone-wall", 70],
      ["doormat", 220],
      ["woodpile", 180],
      ["arch", 550],
    ),
  },
];

/** The Treasury's fine pieces, for Leaf: as cosmetic as everything else in a camp. */
const PIECES: readonly Stock[] = stock(
  ["glass-lantern", 600],
  ["sun-banner", 800],
  ["crab-throne", 1500],
  ["fox-statue", 2000],
  ["fountain", 3000],
);

/** What a member may leave at somebody's camp. */
const PRESENTS = ["pinecone", "painted-pebble", "acorn-jar"] as const;

const LOST_CRAB = 7;
/** The made-up guild's moments, in turn, every twenty seconds or so. */
const ORDER: readonly Moment[] = ["level", "raid", "war", "milestone"];

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
  /** When the stand-ins who have gone were last seen: kept from the first time asked, so that they stay put. */
  const since = now();

  const kept = (): void => {
    o.keep?.(JSON.stringify({ v: 1, ...mem }));
  };
  const tell = (h: Happening): void => {
    for (const fn of ears) fn(h);
  };
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
      if (from <= 0) {
        const first = folk("tindra");
        return [
          letter("m-first", first.name, "A mushroom for your gate. It's the good kind. Welcome home!", "toadstool"),
        ];
      }
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
        const first = folk("tindra").name;
        return {
          first: true,
          hours: 0,
          lines: [
            { art: "leaf", text: "Three raids with the guild", pay: { kind: "leaf", amount: 3 * RAID_LEAF } },
            { art: "folk", text: `${first} left a mushroom by your gate.`, who: [first] },
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
    step(dt) {
      callIn -= dt;
      if (callIn <= 0) {
        callIn = 46 + random() * 30;
        stir("call");
      }
      if (o.quiet) return;
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
    visitors,
    resting,
    heard: () => true,
    here: () => undefined,
    stay: () => undefined,
    told: () => null,
    stir,
  };
}
