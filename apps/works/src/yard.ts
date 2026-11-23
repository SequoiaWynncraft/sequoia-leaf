/**
 * The yard on the page. The yard is Leaf's: its clock, its till and its Coins. The page opens it
 * from the guild's server (`openYard`), holds a copy (`S.world`) that it runs with the same rules
 * ahead of Leaf, and sends everything the member does as a command (`doNow`), done to the copy at
 * once and carrying the tick the copy stood at.
 *
 * The copy is the yard, kept in step with Leaf's by a check. The page is in one of two states.
 *
 * - In step. With each command sent the page keeps the copy's tick and check just after it
 *   (`check`). Leaf answers a batch with its clock and its yard's tick and check after the batch
 *   (`WorksAnswer`), not the yard. When Leaf did what the page did, at the same tick, and hung no
 *   order (only Leaf can: it holds the seed), the two checks are of the same moment: alike, nothing
 *   more happens.
 * - Taking Leaf's yard (`taking`), whenever the copy must give way to it: checks that differ (a
 *   fault in the rules or the check, which the page counts and tells Leaf the tick of), a command
 *   Leaf turned down or did at another tick, an order Leaf hung, a tab come back. Nothing is sent
 *   and nothing done to the copy; what the member does meanwhile is kept, as what they did. Once
 *   every batch already sent has been answered, Leaf's yard is asked for, and again every couple of
 *   seconds until it comes. The copy is then Leaf's yard (`take`), with nothing done again on top,
 *   since nothing is unanswered; and then what the member did is done, at the yard's tick then.
 *
 * Each frame (`runYard`), the copy is run on to Leaf's tick now, which is the tick Leaf last gave
 * plus one for each tenth of a second since, never earlier than one already shown. Coins are Leaf's
 * ledger's: the number the Works shows is the purse's and the whole Coins in the copy's till. Only
 * the screen's own settings stay in the browser.
 *
 * A visit (`S.visiting`) opens somebody else's yard as Leaf gives a visitor it, runs it on the same
 * way, and reads it again every half minute. It sends nothing: `doNow` refuses.
 */

import { keepText, keptText } from "@sequoia-leaf/kit/keep.ts";
import { outside } from "@sequoia-leaf/kit/net.ts";
import { type Answered, openPlay, type Play, type Trouble } from "@sequoia-leaf/kit/play.ts";
import { balance, heardCoins, refreshCoins } from "@sequoia-leaf/kit/purse.ts";
import {
  check,
  drain,
  LEAD,
  type News,
  play,
  readAnswer,
  readNotes,
  readView,
  stepTo,
  stillAt,
  TICK_MS,
  WORKS,
  type WorksAct,
  type WorksAnswer,
  type WorksCommand,
  type WorksNote,
  type WorksView,
} from "@sequoia-leaf/yard";

import { S } from "./state.ts";
import { ZOOM } from "./zoom.ts";

const SCREEN = "works.screen.v1";
/** How far behind Leaf's clock the copy may be run on to; further (a tab put away), Leaf's yard is fetched instead. */
const BEHIND_MOST = 600;
/** How often the till is paid in while it holds a whole Coin. */
const COLLECT_EVERY = 60_000;
/** How often a tab that came back asks Leaf for its yard, until it has it. */
const ASK_EVERY = 2000;
/** How often a visit reads the yard from Leaf again. */
const VISIT_EVERY = 30_000;

/** What the screen itself remembers between visits: nudges already taken, and the zoom. */
export interface Screen {
  taught: string[];
  zoom: number;
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export const screen: Screen = { taught: [], zoom: 0 };

/** What the screen remembered, from its text; whatever makes no sense is as a new member has it. */
export function parseScreen(text: string | null): Screen {
  const out: Screen = { taught: [], zoom: 0 };
  try {
    const raw: unknown = JSON.parse(text ?? "null");
    if (!isRecord(raw)) return out;
    if (Array.isArray(raw.taught))
      out.taught = raw.taught.filter((v): v is string => typeof v === "string").slice(0, 60);
    // As far in or out as the camera goes, and no further.
    if (typeof raw.zoom === "number" && raw.zoom >= -ZOOM.out && raw.zoom <= ZOOM.in) out.zoom = Math.round(raw.zoom);
  } catch {
    // Nonsense in it: start with nothing remembered.
  }
  return out;
}

/** Keeps the screen's settings. */
export const keepScreen = (): void => void keepText(SCREEN, JSON.stringify(screen));

let leaf: Play<WorksView, WorksCommand, WorksNote, WorksAnswer> | null = null;
/** A command sent and not answered yet: the copy's tick and check just after it was done, and whether it changed Coins. */
interface Sent {
  readonly command: WorksCommand;
  readonly tick: number;
  readonly check: number;
  readonly paid: boolean;
}
/** Commands sent and not answered yet, oldest first. */
let unanswered: Sent[] = [];
/** While Leaf's yard is being taken: since when, by the page's clock, and what the member has done meanwhile. */
let taking: { readonly since: number; readonly acts: WorksAct[] } | null = null;
/** The tick the copy was last found not to be Leaf's yard, until Leaf is told; and how often that was found. */
let untold: number | undefined;
let found = 0;
/** Leaf's tick in its last answer, and when that came on the page's own clock. */
let base = { clock: 0, at: 0 };
/** The latest tick the page has shown. */
let shown = 0;
let collectedAt = 0;
/** When Leaf was last asked for its yard. */
let askedAt = -Infinity;
const refusalHearers: ((why: string) => void)[] = [];

/** Hears why Leaf turned down something the page had already shown done. */
export const onRefused = (fn: (why: string) => void): void => void refusalHearers.push(fn);

/** The Coins the member has to spend in the Works, as Leaf will count them: the purse's, and the till's whole Coins (not in a visit). */
export const coins = (): number => balance().coins + (S.visiting ? 0 : Math.floor(S.world.till));

/** Leaf's tick now, as the page reckons it. */
const tickAt = (now: number): number => Math.max(shown, base.clock + Math.floor((now - base.at) / TICK_MS));

/**
 * Opens the yard from Leaf, for the member the page is signed in as (`player`), or in a visit the
 * yard visited. Says why it could not; after that, whatever stops the page sending is told to `trouble`.
 */
export async function openYard(player: string, trouble: (why: Trouble) => void): Promise<Trouble | null> {
  Object.assign(screen, parseScreen(keptText(SCREEN)));
  const opened = await openPlay<WorksView, WorksCommand, WorksNote, WorksAnswer>(
    "works",
    { view: readView, notes: readNotes, short: readAnswer },
    { player, ...(S.visiting ? { of: S.visiting.id } : {}) },
  );
  if ("trouble" in opened) return opened.trouble;
  leaf = opened;
  unanswered = [];
  shown = 0;
  opened.onTrouble(trouble);
  opened.onState(() => void take());
  opened.onAnswer(heard);
  collectedAt = performance.now();
  askedAt = collectedAt;
  if (!take()) return "closed";
  return null;
}

/**
 * The copy becomes Leaf's yard, run on to the tick already shown; and then whatever the member did
 * while it came is done. False when Leaf's rules are newer than the page's.
 */
function take(): boolean {
  const view = leaf?.state;
  const yard = view ? WORKS.decode(view.yard) : null;
  if (!view || !yard) {
    outside.reload();
    return false;
  }
  // Leaf's clock further behind what was shown than Leaf does a command ahead of it is a yard put in
  // place of another (by hand), or a copy run ahead of Leaf's: it is taken as it stands.
  if (shown - view.clock > LEAD) shown = 0;
  base = { clock: view.clock, at: performance.now() };
  // What has been shown was shown with its news: it is not told again.
  stepTo(yard, shown);
  drain(yard);
  shown = Math.max(shown, yard.tick);
  S.world = yard;
  S.rev++;
  const acts = taking?.acts ?? [];
  taking = null;
  untold = undefined;
  for (const act of acts) {
    const done = doNow(act);
    if ("refused" in done) for (const fn of refusalHearers) fn(done.why);
  }
  return true;
}

/** The copy must give way to Leaf's yard: nothing is sent or done to it until that has come. */
function giveWay(): void {
  if (taking) return;
  taking = { since: performance.now(), acts: [] };
  askedAt = -Infinity;
}

/** While Leaf's yard is being taken: once nothing of the page's is on its way, it is asked for, and again every couple of seconds. */
function ask(now: number): void {
  if (!taking || !leaf || leaf.waiting() || now - askedAt < ASK_EVERY) return;
  askedAt = now;
  void leaf.refresh(untold);
}

/** Whether Leaf's yard has been on its way for more than a second: the line over the dock says so. */
export const catchingUp = (now = performance.now()): boolean => taking !== null && now - taking.since > 1000;

/**
 * Hears Leaf's answer to a batch: each command in it is answered, and the copy is still Leaf's yard,
 * or Leaf's is asked for. Leaf may have turned a command down that the page had shown done.
 */
function heard({ done, short }: Answered<WorksCommand, WorksNote, WorksAnswer>): void {
  const mine = unanswered.filter((sent) => done.some((d) => d.command === sent.command));
  unanswered = unanswered.filter((sent) => !mine.includes(sent));
  if (short) base = { clock: short.clock, at: performance.now() };
  const refused = done.some(({ answer }) => "refused" in answer);
  for (const { answer } of done) {
    if (!("refused" in answer)) continue;
    const why = answer.refused === "not_enough_coins" ? "Not enough Coins" : "That could not be done after all";
    for (const fn of refusalHearers) fn(why);
  }
  if (refused || mine.some((sent) => sent.paid)) refreshCoins();
  const last = mine.at(-1);
  if (!taking && last) {
    // Leaf did just what the copy did, at the same tick, and hung no order: the checks are of the same moment.
    const comparable = short && !refused && short.tick === last.tick && short.serial === S.world.serial;
    if (comparable && short.check !== last.check) {
      found++;
      untold = short.tick;
    }
    if (!comparable || short.check !== last.check) giveWay();
  }
  ask(performance.now());
}

/**
 * Does what the member did to the copy at once, with the shared rules, and sends it to Leaf with
 * the tick the copy stands at; whatever Coins it pays or takes show at once. The rules' refusal is
 * given back, and nothing is sent.
 */
export function doNow(act: WorksAct): ReturnType<typeof play> {
  if (S.visiting) return { refused: "visiting", why: "This yard is somebody else's" };
  if (!leaf) return { refused: "closed", why: "The yard is not open" };
  // While Leaf's yard is coming, what the member does is kept, and done once it has come.
  if (taking) {
    taking.acts.push(act);
    return { state: S.world, notes: [] };
  }
  const command: WorksCommand = { ...act, tick: S.world.tick };
  const done = play(S.world, command);
  if ("refused" in done) return done;
  const change = (done.coins ?? []).reduce((sum, c) => sum + c.amount, 0);
  if (change !== 0) heardCoins(balance().coins + change);
  if (act.do === "collect") collectedAt = performance.now();
  // A collection may pay what only Leaf knows of (a tab put away earns on Leaf, not on the copy).
  unanswered.push({ command, tick: S.world.tick, check: check(S.world), paid: change !== 0 || act.do === "collect" });
  void leaf.send(command);
  return done;
}

/** Pays the till into the ledger, and puts away the letter about a time away. */
export const collect = (): ReturnType<typeof play> => doNow({ do: "collect" });

/**
 * A moment of the page's clock (`now`, in milliseconds, as `performance.now` counts them): Leaf's
 * yard is taken if it has come, the copy is run on to Leaf's tick, and its news is handed back for
 * the screen to make something of.
 */
export function runYard(now: number): News[] {
  if (!leaf) return [];
  const w = S.world;
  const tick = tickAt(now);
  const waiting = leaf.waiting();
  // A tab put away and back is given Leaf's yard as Leaf has run it, not a long run on the page. It
  // is asked for, not collected, so that what Leaf says of the time away is still there to show.
  const behind = tick - w.tick > BEHIND_MOST;
  if (behind) giveWay();
  ask(now);
  if (behind) return [];
  stepTo(w, tick);
  shown = w.tick;
  // A yard standing still (its owner away eight hours) holds Leaf's clock with it from the frame it
  // stops in, as Leaf does, until they act.
  if (w.tick >= stillAt(w)) base = { clock: w.tick, at: now };
  // What these steps made known is taken before anything is sent: doing a command takes it too.
  const news = drain(w);
  if (S.visiting) {
    if (!waiting && now - askedAt >= VISIT_EVERY) {
      askedAt = now;
      void leaf.refresh();
    }
    return news;
  }
  // A slot the board would have filled (a story order done) is filled by Leaf. And once a minute
  // the page collects whether or not the till holds a Coin: it keeps Leaf's yard in step with one
  // being watched, so that a yard earning nothing is not taken for one its owner left.
  const empty = w.open.board && w.board.length < w.rates.slots;
  // Not while a letter about a time away waits to be read: putting it away is what collects.
  if (!waiting && !taking && !w.away && (empty || now - collectedAt >= COLLECT_EVERY)) collect();
  return news;
}

/** How far into the next tick the copy is at `now`, from 0 to 1: for drawing things part-way across a tile. */
export const leadAt = (now: number): number =>
  Math.min(1, Math.max(0, base.clock + (now - base.at) / TICK_MS - S.world.tick));

/** Whether anything sent to Leaf has not been answered yet. */
export const waitingForLeaf = (): boolean => leaf?.waiting() ?? false;

/** Takes Leaf's yard: for when something was staged from outside. */
export async function again(): Promise<void> {
  giveWay();
  await leaf?.refresh(untold);
}

/** How many times the copy has been found not to be Leaf's yard since the page opened. */
export const differences = (): number => found;

/** Sends nothing more and forgets the yard (for tests). */
export function letGo(): void {
  leaf = null;
  unanswered = [];
  taking = null;
  untold = undefined;
  found = 0;
  shown = 0;
}
