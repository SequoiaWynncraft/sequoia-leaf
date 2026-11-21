/**
 * The made-up guild: the only answer there is today to the questions in `guild.ts`. Nobody here is
 * a real member and nothing here talks to a server. It keeps a little memory of its own (how far
 * along the quests are, how many raids and lands there have been), as a server would, and hands it
 * to whoever made it to be kept.
 */

import type { Look } from "@sequoia-leaf/kit/skin.ts";

import { layout, type Placed } from "./camp.ts";
import type {
  Activity,
  Away,
  AwayLine,
  Guild,
  Happening,
  MateCamp,
  Me,
  Member,
  Moment,
  Pet,
  Quest,
  Stall,
  Stock,
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
const pinned = { claim: true, ends: null } as const;
const BOARD: readonly Quest[] = [
  {
    id: "raids",
    title: "Three raids with guild-mates",
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

/** What a member may leave at somebody's camp, and what a guild-mate may leave at theirs. */
const PRESENTS = ["pinecone", "painted-pebble", "acorn-jar"] as const;
const GIFTS = [
  "pinecone",
  "painted-pebble",
  "acorn-jar",
  "tiny-cairn",
  "crab-drawing",
  "gnome-traveller",
  "flower-pot",
  "candle-stump",
  "pumpkin",
] as const;

/** How each guild-mate keeps their own camp: what they like about them, who lives there, and what they say. */
interface Home {
  taste: readonly string[];
  count: number;
  pets: readonly Pet[];
  note: string;
  hello: readonly string[];
}

const HOMES: Readonly<Record<string, Home>> = {
  Mossback: {
    taste: ["toadstool", "toadstool", "glowcap", "potted-fern", "potted-fern", "fairy-ring", "rug-moss", "rock"],
    count: 16,
    pets: [{ kind: "glorp", name: "Lichen" }],
    note: "Out being a bush for a bit. Back when the moss says.",
    hello: ["mind the mushrooms. they mind you.", "moss is a way of life."],
  },
  Pipwick: {
    taste: ["gnome", "gnome", "gnome-fishing", "gnome-napping", "gnome-traveller", "pumpkin", "pennant", "barrel"],
    count: 15,
    pets: [{ kind: "cat", name: "Button" }],
    note: "Gone to count the crabs. Again.",
    hello: ["you came! mind the gnome.", "is it true you have a WELL?"],
  },
  Quillfeather: {
    taste: [
      "telescope",
      "guild-banner",
      "sun-banner",
      "lantern-post",
      "lantern-post",
      "bench",
      "rug-woven",
      "wind-chime",
    ],
    count: 14,
    pets: [{ kind: "fox", name: "Vesper" }],
    note: "At the Hollow Vault. There is tea in the pot.",
    hello: ["sit. the fire likes company.", "the stars are out, between the trees."],
  },
  Tindra: {
    taste: [
      "flower-pot",
      "flower-bed",
      "flower-bed",
      "sunflower",
      "sunflower",
      "picket",
      "arch",
      "bird-bath",
      "cushion",
    ],
    count: 18,
    pets: [
      { kind: "glorp", name: "Petal" },
      { kind: "cat", name: "Crumb" },
    ],
    note: "Minding the stall. Smell the flowers for me.",
    hello: ["I did the corners twice.", "mind the flower beds!"],
  },
  Bramblewick: {
    taste: ["picnic", "barrel", "barrel", "cook-pot", "woodpile", "bench", "stump", "berry-bush", "pumpkin", "bunting"],
    count: 15,
    pets: [{ kind: "cat", name: "Loaf" }],
    note: "Baking. Follow your nose to town.",
    hello: ["there's stew. it has always been stew.", "sit, sit. eat something."],
  },
  Embertoe: {
    taste: ["brazier", "brazier", "stone-wall", "stone-wall", "woodpile", "lantern-post", "weathervane", "crab-statue"],
    count: 14,
    pets: [{ kind: "fox", name: "Cinder" }],
    note: "At the Works. The key is under the rock. Not that rock.",
    hello: ["I can fix that.", "mind the brazier. it bites."],
  },
  Sootpaw: {
    taste: [
      "candle-stump",
      "candle-stump",
      "paper-lantern",
      "moth-lantern",
      "cushion",
      "cushion",
      "rug-woven",
      "hammock",
    ],
    count: 15,
    pets: [
      { kind: "cat", name: "Ink" },
      { kind: "cat", name: "Blot" },
      { kind: "cat", name: "Smudge" },
    ],
    note: "napping somewhere. meow.",
    hello: ["meow.", "you may pet one (1) cat."],
  },
  Wrenly: {
    taste: ["birdhouse", "birdhouse", "bird-bath", "telescope", "stepping-stones", "plank-path", "bench", "windsock"],
    count: 15,
    pets: [{ kind: "glorp", name: "Dot" }],
    note: "Bird-watching. Shh.",
    hello: ["shh. there's a wren.", "I'm writing it all down."],
  },
  Fernwhistle: {
    taste: ["potted-fern", "potted-fern", "sapling", "stump", "flower-pot", "pennant", "rock"],
    count: 8,
    pets: [{ kind: "glorp", name: "Sprout" }],
    note: "At the quest board, working out which one is mine.",
    hello: ["it's not much yet!", "do you like my fern? it's my first."],
  },
};

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
/** What a guild-mate writes when they find nobody in. */
const NOTES = [
  "Came by. You were out. I fed the fire.",
  "Your camp is nicer than mine. I'm not upset.",
  "I counted your logs. Two. Good logs.",
  "Left this where the gnome couldn't get it.",
  "Knocked. The cabin said nothing. Rude.",
  "Something small looked at me from your barrel.",
] as const;
/** The letter that goes with each line of `VISITS`, and the present in it, if any. */
const VISIT_MAIL: readonly (readonly [string, string])[] = [
  ["Left you a mushroom. It was looking at me, so now it can look at you.", "toadstool"],
  ["I waved down your path. You weren't in. I waved anyway.", ""],
  ["Where were you? The fire asked too.", ""],
  ["Saved you a seat by the fire in town. Here's one for yours.", "cushion"],
];
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

/** A number that is always the same for the same name. */
function nameSeed(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return h >>> 0;
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
  /**
   * Beside the real guild: only the townsfolk go on as before (about the town, at their camps,
   * calling at the member's); the made-up guild's own news and quests stand still.
   */
  quiet?: boolean;
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
  let callIn = 34;
  const camps = new Map<string, readonly Placed[]>();

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
    } else if (kind === "call") {
      const m = pick(roster.filter((r) => !party.includes(r.name)));
      if (!m) return;
      mem.calls++;
      kept();
      // Now and then a note, now and then a present with it, and often just the visit.
      const r = random();
      const gift = r < 0.4 ? (pick(GIFTS) ?? "") : "";
      const note = r < 0.7 ? (pick(NOTES) ?? "") : "";
      tell({ kind: "call", id: `c-${mem.calls}`, who: m.name, note, gift });
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
    pieces: () => PIECES,
    stalls: () => STALLS,
    presents: () => PRESENTS,
    camp(name): MateCamp | null {
      const home = HOMES[name];
      if (!home || !roster.some((m) => m.name === name)) return null;
      let placed = camps.get(name);
      if (!placed) {
        placed = layout(nameSeed(name), home.taste, home.count);
        camps.set(name, placed);
      }
      return { owner: name, placed, pets: home.pets, home: !party.includes(name), note: home.note, hello: home.hello };
    },
    mail(from, to): Letter[] {
      if (from <= 0)
        return [
          letter("m-first", "Tindra", "A mushroom for your gate. It's the good kind. Welcome home!", "toadstool"),
        ];
      const hours = Math.max(0, (to - from) / 3_600_000);
      const seed = Math.floor(from / 1000);
      const out: Letter[] = [];
      if (hours >= 1) {
        const who = roster[Math.floor(mix(seed, 1) * roster.length)]?.name ?? "Mossback";
        const [text, gift] = VISIT_MAIL[Math.floor(mix(seed, 2) * VISIT_MAIL.length)] ?? ["", ""];
        out.push(letter(`m-${seed}-a`, who, text, gift));
      }
      if (hours >= 6) {
        const who = roster[Math.floor(mix(seed, 4) * roster.length)]?.name ?? "Pipwick";
        const text = NOTES[Math.floor(mix(seed, 5) * NOTES.length)] ?? NOTES[0];
        const gift = GIFTS[Math.floor(mix(seed, 6) * GIFTS.length)] ?? "pinecone";
        out.push(letter(`m-${seed}-b`, who, text, gift));
      }
      return out;
    },
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
    visitors: () => [],
    here: () => undefined,
    told: () => null,
    stir,
  };
}
