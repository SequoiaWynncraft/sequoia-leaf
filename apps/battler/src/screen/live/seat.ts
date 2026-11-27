/**
 * The live table as the page draws it, for the member's seat (`seated.ts`, which holds the line and
 * where their commands go). While they are at it, the shared table (board, bench, stall, rack,
 * level, acorns) shows their seat's run as Leaf shows it, and what Leaf's clock does is acted out:
 * planning, the fight played from the seat's own side, what the room paid, the carousel, going out
 * and the end. Nothing happens on the page's say-so: the page reads the sitting at its deadlines and
 * shows what Leaf says.
 *
 * Stepping back to the front page keeps the sitting (its strip offers Carry on), and a member who
 * closed the page finds it there again when they come back.
 */
import { GOLD, LEAF } from "@sequoia-leaf/kit/palette.ts";
import { balance } from "@sequoia-leaf/kit/purse.ts";
import type { Scope } from "@sequoia-leaf/kit/scope.ts";
import { foughtOf, type RunView } from "@sequoia-leaf/raid";
import type { SittingView } from "@sequoia-leaf/raid/sitting/view.ts";

import { say } from "../fx.ts";
import { BOARD_W } from "../geometry.ts";
import { arrive, arrived } from "../scene.ts";
import { playbackOf, type Screen } from "../screen.ts";
import { ownFirst } from "../sides.ts";
import { snd } from "../sounds.ts";
import { changed, go, hold, onScreen, S } from "../state.ts";
import { toast } from "../ui/table.ts";
import { buildHud, forgetScout, markTable, renderClock, renderPlayers } from "./hud.ts";
import { buildPanels, hidePaper, paperUp, showEnd, showOut } from "./panels.ts";
import { paidLines } from "./reads.ts";
import { buildRing, renderRing } from "./ring.ts";
import {
  atLiveTable,
  doneWithTable,
  liveLine,
  liveView,
  mineOf,
  onDone,
  onLineGone,
  onSeatView,
  shownRun,
  sitAt,
  stepBack,
  takeFromRing,
} from "./seated.ts";

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
  asks: LiveAsks | null;
  /** The seat's run as it set out for the fight on screen: what the room paid is told against it. */
  before: RunView | null;
  /** The papers shown already at this sitting. */
  told: Set<"out" | "end">;
  /** The purse's Coins when the member sat down at the table, to tell what the purse took. */
  coinsAt: number | null;
} = { asks: null, before: null, told: new Set(), coinsAt: null };

/** Takes the figure at a place in the carousel's ring, its button showing Leaf is answering. */
async function take(offer: number): Promise<void> {
  const did = await takeFromRing(offer, document.querySelector(`#live-ring [data-ring="${offer}"]`));
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

/** The table at the stage the sitting stands at (`was`, where it stood): the fight played, or planning (with what the room paid, coming from a fight). */
function stageTable(view: SittingView, was: SittingView): void {
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
  if (view.stage.at === "plan" && (was.stage.at !== "plan" || was.room !== view.room) && !arrived(run)) arrive(run);
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
  const now = liveLine()?.now() ?? 0;
  renderClock(view, now);
  renderPlayers(view);
  renderRing(view, now, hold.asking());
  const mine = mineOf(view);
  markTable(
    view.stage.at === "over" ? "over" : mine?.place != null ? "out" : view.stage.at === "open" ? "plan" : view.stage.at,
  );
}

/** Heard each time the member's sitting changes (`was`, as it stood before). */
function heard(view: SittingView, was: SittingView): void {
  if (atLiveTable()) {
    if (!mineOf(view)) return stepBack();
    stageTable(view, was);
    renderLive(view);
    papers(view);
  } else if (was.stage.at === "open" && view.stage.at !== "open" && mineOf(view)) {
    // The table started (its opener, or the eighth to sit): the member is taken to it from the front page.
    if (L.asks?.frontUp()) enterTable();
    else toast("Your live table has started. Carry on from the front page.", "gold");
  } else L.asks?.redrawFront();
}

// ---------- coming and going ----------

/** Sits the member down at their live table, as it stands. */
export function enterTable(): void {
  const line = liveLine();
  if (!line || !sitAt()) return;
  L.coinsAt ??= balance().coins;
  L.asks?.closePages();
  go({ e: "sit", run: shownRun(line.view), runs: S.runs });
  renderLive(line.view);
  papers(line.view);
}

/** What is put away as the member steps back from the live table to the front page. */
function steppedAway(): void {
  ownFirst();
  markTable(null);
  hidePaper();
  forgetScout();
  const view = liveView();
  if (view) renderRing({ ...view, stage: { at: "over", ended: 0 } }, 0, false);
}

/** Builds what a live table adds round the table, and keeps it in step. */
export function openLive(scope: Scope, asks: LiveAsks): void {
  L.asks = asks;
  buildHud();
  buildRing((offer) => void take(offer));
  buildPanels({
    watch: () => {
      hidePaper();
      snd.close();
      const view = liveView();
      if (view) papers(view);
    },
    done: () => doneWithTable(),
  });
  onSeatView(heard);
  onLineGone((why) => toast(why === "signedout" ? "You are signed out." : "That table is gone."));
  onDone(() => {
    L.told = new Set();
    L.coinsAt = null;
    L.before = null;
  });
  onScreen((before, now) => {
    if (now.at === "front" && before.at !== "front") steppedAway();
  });
  // The clock and the carousel's turn count down between Leaf's answers.
  scope.every(250, () => {
    const view = liveView();
    const now = liveLine()?.now() ?? 0;
    if (!view || !atLiveTable()) return;
    renderClock(view, now);
    renderRing(view, now, hold.asking());
  });
}
