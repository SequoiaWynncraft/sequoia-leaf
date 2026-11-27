/**
 * The member at a live table: the line to their sitting (`line.ts`), and the table the page shows
 * for it. While they are at it, the shared table (board, bench, stall, rack, level, acorns) is
 * driven by their seat's run as Leaf shows it, their commands go to the sitting (`LIVE` in
 * `state.ts`), and what Leaf's clock does is acted out: planning, the fight played from the seat's
 * own side, what the room paid, the carousel, going out and the end. Nothing happens on the page's
 * say-so: the page reads the sitting at its deadlines and shows what Leaf says.
 *
 * Stepping back to the front page keeps the sitting (its strip offers Carry on), and a member who
 * closed the page finds it there again when they come back.
 */
import { GOLD, LEAF } from "@sequoia-leaf/kit/palette.ts";
import { waitingLook } from "@sequoia-leaf/kit/play.ts";
import { balance } from "@sequoia-leaf/kit/purse.ts";
import type { Scope } from "@sequoia-leaf/kit/scope.ts";
import { foughtOf, type RunView } from "@sequoia-leaf/raid";
import { isSeatCommand, type SittingCommand } from "@sequoia-leaf/raid/sitting/commands.ts";
import { sideOf } from "@sequoia-leaf/raid/sitting/sitting.ts";
import { predict, type SittingView } from "@sequoia-leaf/raid/sitting/view.ts";

import { say } from "../fx.ts";
import { BOARD_W } from "../geometry.ts";
import { arrive, arrived } from "../scene.ts";
import { playbackOf, type Screen } from "../screen.ts";
import { OWN, ownFirst } from "../sides.ts";
import { snd } from "../sounds.ts";
import { changed, type Did, go, heldOff, hold, LIVE, onScreen, refuse, S, type Seated, tellNotes } from "../state.ts";
import { toast } from "../ui/table.ts";
import { buildHud, forgetScout, renderClock, renderPlayers } from "./hud.ts";
import type { Answer, Line } from "./line.ts";
import { buildPanels, hidePaper, paperUp, showEnd, showOut } from "./panels.ts";
import { paidLines, refusalWords } from "./reads.ts";
import { buildRing, renderRing } from "./ring.ts";

/** What a live table asks of the rest of the page. */
export interface LiveAsks {
  /** Puts the pages over the table away (the front page), for the table. */
  closePages: () => void;
  /** Draws the front page again, if it is up. */
  redrawFront: () => void;
  /** Whether the front page is up. */
  frontUp: () => boolean;
}

const L: {
  scope: Scope | null;
  asks: LiveAsks | null;
  line: Line | null;
  /** The seat's run as it set out for the fight on screen: what the room paid is told against it. */
  before: RunView | null;
  /** Where the sitting stood when last heard, to tell a change. */
  stage: SittingView["stage"]["at"] | null;
  room: number;
  /** The papers shown already at this sitting, and whether the member stays to watch. */
  told: Set<"out" | "end">;
  /** The purse's Coins when the member sat down at the table, to tell what the purse took. */
  coinsAt: number | null;
} = { scope: null, asks: null, line: null, before: null, stage: null, room: -1, told: new Set(), coinsAt: null };

/** The line to the member's sitting, if they are at one. */
export const liveLine = (): Line | null => L.line;
/** The sitting as the page has it, if the member is at one. */
export const liveView = (): SittingView | null => L.line?.view ?? null;
/** Whether the member is looking at their live table. */
export const atLiveTable = (): boolean => LIVE.seat === SEAT;

/** The member's seat at a sitting, if they have one. */
const mineOf = (view: SittingView) => (view.you === null ? null : (view.seats[view.you] ?? null));

/**
 * The run the shared table is shown: the seat's own, but with no pick up while the carousel stands
 * (the first figure is taken from the ring), and, for a seat that is out or a table that is over, at
 * planning with nothing to pick, so that its board stays on the table to watch from.
 */
function shownRun(view: SittingView): RunView | null {
  const run = view.run;
  if (!run) return null;
  if (mineOf(view)?.place != null || run.stage.phase === "over") return { ...run, stage: { phase: "plan", picks: [] } };
  // The ring stands alone on the far half: whoever waits in the next room comes after it.
  if (view.stage.at === "carousel" && run.stage.phase === "plan")
    return { ...run, stage: { phase: "plan", picks: [] }, foe: { ...run.foe, who: "", figures: [] } };
  return run;
}

/** A refusal in words: Leaf's own sentence, or the rules' for the code. */
const words = (a: { refused: string; why?: string }): string => refusalWords(a.refused, a.why);

const SEAT: Seated = {
  run: () => (L.line ? shownRun(L.line.view) : null),
  table: () => ({ run: L.line ? shownRun(L.line.view) : null, runs: S.runs }),
  doNow(command) {
    const line = L.line;
    if (!line || heldOff(command) || !isSeatCommand(command)) return null;
    const guess = predict(line.view, command);
    if (!guess) return null;
    if ("refused" in guess) {
      const why = words(guess);
      refuse(why);
      return { ok: false, why };
    }
    void sent(line, command);
    S.run = shownRun(line.view);
    tellNotes(guess.notes);
    changed();
    return { ok: true, notes: guess.notes };
  },
  ask(command, waiting) {
    if (heldOff(command)) return Promise.resolve(null);
    if (isSeatCommand(command)) return asked(command, waiting);
    const why = "At a live table the clock sets out.";
    refuse(why);
    return Promise.resolve({ ok: false, why });
  },
};

/** Sends a command shown already; should Leaf turn it down, its view is already the page's, and the member hears why. */
async function sent(line: Line, command: SittingCommand): Promise<void> {
  const answer = await line.send(command, (view) => {
    const redone = predict(view, command);
    return redone && "view" in redone ? redone.view : view;
  });
  if ("refused" in answer) refuse(words(answer));
}

/** Sends a command only Leaf can answer, holding the table until it does. */
async function asked(command: SittingCommand, waiting: Element | null): Promise<Did | null> {
  const line = L.line;
  if (!line) return null;
  const answer: Answer = await hold.until(false, waitingLook(waiting, line.send(command)));
  S.run = shownRun(line.view);
  if ("refused" in answer) {
    const why = words(answer);
    refuse(why);
    changed();
    return { ok: false, why };
  }
  tellNotes(answer.notes);
  changed();
  return { ok: true, notes: answer.notes };
}

/** Takes the figure at a place in the carousel's ring. */
export async function takeFromRing(offer: number): Promise<void> {
  if (hold.asking()) return;
  const did = await asked({ do: "pick", offer }, document.querySelector(`#live-ring [data-ring="${offer}"]`));
  if (did?.ok) snd.tap();
}

// ---------- what Leaf's clock did, acted out ----------

/** Where what a room paid is said: the middle of the member's own half, clear of the ring on the far half. */
const MIDDLE = { x: BOARD_W / 2, y: 84 };

/** What the room paid, over the board, as the table goes on from a fight. */
function sayPaid(view: SittingView): void {
  const before = L.before;
  const after = view.run;
  L.before = null;
  if (!before || !after) return;
  const result = foughtOf(before)?.outcome.result ?? null;
  const [head, ...rest] = paidLines(result, before, after);
  if (head) say(MIDDLE.x, MIDDLE.y - 6, head, result === "win" ? GOLD[2] : "#e67967", { big: true, ttl: 2 });
  rest.forEach((line, i) => say(MIDDLE.x, MIDDLE.y + 14 + i * 12, line, LEAF, { ttl: 2.2 }));
  if (result === "win") snd.win();
  else if (result === "loss") snd.loss();
  else if (result === "draw") snd.draw();
}

/** Whether the screen is playing a fight (or showing its end), by its key. */
const playingNow = (screen: Screen, key: string): boolean =>
  (screen.at === "fight" || screen.at === "after") && screen.play.key === key;

/** The table at the stage the sitting stands at: the fight played, or planning (with what the room paid, coming from a fight). */
function stageTable(view: SittingView): void {
  const mine = mineOf(view);
  const run = shownRun(view);
  if (!mine || !run) return;
  const fought = view.stage.at === "fight" && mine.place === null && view.run ? foughtOf(view.run) : null;
  if (view.run && fought) {
    if (playingNow(S.screen, playbackOf(view.run, fought, S.runs).key)) return;
    L.before = view.run;
    return go({ e: "sit", run, runs: S.runs });
  }
  if (S.screen.at === "fight" || S.screen.at === "after") {
    sayPaid(view);
    return go({ e: "sit", run, runs: S.runs });
  }
  S.run = run;
  // Planning after a carousel: whoever is in the room walks in, as after a fight.
  if (view.stage.at === "plan" && (L.stage !== "plan" || L.room !== view.room) && !arrived(run)) arrive(run);
  changed();
}

/** The member's papers: going out, once, and the end, once. */
function papers(view: SittingView): void {
  const mine = mineOf(view);
  if (!mine) return;
  const gained = L.coinsAt === null ? null : balance().coins - L.coinsAt;
  // Out before the end (whoever won never went out): the place first, and the end after it.
  if (mine.place !== null && mine.place !== 1 && !L.told.has("out")) {
    L.told.add("out");
    showOut(view, gained);
  } else if (view.stage.at === "over" && !L.told.has("end") && paperUp() !== "out") {
    L.told.add("end");
    showEnd(view, gained);
  }
}

/** Draws what the live table adds, for the sitting as it stands now. */
function renderLive(view: SittingView): void {
  const now = L.line?.now() ?? 0;
  renderClock(view, now);
  renderPlayers(view);
  renderRing(view, now, hold.asking());
  const mine = mineOf(view);
  document.body.dataset.live =
    view.stage.at === "over" ? "over" : mine?.place != null ? "out" : view.stage.at === "open" ? "plan" : view.stage.at;
}

/** Heard each time the sitting changes. */
function heard(view: SittingView): void {
  const was = L.stage;
  if (atLiveTable()) {
    if (!mineOf(view)) {
      stepBack();
      return;
    }
    stageTable(view);
    renderLive(view);
    papers(view);
  } else if (was === "open" && view.stage.at !== "open" && mineOf(view)) {
    // The table started (its opener, or the eighth to sit): the member is taken to it from the front page.
    if (L.asks?.frontUp()) enterTable();
    else toast("Your live table has started. Carry on from the front page.", "gold");
  } else L.asks?.redrawFront();
  L.stage = view.stage.at;
  L.room = view.room;
}

// ---------- coming and going ----------

/** Sits the member down at their live table, as it stands. */
export function enterTable(): void {
  const line = L.line;
  const mine = line ? mineOf(line.view) : null;
  if (!line || !mine) return;
  L.coinsAt ??= balance().coins;
  OWN.side = (setup) => sideOf(setup, mine.who);
  LIVE.seat = SEAT;
  L.asks?.closePages();
  const run = shownRun(line.view);
  go({ e: "sit", run, runs: S.runs });
  renderLive(line.view);
  papers(line.view);
  L.stage = line.view.stage.at;
  L.room = line.view.room;
}

/** What is put away as the member steps back from the live table to the front page. */
function steppedAway(): void {
  ownFirst();
  delete document.body.dataset.live;
  hidePaper();
  forgetScout();
  if (L.line) renderRing({ ...L.line.view, stage: { at: "over", ended: 0 } }, 0, false);
}

/** Back to the front page from the live table (from wherever the screen is: a fight's end too). */
export function stepBack(): void {
  if (!atLiveTable()) return;
  go({ e: "sit", run: null, runs: S.runs });
}

/** Who hears that the member is done with a sitting (the front page reads their record again). */
const doneHearers: (() => void)[] = [];
export const onDone = (fn: () => void): void => void doneHearers.push(fn);

/** Done with the sitting: its line is put away, and the member is at the front page. */
export function doneWithTable(): void {
  for (const fn of doneHearers) fn();
  stepBack();
  L.line?.close();
  L.line = null;
  L.told = new Set();
  L.coinsAt = null;
  L.stage = null;
  L.asks?.redrawFront();
}

/** Takes up a sitting Leaf has shown the page (`first`, its answer), as the member's. */
export function takeUp(line: Line): void {
  L.line?.close();
  L.line = line;
  L.told = new Set();
  L.coinsAt = null;
  L.stage = line.view.stage.at;
  L.room = line.view.room;
  line.onView(heard);
  line.onGone((why) => {
    if (L.line !== line) return;
    toast(why === "signedout" ? "You are signed out." : "That table is gone.");
    doneWithTable();
  });
}

/** Builds what a live table adds round the table, and keeps it in step. */
export function openLive(scope: Scope, asks: LiveAsks): void {
  L.scope = scope;
  L.asks = asks;
  buildHud();
  buildRing((offer) => void takeFromRing(offer));
  buildPanels({
    watch: () => {
      hidePaper();
      snd.close();
      const view = liveView();
      if (view) papers(view);
    },
    done: doneWithTable,
  });
  onScreen((before, now) => {
    if (now.at === "front" && before.at !== "front") steppedAway();
  });
  // The clock and the carousel's turn count down between Leaf's answers.
  scope.every(250, () => {
    const view = liveView();
    if (view && atLiveTable()) {
      renderClock(view, L.line?.now() ?? 0);
      renderRing(view, L.line?.now() ?? 0, hold.asking());
    }
  });
}
