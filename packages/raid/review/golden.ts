/**
 * The raid's goldens: what today's rules do, written down, so that a change meant to change nothing
 * proves it, and one meant to change something shows what it changed:
 *
 *     bun review/golden.ts           # every golden against the rules now: what differs, set by set
 *     bun review/golden.ts --write   # the same, then the goldens written as the rules have them now
 *     bun review/golden.ts --pool    # as --write, with the fights' pool taken afresh from the content
 *
 * `golden.test.ts` holds them in `bun run verify`. Regenerating one is a line in the PR's
 * description saying why. In `golden/`:
 *
 * - `fights.txt`: 500 seeded fights, each set up from the ids in `pool.txt` alone, so content added
 *   later changes none of them; by a hash of the setup and one of every event;
 * - `fights-<release>.txt`: 100 more at each of the latest eras (`ERA_GOLDENS`), set up from that
 *   era's own `pool-<release>.txt` and played by its catalogue, so the numbers a release changed are
 *   pinned too;
 * - `runs.txt`: 100 runs for each of the bot's four habits, over the trails, the member's own figures
 *   and both endless ways, each from a table of its own and played by the table's commands off the
 *   wire as Leaf takes them, the bot planning as the page's does (`planCommands`); by a hash of what
 *   every command drew, paid, left and logged, and one of the end;
 * - `sittings.txt`: eight regulars to the end, and two members planning as the sensible bot beside
 *   six regulars, deadline by deadline;
 * - `keys.txt`: for each shape Leaf stores, the keys its writer writes, pinned beside its version. A
 *   version once pinned keeps its keys, so a shape that gains or loses a field takes a new version
 *   (one that re-means a field takes one too, though no key says so);
 * - `stored/`: a row of each shape at each version, written when that version is first seen and
 *   never again. Each must read for ever.
 *
 * What a golden hashes is what the rules did (who stood where, what was drawn, what came of it), never
 * how a run or a table is stored, so a change of shape alone changes no golden but `keys.txt`. A
 * command is hashed as the table reads it (`RAID.command`), never as it was spelt on the wire.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

import {
  below,
  type Ctx,
  draw32,
  isRefused,
  type Kept,
  LOGGED,
  type Logged,
  type Met,
  mix,
  pick,
  shuffled,
  type Stream,
} from "@sequoia-leaf/core";
import { CARELESS, type Habit, planRoom, ROLLER, SAVER, SENSIBLE } from "@sequoia-leaf/raid/bot.ts";
import { FIGHT_BOONS, isBoonId } from "@sequoia-leaf/raid/content/boons.ts";
import { catalogAt, everyFigure } from "@sequoia-leaf/raid/content/catalog.ts";
import { isUnitKind, type Stars, traitsOf, TROUBLE_IDS } from "@sequoia-leaf/raid/content/figures.ts";
import { COMPONENT_IDS, FINISHED_IDS, grantOf, isItemId, type ItemId } from "@sequoia-leaf/raid/content/items.ts";
import { type Era, eraOf, LAST_ERA, LEGACY_ERA, type ReleaseId } from "@sequoia-leaf/raid/content/releases.ts";
import { LEVELS } from "@sequoia-leaf/raid/content/rooms.ts";
import { TRAIT_IDS, traitNumber } from "@sequoia-leaf/raid/content/traits.ts";
import { recordFight } from "@sequoia-leaf/raid/fight/engine.ts";
import type { FightSetup, FightSummary } from "@sequoia-leaf/raid/fight/types.ts";
import { meets, planCommands, RAID, type RaidNote, type Table, TABLE_VERSION } from "@sequoia-leaf/raid/game.ts";
import { SEATS } from "@sequoia-leaf/raid/hex.ts";
import { isParty, type Party, type Placed } from "@sequoia-leaf/raid/party.ts";
import type { Choice, Fought, Piece, RoomRecord, Run, RunView, Stage } from "@sequoia-leaf/raid/run.ts";
import { advance, begin } from "@sequoia-leaf/raid/sitting/clock.ts";
import { command as sittingCommand, openSitting } from "@sequoia-leaf/raid/sitting/commands.ts";
import { decodeSitting, encodeSitting, SITTING_VERSION } from "@sequoia-leaf/raid/sitting/keep.ts";
import {
  type Member,
  seatsIn,
  type Sitting,
  type Stage as SittingStage,
  type Who,
} from "@sequoia-leaf/raid/sitting/sitting.ts";

export const GOLDEN = new URL("golden/", import.meta.url);
export const STORED = new URL("golden/stored/", import.meta.url);
/** Where every golden stream starts. */
const SEED = 0x601d;

// ---------- a line of a golden ----------

/** One golden: what it is, what it came to in words, and its hashes, each named. */
export interface Line {
  readonly id: string;
  readonly says: string;
  readonly hashes: string;
}
const lineText = (l: Line): string => `${l.id} | ${l.says} | ${l.hashes}`;
export const linesText = (lines: readonly Line[]): string => lines.map((l) => `${lineText(l)}\n`).join("");
export function readLines(text: string): Line[] {
  return text
    .split("\n")
    .filter((t) => t !== "")
    .map((t) => {
      const [id = "", says = "", hashes = ""] = t.split(" | ");
      return { id, says, hashes };
    });
}

/** A short hash of plain values, each written out as JSON as it is added. */
class Hash {
  private readonly h = new Bun.CryptoHasher("sha1");
  add(part: unknown): void {
    this.h.update(JSON.stringify(part));
  }
  get(): string {
    return this.h.digest("hex").slice(0, 12);
  }
}
function hashOf(parts: readonly unknown[]): string {
  const h = new Hash();
  for (const part of parts) h.add(part);
  return h.get();
}
const pad = (n: number): string => String(n).padStart(3, "0");

/**
 * How two sets of goldens differ, a line each: one changed (what it said and says, or which of its
 * hashes moved when its words did not), one new (`+`), one gone (`-`).
 */
export function differences(was: readonly Line[], now: readonly Line[]): string[] {
  const before = new Map(was.map((l) => [l.id, l]));
  const after = new Set(now.map((l) => l.id));
  const out: string[] = [];
  for (const l of now) {
    const b = before.get(l.id);
    if (!b) out.push(`+ ${lineText(l)}`);
    else if (b.says !== l.says) out.push(`  ${l.id}: ${b.says} -> ${l.says}`);
    else if (b.hashes !== l.hashes) out.push(`  ${l.id}: ${l.says} (${moved(b.hashes, l.hashes)})`);
  }
  for (const l of was) if (!after.has(l.id)) out.push(`- ${lineText(l)}`);
  return out;
}
/** Hashes by name: `setup a fight b`. */
function named(hashes: string): Map<string, string> {
  const words = hashes.split(" ");
  return new Map(words.flatMap((w, i) => (i % 2 === 0 ? [[w, words[i + 1] ?? ""]] : [])));
}
/** Which named hashes differ: "fight differs" for `setup a fight b` against `setup a fight c`. */
function moved(was: string, now: string): string {
  const a = named(was);
  const b = named(now);
  const names = [...b].flatMap(([name, h]) => (a.get(name) === h ? [] : [name]));
  return `${names.join(" and ")} ${names.length > 1 ? "differ" : "differs"}`;
}

// ---------- what the rules did, as plain values ----------

const placed = (p: Placed): unknown => [p.kind, p.stars, p.seat, p.items, p.fed, p.level ?? 0];
const party = (p: Party): unknown => [p.who, p.by ?? null, p.might, p.boons, p.figures.map(placed)];
const piece = (p: Piece | null): unknown => p && [p.id, p.kind, p.stars, p.items, p.fed];
const outcome = (o: FightSummary): unknown => [
  o.result,
  o.ticks,
  o.standing,
  o.dusk,
  o.units.map((u) => [u.id, u.side, u.kind, u.stars, u.alive, u.hp, u.maxHp, u.dealt, u.taken, u.healed, u.casts]),
];
const setupOf = (s: FightSetup): unknown => [s.seed, s.sides.map(party)];
const fought = (f: Fought): unknown => [setupOf(f.setup), outcome(f.outcome)];
const choice = (c: Choice): unknown => [c.kind, c.options, c.kind === "boon" ? c.redraws : 0];
const stage = (s: Stage): unknown =>
  s.phase === "plan"
    ? [s.phase, s.picks.map(choice)]
    : s.phase === "fight"
      ? [s.phase, fought(s.fight)]
      : [s.phase, s.ending];
const roomRecord = (r: RoomRecord): unknown => [r.room, r.kind, r.result, r.standing, r.boss, r.met ?? null];
/** A run as the rules left it: its streams, where it stands, and everything it has; not which way it set out. */
export const runState = (r: Run): unknown => [
  r.seed,
  r.rng,
  r.room,
  stage(r.stage),
  [r.resolve, r.acorns, r.streak, r.level, r.xp],
  r.board.map(piece),
  r.bench.map(piece),
  r.items,
  r.stall,
  [r.held, r.rustles, r.bought],
  r.boons,
  party(r.foe),
  r.record.map(roomRecord),
  r.nextId,
  r.seen,
];
/** Each room's result, a letter a room: W, L or D. */
const results = (record: readonly RoomRecord[]): string =>
  record.map((r) => (r.result === "win" ? "W" : r.result === "loss" ? "L" : "D")).join("");

// ---------- what the goldens see of what Leaf stores ----------

/** The shapes Leaf stores that the goldens pin. */
export const SHAPES = ["table", "sitting", "fight", "board", "depth"] as const;
export type Shape = (typeof SHAPES)[number];
/**
 * Each shape's version. A fight (a row of `raid_fights`), a board and a depth (pieces left in
 * `play_kept`) are kept with no version of their own: the number here stands for one, and moves
 * when their keys do, in the PR that says why. Fight 3: a row keeps its fight's setup.
 */
export const VERSIONS: Readonly<Record<Shape, number>> = {
  table: TABLE_VERSION,
  sitting: SITTING_VERSION,
  fight: 3,
  board: 1,
  depth: 1,
};

/** Objects keyed by ids rather than by field names: a roster (a run kept before version 8 kept it as `own`), and the traits a side switched on. */
const MAPS = new Set(["own", "roster", "traits"]);
/** Every key a value is written with, as a path: `run.board[].kind`, `run.own.*`. */
export function keysOf(v: unknown, into: Set<string>, at = ""): Set<string> {
  if (Array.isArray(v)) for (const x of v) keysOf(x, into, `${at}[]`);
  else if (typeof v === "object" && v !== null) {
    const map = MAPS.has(at.slice(at.lastIndexOf(".") + 1));
    for (const [k, x] of Object.entries(v)) {
      const path = `${at === "" ? "" : `${at}.`}${map ? "*" : k}`;
      into.add(path);
      keysOf(x, into, path);
    }
  }
  return into;
}

/** What the goldens saw written: the keys of each shape, and a first row of each case worth keeping. */
export class Seen {
  readonly keys = new Map<Shape, Set<string>>(SHAPES.map((s) => [s, new Set()]));
  /** By the name its stored row would have: `table-v3-own.json`. */
  readonly rows = new Map<string, string>();
  saw(shape: Shape, text: string, kept?: string): void {
    keysOf(JSON.parse(text), this.keys.get(shape) ?? new Set());
    const name = kept && rowName(shape, kept);
    if (name && !this.rows.has(name)) this.rows.set(name, text);
  }
}
export const rowName = (shape: Shape, kept: string): string => `${shape}-v${VERSIONS[shape]}-${kept}.json`;

// ---------- 500 fights ----------

export const FIGHTS = 500;

/** What the golden fights are set up from: ids, and the little the setting up knows of them, as they were when pinned. */
export interface Pool {
  readonly figures: readonly string[];
  readonly troubles: readonly string[];
  /** For each trait, the figures that carry it. */
  readonly traits: Readonly<Record<string, readonly string[]>>;
  readonly components: readonly string[];
  readonly finished: readonly string[];
  /** For each emblem, the trait it grants its holder. */
  readonly emblems: Readonly<Record<string, string>>;
  readonly boons: readonly string[];
  /** The highest level a member's figure reaches, and the most times Greg eats. */
  readonly level: number;
  readonly fed: number;
}

/** The pool as the content has it now, every release open: the goldens' only read of the content's lists. */
export function poolNow(): Pool {
  const cat = catalogAt(LAST_ERA);
  return {
    figures: [...everyFigure()],
    troubles: [...TROUBLE_IDS],
    traits: Object.fromEntries(TRAIT_IDS.map((t) => [t, everyFigure().filter((f) => traitsOf(cat, f).includes(t))])),
    components: [...COMPONENT_IDS],
    finished: [...FINISHED_IDS],
    emblems: Object.fromEntries(cat.ids.emblems.flatMap((id) => [[id, grantOf(cat, id) ?? ""]])),
    boons: [...FIGHT_BOONS],
    level: LEVELS.most,
    fed: traitNumber(cat, "greg", "most", 1),
  };
}

export function poolText(p: Pool): string {
  const rows = [
    `figures ${p.figures.join(" ")}`,
    `troubles ${p.troubles.join(" ")}`,
    ...Object.entries(p.traits).map(([t, fs]) => `trait ${t} ${fs.join(" ")}`),
    `components ${p.components.join(" ")}`,
    `finished ${p.finished.join(" ")}`,
    ...Object.entries(p.emblems).map(([e, kin]) => `emblem ${e} ${kin}`),
    `boons ${p.boons.join(" ")}`,
    `level ${p.level}`,
    `fed ${p.fed}`,
  ];
  return `${rows.join("\n")}\n`;
}
export function readPool(text: string): Pool {
  const rows = text.split("\n").map((t) => t.split(" ").filter((w) => w !== ""));
  const list = (name: string): string[] => rows.find((r) => r[0] === name)?.slice(1) ?? [];
  const pairs = (name: string): [string, string[]][] =>
    rows.flatMap((r) => (r[0] === name && r[1] ? [[r[1], r.slice(2)]] : []));
  return {
    figures: list("figures"),
    troubles: list("troubles"),
    traits: Object.fromEntries(pairs("trait")),
    components: list("components"),
    finished: list("finished"),
    emblems: Object.fromEntries(pairs("emblem").map(([e, [kin = ""]]) => [e, kin])),
    boons: list("boons"),
    level: Number(list("level")[0] ?? 0),
    fed: Number(list("fed")[0] ?? 0),
  };
}

/** An id of the pool as the rules know it; one they no longer know means the pool wants taking afresh (`--pool`). */
function known<T>(id: string, is: (v: unknown) => v is T): T {
  if (!is(id)) throw new Error(`"${id}" in golden/pool.txt is not in the raid now: take the pool afresh with --pool`);
  return id;
}
const starsOf = (s: Stream): Stars => {
  const r = below(s, 10);
  return r < 6 ? 1 : r < 9 ? 2 : 3;
};

/** Up to three things for a figure to hold, as a party could: at most one loose component, no emblem of its own kin, none twice. */
function itemsFor(pool: Pool, s: Stream, kind: string): ItemId[] {
  const items: string[] = [];
  for (let n = below(s, 4); n > 0; n--) {
    const r = below(s, 10);
    const emblem = pick(s, Object.keys(pool.emblems));
    const kin = pool.emblems[emblem] ?? "";
    if (r < 2 && !items.some((i) => pool.components.includes(i))) items.push(pick(s, pool.components));
    else if (r < 8) items.push(pick(s, pool.finished));
    else if (!items.includes(emblem) && !(pool.traits[kin] ?? []).includes(kind)) items.push(emblem);
  }
  return items.map((i) => known(i, isItemId));
}

/** `size` seats of a party's half, none twice. */
const seatsFor = (s: Stream, size: number): number[] =>
  shuffled(
    s,
    Array.from({ length: SEATS }, (_, n) => n),
  ).slice(0, size);

/** `size` figures, most of them carrying `theme`, seated anywhere, with stars, items and (`levels`) levels. */
function figuresFor(pool: Pool, s: Stream, size: number, theme: string, levels: boolean): Placed[] {
  const themed = pool.traits[theme] ?? [];
  return seatsFor(s, size).map((seat): Placed => {
    const id = themed.length > 0 && below(s, 10) < 6 ? pick(s, themed) : pick(s, pool.figures);
    const stars = starsOf(s);
    const items = itemsFor(pool, s, id);
    const fed = (pool.traits["greg"] ?? []).includes(id) ? below(s, pool.fed + 1) : 0;
    const level = levels ? below(s, pool.level + 1) : 0;
    const p: Placed = { kind: known(id, isUnitKind), stars, seat, items, fed };
    if (level > 0) p.level = level;
    return p;
  });
}

/** One to six of the forest's trouble, bosses among them. */
function troubleFor(pool: Pool, s: Stream): Placed[] {
  return seatsFor(s, 1 + below(s, 6)).map((seat): Placed => ({
    kind: known(pick(s, pool.troubles), isUnitKind),
    stars: starsOf(s),
    seat,
    items: [],
    fed: 0,
  }));
}

/** The `n`th golden fight's setup: drawn from its own stream and the pool alone, at an era (the legacy one but for `ERA_GOLDENS`). */
export function goldenSetup(pool: Pool, n: number, era: Era = LEGACY_ERA, seed = SEED): FightSetup {
  const s: Stream = { rng: mix(seed, n) };
  const traits = Object.keys(pool.traits);
  const theme = (k: number): string => traits[(n + k * 5) % traits.length] ?? "";
  const size = (): number => (n % 10 === 9 ? 1 + below(s, 2) : 3 + below(s, 6));
  const side = (who: string, figures: Placed[], might: number): Party => ({
    who,
    title: "a golden party",
    figures,
    boons: pool.boons.filter(() => below(s, 5) === 0).map((b) => known(b, isBoonId)),
    might,
  });
  const home = side("home", figuresFor(pool, s, size(), theme(0), n % 4 === 1), 100);
  const away =
    n % 3 === 0
      ? side("forest", troubleFor(pool, s), 100 + 10 * below(s, 11))
      : side("away", figuresFor(pool, s, size(), theme(1), n % 4 === 3), 100);
  return { seed: draw32(s), era, sides: [home, away] };
}

/** The `n`th golden fight's line, played from its setup (`setup`: as the pool sets it up, unless given one kept). */
export function fightLine(pool: Pool, n: number, setup = goldenSetup(pool, n)): Line {
  const { opening, steps, summary } = recordFight(setup);
  const events = opening.length + steps.reduce((a, step) => a + step.length, 0);
  const sizes = setup.sides.map((p) => p.figures.length).join(" on ");
  return {
    id: `fight ${pad(n)}`,
    says: `${sizes}: ${summary.result} in ${summary.seconds.toFixed(1)}s, ${summary.standing.join(" to ")} standing, ${events} events`,
    hashes: `setup ${hashOf([setupOf(setup)])} fight ${hashOf([opening, ...steps, outcome(summary)])}`,
  };
}
export const fightLines = (pool: Pool): Line[] => Array.from({ length: FIGHTS }, (_, n) => fightLine(pool, n));

// ---------- 100 fights at each of the latest eras ----------

/** The releases whose eras have fights pinned of their own, each from that era's pool and played by its catalogue. */
export const ERA_GOLDENS = ["gaz-stall", "groot-night"] as const satisfies readonly ReleaseId[];
export type EraGolden = (typeof ERA_GOLDENS)[number];
const ERA_FIGHTS = 100;

/** The pool as a release's era has it open: everything there then, and nothing later. */
export function poolAt(release: EraGolden): Pool {
  const cat = catalogAt(eraOf(release));
  return {
    figures: [...cat.order],
    troubles: [...TROUBLE_IDS],
    traits: Object.fromEntries(cat.ids.traits.map((t) => [t, cat.order.filter((f) => traitsOf(cat, f).includes(t))])),
    components: [...cat.ids.components],
    finished: [...cat.ids.finished],
    emblems: Object.fromEntries(cat.ids.emblems.map((id) => [id, grantOf(cat, id) ?? ""])),
    boons: FIGHT_BOONS.filter((b) => cat.ids.boons.includes(b)),
    level: LEVELS.most,
    fed: traitNumber(cat, "greg", "most", 1),
  };
}
/** The `n`th fight pinned at a release's era: set up as a golden fight is, from a stream of that era's own. */
export const eraSetup = (pool: Pool, release: EraGolden, n: number): FightSetup =>
  goldenSetup(pool, n, eraOf(release), mix(SEED, eraOf(release)));
export const eraFightLines = (pool: Pool, release: EraGolden): Line[] =>
  Array.from({ length: ERA_FIGHTS }, (_, n) => fightLine(pool, n, eraSetup(pool, release, n)));

// ---------- 100 runs a habit, played at a table ----------

/**
 * The bot's habits as it names them. One fond of a trait is the sensible one with a taste: the
 * regulars of the golden sittings play those.
 */
export const HABITS: readonly Habit[] = [SENSIBLE, SAVER, ROLLER, CARELESS];
export const RUNS_A_HABIT = 100;
/** An endless run walks home after this many rooms. */
const MOST_ROOMS = 40;

/** A way a golden run sets out, as its first command says it off the wire. */
interface Way {
  readonly name: string;
  /** What its stored rows are called. */
  readonly kept: string;
  readonly start: Readonly<Record<string, unknown>>;
  readonly endless: boolean;
}
const WAYS: readonly Way[] = [
  { name: "trail 1", kept: "main", start: { do: "start", trail: 0 }, endless: false },
  { name: "trail 2", kept: "main", start: { do: "start", trail: 1 }, endless: false },
  { name: "trail 3", kept: "main", start: { do: "start", trail: 2 }, endless: false },
  { name: "own figures", kept: "own", start: { do: "start", trail: 0, own: true }, endless: false },
  { name: "the Wilds", kept: "wilds", start: { do: "endless", way: "wilds" }, endless: true },
  { name: "the Deep Woods", kept: "deep", start: { do: "endless", way: "deep" }, endless: true },
];

/** The table every golden run sets out from, as Leaf kept one at version 3: every trail open, and nothing else. */
const START = {
  game: "little-raid-table",
  v: 3,
  rng: 0,
  runs: 2,
  run: null,
  endless: null,
  ventures: 0,
  almanac: {
    fielded: [],
    threeStars: [],
    forged: [],
    topped: [],
    bosses: [["bigcrab"], ["bigcrab"], []],
    best: [15, 15, 0],
    runs: 2,
    deepest: { wilds: 0, deep: 0 },
  },
  trail: 0,
  looks: { place: "clearing", cloth: "bare", lantern: "iron", bases: "plain", owned: [] },
  week: { at: 0, deepest: { wilds: 0, deep: 0 } },
};
const NOW = Date.UTC(2026, 10, 27, 12);
const PLAYER = { id: "00000000-0000-4000-8000-00000000601d", guest: false };
/** What the golden member has pulled: some figures with levels, and a banner's member. */
const AWARDS = [
  ...["crab7", "worm", "slug", "rock", "badger", "greg", "emberkit", "moth", "kettle", "jay", "fogowl", "heron"].map(
    (id) => `pull:figure:${id}`,
  ),
  "copies:figure:crab7:3",
  "copies:figure:slug:2",
  "copies:figure:badger:5",
  "pull:headliner:banner-1",
];
/** Another member, whose board a run meets at every second room it could. */
const OTHER = { player: "00000000-0000-4000-8000-0000000060d2", name: "Another member", of: 1 };
const OTHER_BOARD = {
  who: "Another member",
  title: "their board at this room",
  figures: [
    { kind: "crab7", stars: 2, seat: 2, items: ["conker"], fed: 0, level: 2 },
    { kind: "slug", stars: 2, seat: 3, items: [], fed: 0, level: 1 },
    { kind: "badger", stars: 1, seat: 4, items: ["blackthorn", "hedgehog"], fed: 0, level: 3 },
    { kind: "emberkit", stars: 2, seat: 9, items: [], fed: 0 },
    { kind: "moth", stars: 1, seat: 22, items: ["mothlantern"], fed: 0 },
    { kind: "greg", stars: 1, seat: 23, items: [], fed: 4 },
  ],
  boons: ["secondwind"],
  might: 100,
};

/** The run a way plays at a table: the one place the goldens read where a table keeps its runs. */
const heldBy = (table: Table, way: Way): Run | null => table.held[way.endless ? "endless" : "main"];
type Ended = Extract<RaidNote, { t: "ended" }>;

/** A golden run under way at its table: every command sent as Leaf takes one, and what each did, hashed as it is done. */
class Playing {
  table: Table;
  ended: Ended | null = null;
  coins = 0;
  private sent = 0;
  private meetings = 0;
  readonly draws = new Hash();
  readonly aim: { endless?: true };
  readonly way: Way;
  readonly n: number;
  readonly seen: Seen;

  constructor(way: Way, n: number, seen: Seen) {
    this.way = way;
    this.n = n;
    this.seen = seen;
    const table = RAID.decode(JSON.stringify({ ...START, rng: mix(SEED, 1000 + n) }));
    if (!table) throw new Error("the golden table does not read");
    this.table = table;
    this.aim = way.endless ? { endless: true } : {};
  }
  get run(): Run | null {
    return heldBy(this.table, this.way);
  }
  /** A command off the wire, at the moment, with Leaf's dice and, at every second meeting, another member's board. */
  send(raw: object): boolean {
    const c = RAID.command(JSON.parse(JSON.stringify(raw)));
    if (!c) throw new Error(`the wire does not read ${JSON.stringify(raw)}`);
    const meeting = meets(this.table, c) && this.meetings++ % 2 === 0;
    const met: Met | undefined = meeting ? { ...OTHER, data: OTHER_BOARD } : undefined;
    const ctx: Ctx = { ...ctxOf(mix(mix(SEED, this.n), this.sent++)), ...(met && { met }) };
    const done = RAID.apply(this.table, c, ctx);
    if (isRefused(done)) {
      this.draws.add(["refused", c, done.refused]);
      return false;
    }
    this.table = done.state;
    this.ended ??= done.notes.find((note): note is Ended => note.t === "ended") ?? null;
    for (const pay of done.coins ?? []) this.coins += pay.amount;
    const run = this.run;
    const { keep = [], log = [] } = done;
    this.draws.add([c, done.coins ?? [], keep.map(keptOf), log.map((l) => l.kind), run && runState(run)]);
    watch(this.seen, this.way, c.do, this.table, run, keep, log);
    return true;
  }
  /**
   * Plans the room as the page's bot does, asking again after every answer, with the room's free
   * rustle besides. Asked again, the bot may want the same two figures swapped back for ever: moves
   * and nothing else, the same as the last ask's, end the planning, unsent.
   */
  plan(habit: Habit): void {
    let rustled = false;
    let last = "";
    for (let ask = 0; ask < 16; ask++) {
      const commands = planCommands(RAID.view(this.table, ctxOf(0)), habit, this.way.endless ? "endless" : "main");
      const asked = JSON.stringify(commands);
      if (commands.length > 0 && commands.every((c) => c.do === "move") && asked === last) return;
      last = asked;
      if (commands.length > 0) {
        if (!commands.every((c) => this.send(c))) return;
        continue;
      }
      if (rustled || habit.rustles === 0 || (this.run?.rustles ?? 0) === 0) return;
      rustled = true;
      if (!this.send({ do: "rustle", ...this.aim })) return;
    }
  }
}

/** Plays the `n`th run of a habit, every command off the wire, and gives its golden line. */
export function runLine(habit: Habit, n: number, seen: Seen): Line {
  const way = WAYS[n % WAYS.length];
  if (!way) throw new Error("no ways");
  const p = new Playing(way, n, seen);
  p.send(way.start);
  for (let room = 0; room < MOST_ROOMS && p.run; room++) {
    p.plan(habit);
    if (!p.send({ do: "fight", ...p.aim }) || !p.send({ do: "take", ...p.aim })) break;
  }
  if (p.run) p.send({ do: "abandon", ...p.aim });
  const last = p.ended?.run;
  const summary = last
    ? `${p.ended?.summary.ending ?? "over"} in room ${last.room + 1}, ${results(last.record)}, resolve ${last.resolve}, level ${last.level}, ${p.coins} Coins`
    : "never ended";
  return {
    id: `run ${habit.name} ${pad(n)}`,
    says: `${way.name}: ${summary}`,
    hashes: `draws ${p.draws.get()} end ${hashOf([last && runViewState(last), p.ended?.summary ?? null, p.table.almanac])}`,
  };
}
const ctxOf = (seed: number): Ctx => ({ now: NOW, player: PLAYER, seed, room: 1e9, awards: AWARDS, postcards: {} });
const keptOf = (k: Kept): unknown => [k.slot, k.held ?? false, isParty(k.data) ? party(k.data) : k.data];
/** A run as the page is shown it once over: what it had, without its streams. */
const runViewState = (r: RunView): unknown => [
  r.room,
  [r.resolve, r.acorns, r.streak, r.level, r.xp],
  r.board.map(piece),
  r.bench.map(piece),
  r.items,
  r.boons,
  r.record.map(roomRecord),
  r.seen,
];

/** What a command leaves that Leaf stores: the table at a fight, the pieces left, the fights logged. */
function watch(
  seen: Seen,
  way: Way,
  did: string,
  table: Table,
  run: Run | null,
  keep: readonly Kept[],
  log: readonly Logged[],
): void {
  if (did === "fight" || did === "start" || did === "endless") {
    const worth = run && (run.foe.by !== undefined || (way.endless && run.room >= 15));
    seen.saw("table", RAID.encode(table), worth ? way.kept : undefined);
  }
  for (const k of keep) {
    const shape: Shape = k.slot.startsWith("depth:") ? "depth" : "board";
    const kept =
      shape === "depth" ? "ever" : k.slot.startsWith("own:") ? "own" : k.slot.startsWith("deep:") ? "held" : "fair";
    seen.saw(shape, JSON.stringify(k.data), kept);
  }
  for (const l of log) {
    if (l.kind !== LOGGED.raidFight) continue;
    seen.saw("fight", JSON.stringify(l.data), l.data.against === null ? undefined : way.kept);
  }
}

export const runLines = (habit: Habit, seen: Seen): Line[] =>
  Array.from({ length: RUNS_A_HABIT }, (_, n) => runLine(habit, n, seen));

// ---------- sittings ----------

const SAT_AT = Date.UTC(2026, 10, 27, 18);
const MEMBERS: readonly Member[] = [
  { id: "00000000-0000-4000-8000-0000000060d3", name: "Golden one" },
  { id: "00000000-0000-4000-8000-0000000060d4", name: "Golden two" },
];
const whoOf = (w: Who): unknown => (w.is === "member" ? [w.is, w.id] : [w.is, w.figure, w.habit]);
const nameOf = (w: Who): string => (w.is === "member" ? w.name : `${w.figure}, fond of ${w.habit}`);
const sittingStage = (s: SittingStage): unknown =>
  s.at === "open"
    ? [s.at, s.until, s.sat.map((m) => m.id)]
    : s.at === "carousel"
      ? [s.at, s.until, s.ring.map((o) => [o.kind, o.item, o.by]), s.turns, s.open]
      : s.at === "over"
        ? [s.at, s.ended]
        : [s.at, s.until];
/** A sitting as the clock left it: its stream, the room and stage, and every seat. */
const sittingState = (t: Sitting): unknown => [
  t.rng,
  t.room,
  sittingStage(t.stage),
  t.seats.map((seat) => [whoOf(seat.who), seat.place, runState(seat.run), party(seat.shown)]),
  t.pairs,
  t.odd,
  t.owed,
];
const deadline = (t: Sitting): number => (t.stage.at === "over" ? t.stage.ended : t.stage.until);

/** A sitting's golden lines: one for the sitting (`draws`: a hash of every deadline it was seen at), one a seat. */
function sittingLines(name: string, end: Sitting, draws: string | null): Line[] {
  const over = end.stage.at === "over" ? `over after ${Math.round((end.stage.ended - SAT_AT) / 1000)}s` : end.stage.at;
  return [
    {
      id: `sitting ${name}`,
      says: `${end.room + 1} rooms, ${over}, ${end.owed.length} owed`,
      hashes: `${draws === null ? "" : `draws ${draws} `}end ${hashOf([sittingState(end)])}`,
    },
    ...end.seats.map((seat, n): Line => ({
      id: `sitting ${name} seat ${n}`,
      says: `${nameOf(seat.who)}: place ${seat.place ?? "none"}, ${results(seat.run.record)}, resolve ${seat.run.resolve}, level ${seat.run.level}`,
      hashes: `end ${hashOf([runState(seat.run)])}`,
    })),
  ];
}

/** Eight regulars to the end, in one call of the clock, as nobody waits for anything. */
function regulars(seen: Seen): Line[] {
  const t = openSitting({ now: SAT_AT, seed: SEED, player: { id: "golden", name: "Golden" } });
  begin(t, [], SAT_AT);
  const end = advance(t, SAT_AT);
  seen.saw("sitting", encodeSitting(end));
  return sittingLines("regulars", end, null);
}

/**
 * Two members and six regulars, deadline by deadline: the members sit, one starts it, and each
 * plans every room as the sensible bot does. Each stage it is seen in is a row worth keeping.
 */
function members(seen: Seen): Line[] {
  const [one, two] = MEMBERS;
  if (!one || !two) throw new Error("no members");
  const draws = new Hash();
  let t = openSitting({ now: SAT_AT, seed: SEED + 1, player: one });
  const look = (): void => {
    draws.add(sittingState(t));
    const kept = t.stage.at === "plan" && t.room >= 15 ? "past-room-15" : t.stage.at;
    seen.saw("sitting", encodeSitting(t), kept);
  };
  look();
  for (const [player, c, at] of [
    [two, { do: "sit" }, 1000],
    [one, { do: "start" }, 2000],
  ] as const) {
    const answer = sittingCommand(t, c, { now: SAT_AT + at, seed: at, player });
    if (!answer.ok) throw new Error(`the golden sitting refused ${c.do}: ${answer.why}`);
    t = answer.sitting;
  }
  for (let guard = 0; guard < 2000 && t.stage.at !== "over"; guard++) {
    if (t.stage.at === "plan")
      for (const seat of seatsIn(t)) if (seat.who.is === "member") planRoom(seat.run, SENSIBLE);
    look();
    t = advance(t, deadline(t));
  }
  look();
  return sittingLines("members", t, draws.get());
}

export const sittingGoldens = (seen: Seen): Line[] => [...regulars(seen), ...members(seen)];

// ---------- the keys, pinned ----------

/** For each shape, the keys pinned at each version. */
export type Pins = Map<Shape, Map<number, readonly string[]>>;
export function readPins(text: string): Pins {
  const pins: Pins = new Map();
  let into: string[] = [];
  for (const row of text.split("\n")) {
    if (row.startsWith("  ")) into.push(row.trim());
    else if (row !== "") {
      const [shape, v] = row.split(" ");
      const of = SHAPES.find((s) => s === shape);
      if (!of) throw new Error(`golden/keys.txt names no shape the goldens know: ${row}`);
      into = [];
      const versions = pins.get(of) ?? new Map<number, readonly string[]>();
      versions.set(Number(v), into);
      pins.set(of, versions);
    }
  }
  return pins;
}
export const pinsText = (pins: Pins): string =>
  SHAPES.flatMap((shape) =>
    [...(pins.get(shape) ?? new Map<number, readonly string[]>())]
      .toSorted(([a], [b]) => a - b)
      .map(([v, keys]) => `${shape} ${v}\n${keys.map((k) => `  ${k}\n`).join("")}`),
  ).join("");

/**
 * The keys each shape is written with now: what the goldens saw written, and each of their stored
 * rows read and written again. (Not the rows in `../stored`: other changes add to those, and a
 * pin must move only with the rules.)
 */
export function keysNow(seen: Seen): Map<Shape, string[]> {
  for (const text of storedRows("table")) {
    const table = RAID.decode(text);
    if (table) seen.saw("table", RAID.encode(table));
  }
  for (const text of storedRows("sitting")) {
    const sitting = decodeSitting(text);
    if (sitting) seen.saw("sitting", encodeSitting(sitting));
  }
  return new Map(SHAPES.map((shape) => [shape, [...(seen.keys.get(shape) ?? [])].toSorted()]));
}

/**
 * The pins as they would be written now, or why they cannot be: a version pinned already keeps its
 * keys, so a shape whose keys moved under the same version is refused. A new version is pinned beside the old.
 */
export function pinned(was: Pins, now: ReadonlyMap<Shape, readonly string[]>): { pins: Pins; refused: string[] } {
  const pins: Pins = new Map([...was].map(([s, v]) => [s, new Map(v)]));
  const refused: string[] = [];
  for (const shape of SHAPES) {
    const keys = now.get(shape) ?? [];
    const v = VERSIONS[shape];
    const before = pins.get(shape)?.get(v);
    if (before && before.join() !== keys.join()) {
      const gained = keys.filter((k) => !before.includes(k));
      const lost = before.filter((k) => !keys.includes(k));
      refused.push(
        `${shape} is written with other keys at version ${v} (${[...gained.map((k) => `+${k}`), ...lost.map((k) => `-${k}`)].join(" ")}): a stored shape that changes takes a new version`,
      );
    }
    if (!before) pins.set(shape, (pins.get(shape) ?? new Map<number, readonly string[]>()).set(v, keys));
  }
  return { pins, refused };
}

// ---------- the stored rows ----------

/** The goldens' stored rows of a shape, of every version. */
export function storedRows(shape: Shape): string[] {
  if (!existsSync(STORED)) return [];
  return readdirSync(STORED)
    .filter((name) => name.startsWith(`${shape}-v`))
    .map((name) => readFileSync(new URL(name, STORED), "utf8"));
}
/** A stored row as the repository keeps it: formatted as `bun fmt` would. */
function formatted(name: string, text: string): string {
  const out = Bun.spawnSync([process.execPath, "fmt", `--stdin-filepath=${name}`], {
    stdin: new TextEncoder().encode(text),
    stdout: "pipe",
  });
  if (!out.success) throw new Error(`bun fmt could not format ${name}`);
  return out.stdout.toString();
}

// ---------- all of it ----------

export interface Goldens {
  readonly fights: Line[];
  readonly runs: Line[];
  readonly sittings: Line[];
  readonly keys: Map<Shape, string[]>;
  readonly rows: ReadonlyMap<string, string>;
}
const read = (name: string): string =>
  existsSync(new URL(name, GOLDEN)) ? readFileSync(new URL(name, GOLDEN), "utf8") : "";
export const writtenPool = (): Pool => readPool(read("pool.txt"));
export const written = (name: "fights" | "runs" | "sittings"): Line[] => readLines(read(`${name}.txt`));
export const writtenPins = (): Pins => readPins(read("keys.txt"));
export const writtenEraPool = (release: EraGolden): Pool => readPool(read(`pool-${release}.txt`));
export const writtenEra = (release: EraGolden): Line[] => readLines(read(`fights-${release}.txt`));

export function goldensNow(pool: Pool): Goldens {
  const seen = new Seen();
  const fights = fightLines(pool);
  const runs = HABITS.flatMap((habit) => runLines(habit, seen));
  const sittings = sittingGoldens(seen);
  return { fights, runs, sittings, keys: keysNow(seen), rows: seen.rows };
}

function report(name: string, was: readonly Line[], now: readonly Line[]): void {
  const diff = differences(was, now);
  console.log(`${name}: ${now.length}, ${diff.length === 0 ? "all as written" : `${diff.length} differ`}.`);
  for (const line of diff.slice(0, 40)) console.log(line);
  if (diff.length > 40) console.log(`  and ${diff.length - 40} more`);
}

if (import.meta.main) {
  const fresh = process.argv.includes("--pool");
  const write = fresh || process.argv.includes("--write");
  const pool = fresh || read("pool.txt") === "" ? poolNow() : writtenPool();
  const now = goldensNow(pool);
  report("fights", written("fights"), now.fights);
  report("runs", written("runs"), now.runs);
  report("sittings", written("sittings"), now.sittings);
  const eras = ERA_GOLDENS.map((release) => {
    const at = fresh || read(`pool-${release}.txt`) === "" ? poolAt(release) : writtenEraPool(release);
    const lines = eraFightLines(at, release);
    report(`fights at ${release}`, writtenEra(release), lines);
    return { release, at, lines };
  });
  const { pins, refused } = pinned(writtenPins(), now.keys);
  const unpinned = SHAPES.filter((s) => !writtenPins().get(s)?.has(VERSIONS[s]));
  console.log(
    `keys: ${SHAPES.map((s) => `${s} ${VERSIONS[s]}`).join(", ")}: ${refused.length > 0 ? "refused" : unpinned.length > 0 ? `${unpinned.join(", ")} not pinned yet` : "as pinned"}.`,
  );
  for (const why of refused) console.log(`  ${why}`);
  const rows = [...now.rows].filter(([name]) => !existsSync(new URL(name, STORED)));
  console.log(
    `stored: ${rows.length === 0 ? "every version has its rows" : `${rows.map(([name]) => name).join(", ")} not kept yet`}.`,
  );
  if (write && refused.length > 0) {
    console.log("Nothing written: give each shape refused a new version first.");
    process.exit(1);
  }
  if (write) {
    mkdirSync(STORED, { recursive: true });
    writeFileSync(new URL("pool.txt", GOLDEN), poolText(pool));
    writeFileSync(new URL("fights.txt", GOLDEN), linesText(now.fights));
    writeFileSync(new URL("runs.txt", GOLDEN), linesText(now.runs));
    writeFileSync(new URL("sittings.txt", GOLDEN), linesText(now.sittings));
    writeFileSync(new URL("keys.txt", GOLDEN), pinsText(pins));
    for (const { release, at, lines } of eras) {
      writeFileSync(new URL(`pool-${release}.txt`, GOLDEN), poolText(at));
      writeFileSync(new URL(`fights-${release}.txt`, GOLDEN), linesText(lines));
    }
    for (const [name, text] of rows) writeFileSync(new URL(name, STORED), formatted(name, text));
    console.log("Written. Say why in the PR's description.");
  }
}
