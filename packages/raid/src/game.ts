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
  type Kept,
  LOGGED,
  type Logged,
  type Meeting,
  mix,
  type Refused,
} from "@sequoia-leaf/core";

import { type Habit, type Hands, planWith } from "./bot.ts";
import {
  act,
  type Aimed,
  aimedAt,
  isPredicted,
  isRunCommand,
  plan,
  type RaidCommand,
  readAimed,
  type Slot,
  type TableCommand,
} from "./command.ts";
import { type EndlessWay, isEndlessWay } from "./content/endless.ts";
import {
  isBoughtLook,
  isLookKind,
  type LookId,
  type LookKind,
  LOOKS,
  type Looks,
  newLooks,
  owns,
  wear,
  wornOf,
} from "./content/looks.ts";
import { type Era, eraAt } from "./content/releases.ts";
import { TRAIL_COUNT } from "./content/rooms.ts";
import { type Apart, type Depths, noApart, paidFor, reached, readWeek, type Week, weekAt } from "./depths.ts";
import { isHeld } from "./endless.ts";
import { fightRecord } from "./fought.ts";
import { decodeTable, encodeTable } from "./keep.ts";
import {
  type Almanac,
  beatenBosses,
  newAlmanac,
  type News,
  type Payout,
  payout,
  recordRun,
  trailOpen,
} from "./outside.ts";
import { type Roster, rosterOf } from "./own.ts";
import { isRecord, isWhole } from "./party.ts";
import { postcard } from "./postcard.ts";
import { metLately, roomsFought } from "./record.ts";
import {
  abandon,
  type Choice,
  fieldCap,
  type Fought,
  foughtOf,
  type Note,
  refusal,
  REFUSALS,
  type Run,
  type RunSummary,
  type RunView,
  type Stage,
  startRun,
  summariseRun,
  takenTo,
  type Why,
  whyText,
} from "./run.ts";
import {
  counts,
  type Course,
  courseOf,
  lanes,
  offered,
  payKey,
  slotOf,
  trailOf,
  type Way,
  wayLogged,
  wayOn,
} from "./way.ts";

export type { RunView } from "./run.ts";

// ---------- the state ----------

/** Everything Leaf keeps of one player's table. */
export interface Table {
  /** The table's own stream: each new run's seed is drawn from it. */
  rng: number;
  /** The era on Leaf's clock as the table was last brought to a moment: what a run set out now draws from. */
  era: Era;
  /** Runs begun at this table in each slot. The run held in a slot is the last begun there, and pays under its number (`payKey`). */
  begun: Record<Slot, number>;
  /**
   * The run held in each slot (`slotOf` its way, read as it sets out): the run in hand, and the
   * endless run beside it. Each is picked up and put down on its own; a run that ends is let go of at once.
   */
  held: Record<Slot, Run | null>;
  almanac: Almanac;
  /** The trail picked on the front page, to set out on next. */
  trail: number;
  looks: Looks;
  /** This week's deepest rooms won in each endless way with everyone's figures (`depths.ts`). */
  week: Week;
  /** The deepest rooms won with the member's own figures, ever and this week, kept apart from the almanac's and the week's. */
  apart: Apart;
}

/** What the player's page is given. */
export interface TableView {
  /** The era Leaf's clock is in: what the page reads the catalogue by (`catalogOf`). */
  era: Era;
  begun: Record<Slot, number>;
  held: Record<Slot, RunView | null>;
  week: Week;
  apart: Apart;
  almanac: Almanac;
  trail: number;
  looks: Looks;
  /** The figures the member has pulled, with their levels: what a run with their own figures would start with now. */
  roster: Roster;
}

// ---------- commands ----------

/** What a command did, for the page to show. */
export type RaidNote =
  | Note
  /** A run set out: on a trail, or (`endless`) an endless run, with its number at the table. */
  | { t: "started"; trail: number; run: number; endless?: EndlessWay }
  | { t: "trail"; trail: number }
  | { t: "look"; kind: LookKind; id: LookId }
  /** A run ended (won, lost, or walked home from): what it came to, what it paid, and what is new in the almanac. */
  | { t: "ended"; run: RunView; summary: RunSummary; paid: Payout; news: News[] };

/** Why the table turned a command down, besides the run's own reasons. */
export const TABLE_REFUSALS = {
  no_run: "There is no raid laid out.",
  unfought: "The first room has not been fought yet.",
  trail_closed: "That trail is not open yet.",
  nothing_pulled: "You have pulled no figures yet.",
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
  if (run) return whyText(run, view?.held.main ? fieldCap(view.held.main) : undefined);
  return "That cannot be done just now.";
}

// ---------- what the page is shown ----------

/** A pick waiting behind the first: its kind, but not what it will offer. */
function unseen(choice: Choice): Choice {
  return choice.kind === "boon" ? { kind: "boon", options: [], redraws: choice.redraws } : { ...choice, options: [] };
}

/** Where a run stands as the page is shown it: only the first of the picks waiting says what it offers. */
const stageView = (stage: Stage): Stage =>
  stage.phase === "plan" ? { phase: "plan", picks: stage.picks.map((c, i) => (i === 0 ? c : unseen(c))) } : stage;

/** A run as the page is shown it. Each field is named, so nothing new is shown by accident. */
export function runView(run: RunView): RunView {
  return {
    era: run.era,
    way: run.way,
    room: run.room,
    stage: stageView(run.stage),
    resolve: run.resolve,
    acorns: run.acorns,
    streak: run.streak,
    level: run.level,
    xp: run.xp,
    board: run.board,
    bench: run.bench,
    rack: run.rack,
    stall: run.stall,
    held: run.held,
    rustles: run.rustles,
    bought: run.bought,
    boons: run.boons,
    foe: run.foe,
    record: run.record,
    before: run.before,
    nextId: run.nextId,
    last: run.last,
    wing: run.wing,
    seen: run.seen,
  };
}

/** What the page is shown of the table: the week as it stands now (`weekAt`), a new one with nothing won in it yet. */
export function tableView(state: Table, ctx: Pick<Ctx, "awards" | "now">): TableView {
  const { main, endless } = state.held;
  return {
    era: state.era,
    begun: { ...state.begun },
    held: { main: main && runView(main), endless: endless && runView(endless) },
    week: weekAt(state.week, ctx.now),
    apart: { deepest: state.apart.deepest, week: weekAt(state.apart.week, ctx.now) },
    almanac: state.almanac,
    trail: state.trail,
    looks: state.looks,
    roster: rosterOf(ctx.awards),
  };
}

// ---------- doing things ----------

type Answer = Done<Table, RaidNote> | Refused;
const no = (code: TableWhy | Why): Refused => ({ refused: code });

/**
 * A run that has ended: written into what its way counts for (`counts`: the almanac, and so the
 * trophies, the standing and the trails open, for a trail with everyone's figures alone), let go of,
 * and paid for under its number in its slot (`payKey`). It is paid what it is worth (`paidFor`), or
 * what the player may still earn (`room`) when that is less, and says so. (An endless run's deepest
 * rooms are written down as they are won, by `reached`.)
 */
function finish(s: Table, run: Run, notes: RaidNote[], log: Logged[], room: number): CoinChange[] {
  const summary = summariseRun(run);
  const worth = payout(paidFor(run, summary));
  const paid: Payout =
    worth.coins > room ? { coins: Math.max(0, room), lines: [...worth.lines, { why: "full", coins: 0 }] } : worth;
  const recorded = counts(run.way).almanac ? recordRun(s.almanac, summary) : { almanac: s.almanac, news: [] };
  s.almanac = recorded.almanac;
  const slot = slotOf(run.way);
  s.held[slot] = null;
  notes.push({ t: "ended", run: runView(run), summary, paid, news: recorded.news });
  log.push({
    kind: LOGGED.raidEnded,
    data: {
      trail: trailOf(run.way),
      rooms_won: summary.cleared,
      ended: summary.ending ?? "lost",
      coins: paid.coins,
      ...logged(run.way),
    },
  });
  const key = payKey({ at: "table", slot }, s.begun[slot]);
  return paid.coins > 0 ? [{ amount: paid.coins, reason: "The Little Raid", key }] : [];
}

/**
 * What a log line says of a run's way: as the lines always said it (`own: true` with the member's
 * own figures, `endless: <course>` off a trail), the way (`wayLogged`), and whether the Tally counts
 * the run (`tallied`, `counts`).
 */
const logged = (way: Way): Record<string, unknown> => ({
  ...(way.figures.pool === "own" && { own: true }),
  ...(way.course.id !== "trail" && { endless: way.course.id }),
  ...wayLogged(way),
  tallied: counts(way).tally,
});

/** Setting out afresh puts down the run of that slot laid out (one that has fought a room), as walking home does. */
function putDown(s: Table, run: Run | null, notes: RaidNote[], log: Logged[], room: number): CoinChange[] {
  if (!run) return [];
  const left = abandon(run);
  if (left.ok) notes.push(...left.notes);
  return finish(s, run, notes, log, room);
}

type SetOut = Extract<TableCommand, { do: "start" }>;
/** The course a command to set out names. */
const courseOfStart = (c: SetOut): Course => ("course" in c ? { id: c.course } : { id: "trail", trail: c.trail });
/** The slot a command sets out in. */
const setOutIn = (c: SetOut): Slot => slotOf(wayOn(courseOfStart(c)));

/**
 * Setting out on a way, in its slot: the run held there is put down first, the slot's count goes up
 * and the new run is drawn from the table's stream. On a trail, it is the trail picked. A way with
 * the member's own figures takes their roster as it is now; a way with everyone's is never told
 * what the member has pulled.
 */
function setOut(s: Table, c: SetOut, ctx: Ctx): Answer {
  const way = wayOn(courseOfStart(c), c.own === true ? rosterOf(ctx.awards) : null);
  if (way.figures.pool === "own" && Object.keys(way.figures.roster).length === 0) return no("nothing_pulled");
  const slot = slotOf(way);
  const notes: RaidNote[] = [];
  const log: Logged[] = [];
  const coins = putDown(s, s.held[slot], notes, log, ctx.room);
  s.begun[slot] += 1;
  s.held[slot] = startRun(draw32(s), { era: s.era, way });
  if (way.course.id === "trail") s.trail = way.course.trail;
  const endless = way.course.id === "trail" ? {} : { endless: way.course.id };
  notes.push({ t: "started", trail: trailOf(way), run: s.begun[slot], ...endless });
  log.push({ kind: LOGGED.raidStarted, data: { trail: trailOf(way), ...logged(way) } });
  return { state: s, notes, coins, log };
}

/**
 * The deepest rooms a way's pool has won (`reached` writes into them): everyone's figures' in the
 * almanac and the week, the member's own kept apart; each week as it stands now (`weekAt`).
 */
function deepestOf(s: Table, way: Way, now: number): { ever: Depths; week: Week } {
  if (way.figures.pool === "own") {
    s.apart.week = weekAt(s.apart.week, now);
    return { ever: s.apart.deepest, week: s.apart.week };
  }
  s.week = weekAt(s.week, now);
  return { ever: s.almanac.deepest, week: s.week };
}

/**
 * What a fight decided leaves with Leaf (`Done.keep`): on a way that keeps its deepest rooms what
 * `reached` says; else a member's board (not a guest's) at a sparring room, exactly as the fight was
 * decided from, in its way's lane (`lanes`), for other members to meet there. Trouble and bosses are
 * the forest's.
 */
function kept(s: Table, run: Run, decided: Fought, ctx: Ctx): Kept[] {
  if (counts(run.way).deepest) return reached(deepestOf(s, run.way, ctx.now), run, decided, ctx.player.guest);
  const slot = lanes(run.way).board(run.room);
  if (ctx.player.guest || slot === null || courseOf(run.way).rooms(run.room)?.kind !== "spar") return [];
  return [{ slot, data: decided.setup.sides[0] }];
}

function play(s: Table, c: Aimed, ctx: Ctx): Answer {
  const slot = aimedAt(c);
  const run = s.held[slot];
  if (!run) return no("no_run");
  // The run moves now: it draws from the era it is moved in.
  run.era = s.era;
  const rooms = roomsFought(run);
  // The takings are paid from the fight as it was decided when the party set out, against whoever was across.
  const before = foughtOf(run);
  const seconds = before?.outcome.seconds ?? 0;
  const across = before?.setup.sides[1].by;
  const done = act(run, c, { met: ctx.met });
  if (!done.ok) return no(done.code);
  const notes: RaidNote[] = [...done.notes];
  // Every fight decided, kept whole for the staff's analysis.
  const decided = c.do === "fight" ? foughtOf(run) : null;
  const log: Logged[] = decided ? [{ kind: LOGGED.raidFight, data: fightRecord(s.begun[slot], run, decided) }] : [];
  // The room the takings wrote down, the newest in the record.
  const fought = roomsFought(run) > rooms ? run.record.at(-1) : undefined;
  if (c.do === "take" && fought) {
    log.push({
      kind: LOGGED.raidRoom,
      data: {
        room: fought.room + 1,
        kind: fought.kind,
        won: fought.result === "win",
        resolve: run.resolve,
        seconds: Math.round(seconds * 10) / 10,
        // A sparring room fought against another member's board: whose.
        ...(across === undefined ? {} : { met: across }),
        ...logged(run.way),
      },
    });
  }
  const keep = decided ? kept(s, run, decided, ctx) : [];
  const coins = run.stage.phase === "over" ? finish(s, run, notes, log, ctx.room) : [];
  return { state: s, notes, coins, log, keep };
}

/**
 * Where a command meets another member's board (`Game.meets`): a `take` that moves the run on to a
 * sparring room (`takenTo`: a run whose takings end it moves nowhere). In a room held (`isHeld`) it
 * meets whoever holds it, the member too; else at the room's board lane (`lanes`), a member whose
 * board it has not met lately (`metLately`); and nobody's on a way with neither.
 */
export function meets(state: Table, c: RaidCommand): Meeting | null {
  const run = c.do === "take" ? state.held[aimedAt(c)] : null;
  const to = run && takenTo(run);
  if (!run || to === null || courseOf(run.way).rooms(to)?.kind !== "spar") return null;
  const lane = lanes(run.way);
  const held = isHeld(run, to) ? lane.held(to) : null;
  if (held !== null) return { slot: held, avoid: [], held: true };
  const board = lane.board(to);
  return board === null ? null : { slot: board, avoid: metLately(run, run.foe) };
}

/**
 * Whether a run has fought no room yet. Such a run is not put down: setting out afresh or walking
 * home is refused, so that a run's opening cannot be drawn again and again for free.
 */
export const unfought = (run: Pick<Run, "record" | "before">): boolean => roomsFought(run) === 0;
/** Whether a command would put down a run that has fought no room yet (`unfought`): setting out afresh in its slot, or walking home. */
function putsDownUnfought(s: Table, c: RaidCommand): boolean {
  const slot = c.do === "start" ? setOutIn(c) : c.do === "abandon" ? aimedAt(c) : null;
  const run = slot && s.held[slot];
  return run !== null && unfought(run);
}

export function applyCommand(state: Table, c: RaidCommand, ctx: Ctx): Answer {
  if (c.do === "start" && !("course" in c) && !trailOpen(state.almanac, c.trail)) return no("trail_closed");
  if (putsDownUnfought(state, c)) return no("unfought");
  const s = structuredClone(state);
  // Leaf's clock says the era the command is done in; Leaf's dice are stirred into every stream before anything is drawn.
  s.era = eraAt(ctx.now);
  s.rng = mix(s.rng, ctx.seed);
  for (const run of [s.held.main, s.held.endless]) if (run) run.rng = mix(run.rng, ctx.seed);
  return isRunCommand(c) ? play(s, c, ctx) : doTable(s, c, ctx);
}

// ---------- the table's own commands ----------

/** One of the table's own commands, said once: how it is read off the wire, and what it does to the table. */
interface TableSpec<C extends TableCommand> {
  readonly read: (v: Record<string, unknown>) => C | null;
  readonly run: (s: Table, c: C, ctx: Ctx) => Answer;
}
type TableDo = TableCommand["do"];
type TableCommandOf<D extends TableDo> = Extract<TableCommand, { do: D }>;

const trailIndex = (v: unknown): number | null => (isWhole(v, 0, TRAIL_COUNT - 1) ? v : null);
const lookOf = (v: Record<string, unknown>): { kind: LookKind; look: string } | null =>
  isLookKind(v.kind) && typeof v.look === "string" && v.look.length <= 32 ? { kind: v.kind, look: v.look } : null;

/**
 * Setting out off the wire: on a trail (`course: "trail"`, or none) or an endless way (`course:
 * "wilds"` or `"deep"`), with the member's own figures when `own` is true; but only on a way its
 * course offers (`offered`: a course's row says whose figures it may be set out with).
 */
function readStart(v: Record<string, unknown>): SetOut | null {
  const course = v.course ?? "trail";
  const trail = trailIndex(v.trail);
  const c: SetOut | null = isEndlessWay(course)
    ? { do: "start", course }
    : course === "trail" && trail !== null
      ? { do: "start", trail }
      : null;
  if (c === null) return null;
  const own = v.own === true;
  return offered(wayOn(courseOfStart(c), own ? {} : null)) ? (own ? { ...c, own } : c) : null;
}

/** The command that sets out on a way, as the wire says it (`readStart` reads it back): the roster is Leaf's to read. */
export function startOf({ course, figures }: Way): SetOut {
  const own = figures.pool === "own" ? { own: true } : {};
  return course.id === "trail"
    ? { do: "start", trail: course.trail, ...own }
    : { do: "start", course: course.id, ...own };
}

const TABLE: { readonly [D in TableDo]: TableSpec<TableCommandOf<D>> } = {
  start: { read: readStart, run: setOut },
  trail: {
    read: (v) => {
      const trail = trailIndex(v.trail);
      return trail === null ? null : { do: "trail", trail };
    },
    run: (s, c) => {
      if (!trailOpen(s.almanac, c.trail)) return no("trail_closed");
      s.trail = c.trail;
      return { state: s, notes: [{ t: "trail", trail: c.trail }] };
    },
  },
  look: {
    read: (v) => {
      const look = lookOf(v);
      return look && { do: "look", ...look };
    },
    run: (s, c) => dress(s, c),
  },
  buyLook: {
    read: (v) => {
      const look = lookOf(v);
      return look && { do: "buyLook", ...look };
    },
    run: (s, c) => dress(s, c),
  },
};
const tableSpec = <D extends TableDo>(name: D): TableSpec<TableCommandOf<D>> => TABLE[name];
const isTableDo = (name: unknown): name is TableDo => typeof name === "string" && Object.hasOwn(TABLE, name);
const doTable = (s: Table, c: TableCommand, ctx: Ctx): Answer => tableSpec(c.do).run(s, c, ctx);

/**
 * A command off the wire, or null. A command for a run is for the slot it says (`slot`, or the old
 * `endless: true`), and none is the main run. Setting out on an endless run is still read as it was
 * once sent, `{ do: "endless", way }`. Fields a command does not use (its id) are let be.
 */
export function readCommand(v: unknown): RaidCommand | null {
  if (!isRecord(v)) return null;
  if (v.do === "endless") return readStart({ course: v.way });
  return isTableDo(v.do) ? tableSpec(v.do).read(v) : readAimed(v);
}

/** Puts an owned look on the table, or buys one with Leaf and puts it on. */
function dress(s: Table, c: TableCommandOf<"look" | "buyLook">): Answer {
  const spec = LOOKS[c.kind].find((l) => l.id === c.look);
  if (!spec) return no("no_such_look");
  if (c.do === "look") {
    if (!wear(s.looks, c.kind, c.look)) return no("not_owned");
    return { state: s, notes: [{ t: "look", kind: c.kind, id: wornOf(s.looks, c.kind) }] };
  }
  if (owns(s.looks, c.kind, spec.id)) return no("owned");
  s.looks.owned.push(spec.id);
  wear(s.looks, c.kind, spec.id);
  return {
    state: s,
    notes: [{ t: "look", kind: c.kind, id: spec.id }],
    leaf: [{ amount: spec.leaf, reason: `Raid table look: ${spec.name}`, key: `look:${spec.id}`, for: spec.for }],
  };
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
  if (!isPredicted(c)) return null;
  const slot = aimedAt(c);
  const held = view.held[slot];
  if (!held) return { refused: "no_run" };
  const run = structuredClone(held);
  // The run moves in the era Leaf's view is of, as it does at Leaf (`play`).
  run.era = view.era;
  const done = plan(run, c);
  if (!done) return null;
  if (!done.ok) return { refused: done.code };
  return { view: { ...view, held: { ...view.held, [slot]: run } }, notes: done.notes };
}

/**
 * The commands the bot would send to plan the room that is up, worked out on the page's copy: of
 * the run held in a slot (the run in hand, by default). A pick waiting is one command alone, since
 * what comes after it is Leaf's to say; and the bot never rustles here, since the new stall is
 * Leaf's to draw. Send them, and ask again once Leaf has answered: an empty list means the room is
 * planned.
 */
export function planCommands(view: TableView, habit: Habit, slot: Slot = "main"): RaidCommand[] {
  const held = view.held[slot];
  if (held?.stage.phase !== "plan") return [];
  const run = structuredClone(held);
  const out: Aimed[] = [];
  const hands: Hands<RunView> = (r, c) => {
    const done = plan(r, c);
    if (done?.ok || (!done && (c.do === "choose" || c.do === "whetstone")))
      out.push(slot === "main" ? c : { ...c, slot });
    // What draws is Leaf's to do: a pick or a Whetstone (the bot's last) is written down and the bot plans the rest once Leaf has answered; a rustle, never.
    return done ?? refusal(c.do === "choose" ? "nothing_to_choose" : "not_enough_acorns");
  };
  // The page's own stream for the bot's habits: the run's is Leaf's.
  planWith(run, habit, hands, { rng: mix(view.begun[slot], 9000 + roomsFought(run)) });
  return out;
}

// ---------- keeping it ----------

export { decodeTable, encodeTable, TABLE_VERSION } from "./keep.ts";

/**
 * Nothing at the table happens by itself, however long the player is away, but this: the era moves
 * with Leaf's clock, and a look won as a pull's prize (`pull:look:<id>` among `ctx.awards`) is
 * owned, as one bought is. A run moves into the era only when it next moves (`play`).
 */
function advance(state: Table, ctx: Pick<Ctx, "awards" | "now">): Table {
  const won = ctx.awards
    .map((award) => award.replace(/^pull:look:/, ""))
    .filter((id): id is LookId => isBoughtLook(id) && !state.looks.owned.includes(id));
  const era = eraAt(ctx.now);
  if (won.length === 0 && era === state.era) return state;
  return { ...state, era, looks: { ...state.looks, owned: [...state.looks.owned, ...won] } };
}

/** A new player's table: nothing laid out, an empty almanac, the plain looks. */
export const newTable = (ctx: Pick<Ctx, "seed" | "now">): Table => ({
  rng: mix(ctx.seed >>> 0, 0x7ab1e),
  era: eraAt(ctx.now),
  begun: { main: 0, endless: 0 },
  held: { main: null, endless: null },
  almanac: newAlmanac(),
  trail: 0,
  looks: newLooks(),
  week: readWeek(undefined),
  apart: noApart(),
});

/** A carved figure of each boss beaten, on any trail, once. */
const trophies = (almanac: Almanac): string[] => [...beatenBosses(almanac)].map((boss) => `trophy-${boss}`);

/** The Little Raid, for Leaf's play service. */
export const RAID: Game<Table, RaidCommand, TableView, RaidNote> = {
  id: "raid",
  create: newTable,
  advance,
  apply: applyCommand,
  // A sparring room may be against the board another member fought it with.
  meets,
  view: tableView,
  decode: decodeTable,
  encode: encodeTable,
  command: readCommand,
  // The different bosses beaten, every trail together, reached as the last of their trophies was first
  // won; the runs finished or abandoned, and the furthest room met on any trail.
  standing: ({ almanac }) => {
    const carved = trophies(almanac);
    return { score: carved.length, also: { runs: almanac.runs, room: Math.max(0, ...almanac.best) }, counts: carved };
  },
  // A carved figure of each boss beaten, for the member's camp.
  awards: (state) => trophies(state.almanac),
  // A raid under way, or the board set out, for the town's door.
  postcard,
};
