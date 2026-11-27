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
  type Met,
  mix,
  type Refused,
} from "@sequoia-leaf/core";

import { type Habit, type Hands, planWith } from "./bot.ts";
import {
  type Aimed,
  forEndless,
  isPredicted,
  type Predicted,
  type RaidCommand,
  readCommand,
  type RunCommand,
} from "./command.ts";
import type { EndlessWay } from "./content/endless.ts";
import {
  isBoughtLook,
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
import { ROOMS } from "./content/rooms.ts";
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
import { forgeItems } from "./rack.ts";
import {
  abandon,
  beginFight,
  buy,
  buyXp,
  type Choice,
  choose,
  type Done as RunDone,
  fieldCap,
  type Fought,
  foughtOf,
  giveItem,
  hold,
  move,
  type Note,
  redraw,
  refusal,
  REFUSALS,
  type Run,
  type RunSummary,
  type RunView,
  rustle,
  sell,
  type Stage,
  startRun,
  summariseRun,
  takenTo,
  takeTakings,
  toBench,
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
  return choice.kind === "boon"
    ? { kind: "boon", options: [], redraws: choice.redraws }
    : choice.kind === "component"
      ? { kind: "component", options: [] }
      : { kind: "starter", options: [] };
}

/** Where a run stands as the page is shown it: only the first of the picks waiting says what it offers. */
const stageView = (stage: Stage): Stage =>
  stage.phase === "plan" ? { phase: "plan", picks: stage.picks.map((c, i) => (i === 0 ? c : unseen(c))) } : stage;

/** A run as the page is shown it. Each field is named, so nothing new is shown by accident. */
export function runView(run: RunView): RunView {
  return {
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
    seen: run.seen,
  };
}

/** What the page is shown of the table: the week as it stands now (`weekAt`), a new one with nothing won in it yet. */
export function tableView(state: Table, ctx: Pick<Ctx, "awards" | "now">): TableView {
  return {
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

/** A command that draws nothing, on a run with or without its streams: Leaf's, or the page's copy. */
export function plan(run: RunView, c: Predicted): RunDone {
  switch (c.do) {
    case "buy":
      return buy(run, c.offer);
    case "sell":
      return sell(run, c.from);
    case "move":
      return move(run, c.from, c.to);
    case "bench":
      return toBench(run, c.seat);
    case "hold":
      return hold(run, c.on);
    case "xp":
      return buyXp(run);
    case "give":
      return giveItem(run, c.item, c.to);
    case "forge":
      return forgeItems(run, c.item, c.with);
  }
}

/** A run action, on the run in hand; `met` is another member's board that a `take` meets (`Ctx.met`). */
export function act(run: Run, c: RunCommand, met: Met | undefined): RunDone {
  if (isPredicted(c)) return plan(run, c);
  switch (c.do) {
    case "choose":
      return choose(run, c.option);
    case "redraw":
      return redraw(run);
    case "rustle":
      return rustle(run);
    case "fight":
      return beginFight(run);
    case "take":
      return takeTakings(run, met);
    case "abandon":
      return abandon(run);
  }
}

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

function setOut(s: Table, { trail, own: asked }: Extract<RaidCommand, { do: "start" }>, ctx: Ctx): Answer {
  // The main way is never told what the member has pulled.
  const own: Roster | null = asked ? rosterOf(ctx.awards) : null;
  if (own && Object.keys(own).length === 0) return no("nothing_pulled");
  const notes: RaidNote[] = [];
  const log: Logged[] = [];
  const coins = putDown(s, s.run, notes, log, ctx.room);
  s.runs += 1;
  s.run = startRun(draw32(s), own ? { trail, own } : { trail });
  s.trail = trail;
  notes.push({ t: "started", trail, run: s.runs });
  log.push({ kind: LOGGED.raidStarted, data: { trail, ...wayLogged(s.run) } });
  return { state: s, notes, coins, log };
}

/** Setting out on an endless run, beside the run in hand: on the first trail, the fair game's figures. */
function setOutEndless(s: Table, { way }: Extract<RaidCommand, { do: "endless" }>, ctx: Ctx): Answer {
  const notes: RaidNote[] = [];
  const log: Logged[] = [];
  const coins = putDown(s, s.endless, notes, log, ctx.room);
  s.ventures += 1;
  s.endless = startRun(draw32(s), { endless: way });
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
  const run = forEndless(c) ? s.endless : s.run;
  if (!run) return no("no_run");
  const room = run.record.length;
  // The takings are paid from the fight as it was decided when the party set out, against whoever was across.
  const before = foughtOf(run);
  const seconds = before?.outcome.seconds ?? 0;
  const across = before?.setup.sides[1].by;
  const done = act(run, c, ctx.met);
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
  const run = forEndless(c) ? state.endless : state.run;
  const to = c.do === "take" && run ? takenTo(run) : null;
  if (!run || to === null || roomAt(to)?.kind !== "spar") return null;
  if (run.endless) return isHeld(run, to) ? { slot: heldSlot(to), avoid: [], held: true } : null;
  return { slot: boardSlot(run.trail, to, run.own !== null), avoid: metLately(run.record, run.foe) };
}

/**
 * Whether a run has fought no room yet. Such a run is not put down: setting out afresh or walking
 * home is refused, so that a run's opening cannot be drawn again and again for free.
 */
export const unfought = (run: Pick<Run, "record">): boolean => run.record.length === 0;
/** Whether a command would put down a run that has fought no room yet (`unfought`): the endless run's, or the run in hand's. */
function putsDownUnfought(s: Table, c: RaidCommand): boolean {
  const run = c.do === "endless" || forEndless(c) ? s.endless : s.run;
  return (c.do === "start" || c.do === "endless" || c.do === "abandon") && run !== null && unfought(run);
}

export function applyCommand(state: Table, c: RaidCommand, ctx: Ctx): Answer {
  if (c.do === "start" && !trailOpen(state.almanac, c.trail)) return no("trail_closed");
  if (putsDownUnfought(state, c)) return no("unfought");
  const s = structuredClone(state);
  // Leaf's dice, stirred into every stream before anything is drawn.
  s.rng = mix(s.rng, ctx.seed);
  for (const run of [s.run, s.endless]) if (run) run.rng = mix(run.rng, ctx.seed);
  if (c.do === "start") return setOut(s, c, ctx);
  if (c.do === "endless") return setOutEndless(s, c, ctx);
  if (c.do === "trail") {
    if (!trailOpen(s.almanac, c.trail)) return no("trail_closed");
    s.trail = c.trail;
    return { state: s, notes: [{ t: "trail", trail: c.trail }] };
  }
  if (c.do === "look" || c.do === "buyLook") return dress(s, c);
  return play(s, c, ctx);
}

/** Puts an owned look on the table, or buys one with Leaf and puts it on. */
function dress(s: Table, c: Extract<RaidCommand, { do: "look" | "buyLook" }>): Answer {
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
  const held = forEndless(c) ? view.endless : view.run;
  if (!held) return { refused: "no_run" };
  const run = structuredClone(held);
  const done = plan(run, c);
  if (!done.ok) return { refused: done.code };
  return { view: forEndless(c) ? { ...view, endless: run } : { ...view, run }, notes: done.notes };
}

/**
 * Whether a command that draws nothing would be done to a run as it stands: the rules asked, on a
 * copy, so that a page lights only what Leaf would do and never works the rules out again.
 */
export const legal = (run: RunView, c: Predicted): boolean => plan(structuredClone(run), c).ok;

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
  const wrote = <T extends { ok: boolean }>(done: T, c: Aimed): T => {
    if (done.ok) out.push(c);
    return done;
  };
  const hands: Hands<RunView> = {
    // Written down but not done here: the bot stops at it, and plans the rest once Leaf has answered.
    choose: (_, option) => {
      out.push({ do: "choose", option });
      return refusal("nothing_to_choose");
    },
    buy: (r, offer) => wrote(buy(r, offer), { do: "buy", offer }),
    sell: (r, from) => wrote(sell(r, from), { do: "sell", from }),
    move: (r, from, to) => wrote(move(r, from, to), { do: "move", from, to }),
    toBench: (r, seat) => wrote(toBench(r, seat), { do: "bench", seat }),
    rustle: () => refusal("not_enough_acorns"),
    buyXp: (r) => wrote(buyXp(r), { do: "xp" }),
    giveItem: (r, item, to) => wrote(giveItem(r, item, to), { do: "give", item, to }),
  };
  // The page's own stream for the bot's habits: the run's is Leaf's.
  planWith(run, habit, hands, { rng: mix(endless ? view.ventures : view.runs, 9000 + run.record.length) });
  return endless ? out.map((c): Aimed => ({ ...c, endless: true })) : out;
}

// ---------- keeping it ----------

const GAME = "little-raid-table";
/**
 * 3: the endless run beside the run in hand, and the week's deepest rooms. 2: a run keeps where it
 * stands as one value (`Stage`). A table of versions 1 and 2 is read as well.
 */
export const TABLE_VERSION = 3;
const READS = [1, 2, TABLE_VERSION] as const;

export const encodeTable = (state: Table): string =>
  JSON.stringify({
    game: GAME,
    v: TABLE_VERSION,
    rng: state.rng,
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
 * A run as a table keeps it in one of its places (`endless`: the endless run's), or none: one that
 * does not read, or could not have been kept (one over, one of the other place, one with no number
 * of `begun`), is let go of.
 */
function keptRun(v: unknown, old: boolean, begun: number, endless: boolean): Run | null {
  const read = v === null || v === undefined ? null : checkRun(v, old);
  if (!read?.ok || read.run.stage.phase === "over" || begun <= 0) return null;
  return (read.run.endless !== null) === endless ? read.run : null;
}

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
  if (!isRecord(raw) || raw.game !== GAME || !READS.some((v) => v === raw.v)) return null;
  const { rng, runs, trail } = raw;
  if (!isWhole(rng, 0, UINT) || !isWhole(runs, 0, 1_000_000_000) || !isWhole(trail, 0, 999)) return null;
  const almanac = readAlmanac(raw.almanac);
  const looks = readLooks(raw.looks);
  if (!almanac || !looks) return null;
  const ventures = isWhole(raw.ventures, 0, 1_000_000_000) ? raw.ventures : 0;
  return {
    rng,
    runs,
    run: keptRun(raw.run, raw.v === 1, runs, false),
    endless: keptRun(raw.endless, false, ventures, true),
    ventures,
    almanac,
    trail: trailOpen(almanac, trail) ? trail : 0,
    looks,
    week: readWeek(raw.week),
  };
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
  advance: wonLooks,
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
