/**
 * The shape of a run as plain tables: what things cost and pay, how levels and the stall's odds go,
 * the fifteen rooms of a little raid, what the forest sends into each, how strong a sparring
 * partner is by then, and what the three trails change. Tuning the run is editing this file.
 */
import type { FigureId, Stars, TroubleId } from "./figures.ts";

// ---------- acorns, levels and the stall ----------

export const ECONOMY = {
  /** What the party starts with, and what a lost room costs: a base, plus one for each enemy still standing, up to a most. */
  resolve: 20,
  lossBase: 2,
  lossMost: 7,
  /** Acorns in hand when the run starts. */
  startAcorns: 2,
  /** After every room: this much, this much more for a win, and one for every `interestPer` held, up to `interestMost`. */
  roomAcorns: 4,
  winAcorns: 1,
  interestPer: 10,
  interestMost: 5,
  /** After every room, by how many rooms in a row have now been won, or lost: this much more. A draw ends a streak; a streak longer than the list pays the last. */
  streakAcorns: [0, 0, 0, 1, 1, 2],
  /** Places on the stall and on the bench. */
  stall: 5,
  bench: 9,
  /** What new offers cost, and how many are free each room. */
  rustle: 2,
  freeRustles: 1,
  /** What experience costs, how much that buys, and how much every room gives for nothing. */
  xpCost: 4,
  xpBought: 4,
  xpRoom: 2,
  /** Experience it takes to leave each level: from 1 to 2, from 2 to 3, and so on. The last level is one more than the list is long. */
  levelXp: [2, 2, 6, 10, 18, 28, 40],
  /** How many figures the start offers, and how many components a room does when it is won and when it is lost. */
  starters: 3,
  componentsWon: 3,
  componentsLost: 2,
  /** A boon is offered after these rooms (counting from 0), from this many, with this many free redraws. */
  boonRooms: [1, 4, 9],
  boonOptions: 3,
  boonRedraws: 1,
} as const;

export const MAX_LEVEL = ECONOMY.levelXp.length + 1;

/** Out of a hundred, how often each tier (1 to 5) turns up at the stall, by level (1 to 8). */
export const STALL_ODDS: readonly (readonly [number, number, number, number, number])[] = [
  [100, 0, 0, 0, 0],
  [80, 20, 0, 0, 0],
  [65, 30, 5, 0, 0],
  [50, 33, 15, 2, 0],
  [35, 35, 22, 8, 0],
  [24, 32, 28, 14, 2],
  [17, 26, 31, 21, 5],
  [12, 20, 30, 28, 10],
];

/**
 * A figure's level, in a run with the member's own figures (`own.ts`): one for each copy pulled
 * after the first, `most` at most, each `boost` percent more health and attack. It is not a star:
 * stars are made in the run, and multiply with it.
 */
export const LEVELS = { most: 6, boost: 3 } as const;
/** How much more health and attack a level gives, in percent. */
export const levelBoost = (level: number): number => level * LEVELS.boost;

/** What a figure sells for: its price at one star, a little less than was paid at two and three. */
export const sellPrice = (tier: number, stars: Stars): number =>
  stars === 1 ? tier : stars === 2 ? tier * 3 - 1 : tier * 9 - 2;
/** What a figure has had spent on it: one, three or nine times its price. */
export const worth = (tier: number, stars: Stars): number => tier * (stars === 1 ? 1 : stars === 2 ? 3 : 9);

// ---------- the fight ----------

export const FIGHT = {
  /** Steps of the clock in a second. */
  hz: 20,
  /** How long one hex takes to walk, and how long a figure stands still to use its ability, in steps. */
  walk: 6,
  cast: 6,
  /** How long anything thrown takes to cross one hex, and a figure dashing, in steps. */
  flight: 2,
  dash: 2,
  /** A heal or shield waits until somebody it reaches is at this share of their health or under, in percent. */
  mendUnder: 85,
  /** How long an area ability that would catch one enemy of three or more waits for a second, in steps. */
  crowdWait: 20,
  /** Mana from attacking, and the most one hit can give whoever it lands on. */
  manaAttack: 10,
  manaHit: 10,
  /** A hit that lands hard does this much more, in percent. */
  hard: 50,
  /** Dusk falls after this many seconds; each second of it hurts everyone this much more of their health, in percent. */
  dusk: 30,
  duskGrows: 3,
  /** A fight still going after this many seconds is a draw. */
  cap: 45,
  /** The most and least a figure's draw can be, however much it carries and holds. */
  drawMost: 2,
  drawLeast: -1,
} as const;

// ---------- rooms ----------

export type RoomKind = "trouble" | "spar" | "boss";
/** One of the forest's own: what it is, its stars, and where it stands on its own half (column 0 to 6; row 0 is its front line). The last number is the first trail it turns up on. */
export type Muster = readonly [kind: TroubleId, stars: Stars, col: number, row: number, fromTrail?: number];
export interface Plan {
  readonly name: string;
  readonly party: readonly Muster[];
}
/** How good a sparring partner's party is by a given room: its level, what was spent on figures, and how many components it holds. */
export interface SparStrength {
  readonly level: number;
  readonly spent: number;
  readonly components: number;
  /** Deep enough that a member could have found the copies for any star, however seldom the stall offers the figure. */
  readonly anyStars?: boolean;
}
export interface Room {
  readonly kind: RoomKind;
  readonly wing: 1 | 2 | 3;
  /** For trouble and bosses: what may be waiting. One is drawn. */
  readonly plans: readonly Plan[];
  /** For sparring. */
  readonly spar: SparStrength | null;
}

const trouble = (wing: 1 | 2 | 3, ...plans: Plan[]): Room => ({ kind: "trouble", wing, plans, spar: null });
const boss = (wing: 1 | 2 | 3, ...plans: Plan[]): Room => ({ kind: "boss", wing, plans, spar: null });
const spar = (wing: 1 | 2 | 3, level: number, spent: number, components: number): Room => ({
  kind: "spar",
  wing,
  plans: [],
  spar: { level, spent, components },
});

export const ROOMS: readonly Room[] = [
  // ---------- the first wing ----------
  trouble(
    1,
    {
      name: "A few gnats",
      party: [
        ["gnat", 1, 2, 0],
        ["gnat", 1, 4, 0],
      ],
    },
    {
      name: "Gnats, in no particular order",
      party: [
        ["gnat", 1, 3, 0],
        ["gnat", 1, 5, 1],
      ],
    },
  ),
  trouble(
    1,
    {
      name: "Gnats in the brambles",
      party: [
        ["bramble", 1, 3, 0],
        ["gnat", 1, 2, 0],
        ["gnat", 1, 4, 0],
        ["gnat", 1, 3, 1],
        ["gnat", 1, 2, 2, 2],
      ],
    },
    {
      name: "Wasps over a puddle",
      party: [
        ["puddle", 1, 3, 0],
        ["wasp", 1, 2, 1],
        ["gnat", 1, 4, 0],
        ["gnat", 1, 5, 1, 2],
      ],
    },
  ),
  spar(1, 3, 5, 0),
  spar(1, 3, 8, 1),
  boss(1, {
    name: "Snag",
    party: [
      ["oldbramble", 1, 3, 0],
      ["bramble", 1, 1, 0],
      ["bramble", 1, 5, 0],
      ["toadstool", 1, 3, 2],
      ["wasp", 1, 5, 1],
      ["toadstool", 1, 1, 2, 1],
      ["wasp", 1, 1, 1, 2],
    ],
  }),

  // ---------- the second wing ----------
  spar(2, 4, 17, 1),
  trouble(
    2,
    {
      name: "A toadstool ring",
      party: [
        ["puddle", 2, 3, 0],
        ["bramble", 2, 1, 0],
        ["bramble", 2, 5, 0],
        ["toadstool", 2, 2, 2],
        ["toadstool", 2, 4, 2],
        ["wasp", 2, 3, 1],
        ["wasp", 2, 0, 1],
        ["toadstool", 2, 3, 3, 1],
        ["wasp", 2, 6, 1, 2],
      ],
    },
    {
      name: "A stiff wind",
      party: [
        ["mud", 2, 3, 0],
        ["bramble", 2, 2, 0],
        ["wasp", 2, 5, 0],
        ["gust", 2, 1, 2],
        ["gust", 2, 5, 2],
        ["magpie", 2, 3, 2],
        ["gust", 2, 3, 3, 1],
        ["magpie", 2, 0, 1, 2],
      ],
    },
  ),
  spar(2, 5, 25, 2),
  spar(2, 5, 30, 3),
  boss(2, {
    name: "Swipe",
    party: [
      ["hoardmagpie", 1, 3, 1],
      ["mud", 1, 2, 0],
      ["mud", 1, 4, 0],
      ["magpie", 2, 0, 1],
      ["magpie", 2, 6, 1],
      ["gust", 2, 3, 3],
      ["gust", 2, 1, 3, 1],
      ["gust", 2, 5, 3, 2],
    ],
  }),

  // ---------- the third wing ----------
  spar(3, 6, 40, 4),
  spar(3, 6, 47, 4),
  trouble(
    3,
    {
      name: "Crabs in the mud",
      party: [
        ["mud", 3, 3, 0],
        ["crab", 3, 2, 0],
        ["crab", 2, 4, 0],
        ["crab", 2, 1, 1],
        ["crab", 2, 5, 1],
        ["toadstool", 3, 3, 2],
        ["gust", 2, 1, 3],
        ["gust", 2, 5, 3],
        ["wasp", 2, 0, 1],
        ["wasp", 2, 6, 1],
        ["wasp", 3, 3, 3, 1],
        ["crab", 3, 3, 1, 2],
      ],
    },
    {
      name: "Everything at once",
      party: [
        ["mud", 3, 2, 0],
        ["puddle", 3, 4, 0],
        ["bramble", 3, 3, 0],
        ["wasp", 3, 1, 1],
        ["wasp", 2, 5, 1],
        ["magpie", 2, 0, 2],
        ["toadstool", 3, 3, 2],
        ["gust", 2, 4, 3],
        ["magpie", 2, 6, 2, 1],
        ["wasp", 3, 2, 3, 2],
      ],
    },
  ),
  spar(3, 7, 62, 5),
  boss(3, {
    name: "Zero",
    party: [
      ["bigcrab", 1, 3, 0],
      ["crab", 3, 1, 0],
      ["crab", 3, 5, 0],
      ["crab", 2, 2, 1],
      ["crab", 2, 4, 1],
      ["toadstool", 3, 3, 2],
      ["wasp", 3, 0, 1],
      ["wasp", 3, 6, 1],
      ["gust", 3, 3, 3, 1],
      ["crab", 3, 1, 2, 2],
      ["crab", 3, 5, 2, 2],
    ],
  }),
];
export const ROOM_COUNT = ROOMS.length;
/** The rooms a wing ends on, counting from 0. */
export const BOSS_ROOMS: readonly number[] = ROOMS.flatMap((room, i) => (room.kind === "boss" ? [i] : []));

// ---------- trails ----------

export interface Trail {
  readonly name: string;
  readonly text: string;
  /** Health and attack of the forest's trouble and of its bosses, in percent. */
  readonly trouble: number;
  readonly boss: number;
  /** A sparring partner's polish: what it has spent, in percent, and how many more components it holds. */
  readonly spent: number;
  readonly components: number;
  /** What a run on this trail pays, in percent of the first. */
  readonly pays: number;
}
export const TRAILS: readonly Trail[] = [
  {
    name: "The Easy Way",
    text: "The path everybody takes. The forest is only a little cross.",
    trouble: 100,
    boss: 100,
    spent: 100,
    components: 0,
    pays: 100,
  },
  {
    name: "The Brambly Way",
    text: "Shorter on the map. More of everything on the ground, and regulars at the table who have done this before.",
    trouble: 100,
    boss: 104,
    spent: 118,
    components: 1,
    pays: 125,
  },
  {
    name: "The Long Way Round",
    text: "Nobody remembers why it is called that. Everything out here has had practice.",
    trouble: 102,
    boss: 107,
    spent: 130,
    components: 2,
    pays: 150,
  },
];
export const TRAIL_COUNT = TRAILS.length;

/**
 * The regulars at the table, whose parties turn up for sparring: the battler's own figures, each
 * sitting across the table as itself. None of them is a member: a sparring room may be another
 * member's board instead (`Party.by`), whatever name that member goes by.
 */
export const REGULARS = [
  { name: "Greg", kind: "greg" },
  { name: "Vesta", kind: "hearthcat" },
  { name: "Hodge", kind: "barrowgnome" },
  { name: "Nipper", kind: "crab7" },
  { name: "Orphion", kind: "whitefox" },
  { name: "Moth", kind: "moth" },
] as const satisfies readonly { name: string; kind: FigureId }[];

/** The regulars' names, as a party is signed. */
export const HANDLES: readonly string[] = REGULARS.map((r) => r.name);

/**
 * What a stored party may still be signed or titled with from before the figures had names of their
 * own (November 2026), and what that one is called now: three bosses' rooms and four regulars.
 */
const RENAMED: Readonly<Record<string, string>> = {
  "Old Bramble": "Snag",
  "The Magpie With The Hoard": "Swipe",
  "The Crab Nobody Counted": "Zero",
  "the Hearth Cat": "Vesta",
  "a Barrow Gnome": "Hodge",
  "Crab #7": "Nipper",
  "a Moth": "Moth",
};
/** A party's name or title as it reads now: an old one (`RENAMED`) as it is called today, anything else as it is. */
export const nowCalled = (name: string): string => RENAMED[name] ?? name;

/**
 * The regular who brought a party, by the name it was signed with (an old signature too); none for
 * anybody else, and none for a member's own board (`Party.by`) whatever its name: a member may be
 * called Greg too.
 */
export const regularOf = (party: { readonly who: string; readonly by?: string }): (typeof REGULARS)[number] | null =>
  party.by === undefined ? (REGULARS.find((r) => r.name === nowCalled(party.who)) ?? null) : null;
