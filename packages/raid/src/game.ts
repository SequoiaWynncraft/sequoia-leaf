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
  readLooks,
  wear,
  wornOf,
} from "./content/looks.ts";
import { type Era, eraAt, isEra, LEGACY_ERA } from "./content/releases.ts";
import { ROOMS, TRAIL_COUNT } from "./content/rooms.ts";
import { paidFor, reached, readWeek, type Week, weekAt } from "./depths.ts";
import { heldSlot, isHeld, roomAt } from "./endless.ts";
import { boardSlot, metLately } from "./foe.ts";
import { fightRecord } from "./fought.ts";
import {
  type Almanac,
  beatenBosses,
  newAlmanac,
  type News,
  type Payout,
  payout,
  readAlmanac,
  recordRun,
  trailOpen,
} from "./outside.ts";
import { type Roster, rosterOf } from "./own.ts";
import { isRecord, isWhole } from "./party.ts";
import { postcard } from "./postcard.ts";
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
import { checkRun } from "./save.ts";

export type { RunView } from "./run.ts";

// ---------- the state ----------

/** Everything Leaf keeps of one player's table. */
export interface Table {
  /** The table's own stream: each new run's seed is drawn from it. */
  rng: number;
  /** The era on Leaf's clock as the table was last brought to a moment: what a run set out now draws from. */
  era: Era;
  /** Runs begun at this table. The run in hand is the last of them, and pays under its number. */
  runs: number;
  /** The run in hand, or none. A run that ends is let go of at once. */
  run: Run | null;
  /** The endless run, beside the run in hand: each is picked up and put down on its own. */
  endless: Run | null;
  /** Endless runs begun at this table. The endless run is the last of them, and pays under its number. */
  ventures: number;
  almanac: Almanac;
  /** The trail picked on the front page, to set out on next. */
  trail: number;
  looks: Looks;
  /** This week's deepest rooms won in each endless way (`depths.ts`). */
  week: Week;
}

/** What the player's page is given. */
export interface TableView {
  /** The era Leaf's clock is in: what the page reads the catalogue by (`catalogOf`). */
  era: Era;
  runs: number;
  run: RunView | null;
  endless: RunView | null;
  ventures: number;
  week: Week;
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
  if (run) return whyText(run, view?.run ? fieldCap(view.run) : undefined);
  return "That cannot be done just now.";
}

const UINT = 0xffffffff;

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
    trail: run.trail,
    room: run.room,
    stage: stageView(run.stage),
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
    foe: run.foe,
    record: run.record,
    nextId: run.nextId,
    last: run.last,
    own: run.own,
    endless: run.endless,
    wing: run.wing,
    seen: run.seen,
  };
}

/** What the page is shown of the table: the week as it stands now (`weekAt`), a new one with nothing won in it yet. */
export function tableView(state: Table, ctx: Pick<Ctx, "awards" | "now">): TableView {
  return {
    era: state.era,
    runs: state.runs,
    run: state.run ? runView(state.run) : null,
    endless: state.endless ? runView(state.endless) : null,
    ventures: state.ventures,
    week: weekAt(state.week, ctx.now),
    almanac: state.almanac,
    trail: state.trail,
    looks: state.looks,
    roster: rosterOf(ctx.awards),
  };
}

// ---------- doing things ----------

type Answer = Done<Table, RaidNote> | Refused;
const no = (code: TableWhy | Why): Refused => ({ refused: code });

/** The run a table keeps in a slot, or the page's copy of it. */
const heldIn = <R>(s: { run: R | null; endless: R | null }, slot: Slot): R | null =>
  slot === "endless" ? s.endless : s.run;

/**
 * A run that has ended: written into the almanac, let go of, and paid for under its number (an
 * endless run under its own: `endless:<n>`). It is paid what it is worth (`paidFor`), or what the
 * player may still earn (`room`) when that is less, and says so. A run with the member's own figures
 * or an endless run is paid the same and written nowhere: the almanac, and so the trophies, the
 * standing and the trails open, are the main way's alone. (An endless run's deepest rooms are
 * written down as they are won, by `reached`.)
 */
function finish(s: Table, run: Run, notes: RaidNote[], log: Logged[], room: number): CoinChange[] {
  const summary = summariseRun(run);
  const worth = payout(paidFor(run, summary));
  const paid: Payout =
    worth.coins > room ? { coins: Math.max(0, room), lines: [...worth.lines, { why: "full", coins: 0 }] } : worth;
  const recorded = run.own || run.endless ? { almanac: s.almanac, news: [] } : recordRun(s.almanac, summary);
  s.almanac = recorded.almanac;
  s[run.endless ? "endless" : "run"] = null;
  notes.push({ t: "ended", run: runView(run), summary, paid, news: recorded.news });
  log.push({
    kind: LOGGED.raidEnded,
    data: {
      trail: run.trail,
      rooms_won: summary.cleared,
      ended: summary.ending ?? "lost",
      coins: paid.coins,
      ...wayLogged(run),
    },
  });
  const key = run.endless ? `endless:${s.ventures}` : `run:${s.runs}`;
  return paid.coins > 0 ? [{ amount: paid.coins, reason: "The Little Raid", key }] : [];
}

/** What a log line of a run with the member's own figures, or of an endless run, says besides. */
const wayLogged = (run: Pick<Run, "own" | "endless">): { own?: true; endless?: EndlessWay } =>
  run.own ? { own: true } : run.endless ? { endless: run.endless } : {};

/** Setting out afresh puts down the run of that kind laid out (one that has fought a room), as walking home does. */
function putDown(s: Table, run: Run | null, notes: RaidNote[], log: Logged[], room: number): CoinChange[] {
  if (!run) return [];
  const left = abandon(run);
  if (left.ok) notes.push(...left.notes);
  return finish(s, run, notes, log, room);
}

type SetOut = Extract<TableCommand, { do: "start" }>;

function setOut(s: Table, { trail, own: asked }: Exclude<SetOut, { course: EndlessWay }>, ctx: Ctx): Answer {
  // The main way is never told what the member has pulled.
  const own: Roster | null = asked ? rosterOf(ctx.awards) : null;
  if (own && Object.keys(own).length === 0) return no("nothing_pulled");
  const notes: RaidNote[] = [];
  const log: Logged[] = [];
  const coins = putDown(s, s.run, notes, log, ctx.room);
  s.runs += 1;
  s.run = startRun(draw32(s), own ? { era: s.era, trail, own } : { era: s.era, trail });
  s.trail = trail;
  notes.push({ t: "started", trail, run: s.runs });
  log.push({ kind: LOGGED.raidStarted, data: { trail, ...wayLogged(s.run) } });
  return { state: s, notes, coins, log };
}

/** Setting out on an endless run, beside the run in hand: on the first trail, the fair game's figures. */
function setOutEndless(s: Table, { course: way }: Extract<SetOut, { course: EndlessWay }>, ctx: Ctx): Answer {
  const notes: RaidNote[] = [];
  const log: Logged[] = [];
  const coins = putDown(s, s.endless, notes, log, ctx.room);
  s.ventures += 1;
  s.endless = startRun(draw32(s), { era: s.era, endless: way });
  notes.push({ t: "started", trail: 0, run: s.ventures, endless: way });
  log.push({ kind: LOGGED.raidStarted, data: { trail: 0, endless: way } });
  return { state: s, notes, coins, log };
}

/**
 * What a fight decided leaves with Leaf (`Done.keep`): in an endless run what `reached` says; else a
 * member's board (not a guest's) at a sparring room, exactly as the fight was decided from, for
 * other members to meet there. Trouble and bosses are the forest's.
 */
function kept(s: Table, run: Run, decided: Fought, ctx: Ctx): Kept[] {
  if (run.endless) {
    s.week = weekAt(s.week, ctx.now);
    return reached({ ever: s.almanac.deepest, week: s.week }, run, decided, ctx.player.guest);
  }
  if (ctx.player.guest || ROOMS[run.room]?.kind !== "spar") return [];
  return [{ slot: boardSlot(run.trail, run.room, run.own !== null), data: decided.setup.sides[0] }];
}

function play(s: Table, c: Aimed, ctx: Ctx): Answer {
  const run = heldIn(s, aimedAt(c));
  if (!run) return no("no_run");
  // The run moves now: it draws from the era it is moved in.
  run.era = s.era;
  const room = run.record.length;
  // The takings are paid from the fight as it was decided when the party set out, against whoever was across.
  const before = foughtOf(run);
  const seconds = before?.outcome.seconds ?? 0;
  const across = before?.setup.sides[1].by;
  const done = act(run, c, { met: ctx.met });
  if (!done.ok) return no(done.code);
  const notes: RaidNote[] = [...done.notes];
  // Every fight decided, kept whole for the staff's analysis.
  const decided = c.do === "fight" ? foughtOf(run) : null;
  const number = run.endless ? s.ventures : s.runs;
  const log: Logged[] = decided ? [{ kind: LOGGED.raidFight, data: fightRecord(number, run, decided) }] : [];
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
        // A sparring room fought against another member's board: whose.
        ...(across === undefined ? {} : { met: across }),
        ...wayLogged(run),
      },
    });
  }
  const keep = decided ? kept(s, run, decided, ctx) : [];
  const coins = run.stage.phase === "over" ? finish(s, run, notes, log, ctx.room) : [];
  return { state: s, notes, coins, log, keep };
}

/**
 * Where a command meets another member's board (`Game.meets`): a `take` that moves the run on to a
 * sparring room (`takenTo`: a run whose takings end it moves nowhere) meets one at that room's slot,
 * of a member whose board it has not met lately (`metLately`). In an endless run it meets whoever
 * holds a room held (`isHeld`, `heldSlot`), the member too, and nobody's anywhere else.
 */
export function meets(state: Table, c: RaidCommand): Meeting | null {
  const run = c.do === "take" ? heldIn(state, aimedAt(c)) : null;
  const to = run && takenTo(run);
  if (!run || to === null || roomAt(to)?.kind !== "spar") return null;
  if (run.endless) return isHeld(run, to) ? { slot: heldSlot(to), avoid: [], held: true } : null;
  return { slot: boardSlot(run.trail, to, run.own !== null), avoid: metLately(run.record, run.foe) };
}

/**
 * Whether a run has fought no room yet. Such a run is not put down: setting out afresh or walking
 * home is refused, so that a run's opening cannot be drawn again and again for free.
 */
export const unfought = (run: Pick<Run, "record">): boolean => run.record.length === 0;
/** The slot a run is set out in. */
const setOutIn = (c: SetOut): Slot => ("course" in c ? "endless" : "main");
/** Whether a command would put down a run that has fought no room yet (`unfought`): setting out afresh in its slot, or walking home. */
function putsDownUnfought(s: Table, c: RaidCommand): boolean {
  const slot = c.do === "start" ? setOutIn(c) : c.do === "abandon" ? aimedAt(c) : null;
  const run = slot && heldIn(s, slot);
  return run !== null && unfought(run);
}

export function applyCommand(state: Table, c: RaidCommand, ctx: Ctx): Answer {
  if (c.do === "start" && !("course" in c) && !trailOpen(state.almanac, c.trail)) return no("trail_closed");
  if (putsDownUnfought(state, c)) return no("unfought");
  const s = structuredClone(state);
  // Leaf's clock says the era the command is done in; Leaf's dice are stirred into every stream before anything is drawn.
  s.era = eraAt(ctx.now);
  s.rng = mix(s.rng, ctx.seed);
  for (const run of [s.run, s.endless]) if (run) run.rng = mix(run.rng, ctx.seed);
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

const trailOf = (v: unknown): number | null => (isWhole(v, 0, TRAIL_COUNT - 1) ? v : null);
const lookOf = (v: Record<string, unknown>): { kind: LookKind; look: string } | null =>
  isLookKind(v.kind) && typeof v.look === "string" && v.look.length <= 32 ? { kind: v.kind, look: v.look } : null;

/**
 * Setting out off the wire: on a trail (`course: "trail"`, or none), with the member's own figures
 * when `own` is true; or on an endless run (`course: "wilds"` or `"deep"`), with the fair game's.
 */
function readStart(v: Record<string, unknown>): SetOut | null {
  const course = v.course ?? "trail";
  if (course !== "trail") return isEndlessWay(course) && v.own !== true ? { do: "start", course } : null;
  const trail = trailOf(v.trail);
  return trail === null ? null : v.own === true ? { do: "start", trail, own: true } : { do: "start", trail };
}

const TABLE: { readonly [D in TableDo]: TableSpec<TableCommandOf<D>> } = {
  start: { read: readStart, run: (s, c, ctx) => ("course" in c ? setOutEndless(s, c, ctx) : setOut(s, c, ctx)) },
  trail: {
    read: (v) => {
      const trail = trailOf(v.trail);
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
  const held = heldIn(view, slot);
  if (!held) return { refused: "no_run" };
  const run = structuredClone(held);
  // The run moves in the era Leaf's view is of, as it does at Leaf (`play`).
  run.era = view.era;
  const done = plan(run, c);
  if (!done) return null;
  if (!done.ok) return { refused: done.code };
  return { view: slot === "endless" ? { ...view, endless: run } : { ...view, run }, notes: done.notes };
}

/**
 * The commands the bot would send to plan the room that is up, worked out on the page's copy: of
 * the run in hand, or (`endless`) of the endless run. A pick waiting is one command alone, since
 * what comes after it is Leaf's to say; and the bot never rustles here, since the new stall is
 * Leaf's to draw. Send them, and ask again once Leaf has answered: an empty list means the room is
 * planned.
 */
export function planCommands(view: TableView, habit: Habit, endless = false): RaidCommand[] {
  const held = endless ? view.endless : view.run;
  if (held?.stage.phase !== "plan") return [];
  const run = structuredClone(held);
  const out: Aimed[] = [];
  const hands: Hands<RunView> = (r, c) => {
    const done = plan(r, c);
    if (done?.ok || (!done && c.do === "choose")) out.push(endless ? { ...c, slot: "endless" } : c);
    // What draws is Leaf's to do: a pick is written down and the bot plans the rest once Leaf has answered; a rustle, never.
    return done ?? refusal(c.do === "choose" ? "nothing_to_choose" : "not_enough_acorns");
  };
  // The page's own stream for the bot's habits: the run's is Leaf's.
  planWith(run, habit, hands, { rng: mix(endless ? view.ventures : view.runs, 9000 + run.record.length) });
  return out;
}

// ---------- keeping it ----------

const GAME = "little-raid-table";
/**
 * 6: the table, each run and each fight's setup keep their era (`releases.ts`). 5: what Greg has
 * eaten is a share of his health (`feed`), where it was meals of 3% each. 4: a run of the Wilds
 * keeps the rule picked for its wing (`Run.wing`), and a fight its rule. 3: the endless run beside
 * the run in hand, and the week's deepest rooms. 2: a run keeps where it stands as one value
 * (`Stage`). A table of versions 1 to 5 is read as well: it and its runs are of `LEGACY_ERA`, one of
 * versions 1 to 4 has Greg's meals at 3% each, and one of versions 1 to 3 has no rules, so a run of
 * the Wilds past room 5 picks one at its next boss.
 */
export const TABLE_VERSION = 6;
const READS = [1, 2, 3, 4, 5, TABLE_VERSION] as const;

export const encodeTable = (state: Table): string =>
  JSON.stringify({
    game: GAME,
    v: TABLE_VERSION,
    rng: state.rng,
    era: state.era,
    runs: state.runs,
    run: state.run,
    endless: state.endless,
    ventures: state.ventures,
    almanac: state.almanac,
    trail: state.trail,
    looks: state.looks,
    week: state.week,
  });

/**
 * A run as a table of a version keeps it in one of its places (`endless`: the endless run's), or
 * none: one that does not read, or could not have been kept (one over, one of the other place, one
 * with no number of `begun`), is let go of.
 */
function keptRun(v: unknown, version: number, begun: number, endless: boolean): Run | null {
  const read = v === null || v === undefined ? null : checkRun(v, version === 1, version < 5);
  if (!read?.ok || read.run.stage.phase === "over" || begun <= 0) return null;
  return (read.run.endless !== null) === endless ? read.run : null;
}

/** A table's era as it kept it, or null for one that is none; a table kept before there were eras is of the era live then. */
const keptEra = (v: unknown): Era | null => (v === undefined ? LEGACY_ERA : isEra(v) ? v : null);

/**
 * A table from the text Leaf stored, or null for anything not of these versions' shape. Under
 * today's content and numbers it refuses nothing more: a trail picked that is not open is the
 * first, a run that does not read is let go of (`keptRun`), and what an older table did not keep
 * is none, so the almanac and the looks bought are never out of reach.
 */
export function decodeTable(text: string): Table | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const version = isRecord(raw) && raw.game === GAME ? READS.find((v) => v === raw.v) : undefined;
  if (!isRecord(raw) || version === undefined) return null;
  const { rng, runs, trail } = raw;
  if (!isWhole(rng, 0, UINT) || !isWhole(runs, 0, 1_000_000_000) || !isWhole(trail, 0, 999)) return null;
  const almanac = readAlmanac(raw.almanac);
  const looks = readLooks(raw.looks);
  if (!almanac || !looks) return null;
  const ventures = isWhole(raw.ventures, 0, 1_000_000_000) ? raw.ventures : 0;
  const era = keptEra(raw.era);
  if (era === null) return null;
  return {
    rng,
    era,
    runs,
    run: keptRun(raw.run, version, runs, false),
    endless: keptRun(raw.endless, version, ventures, true),
    ventures,
    almanac,
    trail: trailOpen(almanac, trail) ? trail : 0,
    looks,
    week: readWeek(raw.week),
  };
}

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
  runs: 0,
  run: null,
  endless: null,
  ventures: 0,
  almanac: newAlmanac(),
  trail: 0,
  looks: newLooks(),
  week: readWeek(undefined),
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
    const counts = trophies(almanac);
    return { score: counts.length, also: { runs: almanac.runs, room: Math.max(0, ...almanac.best) }, counts };
  },
  // A carved figure of each boss beaten, for the member's camp.
  awards: (state) => trophies(state.almanac),
  // A raid under way, or the board set out, for the town's door.
  postcard,
};
