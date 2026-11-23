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
 *   (`Heard`), not the yard. When Leaf did what the page did, at the same tick, the two checks
 *   are of the same moment: alike, the page only puts on its board the orders Leaf has hung that are
 *   new to it (`hung`: only Leaf can draw them, holding the seed), which count a few seconds after
 *   they are hung (`ORDER_WAITS`), so the copy has them in time.
 * - Taking Leaf's yard (`taking`), now and then, when the copy must give way to it: checks that
 *   differ (a fault in the rules or the check, which the page counts and tells Leaf the tick of), a
 *   command Leaf turned down or did at another tick, an order heard of after it began to count, a tab
 *   away over a minute, a yard staged from outside. The yard takes no input (`gate`; `doNow` refuses
 *   too, for scripts) and the copy stands still; what was already handed to the kit goes to Leaf and
 *   is answered; then Leaf's yard is read, as when the page opens, and again every couple of seconds
 *   while that fails for a moment, and becomes the copy (`take`).
 *
 * Each frame (`runYard`), the copy is run on to Leaf's tick now, which is the tick Leaf last gave
 * plus one for each tenth of a second since, never earlier than one already shown. Coins are Leaf's
 * ledger's: the number the Works shows is the purse's and the whole Coins in the copy's till. Only
 * the screen's own settings stay in the browser.
 *
 * What is done is done to the copy as the rules' `Act`, with things, kinds, plots and goals as
 * numbers, and goes to Leaf as the rules write it (`writeCommand`), by name.
 *
 * A visit (`S.visiting`) opens somebody else's yard as Leaf gives a visitor it and sends nothing
 * (`doNow` refuses). It follows the yard live: in the visit's room on Leaf (`visitRoom`), it hears
 * each batch Leaf keeps of the yard as Leaf keeps it (`hearDid`): the commands done, each at the tick
 * Leaf did it, and Leaf's answer after them. Its copy runs a little behind Leaf's clock (`hold`), so
 * that it hears of a command before it reaches the command's tick, and does each command there; at
 * the tick of each answer it holds itself to Leaf's check, and puts the orders Leaf hung on its board,
 * as the owner's page does (`follow`). Whatever was done while it was not in the room is never told:
 * each time the room welcomes it, it reads the yard again. Leaf's word that comes after the copy
 * passed its tick, a command the copy refuses, or a check that differs, is a copy that is not Leaf's
 * yard: it takes Leaf's yard as above, and a copy that heard too late is held further behind from
 * then on. It reads the yard again every few minutes as well, and every few seconds while it hears
 * nothing live; a read older than a batch the copy has begun is let go.
 */

import {
  type Act,
  ALL_KINDS,
  check,
  type Command,
  decode,
  drain,
  hear,
  type Heard,
  isGraded,
  kindName,
  kindNamed,
  LEAD,
  MILLI,
  type News,
  play,
  readAnswer,
  readCommand,
  readNotes,
  readView,
  type Standing,
  stepTo,
  stillAt,
  TICK_MS,
  TOP,
  type View,
  type Wired,
  writeCommand,
  type Yard,
} from "@sequoia-leaf/factory";
import { keepText, keptText } from "@sequoia-leaf/kit/keep.ts";
import { outside } from "@sequoia-leaf/kit/net.ts";
import { type Answered, openPlay, type Play, type Trouble } from "@sequoia-leaf/kit/play.ts";
import { balance } from "@sequoia-leaf/kit/purse.ts";
import { joinVisit, type LiveRoom } from "@sequoia-leaf/kit/realtime.ts";

import { S } from "./state.ts";
import { ZOOM } from "./zoom.ts";

const SCREEN = "works.screen.v1";
/** How far behind Leaf's clock the copy may be run on to; further (a tab put away), Leaf's yard is fetched instead. */
const BEHIND_MOST = 600;
/** How often the till is paid in while it holds a whole Coin. */
const COLLECT_EVERY = 60_000;
/** How often Leaf is asked for its yard while it is being taken, until it has come. */
const ASK_EVERY = 2000;
/** How often a visit reads the yard from Leaf again: now and then while Leaf tells it what it does, often while it does not. */
const VISIT_EVERY = { live: 5 * 60_000, alone: 15_000 };
/**
 * How far behind Leaf's clock a visit's copy runs, in ticks: at first half a second, time enough for
 * the owner's command to reach Leaf and Leaf's word of it to reach the visitor; and the most, once
 * that word has come too late.
 */
const VISIT_HOLD = { first: 5, most: 30 };
/** How many ticks Leaf's clock, as a batch tells it, may be from the visit's reckoning before the visit takes Leaf's. */
const VISIT_SLACK = 2;
/** The most batches a visit keeps told and not done (a tab put away, hearing all the while): past it, it reads the yard. */
const TOLD_MOST = 256;

/** What the screen itself remembers between visits: nudges already taken, the zoom, and the grade chosen for each kind of piece, by its name. */
export interface Screen {
  taught: string[];
  zoom: number;
  grades: Record<string, number>;
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export const screen: Screen = { taught: [], zoom: 0, grades: {} };

/** What the screen remembered, from its text; whatever makes no sense is as a new member has it. */
export function parseScreen(text: string | null): Screen {
  const out: Screen = { taught: [], zoom: 0, grades: {} };
  try {
    const raw: unknown = JSON.parse(text ?? "null");
    if (!isRecord(raw)) return out;
    if (Array.isArray(raw.taught))
      out.taught = raw.taught.filter((v): v is string => typeof v === "string").slice(0, 60);
    // As far in or out as the camera goes, and no further.
    if (typeof raw.zoom === "number" && raw.zoom >= -ZOOM.out && raw.zoom <= ZOOM.in) out.zoom = Math.round(raw.zoom);
    // A grade above the first, for a kind that has grades: the first is not kept, being what a kind starts at.
    if (isRecord(raw.grades))
      for (const [name, grade] of Object.entries(raw.grades)) {
        const k = kindNamed(name);
        if (
          k !== null &&
          isGraded(k) &&
          typeof grade === "number" &&
          Number.isInteger(grade) &&
          grade > 1 &&
          grade <= TOP
        )
          out.grades[name] = grade;
      }
  } catch {
    // Nonsense in it: start with nothing remembered.
  }
  return out;
}

/** Keeps the screen's settings: with them, the grade chosen for each kind in hand. */
export function keepScreen(): void {
  screen.grades = {};
  for (const k of ALL_KINDS) if ((S.grades[k] ?? 0) > 1) screen.grades[kindName(k)] = S.grades[k] ?? 1;
  void keepText(SCREEN, JSON.stringify(screen));
}

/** A command as it goes to Leaf. */
type Sending = Wired & { readonly tick: number };
let leaf: Play<View, Sending, News, Heard> | null = null;
/** A command sent and not answered yet: the copy's tick and check just after it was done. */
interface Sent {
  readonly command: Sending;
  readonly tick: number;
  readonly check: number;
}
/** Commands sent and not answered yet, oldest first. */
let unanswered: Sent[] = [];
/** Since when, by the page's clock, Leaf's yard is being taken; null while the copy is in step. */
let taking: number | null = null;
/** The tick the copy was last found not to be Leaf's yard, until Leaf is told; and how often that was found. */
let untold: number | undefined;
let found = 0;
/** How many times the copy has become Leaf's yard as read: the opening, and each time it was taken since. */
let reads = 0;
/** A batch Leaf told a visit it kept of the yard: its revision, each command done, Leaf's answer after them, and how many the copy has done. */
interface Told {
  readonly rev: number;
  readonly acts: readonly Command[];
  readonly after: Heard;
  done: number;
}
/** A visit's room on Leaf, and whether it has welcomed the page since the connection last dropped. */
let room: LiveRoom | null = null;
let live = false;
/** The batches told and not yet all done to the copy, oldest first; the revision of the newest the copy has begun, or was read at. */
let told: Told[] = [];
let upTo = 0;
/** How far behind Leaf's clock the copy runs, in ticks: none for the owner's page (`VISIT_HOLD`). */
let hold = 0;
/** For a visit: batches done as told, those told after the copy had passed their tick, and those the copy did not do as Leaf had. */
const followed = { batches: 0, late: 0, unlike: 0 };
/** Leaf's tick in its last answer, and when that came on the page's own clock. */
let base = { clock: 0, at: 0 };
/** The latest tick the page has shown. */
let shown = 0;
let collectedAt = 0;
/** When Leaf was last asked for its yard. */
let askedAt = -Infinity;
const refusalHearers: ((why: string) => void)[] = [];
/** Puts away whatever the member has under way, as the yard stops taking input (`gate`). */
let putAway = (): void => undefined;

/** What the yard says, and what anything the member does while Leaf's yard is being taken is refused with. */
export const CATCHING_UP = "The yard is catching up with the guild's server";

/** Hears why Leaf turned down something the page had already shown done. */
export const onRefused = (fn: (why: string) => void): void => void refusalHearers.push(fn);

/** The Coins the member has to spend in the Works, as Leaf will count them: the purse's, and the till's whole Coins (not in a visit). */
export const coins = (): number => balance().coins + (S.visiting ? 0 : Math.floor(S.world.till / MILLI));

/** Leaf's tick now, as the page reckons it. */
const tickAt = (now: number): number => Math.max(shown, base.clock + Math.floor((now - base.at) / TICK_MS));

/**
 * Opens the yard from Leaf, for the member the page is signed in as (`player`), or in a visit the
 * yard visited. Says why it could not; after that, whatever stops the page sending is told to `trouble`.
 */
export async function openYard(player: string, trouble: (why: Trouble) => void): Promise<Trouble | null> {
  Object.assign(screen, parseScreen(keptText(SCREEN)));
  S.grades.fill(0);
  for (const [name, grade] of Object.entries(screen.grades)) {
    const k = kindNamed(name);
    if (k !== null) S.grades[k] = grade;
  }
  const opened = await openPlay<View, Sending, News, Heard>(
    "works",
    { view: readView, notes: readNotes, short: readAnswer },
    { player, ...(S.visiting ? { of: S.visiting.id } : {}) },
  );
  if ("trouble" in opened) return opened.trouble;
  leaf = opened;
  unanswered = [];
  shown = 0;
  hold = S.visiting ? VISIT_HOLD.first : 0;
  // Play that has ended has no Leaf: the yard is run and taken no more, and input is let through
  // to the screen that says why.
  opened.onTrouble((why) => {
    leaf = null;
    taking = null;
    trouble(why);
  });
  opened.onState(() => void take());
  opened.onAnswer(heard);
  collectedAt = performance.now();
  askedAt = collectedAt;
  if (!take()) return "closed";
  if (S.visiting) listen(S.visiting.id);
  return null;
}

/**
 * A visit goes into the visit's room on Leaf, to hear each batch Leaf keeps of the yard. What was
 * done before the room welcomed it was never told: at each welcome, Leaf's yard is read again.
 */
function listen(of: string): void {
  room = joinVisit("works", of, {
    welcome: () => {
      live = true;
      giveWay();
    },
    did: hearDid,
    status: (s) => {
      if (s !== "open" && s !== "connecting") live = false;
    },
  });
}

/**
 * Hears a batch Leaf kept of a visited yard, to be done to the copy as it reaches each command's
 * tick. Leaf's clock as it tells it is taken when the visit's reckoning is off by more than a
 * little: a yard that stood still, say, and has been set going. A batch this page's rules cannot
 * read is from rules newer than the page's, which loads again.
 */
function hearDid(rev: number, did: readonly unknown[], answer: unknown): void {
  const after = readAnswer(answer);
  const acts = did.map(readCommand).filter((c): c is Command => c !== null);
  if (!after || acts.length !== did.length) {
    outside.reload();
    return;
  }
  if (told.length >= TOLD_MOST) {
    told = [];
    giveWay();
  }
  told.push({ rev, acts, after, done: 0 });
  const now = performance.now();
  const at = after.clock - hold;
  if (Math.abs(at - tickAt(now)) > VISIT_SLACK) base = { clock: at, at: now };
  // Heard well before the copy reaches it, the copy may run nearer Leaf's clock, down to where it began.
  if (hold > VISIT_HOLD.first && (acts[0]?.tick ?? after.tick) - tickAt(now) > VISIT_SLACK + 1) hold--;
}

/**
 * Does to a visit's copy what Leaf told it was done, each command as the copy reaches its tick, and
 * at the tick of each batch's answer holds the copy to Leaf's check and hears the orders Leaf hung.
 * False when the copy is not Leaf's yard: told after it had passed the tick (from then on it is held
 * further behind), a command it refuses, or a check that differs.
 */
function follow(w: Yard, to: number): boolean {
  for (let batch = told[0]; batch !== undefined; batch = told[0]) {
    for (let c = batch.acts[batch.done]; c !== undefined; c = batch.acts[++batch.done]) {
      if (c.tick > to) return true;
      if (c.tick < w.tick) return late(w.tick - c.tick);
      upTo = batch.rev;
      if ("refused" in play(w, c)) return unlike();
    }
    const { after } = batch;
    if (after.tick > to) return true;
    if (after.tick < w.tick) return late(w.tick - after.tick);
    stepTo(w, after.tick);
    told.shift();
    followed.batches++;
    if (check(w) !== after.check || !hear(w, after.hung)) return unlike();
  }
  return true;
}

/** Leaf's word came after the copy passed the tick it was of: the copy is held that much further behind, and more. */
function late(by: number): false {
  followed.late++;
  hold = Math.min(VISIT_HOLD.most, hold + by + 2);
  return false;
}

function unlike(): false {
  followed.unlike++;
  return false;
}

/** The copy becomes Leaf's yard, run on to the tick already shown, and is in step. False when Leaf's rules are newer than the page's. */
function take(): boolean {
  const view = leaf?.state;
  const yard = view ? decode(view.yard) : null;
  if (!view || !yard) {
    outside.reload();
    return false;
  }
  // A visit's copy that has begun a batch Leaf kept after this read is further on than it: it stays.
  const rev = leaf?.rev ?? 0;
  if (S.visiting && taking === null && rev < upTo) return true;
  // Leaf's clock further behind what was shown than Leaf does a command ahead of it is a yard put in
  // place of another (by hand), or a copy run ahead of Leaf's: it is taken as it stands.
  if (shown - (view.clock - hold) > LEAD) shown = 0;
  base = { clock: view.clock - hold, at: performance.now() };
  // What has been shown was shown with its news: it is not told again.
  stepTo(yard, shown);
  drain(yard);
  shown = Math.max(shown, yard.tick);
  S.world = yard;
  reads++;
  taking = null;
  untold = undefined;
  // What the yard as read has of what a visit was told is let go; none of the rest is begun.
  upTo = rev;
  told = told.filter((batch) => batch.rev > rev);
  return true;
}

/** The copy must give way to Leaf's yard: it takes no input and stands still until that has come. */
function giveWay(): void {
  if (taking !== null) return;
  taking = performance.now();
  askedAt = -Infinity;
  putAway();
}

/** Stops a press or a key at the window, while Leaf's yard is being taken. */
const stop = (e: Event): void => {
  if (taking !== null) e.stopImmediatePropagation();
};

/**
 * The one gate for input while Leaf's yard is being taken. As taking begins, whatever the member
 * has under way is put away (`away`, the tools' own `cancel`); from then until the yard has been
 * read, no press, move, click, wheel or key goes past the window to the yard, the dock, the panels
 * or the letter. A press or key let go still passes, so that nothing is left held down.
 */
export function gate(away: () => void): void {
  putAway = away;
  for (const type of ["pointerdown", "pointermove", "click", "wheel", "keydown"])
    window.addEventListener(type, stop, true);
}

/** While Leaf's yard is being taken: once nothing the page handed the kit is on its way, it is asked for, and again every couple of seconds. */
function ask(now: number): void {
  if (taking === null || !leaf || leaf.waiting() || now - askedAt < ASK_EVERY) return;
  askedAt = now;
  void leaf.refresh(untold);
}

/** Whether Leaf's yard has been on its way for more than a second: the line over the dock says so. */
export const catchingUp = (now = performance.now()): boolean => taking !== null && now - taking > 1000;

/**
 * Puts on the copy's board each order Leaf has hung that is new to it (the rules' `hear`); one heard
 * of after it began to count has been missed, and Leaf's yard is taken.
 */
function hang(hung: readonly Standing[]): void {
  if (!hear(S.world, hung)) giveWay();
}

/**
 * Hears Leaf's answer to a batch: each command in it is answered, and the copy is still Leaf's yard,
 * with the orders Leaf hung put on its board, or Leaf's is asked for. Leaf may have turned a command
 * down that the page had shown done.
 */
function heard({ done, short }: Answered<Sending, News, Heard>): void {
  const mine = unanswered.filter((sent) => done.some((d) => d.command === sent.command));
  unanswered = unanswered.filter((sent) => !mine.includes(sent));
  if (short) base = { clock: short.clock, at: performance.now() };
  const refused = done.some(({ answer }) => "refused" in answer);
  for (const { answer } of done) {
    if (!("refused" in answer)) continue;
    const why = answer.refused === "not_enough_coins" ? "Not enough Coins" : "That could not be done after all";
    for (const fn of refusalHearers) fn(why);
  }
  const last = mine.at(-1);
  if (taking === null && last) {
    // Leaf did just what the copy did, at the same tick: the checks are of the same moment.
    if (!short || refused || short.tick !== last.tick) giveWay();
    else if (short.check !== last.check) {
      found++;
      untold = short.tick;
      giveWay();
    } else hang(short.hung);
  }
  ask(performance.now());
}

/**
 * Does what the member did to the copy at once, with the shared rules, and sends it to Leaf with
 * the tick the copy stands at; whatever Coins it pays or takes show at once. The rules are asked
 * with the purse as it is at this moment, so that whatever costs more Coins than there are is
 * refused here, with their sentence, however long ago it was aimed: this is the one place a price
 * is judged before it is sent. The rules' refusal is given back, and nothing is sent. A yard the
 * page was handed by a review page of its own (`S.alone`) is done to in the same way, and sends nothing.
 */
export function doNow(act: Act): ReturnType<typeof play> {
  if (S.visiting) return { refused: "visiting", why: "This yard is somebody else's" };
  if (!leaf && !S.alone) return { refused: "closed", why: "The yard is not open" };
  if (taking !== null) return { refused: "catching_up", why: CATCHING_UP };
  const command: Command = { ...act, tick: S.world.tick };
  const done = play(S.world, command, balance().coins);
  if ("refused" in done) return done;
  if (!leaf) return done;
  const sending = writeCommand(command);
  if (act.do === "collect") collectedAt = performance.now();
  unanswered.push({ command: sending, tick: S.world.tick, check: check(S.world) });
  // What it pays or takes shows in the purse until Leaf answers, whose answer brings Leaf's word.
  void leaf.send(
    sending,
    undefined,
    (done.coins ?? []).reduce((sum, c) => sum + c.amount, 0),
  );
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
  // A tab put away and back is given Leaf's yard as Leaf has run it, not a long run on the page. It
  // is asked for, not collected, so that what Leaf says of the time away is still there to show.
  if (tick - w.tick > BEHIND_MOST) giveWay();
  // While Leaf's yard is being taken, the copy stands still and tells nothing.
  if (taking !== null) {
    ask(now);
    return [];
  }
  // A visit does what Leaf told it was done, each at its tick, on the way.
  if (S.visiting && !follow(w, tick)) {
    giveWay();
    return [];
  }
  stepTo(w, tick);
  shown = w.tick;
  // A yard standing still (its owner away eight hours) holds Leaf's clock with it from the frame it
  // stops in, as Leaf does, until they act.
  if (w.tick >= stillAt(w)) base = { clock: w.tick, at: now };
  // What these steps made known is taken before anything is sent: doing a command takes it too.
  const news = drain(w);
  const waiting = leaf.waiting();
  if (S.visiting) {
    if (!waiting && now - askedAt >= (live ? VISIT_EVERY.live : VISIT_EVERY.alone)) {
      askedAt = now;
      void leaf.refresh();
    }
    return news;
  }
  // A slot the board would have filled (a story order done) is filled by Leaf. And once a minute
  // the page collects whether or not the till holds a Coin: it keeps Leaf's yard in step with one
  // being watched, so that a yard earning nothing is not taken for one its owner left.
  const empty = w.open.board && w.board.length < w.open.hooks;
  // Not while a letter about a time away waits to be read: putting it away is what collects.
  if (!waiting && !w.away && (empty || now - collectedAt >= COLLECT_EVERY)) collect();
  return news;
}

/** How far into the next tick the copy is at `now`, from 0 to 1: for drawing things part-way across a tile. */
export const leadAt = (now: number): number =>
  Math.min(1, Math.max(0, base.clock + (now - base.at) / TICK_MS - S.world.tick));

/** Whether anything sent to Leaf has not been answered yet. */
export const waitingForLeaf = (): boolean => leaf?.waiting() ?? false;

/** Resolves once nothing the page handed the kit is on its way. */
async function drained(): Promise<void> {
  if (!leaf?.waiting()) return;
  await new Promise((resolve) => setTimeout(resolve, 10));
  await drained();
}

/**
 * Takes Leaf's yard: for when one was staged from outside. What is in flight is answered first, and
 * a read already on its way, which may have set off before the staging, lands; then the yard is read
 * again, and that read is the one taken.
 */
export async function again(): Promise<void> {
  giveWay();
  await drained();
  await leaf?.refresh(untold);
  giveWay();
  await leaf?.refresh(untold);
}

/** How many times the copy has been found not to be Leaf's yard since the page opened. */
export const differences = (): number => found;

/** How many times the copy has become Leaf's yard as read since the page opened, the opening included. */
export const yardReads = (): number => reads;

/** How a visit follows the yard: whether it hears Leaf live, how far behind it runs, the batches told and not done, and `followed`. */
export const visitFollowing = () => ({ live, hold, waiting: told.length, upTo, ...followed });

/** Sends nothing more and forgets the yard (for tests). */
export function letGo(): void {
  leaf = null;
  unanswered = [];
  taking = null;
  untold = undefined;
  found = 0;
  reads = 0;
  shown = 0;
  putAway = (): void => undefined;
  room?.close();
  room = null;
  live = false;
  told = [];
  upTo = 0;
  hold = 0;
  Object.assign(followed, { batches: 0, late: 0, unlike: 0 });
}
