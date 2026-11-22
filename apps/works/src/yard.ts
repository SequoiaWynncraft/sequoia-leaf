/**
 * The yard on the page. The yard is Leaf's: its clock, its till and its Coins. The page opens it
 * from the guild's server (`openYard`), holds a copy (`S.world`) that it runs with the same rules
 * ahead of Leaf, and sends everything the member does as a command (`doNow`), done to the copy at
 * once and carrying the tick the copy stood at.
 *
 * Each frame (`runYard`), if Leaf has answered since the last, the copy becomes Leaf's yard with
 * every command still unanswered done again on top, each at its own tick; then the copy is run on to
 * Leaf's tick now, which is the tick Leaf last gave plus one for each tenth of a second since, never
 * earlier than one already shown. Coins are Leaf's ledger's: the number the Works shows is the
 * purse's and the whole Coins in the copy's till. Only the screen's own settings stay in the browser.
 */

import { keepText, keptText } from "@sequoia-leaf/kit/keep.ts";
import { outside } from "@sequoia-leaf/kit/net.ts";
import { openPlay, type Play, type Trouble } from "@sequoia-leaf/kit/play.ts";
import { balance, heardCoins, refreshCoins } from "@sequoia-leaf/kit/purse.ts";
import {
  drain,
  type News,
  play,
  readNotes,
  readView,
  stepTo,
  TICK_MS,
  WORKS,
  type WorksAct,
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

let leaf: Play<WorksView, WorksCommand, WorksNote> | null = null;
/** Commands sent and not answered yet, oldest first. */
let unanswered: WorksCommand[] = [];
/** Whether Leaf has answered since the copy was last made from its yard, and when. */
let fresh = false;
let arrived = 0;
/** Leaf's tick in its last answer, and when that came on the page's own clock. */
let base = { clock: 0, at: 0 };
/** The latest tick the page has shown. */
let shown = 0;
let collectedAt = 0;
const refusalHearers: ((why: string) => void)[] = [];

/** Hears why Leaf turned down something the page had already shown done. */
export const onRefused = (fn: (why: string) => void): void => void refusalHearers.push(fn);

/** The Coins the member has to spend in the Works, as Leaf will count them: the purse's, and the till's whole Coins. */
export const coins = (): number => balance().coins + Math.floor(S.world.till);

/** Leaf's tick now, as the page reckons it. */
const tickAt = (now: number): number => Math.max(shown, base.clock + Math.floor((now - base.at) / TICK_MS));

/**
 * Opens the yard from Leaf, for the member the page is signed in as (`player`). Says why it could
 * not; after that, whatever stops the page sending is told to `trouble`.
 */
export async function openYard(player: string, trouble: (why: Trouble) => void): Promise<Trouble | null> {
  Object.assign(screen, parseScreen(keptText(SCREEN)));
  const opened = await openPlay<WorksView, WorksCommand, WorksNote>(
    "works",
    { view: readView, notes: readNotes },
    { player },
  );
  if ("trouble" in opened) return opened.trouble;
  leaf = opened;
  unanswered = [];
  shown = 0;
  opened.onTrouble(trouble);
  opened.onState(() => {
    fresh = true;
    arrived = performance.now();
  });
  arrived = performance.now();
  collectedAt = arrived;
  if (!take()) return "closed";
  return null;
}

/** The copy becomes Leaf's yard, with every command still unanswered done again on top. False when Leaf's rules are newer than the page's. */
function take(): boolean {
  fresh = false;
  const view = leaf?.state;
  const yard = view ? WORKS.decode(view.yard) : null;
  if (!view || !yard) {
    outside.reload();
    return false;
  }
  // Leaf's clock far behind what was shown is a yard put in place of another (by hand): it is taken as it stands.
  if (shown - view.clock > BEHIND_MOST) shown = 0;
  base = { clock: view.clock, at: arrived };
  for (const c of unanswered) play(yard, c);
  // What has been shown was shown with its news: it is not told again.
  stepTo(yard, shown);
  drain(yard);
  shown = Math.max(shown, yard.tick);
  S.world = yard;
  S.rev++;
  return true;
}

/**
 * Does what the member did to the copy at once, with the shared rules, and sends it to Leaf with
 * the tick the copy stands at; whatever Coins it pays or takes show at once. The rules' refusal is
 * given back, and nothing is sent.
 */
export function doNow(act: WorksAct): ReturnType<typeof play> {
  const command: WorksCommand = { ...act, tick: S.world.tick };
  const done: ReturnType<typeof play> = leaf
    ? play(S.world, command)
    : { refused: "closed", why: "The yard is not open" };
  if ("refused" in done || !leaf) return done;
  const change = (done.coins ?? []).reduce((sum, c) => sum + c.amount, 0);
  if (change !== 0) heardCoins(balance().coins + change);
  if (act.do === "collect") collectedAt = performance.now();
  unanswered.push(command);
  void sent(leaf, command, change !== 0);
  return done;
}

/** Hears Leaf's answer to a command shown done: it is answered now, and Leaf may have turned it down. */
async function sent(to: Play<WorksView, WorksCommand, WorksNote>, command: WorksCommand, paid: boolean) {
  const answer = await to.send(command);
  unanswered = unanswered.filter((u) => u !== command);
  if ("refused" in answer) {
    const why = answer.refused === "not_enough_coins" ? "Not enough Coins" : "That could not be done after all";
    for (const fn of refusalHearers) fn(why);
  }
  if (paid || "refused" in answer) refreshCoins();
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
  if (fresh && !take()) return [];
  const w = S.world;
  const tick = tickAt(now);
  const waiting = leaf.waiting();
  if (tick - w.tick > BEHIND_MOST) {
    // A tab put away and back: Leaf's yard, not a long run on the page.
    if (!waiting) collect();
    return [];
  }
  stepTo(w, tick);
  shown = tick;
  // A slot the board would have filled (a story order done) is filled by Leaf. And once a minute
  // the page collects whether or not the till holds a Coin: it keeps Leaf's yard in step with one
  // being watched, so that a yard earning nothing is not taken for one its owner left.
  const empty = w.open.board && w.board.length < w.rates.slots;
  if (!waiting && (empty || now - collectedAt >= COLLECT_EVERY)) collect();
  return drain(w);
}

/** How far into the next tick the copy is at `now`, from 0 to 1: for drawing things part-way across a tile. */
export const leadAt = (now: number): number =>
  Math.min(1, Math.max(0, base.clock + (now - base.at) / TICK_MS - S.world.tick));

/** Whether anything sent to Leaf has not been answered yet. */
export const waitingForLeaf = (): boolean => leaf?.waiting() ?? false;

/** Asks Leaf for the yard again and takes it: for when something was staged from outside. */
export async function again(): Promise<void> {
  await leaf?.refresh();
}

/** Sends nothing more and forgets the yard (for tests). */
export function letGo(): void {
  leaf = null;
  unanswered = [];
  fresh = false;
  shown = 0;
}
