/**
 * The live table as the page draws it, for the member's seat (`seated.ts`, which holds the line and
 * where their commands go). While they are at it, the shared table (board, bench, stall, rack,
 * level, acorns) shows their seat's run as Leaf shows it, and what Leaf's clock does is acted out:
 * planning (and Ready), the fight played from the seat's own side (said watched when it has been, or
 * skipped), what the room paid, the carousel, going out and the end. The page reads the sitting at
 * its deadlines and when Leaf says it moved on, and shows what Leaf says; the member's own moves are
 * shown at once, as Leaf will do them.
 *
 * Stepping back to the front page keeps the sitting (its strip offers Carry on), and a member who
 * closed the page finds it there again when they come back.
 */
import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import { GOLD, LEAF } from "@sequoia-leaf/kit/palette.ts";
import { balance } from "@sequoia-leaf/kit/purse.ts";
import type { Scope } from "@sequoia-leaf/kit/scope.ts";
import { foughtOf } from "@sequoia-leaf/raid";
import type { SittingView } from "@sequoia-leaf/raid/sitting/view.ts";

import { glyph } from "../art/icons.ts";
import { say } from "../fx.ts";
import { BOARD_W } from "../geometry.ts";
import { arrive, arrived } from "../scene.ts";
import { playbackOf, type Screen } from "../screen.ts";
import { ownFirst } from "../sides.ts";
import { snd } from "../sounds.ts";
import { changed, go, onScreen, S } from "../state.ts";
import { pic } from "../ui/cards.ts";
import { toast } from "../ui/table.ts";
import { buildHud, forgetScout, markTable, renderClock, renderPlayers } from "./hud.ts";
import { buildPanels, hidePaper, paperUp, showEnd, showOut } from "./panels.ts";
import { turnOf } from "./reads.ts";
import { buildRing, hideRing, ringHeard, ringMiddle } from "./ring.ts";
import {
  atLiveTable,
  doneWithTable,
  fightBegins,
  liveLine,
  liveView,
  mineOf,
  onDone,
  onLineGone,
  onSeatView,
  paidFor,
  readyUp,
  shownRun,
  sitAt,
  stepBack,
  takeFromRing,
  watchedFight,
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
  /** The papers shown already at this sitting. */
  told: Set<"out" | "end">;
  /** The purse's Coins when the member sat down at the table, to tell what the purse took. */
  coinsAt: number | null;
  /** Whether it was the member's turn at the carousel when last looked, to say so as it becomes it. */
  choosing: boolean;
  ready: HTMLButtonElement | null;
} = { asks: null, told: new Set(), coinsAt: null, choosing: false, ready: null };

/** Takes the figure at a place in the carousel's ring: at once, as Leaf will. */
function take(offer: number): void {
  if (takeFromRing(offer)?.ok) snd.tap();
}

/** Ready, beside the stall where Set out is at the solo table: pressed again, not ready after all. */
function buildReady(): void {
  const button = el(
    "button",
    "k-btn",
    {
      id: "live-ready",
      type: "button",
      "aria-pressed": "false",
      onclick: () => {
        if (readyUp(button.getAttribute("aria-pressed") !== "true")?.ok) snd.tap();
      },
    },
    pic(glyph("swords")),
    "Ready",
  );
  document.getElementById("plan")?.append(button);
  L.ready = button;
}
/** Ready shows whether the member said so; it is there while they plan. */
function renderReady(view: SittingView): void {
  const button = L.ready;
  if (!button) return;
  const you = view.you;
  const on = view.stage.at === "plan" && you !== null && view.stage.ready.includes(you);
  if (button.getAttribute("aria-pressed") === String(on)) return;
  button.setAttribute("aria-pressed", String(on));
  button.classList.toggle("down", on);
  // Pressed, it sinks and is ticked.
  button.replaceChildren(on ? icon("check") : pic(glyph("swords")), "Ready");
}

/** As it becomes the member's turn at the carousel, the table says so. */
function sayTurn(view: SittingView, now: number): void {
  const choosing = turnOf(view, now).at === "choosing";
  if (choosing && !L.choosing) {
    // In the ring's empty middle, clear of what the last room paid on the member's own half.
    const at = ringMiddle();
    say(at.x, at.y, "Your turn", GOLD[2], { big: true, ttl: 1.6 });
    snd.choose();
  }
  L.choosing = choosing;
}

// ---------- what Leaf's clock did, acted out ----------

/** Where what a room paid is said: the middle of the member's own half, clear of the ring on the far half. */
const MIDDLE = { x: BOARD_W / 2, y: 84 };

/** What the room paid, over the board, as the table goes on from a fight. */
function sayPaid(view: SittingView): void {
  const paid = paidFor(view);
  if (!paid) return;
  const { result } = paid;
  const [head, ...rest] = paid.lines;
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
    fightBegins(view);
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

/** Draws what the live table adds, for the sitting as it stands now (`was`, as it stood: what the ring has seen taken since). */
function renderLive(view: SittingView, was: SittingView | null): void {
  const now = liveLine()?.now() ?? 0;
  renderClock(view, now);
  renderPlayers(view);
  ringHeard(view, was);
  renderReady(view);
  sayTurn(view, now);
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
    renderLive(view, was);
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
  renderLive(line.view, null);
  papers(line.view);
}

/** What is put away as the member steps back from the live table to the front page. */
function steppedAway(): void {
  ownFirst();
  markTable(null);
  hidePaper();
  forgetScout();
  hideRing();
  L.choosing = false;
}

/** Builds what a live table adds round the table, and keeps it in step. */
export function openLive(scope: Scope, asks: LiveAsks): void {
  L.asks = asks;
  buildHud();
  buildReady();
  buildRing({
    take,
    view: liveView,
    now: () => liveLine()?.now() ?? 0,
    up: atLiveTable,
  });
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
  });
  onScreen((before, now) => {
    if (now.at === "front" && before.at !== "front") steppedAway();
    // The member's fight has been played to its end, or skipped to it: Leaf hears they are done with it.
    if (atLiveTable() && before.at === "fight" && now.at === "after") watchedFight();
  });
  // The clock and the carousel's turn count down between Leaf's answers.
  scope.every(250, () => {
    const view = liveView();
    const now = liveLine()?.now() ?? 0;
    if (!view || !atLiveTable()) return;
    renderClock(view, now);
    sayTurn(view, now);
  });
}
