/**
 * How each ability looks and sounds on the table, as a table: how long its owner winds up before
 * it goes off and how its body moves meanwhile, what it throws, the mark it leaves where it goes
 * off (drawn by `marks.ts`), the weight it lands with, and its own sound. Also what each figure
 * throws when it only attacks, and the puff it leaves when it falls.
 *
 * Nothing here draws, so the timings can be tested with the fight itself (`playback.test.ts`).
 */
import {
  BARK,
  CORAL,
  CREAM,
  EARTH,
  GOLD,
  GREEN,
  INK,
  LEAF,
  PAPER,
  SKY,
  STONE,
  WATER,
} from "@sequoia-leaf/kit/palette.ts";
import type { Fight, FightEvent } from "@sequoia-leaf/raid";
import type { Catalog } from "@sequoia-leaf/raid/content/catalog.ts";
import { figureIn, isFigureId, type UnitKind } from "@sequoia-leaf/raid/content/figures.ts";
import type { KinId } from "@sequoia-leaf/raid/content/traits.ts";

/**
 * How a figure's body moves while it winds up: rearing up, crouching, rising onto its toes,
 * shaking, leaning back, puffing up, wobbling, staring its target down, keeping perfectly still,
 * keeping still while what grows on top of it rustles, sinking into the ground, rising into the fog,
 * or spinning about.
 */
export type Body =
  | "rear"
  | "crouch"
  | "rise"
  | "shake"
  | "lean"
  | "puff"
  | "wobble"
  | "stare"
  | "still"
  | "rustle"
  | "dig"
  | "fade"
  | "spin";

/** What an ability throws: flown where the rules fly it, or (`ahead`) thrown in the wind-up so that it arrives as the ability goes off. */
export type Thrown =
  | "seed"
  | "pebble"
  | "cone"
  | "beam"
  | "cushion"
  | "tea"
  | "plaster"
  | "drop"
  | "dust"
  | "gust"
  | "spark"
  | "spoon"
  | "runner"
  | "bolt";

/** The mark an ability leaves where it goes off (`marks.ts`). */
export type MarkId =
  | "spark"
  | "cushion"
  | "dust"
  | "surface"
  | "seed"
  | "pinch"
  | "barrow"
  | "steam"
  | "slime"
  | "split"
  | "bonk"
  | "temper"
  | "skip"
  | "lamplight"
  | "advice"
  | "breath"
  | "splash"
  | "pointedly"
  | "pounce"
  | "plaster"
  | "claws"
  | "fog"
  | "stab"
  | "stomp"
  | "tonic"
  | "sit"
  | "antlers"
  | "bat"
  | "caught"
  | "plain"
  | "sting"
  | "gust"
  | "peck"
  | "squelch"
  | "spores"
  | "runner"
  | "swoop"
  | "crabbier"
  | "roots";

/** An ability's own sound: a note (semitones from A), its timbre, a second note after it, a breath of noise (its pitch), a slide, how loud; and for one that lands later, its sound then. */
export interface Voice {
  readonly n: number;
  readonly wave: OscillatorType;
  readonly two?: number;
  readonly hiss?: number;
  readonly slide?: number;
  readonly vol?: number;
  readonly lands?: Voice;
}

export interface Look {
  /** Steps it winds up before its ability goes off, and how its body moves meanwhile. */
  readonly wind: number;
  readonly body: Body;
  /** Colours drawn in toward it while it winds up: these, or its own (`livery.ts`). */
  readonly gather?: readonly string[] | "own";
  /** For one that leaps or runs to where it goes off: steps on the way, ending as it goes off. */
  readonly leap?: number;
  /** For one that strikes its target itself: how far it lunges, peaking as it goes off. */
  readonly lunge?: number;
  /** What it throws where the rules throw something. */
  readonly shot?: Thrown;
  /** What it throws during its wind-up, at whoever it is for, landing as it goes off. */
  readonly ahead?: Thrown;
  /** Where it is seen going off: where each thing thrown lands, else at the moment it goes off. */
  readonly mark: MarkId;
  /**
   * It lands some steps after it goes off (the rules' `ticks`), with nothing thrown: the hexes it
   * covers are marked until then, its owner's seal lies under whoever it is for and a lance hangs
   * over them, in its owner's colours (`spells.ts`), and its mark, bump and stop come then, where
   * they stand by then.
   */
  readonly lands?: true;
  /** A big moment: how far the board bumps, in art pixels at 1x (1 for most, 2 for the biggest). */
  readonly bump?: number;
  /** Seconds the fight's clock holds as it goes off, at 1x; a big moment holds as long as `STOP.big` unless it says. */
  readonly stop?: number;
}

/** Every ability on the board, by whose it is. */
export const LOOKS: Partial<Record<UnitKind, Look>> = {
  // ---------- one acorn ----------
  emberkit: { wind: 6, body: "shake", gather: [CORAL, GOLD[1]], ahead: "spark", mark: "spark" },
  mossmote: { wind: 6, body: "puff", gather: [GREEN[4], LEAF], shot: "cushion", mark: "cushion" },
  moth: { wind: 8, body: "shake", gather: [WATER[3], CREAM], shot: "dust", mark: "dust" },
  worm: { wind: 4, body: "dig", leap: 8, mark: "surface" },
  finch: { wind: 6, body: "puff", shot: "seed", mark: "seed" },
  crab7: { wind: 6, body: "rear", lunge: 4, mark: "pinch" },
  barrowgnome: { wind: 8, body: "lean", mark: "barrow" },
  // ---------- two acorns ----------
  kettle: { wind: 8, body: "wobble", gather: [CREAM, STONE[3]], shot: "tea", mark: "steam" },
  slug: { wind: 8, body: "puff", mark: "slime" },
  glorp: { wind: 8, body: "wobble", mark: "split" },
  chickaree: { wind: 6, body: "rear", shot: "cone", mark: "bonk" },
  jay: { wind: 6, body: "shake", mark: "temper" },
  crab12: { wind: 6, body: "lean", shot: "pebble", mark: "skip" },
  lanterngnome: { wind: 8, body: "rear", gather: [GOLD[1], GOLD[2]], shot: "beam", mark: "lamplight" },
  // ---------- three acorns ----------
  leafling: { wind: 8, body: "rear", mark: "advice" },
  cindernewt: { wind: 8, body: "puff", gather: [CORAL, GOLD[1]], mark: "breath" },
  drizzlefrog: { wind: 8, body: "puff", shot: "drop", mark: "splash" },
  rock: { wind: 10, body: "still", mark: "pointedly" },
  bushgnome: { wind: 10, body: "shake", gather: [GREEN[3], GREEN[4]], lunge: 7, mark: "pounce" },
  crab23: { wind: 6, body: "rear", shot: "plaster", mark: "plaster" },
  // ---------- four acorns ----------
  badger: { wind: 8, body: "spin", mark: "claws" },
  fogowl: { wind: 6, body: "fade", leap: 8, mark: "fog" },
  heron: { wind: 8, body: "lean", mark: "stab" },
  crab40: { wind: 8, body: "crouch", mark: "stomp" },
  apothecary: { wind: 6, body: "rear", ahead: "spoon", mark: "tonic" },
  // ---------- five acorns ----------
  greg: { wind: 12, body: "rise", mark: "sit", bump: 2 },
  whitefox: { wind: 10, body: "rear", gather: [GOLD[1], GOLD[2]], mark: "antlers", bump: 1 },
  hearthcat: { wind: 12, body: "stare", lunge: 6, mark: "bat", bump: 1 },
  // Its sprout shakes, then its roots run out to everyone (`roots.ts`) over the rest of the lead-in.
  seqwawa: { wind: 22, body: "rustle", gather: [GOLD[1], LEAF], mark: "roots", bump: 1 },
  // ---------- a banner's member ----------
  "banner-1": {
    wind: 12,
    body: "rear",
    gather: "own",
    mark: "caught",
    lands: true,
    bump: 2,
    stop: 0.12,
  },
  // ---------- the forest's own ----------
  wasp: { wind: 6, body: "shake", lunge: 5, mark: "sting" },
  puddle: { wind: 6, body: "wobble", mark: "splash" },
  toadstool: { wind: 0, body: "still", mark: "spores" },
  gust: { wind: 8, body: "wobble", gather: [CREAM, WATER[3]], shot: "gust", mark: "gust" },
  magpie: { wind: 6, body: "lean", lunge: 4, mark: "peck" },
  mud: { wind: 8, body: "wobble", mark: "squelch" },
  // ---------- the bosses ----------
  oldbramble: { wind: 10, body: "shake", ahead: "runner", mark: "runner", bump: 1 },
  hoardmagpie: { wind: 6, body: "lean", leap: 8, mark: "swoop", bump: 2 },
  bigcrab: { wind: 12, body: "rear", lunge: 3, mark: "crabbier", bump: 2 },
};

/** Each ability's own sound, by whose it is. */
export const VOICES: Partial<Record<UnitKind, Voice>> = {
  // ---------- one acorn ----------
  emberkit: { n: 7, wave: "square", hiss: 3000, slide: 1.8, vol: 0.06 },
  mossmote: { n: 12, wave: "sine", two: 7, vol: 0.06 },
  moth: { n: 19, wave: "triangle", hiss: 6000, vol: 0.05 },
  worm: { n: -12, wave: "sine", hiss: 300, slide: 2 },
  finch: { n: 16, wave: "square", two: 5, vol: 0.05 },
  crab7: { n: 10, wave: "square", hiss: 2400, slide: 0.6, vol: 0.06 },
  barrowgnome: { n: -5, wave: "triangle", hiss: 700, slide: 0.6 },
  // ---------- two acorns ----------
  kettle: { n: 14, wave: "sine", two: 4, hiss: 5000, slide: 1.3, vol: 0.05 },
  slug: { n: -9, wave: "sine", hiss: 600, slide: 0.7 },
  glorp: { n: 0, wave: "sine", two: 12, slide: 1.6 },
  chickaree: { n: 5, wave: "triangle", two: -5 },
  jay: { n: 9, wave: "sawtooth", slide: 1.3, vol: 0.05 },
  crab12: { n: 12, wave: "triangle", two: 7 },
  lanterngnome: { n: 14, wave: "sine", two: 5 },
  // ---------- three acorns ----------
  leafling: { n: 7, wave: "triangle", two: 4 },
  cindernewt: { n: -2, wave: "sawtooth", hiss: 1500, slide: 0.8, vol: 0.06 },
  drizzlefrog: { n: 2, wave: "sine", slide: 0.5 },
  rock: { n: -24, wave: "sine", vol: 0.04 },
  bushgnome: { n: 4, wave: "triangle", hiss: 2000 },
  crab23: { n: 9, wave: "triangle", two: 3, vol: 0.06 },
  // ---------- four acorns ----------
  badger: { n: -7, wave: "sawtooth", hiss: 1800, slide: 0.7, vol: 0.06 },
  fogowl: { n: -3, wave: "sine", two: -5, hiss: 900 },
  heron: { n: 17, wave: "sawtooth", slide: 0.5, vol: 0.05 },
  crab40: { n: -10, wave: "triangle", hiss: 400 },
  apothecary: { n: 12, wave: "sine", two: 7, hiss: 4000, vol: 0.06 },
  // ---------- five acorns ----------
  greg: { n: -19, wave: "triangle", hiss: 200, slide: 0.5, vol: 0.14 },
  whitefox: { n: 19, wave: "sine", two: 7, vol: 0.09 },
  hearthcat: { n: 3, wave: "triangle", hiss: 2500, slide: 0.6 },
  // A creak and a rising pair of soft notes, Moss's and a Mender's.
  seqwawa: { n: -7, wave: "sine", two: 12, hiss: 300, vol: 0.08 },
  // A low two-note stare, and a thump with a bell over it when it lands.
  "banner-1": {
    n: -14,
    wave: "triangle",
    two: -1,
    hiss: 500,
    slide: 0.94,
    vol: 0.1,
    lands: { n: -22, wave: "sine", two: 34, hiss: 260, slide: 0.5, vol: 0.14 },
  },
  // ---------- the forest's own ----------
  wasp: { n: 21, wave: "sawtooth", slide: 0.8, vol: 0.04 },
  puddle: { n: 0, wave: "sine", hiss: 1200, slide: 0.6 },
  toadstool: { n: -3, wave: "triangle", hiss: 1000, vol: 0.06 },
  gust: { n: 5, wave: "sine", hiss: 2500, slide: 1.5 },
  magpie: { n: 14, wave: "square", vol: 0.05 },
  mud: { n: -12, wave: "sine", hiss: 400, slide: 0.6 },
  // ---------- the bosses ----------
  oldbramble: { n: -14, wave: "triangle", hiss: 600 },
  hoardmagpie: { n: 7, wave: "square", two: 12, vol: 0.07 },
  bigcrab: { n: -15, wave: "square", hiss: 1800, slide: 0.6, vol: 0.12 },
};

/** What a figure throws when it only attacks: a small thing of a colour (`"own"`: its own, as `livery.ts` has it), some with a streak behind, a few a thing of their own (`shot`). */
export const ATTACK_SHOT: Partial<
  Record<UnitKind, { readonly col: string; readonly trail?: boolean; readonly shot?: Thrown }>
> = {
  mossmote: { col: GREEN[4] },
  moth: { col: WATER[3] },
  finch: { col: EARTH[2] },
  kettle: { col: CREAM },
  chickaree: { col: BARK[4] },
  crab12: { col: STONE[3] },
  lanterngnome: { col: GOLD[2], trail: true },
  leafling: { col: GREEN[3] },
  cindernewt: { col: CORAL, trail: true },
  drizzlefrog: { col: WATER[2] },
  crab23: { col: PAPER[1] },
  heron: { col: CREAM, trail: true },
  apothecary: { col: SKY[4] },
  "banner-1": { col: "own", trail: true, shot: "bolt" },
  toadstool: { col: SKY[4] },
  gust: { col: CREAM, trail: true },
};

/** The puff a figure leaves when it falls: its colours, and whether they rise (smoke, mist), drift down (leaves, feathers) or scatter (earth, shell). */
export interface Puff {
  readonly cols: readonly string[];
  readonly drift: "up" | "down" | "out";
}
const KIN_PUFF: Readonly<Record<KinId, Puff>> = {
  ember: { cols: [STONE[2], STONE[3], CORAL], drift: "up" },
  moss: { cols: [GREEN[3], GREEN[4]], drift: "down" },
  mist: { cols: [WATER[3], CREAM], drift: "up" },
  burrow: { cols: [EARTH[1], EARTH[2]], drift: "out" },
  feather: { cols: [PAPER[2], CREAM], drift: "down" },
  crab: { cols: ["#b0483a", PAPER[1]], drift: "out" },
  gnome: { cols: [SKY[4], PAPER[1]], drift: "out" },
  // Gold, rising: what the raiders saw going back where it came from.
  graid: { cols: [GOLD[1], GOLD[2], CREAM], drift: "up" },
};
const SHELL: Puff = KIN_PUFF.crab;
const LEAVES: Puff = { cols: [BARK[3], GREEN[3]], drift: "down" };
const PUFFS: Partial<Record<UnitKind, Puff>> = {
  rock: { cols: [STONE[1], STONE[2]], drift: "out" },
  bramble: LEAVES,
  sprout: LEAVES,
  oldbramble: LEAVES,
  wasp: { cols: [GOLD[1], INK], drift: "out" },
  puddle: { cols: [WATER[2], WATER[3]], drift: "out" },
  toadstool: { cols: [SKY[4], CREAM], drift: "up" },
  gust: { cols: [CREAM, WATER[3]], drift: "up" },
  magpie: { cols: [INK, PAPER[2]], drift: "down" },
  hoardmagpie: { cols: [INK, PAPER[2]], drift: "down" },
  mud: KIN_PUFF.burrow,
  crab: SHELL,
  bigcrab: SHELL,
  uncounted: SHELL,
  biguncounted: SHELL,
  glorplet: KIN_PUFF.mist,
};
/** The puff a figure of a kind leaves; plain dust for anyone with nothing of their own. */
export const puffOf = (cat: Catalog, kind: UnitKind): Puff =>
  PUFFS[kind] ?? (isFigureId(kind) ? KIN_PUFF[figureIn(cat, kind).kin] : { cols: [PAPER[1], EARTH[2]], drift: "out" });

/** Steps before a blow lands that its owner begins it: drawing back, then the lunge that peaks as it lands. */
export const SWING_LEAD = 4;
/** Steps before something is thrown that its thrower draws back. */
export const THROW_LEAD = 3;

/** How many steps before it happens the table begins showing an event (`playback.ts`). */
export function leadOf(ev: FightEvent, f: Fight): number {
  if (ev.t === "swing") return SWING_LEAD;
  if (ev.t === "shot") return ev.what === "attack" ? THROW_LEAD : 0;
  if (ev.t === "cast") {
    const look = LOOKS[ev.kind];
    return look ? look.wind + (look.leap ?? 0) : 0;
  }
  if (ev.t === "leap" && ev.why === "ability") {
    const kind = f.units[ev.id]?.kind;
    return (kind && LOOKS[kind]?.leap) || 0;
  }
  return 0;
}
