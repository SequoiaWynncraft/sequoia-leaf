/**
 * The Little Raid as Leaf plays it: the table's whole state (the run in hand, the almanac, the looks,
 * the trail picked, and the random stream), one command for everything a player can do at the
 * table, and what the player's page is shown of it. Leaf holds the state and applies the commands;
 * the page holds a copy to draw from, and may run the commands that draw nothing (`predict`) ahead
 * of Leaf's answer.
 *
 * Every draw comes from the state's streams (the table's for each new run's seed, the run's for
 * everything in it), and Leaf's dice for the call (`Ctx.seed`) are stirred into both before a
 * command is done, so nothing a command draws could have been worked out before it was sent. The
 * page is never shown either stream, nor any pick drawn but not yet offered.
 */
import {
  type CoinChange,
  type Ctx,
  type Done,
  draw32,
  type Game,
  LOGGED,
  type Logged,
  mix,
  type Refused,
} from "@sequoia-leaf/core";

import { DIRECT, type Habit, type Hands, planRoom } from "./bot.ts";
import {
  isBoughtLook,
  isLookKind,
  type LookId,
  type LookKind,
  LOOKS,
  type Looks,
  newLooks,
  owns,
  readLooks,
  wear,
  wornOf,
} from "./content/looks.ts";
import { TRAIL_COUNT } from "./content/rooms.ts";
import {
  type Almanac,
  newAlmanac,
  type News,
  type Payout,
  payout,
  readAlmanac,
  recordRun,
  trailOpen,
} from "./outside.ts";
import {
  abandon,
  beginFight,
  buy,
  buyXp,
  type Choice,
  choose,
  fieldCap,
  giveItem,
  hold,
  move,
  type Note,
  redraw,
  refusal,
  REFUSALS,
  type Run,
  type RunSummary,
  rustle,
  sell,
  type Spot,
  startRun,
  summariseRun,
  takeTakings,
  toBench,
  type Why,
  whyText,
} from "./run.ts";
import { checkRun } from "./save.ts";

// ---------- the state ----------

/** Everything Leaf keeps of one player's table. */
export interface Table {
  /** The table's own stream: each new run's seed is drawn from it. */
  rng: number;
  /** Runs begun at this table. The run in hand is the last of them, and pays under its number. */
  runs: number;
  /** The run in hand, or none. A run that ends is let go of at once. */
  run: Run | null;
  almanac: Almanac;
  /** The trail picked on the front page, to set out on next. */
  trail: number;
  looks: Looks;
}

/** A run as the page is shown it: without its streams, and with only the first of the picks waiting. */
export type RunView = Omit<Run, "seed" | "rng">;

/** What the player's page is given. */
export interface TableView {
  runs: number;
  run: RunView | null;
  almanac: Almanac;
  trail: number;
  looks: Looks;
}

// ---------- commands ----------

/** Everything a player can do at the table. */
export type RaidCommand =
  /** Set out on a trail. A run in hand is put down first, as walking home, once it has fought a room. */
  | { do: "start"; trail: number }
  /** Pick the trail to set out on next, on the front page. */
  | { do: "trail"; trail: number }
  /** Put a look on the table. (A command's `id` on the wire is its own, so the look is `look`.) */
  | { do: "look"; kind: LookKind; look: string }
  /** Buy a look with Leaf, and put it on the table. */
  | { do: "buyLook"; kind: LookKind; look: string }
  /** Take one of the options of the pick waiting. */
  | { do: "choose"; option: number }
  /** Ask for three other boons. */
  | { do: "redraw" }
  | { do: "buy"; offer: number }
  | { do: "sell"; from: Spot }
  /** Move a figure, changing places with whoever is there. */
  | { do: "move"; from: Spot; to: Spot }
  /** Take a figure off the board to the first free hollow of the bench. */
  | { do: "bench"; seat: number }
  | { do: "rustle" }
  /** Keep the stall as it is for the next room, or let it go. */
  | { do: "hold"; on: boolean }
  /** Buy experience. */
  | { do: "xp" }
  /** Hand the item at a place on the rack to a figure. */
  | { do: "give"; item: number; to: Spot }
  /** Send the party in: the boards are locked and the fight is decided. */
  | { do: "fight" }
  /** Take what the fight paid, and go on to the next room or to the end. */
  | { do: "take" }
  /** Walk home early, once a room has been fought. */
  | { do: "abandon" };

export type RaidCommandName = RaidCommand["do"];
/** The commands that act on the run in hand. */
export type RunCommand = Exclude<RaidCommand, { do: "start" | "trail" | "look" | "buyLook" }>;

/** The commands a page may show before Leaf answers: they draw nothing, so Leaf will do just the same. */
export const PREDICTED: readonly RaidCommandName[] = ["move", "bench", "sell", "give", "hold", "buy", "xp"];

/** What a command did, for the page to show. */
export type RaidNote =
  | Note
  | { t: "started"; trail: number; run: number }
  | { t: "trail"; trail: number }
  | { t: "look"; kind: LookKind; id: LookId }
  /** A run ended (won, lost, or walked home from): what it came to, what it paid, and what is new in the almanac. */
  | { t: "ended"; run: RunView; summary: RunSummary; paid: Payout; news: News[] };

/** Why the table turned a command down, besides the run's own reasons. */
export const TABLE_REFUSALS = {
  no_run: "There is no raid laid out.",
  trail_closed: "That trail is not open yet.",
  no_such_look: "There is no such look.",
  not_owned: "That look is not yours yet.",
  owned: "That look is yours already.",
  // Leaf's own refusals of a command that takes Leaf.
  not_enough_leaf: "Not enough Leaf.",
  leaf_closed: "Leaf cannot be spent here.",
  members_only: "For guild members.",
} as const;
export type TableWhy = keyof typeof TABLE_REFUSALS;

/** The sentence for a refusal's code, as the page shows it. With the page's copy, how many may be fielded is said. */
export function refusalText(code: string, view?: TableView): string {
  const table = Object.entries(TABLE_REFUSALS).find(([c]) => c === code);
  if (table) return table[1];
  const run = Object.keys(REFUSALS).find((c): c is Why => c === code);
  if (run) return whyText(run, view?.run ? fieldCap(localRun(view.run)) : undefined);
  return "That cannot be done just now.";
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const UINT = 0xffffffff;
const whole = (v: unknown, least: number, most: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= least && v <= most;
/** A place as a command names it. Anything past the board and bench is turned down by the rules. */
function spotOf(v: unknown): Spot | null {
  if (!isRecord(v) || (v.on !== "board" && v.on !== "bench") || !whole(v.at, 0, 63)) return null;
  return { on: v.on, at: v.at };
}

/** A command off the wire, or null. Fields it does not use (the command's id) are let be. */
export function readCommand(v: unknown): RaidCommand | null {
  if (!isRecord(v)) return null;
  switch (v.do) {
    case "start":
    case "trail":
      return whole(v.trail, 0, TRAIL_COUNT - 1) ? { do: v.do, trail: v.trail } : null;
    case "look":
    case "buyLook":
      return isLookKind(v.kind) && typeof v.look === "string" && v.look.length <= 32
        ? { do: v.do, kind: v.kind, look: v.look }
        : null;
    case "choose":
      return whole(v.option, 0, 15) ? { do: "choose", option: v.option } : null;
    case "buy":
      return whole(v.offer, 0, 15) ? { do: "buy", offer: v.offer } : null;
    case "sell": {
      const from = spotOf(v.from);
      return from ? { do: "sell", from } : null;
    }
    case "move": {
      const from = spotOf(v.from);
      const to = spotOf(v.to);
      return from && to ? { do: "move", from, to } : null;
    }
    case "bench":
      return whole(v.seat, 0, 63) ? { do: "bench", seat: v.seat } : null;
    case "hold":
      return typeof v.on === "boolean" ? { do: "hold", on: v.on } : null;
    case "give": {
      const to = spotOf(v.to);
      return to && whole(v.item, 0, 399) ? { do: "give", item: v.item, to } : null;
    }
    case "redraw":
    case "rustle":
    case "xp":
    case "fight":
    case "take":
    case "abandon":
      return { do: v.do };
    default:
      return null;
  }
}

// ---------- what the page is shown ----------

/** A pick waiting behind the first: its kind, but not what it will offer. */
function unseen(choice: Choice): Choice {
  return choice.kind === "boon"
    ? { kind: "boon", options: [], redraws: choice.redraws }
    : choice.kind === "component"
      ? { kind: "component", options: [] }
      : { kind: "starter", options: [] };
}

/** A run as the page is shown it. Each field is named, so nothing new is shown by accident. */
export function runView(run: Run): RunView {
  return {
    trail: run.trail,
    room: run.room,
    phase: run.phase,
    resolve: run.resolve,
    acorns: run.acorns,
    streak: run.streak,
    level: run.level,
    xp: run.xp,
    board: run.board,
    bench: run.bench,
    items: run.items,
    stall: run.stall,
    held: run.held,
    rustles: run.rustles,
    bought: run.bought,
    boons: run.boons,
    choices: run.choices.map((c, i) => (i === 0 ? c : unseen(c))),
    foe: run.foe,
    record: run.record,
    nextId: run.nextId,
    won: run.won,
    left: run.left,
    last: run.last,
    fight: run.fight,
    seen: run.seen,
  };
}

/** The page's copy of a run, as one the rules can act on. It has no stream: only what draws nothing may be done to it. */
export const localRun = (view: RunView): Run => ({ ...structuredClone(view), seed: 0, rng: 0 });

export function tableView(state: Table): TableView {
  return {
    runs: state.runs,
    run: state.run ? runView(state.run) : null,
    almanac: state.almanac,
    trail: state.trail,
    looks: state.looks,
  };
}

// ---------- doing things ----------

type Answer = Done<Table, RaidNote> | Refused;
const no = (code: TableWhy | Why): Refused => ({ refused: code });

/** A run action, on the run in hand. */
function act(run: Run, c: RunCommand): { ok: true; notes: Note[] } | { ok: false; code: Why } {
  switch (c.do) {
    case "choose":
      return choose(run, c.option);
    case "redraw":
      return redraw(run);
    case "buy":
      return buy(run, c.offer);
    case "sell":
      return sell(run, c.from);
    case "move":
      return move(run, c.from, c.to);
    case "bench":
      return toBench(run, c.seat);
    case "rustle":
      return rustle(run);
    case "hold":
      return hold(run, c.on);
    case "xp":
      return buyXp(run);
    case "give":
      return giveItem(run, c.item, c.to);
    case "fight":
      return beginFight(run);
    case "take":
      return takeTakings(run);
    case "abandon":
      return abandon(run);
  }
}

/**
 * A run that has ended: written into the almanac, let go of, and paid for under its number. It is
 * paid what it is worth, or what the player may still earn (`room`) when that is less, and says so.
 */
function finish(s: Table, run: Run, notes: RaidNote[], log: Logged[], room: number): CoinChange[] {
  const summary = summariseRun(run);
  const worth = payout(summary);
  const paid: Payout =
    worth.coins > room ? { coins: Math.max(0, room), lines: [...worth.lines, { why: "full", coins: 0 }] } : worth;
  const recorded = recordRun(s.almanac, summary);
  s.almanac = recorded.almanac;
  s.run = null;
  notes.push({ t: "ended", run: runView(run), summary, paid, news: recorded.news });
  log.push({
    kind: LOGGED.raidEnded,
    data: {
      trail: run.trail,
      rooms_won: summary.cleared,
      ended: run.won ? "won" : run.left ? "left" : "lost",
      coins: paid.coins,
    },
  });
  return paid.coins > 0 ? [{ amount: paid.coins, reason: "The Little Raid", key: `run:${s.runs}` }] : [];
}

function setOut(s: Table, trail: number, room: number): Answer {
  if (!trailOpen(s.almanac, trail)) return no("trail_closed");
  const notes: RaidNote[] = [];
  const log: Logged[] = [];
  let coins: CoinChange[] = [];
  // Setting out afresh puts down the raid that is laid out (one that has fought a room), as walking home does.
  if (s.run) {
    const run = s.run;
    const left = abandon(run);
    if (left.ok) notes.push(...left.notes);
    coins = finish(s, run, notes, log, room);
  }
  s.runs += 1;
  s.run = startRun(draw32(s), { trail });
  s.trail = trail;
  notes.push({ t: "started", trail, run: s.runs });
  log.push({ kind: LOGGED.raidStarted, data: { trail } });
  return { state: s, notes, coins, log };
}

function play(s: Table, c: RunCommand, ctx: Ctx): Answer {
  const run = s.run;
  if (!run) return no("no_run");
  const room = run.record.length;
  // The takings are paid from the fight as it was decided when the party set out.
  const seconds = run.fight?.outcome.seconds ?? 0;
  const done = act(run, c);
  if (!done.ok) return no(done.code);
  const notes: RaidNote[] = [...done.notes];
  const log: Logged[] = [];
  const fought = run.record[room];
  if (c.do === "take" && fought) {
    log.push({
      kind: LOGGED.raidRoom,
      data: {
        room: fought.room + 1,
        kind: fought.kind,
        won: fought.result === "win",
        resolve: run.resolve,
        seconds: Math.round(seconds * 10) / 10,
      },
    });
  }
  const coins = run.phase === "over" ? finish(s, run, notes, log, ctx.room) : [];
  // A member's party as the fight was decided from, left for others to meet on that trail, in that
  // room (its place in `ROOMS`).
  const party = c.do === "fight" && !ctx.player.guest ? run.fight?.setup.sides[0] : undefined;
  if (!party) return { state: s, notes, coins, log };
  return { state: s, notes, coins, log, keep: [{ slot: `board:${run.trail}:${run.room}`, data: party }] };
}

/**
 * Whether the run in hand has fought no room yet. Such a run is not put down: setting out afresh or
 * walking home leaves it as it is, so that a run's opening cannot be drawn again and again for free.
 */
export const unfought = (run: Pick<Run, "record">): boolean => run.record.length === 0;

export function applyCommand(state: Table, c: RaidCommand, ctx: Ctx): Answer {
  if (c.do === "start" && !trailOpen(state.almanac, c.trail)) return no("trail_closed");
  // The run in hand as it is: nothing drawn, paid or logged.
  if ((c.do === "start" || c.do === "abandon") && state.run && unfought(state.run)) return { state, notes: [] };
  const s = structuredClone(state);
  // Leaf's dice, stirred into both streams before anything is drawn.
  s.rng = mix(s.rng, ctx.seed);
  if (s.run) s.run.rng = mix(s.run.rng, ctx.seed);
  if (c.do === "start") return setOut(s, c.trail, ctx.room);
  if (c.do === "trail") {
    if (!trailOpen(s.almanac, c.trail)) return no("trail_closed");
    s.trail = c.trail;
    return { state: s, notes: [{ t: "trail", trail: c.trail }] };
  }
  if (c.do === "look") {
    if (!LOOKS[c.kind].some((l) => l.id === c.look)) return no("no_such_look");
    if (!wear(s.looks, c.kind, c.look)) return no("not_owned");
    return { state: s, notes: [{ t: "look", kind: c.kind, id: wornOf(s.looks, c.kind) }] };
  }
  if (c.do === "buyLook") {
    const spec = LOOKS[c.kind].find((l) => l.id === c.look);
    if (!spec) return no("no_such_look");
    if (owns(s.looks, c.kind, spec.id)) return no("owned");
    s.looks.owned.push(spec.id);
    wear(s.looks, c.kind, spec.id);
    return {
      state: s,
      notes: [{ t: "look", kind: c.kind, id: spec.id }],
      leaf: [{ amount: spec.leaf, reason: `Raid table look: ${spec.name}`, key: `look:${spec.id}`, for: spec.for }],
    };
  }
  return play(s, c, ctx);
}

/**
 * What a command that draws nothing does to the page's copy, worked out by the same rules Leaf
 * will use: the copy after it and what happened, or the refusal Leaf would give. Null for a command
 * that must wait for Leaf.
 */
export function predict(
  view: TableView,
  c: RaidCommand,
): { view: TableView; notes: RaidNote[] } | { refused: string } | null {
  if (
    c.do !== "move" &&
    c.do !== "bench" &&
    c.do !== "sell" &&
    c.do !== "give" &&
    c.do !== "hold" &&
    c.do !== "buy" &&
    c.do !== "xp"
  )
    return null;
  if (!view.run) return { refused: "no_run" };
  const run = localRun(view.run);
  const done = act(run, c);
  if (!done.ok) return { refused: done.code };
  return { view: { ...view, run: runView(run) }, notes: done.notes };
}

/**
 * The commands the bot would send to plan the room that is up, worked out on the page's copy. A pick
 * waiting is one command alone, since what comes after it is Leaf's to say; and the bot never
 * rustles here, since the new stall is Leaf's to draw. Send them, and ask again once Leaf has
 * answered: an empty list means the room is planned.
 */
export function planCommands(view: TableView, habit: Habit): RaidCommand[] {
  if (!view.run || view.run.phase !== "plan") return [];
  const run = localRun(view.run);
  const out: RaidCommand[] = [];
  const wrote = <T extends { ok: boolean }>(done: T, c: RaidCommand): T => {
    if (done.ok) out.push(c);
    return done;
  };
  const hands: Hands = {
    // Written down but not done here: the bot stops at it, and plans the rest once Leaf has answered.
    choose: (_, option) => {
      out.push({ do: "choose", option });
      return refusal("nothing_to_choose");
    },
    buy: (r, offer) => wrote(DIRECT.buy(r, offer), { do: "buy", offer }),
    sell: (r, from) => wrote(DIRECT.sell(r, from), { do: "sell", from }),
    move: (r, from, to) => wrote(DIRECT.move(r, from, to), { do: "move", from, to }),
    toBench: (r, seat) => wrote(DIRECT.toBench(r, seat), { do: "bench", seat }),
    rustle: () => refusal("not_enough_acorns"),
    buyXp: (r) => wrote(DIRECT.buyXp(r), { do: "xp" }),
    giveItem: (r, item, to) => wrote(DIRECT.giveItem(r, item, to), { do: "give", item, to }),
  };
  planRoom(run, habit, hands);
  return out;
}

// ---------- keeping it ----------

const GAME = "little-raid-table";
export const TABLE_VERSION = 1;

export const encodeTable = (state: Table): string =>
  JSON.stringify({
    game: GAME,
    v: TABLE_VERSION,
    rng: state.rng,
    runs: state.runs,
    run: state.run,
    almanac: state.almanac,
    trail: state.trail,
    looks: state.looks,
  });

/**
 * A table from the text Leaf stored, or null for anything not of this version's shape. Under
 * today's content and numbers it refuses nothing more: a trail picked that is not open is the
 * first, and a run that does not read (or could not have been kept: one over, one with no number)
 * is let go of, so the almanac and the looks bought are never out of reach.
 */
export function decodeTable(text: string): Table | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.game !== GAME || raw.v !== TABLE_VERSION) return null;
  const { rng, runs, trail } = raw;
  if (!whole(rng, 0, UINT) || !whole(runs, 0, 1_000_000_000) || !whole(trail, 0, 999)) return null;
  const almanac = readAlmanac(raw.almanac);
  const looks = readLooks(raw.looks);
  if (!almanac || !looks) return null;
  const read = raw.run === null ? null : checkRun(raw.run);
  const run = read?.ok && read.run.phase !== "over" && runs > 0 ? read.run : null;
  return { rng, runs, run, almanac, trail: trailOpen(almanac, trail) ? trail : 0, looks };
}

/**
 * Nothing at the table happens by itself, however long the player is away, but this: a look won as
 * a pull's prize (`pull:look:<id>` among `ctx.awards`) is owned, as one bought is.
 */
function wonLooks(state: Table, ctx: Pick<Ctx, "awards">): Table {
  const won = ctx.awards
    .map((award) => award.replace(/^pull:look:/, ""))
    .filter((id): id is LookId => isBoughtLook(id) && !state.looks.owned.includes(id));
  return won.length === 0 ? state : { ...state, looks: { ...state.looks, owned: [...state.looks.owned, ...won] } };
}

/** A new player's table: nothing laid out, an empty almanac, the plain looks. */
export const newTable = (ctx: Pick<Ctx, "seed">): Table => ({
  rng: mix(ctx.seed >>> 0, 0x7ab1e),
  runs: 0,
  run: null,
  almanac: newAlmanac(),
  trail: 0,
  looks: newLooks(),
});

/** The Little Raid, for Leaf's play service. */
export const RAID: Game<Table, RaidCommand, TableView, RaidNote> = {
  id: "raid",
  create: newTable,
  advance: wonLooks,
  apply: applyCommand,
  view: (state) => tableView(state),
  decode: decodeTable,
  encode: encodeTable,
  command: readCommand,
  // The bosses beaten on every trail, the runs finished or abandoned, and the furthest room met on any trail.
  standing: ({ almanac }) => ({
    score: almanac.bosses.reduce((sum, beaten) => sum + beaten.length, 0),
    also: { runs: almanac.runs, room: Math.max(0, ...almanac.best) },
  }),
  // A carved figure of each boss the almanac has beaten, for the member's camp.
  awards: (state) => [...new Set(state.almanac.bosses.flat())].map((boss) => `trophy-${boss}`),
};
