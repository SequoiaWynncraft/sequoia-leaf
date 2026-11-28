/**
 * The Works: the yard behind the guild's workshop, where gatherers, belts and machines turn what
 * lies on the forest floor into what the guild has asked for.
 *
 * This file is the stage: it opens the yard, owns the canvas and the loop, and joins the parts
 * together. The rules are `@sequoia-leaf/factory`, the picture in `scene.ts` and `art/`, what the
 * member does in `tools.ts` and `input.ts`, and everything that sits over the yard in `ui/`.
 *
 * Opened with `?of=<player>`, it is a visit to that player's yard (`S.visiting`): the same yard,
 * with nothing to act with, no lessons or letters, and nothing told to the town. Opened by a review
 * page with a yard of its own (`S.alone`, `review/bench.ts`), it opens nothing from Leaf.
 *
 * A review page works it from outside through its `Page` (`review/handles.ts` puts `window.works`
 * on it); nothing here reaches `review/`.
 */

import { ALL_ITEMS, ITEM_INFO, power } from "@sequoia-leaf/factory";
import { callLine, openLeaf } from "@sequoia-leaf/kit/call.ts";
import { unit } from "@sequoia-leaf/kit/dom.ts";
import { keepLeaf, pageCard, serverCard, shutCard, troubleCard } from "@sequoia-leaf/kit/live.ts";
import { paced } from "@sequoia-leaf/kit/pace.ts";
import { askPerson } from "@sequoia-leaf/kit/person.ts";
import type { Trouble } from "@sequoia-leaf/kit/play.ts";
import { here } from "@sequoia-leaf/kit/presence.ts";
import { failedToOpen } from "@sequoia-leaf/kit/report.ts";
import { scope } from "@sequoia-leaf/kit/scope.ts";
import { fromTown, tell } from "@sequoia-leaf/kit/shell.ts";
import { fontsReady } from "@sequoia-leaf/kit/text.ts";
import { must, type Pt } from "@sequoia-leaf/kit/util.ts";

import { stepFlights, stepWalkers } from "./actors.ts";
import { noteArrivals } from "./arrivals.ts";
import { TILE } from "./art/belts.ts";
import { makeArt } from "./art/index.ts";
import { ease, inset, inView, look, pan, resize, setCamera, setZoom, zoomSteps } from "./camera.ts";
import { callers, capstones, handOver, onNews } from "./events.ts";
import { arrive } from "./figure/you.ts";
import { updateFx } from "./fx.ts";
import { initInput, inputHooks, stepInput } from "./input.ts";
import { stepClearing } from "./plots.ts";
import { drawWords, drawYard, lap, openPicture, picture, spent, wipe } from "./scene.ts";
import { murmur, yardSfx } from "./sound.ts";
import { builds, S } from "./state.ts";
import { NO_LESSONS, type Nudge, stepLessons } from "./teach.ts";
import { cancel, keepAim } from "./tools.ts";
import { initBoard } from "./ui/board.ts";
import { followCards, initCard, refreshCard } from "./ui/card.ts";
import { initDock, refreshDock } from "./ui/dock.ts";
import { initHud, myYard, refreshHud } from "./ui/hud.ts";
import { letters } from "./ui/letter.ts";
import { feed, initNotes, tickNotes } from "./ui/notes.ts";
import { initPanels, panelHooks, refreshPanel } from "./ui/panels.ts";
import { $ } from "./ui/parts.ts";
import { startSettings } from "./ui/settings.ts";
import { viewHooks } from "./ui/views.ts";
import { gate, keepScreen, leadAt, onRefused, openYard, runYard, screen } from "./yard.ts";

/** What the page says where no Leaf answers: the yard is the guild's server's. */
const NEEDS_LEAF = "The Works needs the guild's server.";
/** What the page says in the yard's place where the browser cannot draw it. */
const NEEDS_WEBGL = "This browser cannot draw the yard. It needs WebGL 2.";

function refreshAll(): void {
  // What is aimed is said over the dock: of the yard as it is.
  keepAim();
  refreshHud();
  refreshDock();
  refreshPanel();
  refreshCard();
}

/** The parts whose size `measure` reads: it reads them again whenever one of them changes size. */
const MEASURED = ["top", "side", "books", "dock", "hand", "track", "visit", "study", "walk"] as const;

/**
 * How much of the screen the interface covers, so the camera can keep the yard clear of it. Each
 * part is read only once what places it has been written: the order in hand hangs from the top bar
 * (`--toph`), or folded on a phone is in it; the research hangs from the order (`--trackb`), the line
 * over the dock from the dock. A part that only moves changes no size, and no observer would measure
 * it again.
 */
function measure(): void {
  const root = document.documentElement.style;
  const top = $("top").getBoundingClientRect();
  root.setProperty("--toph", `${Math.round(top.bottom)}px`);
  // How far the side column reaches in from the screen's right edge, in one column or two: on an
  // upright phone the way out, the gear and the books (`#side`), on a phone on its side the books
  // alone, whichever stands fixed down the side. What stands beside it keeps clear of it.
  const column = [$("side"), $("books")].find((e) => getComputedStyle(e).position === "fixed") ?? $("books");
  root.setProperty("--sidew", `${Math.round(window.innerWidth - column.getBoundingClientRect().left)}px`);
  const dock = $("dock").getBoundingClientRect();
  root.setProperty("--dockh", `${Math.round(dock.height)}px`);
  // The line over the dock is as wide as it: unrounded, so that their edges meet.
  root.setProperty("--dockw", `${dock.width}px`);
  // Under the top bar: the order in hand, or in a visit whose yard it is.
  const track = $(S.visiting ? "visit" : "track").getBoundingClientRect();
  root.setProperty("--trackb", `${Math.round(track.bottom)}px`);
  // The research being studied hangs under the order in hand, when it is there.
  const study = $("study").hidden ? track : $("study").getBoundingClientRect();
  const hand = $("hand").getBoundingClientRect();
  root.setProperty("--handh", `${Math.round(hand.height)}px`);
  root.setProperty("--handt", `${Math.round(hand.top)}px`);
  // A finger's card stops above the line over the dock (or the dock, in a visit), and on a phone below
  // what hangs under the top bar: the order in hand, the research, a walk's bar (`index.html`).
  const floor = hand.height > 0 ? hand.top : dock.height > 0 ? dock.top : window.innerHeight;
  root.setProperty("--sheet-floor", `${Math.round(window.innerHeight - floor)}px`);
  const walk = $("walk").getBoundingClientRect();
  root.setProperty("--sheet-top", `${Math.round(Math.max(top.bottom, track.bottom, study.bottom, walk.bottom))}px`);
  // On a narrow screen the order in hand runs the width of it, and the yard is clear only below.
  inset.top = track.width > window.innerWidth * 0.6 ? Math.max(top.bottom, track.bottom, study.bottom) : top.bottom;
  // A visit has nothing along the bottom.
  inset.bottom = S.visiting ? 0 : Math.max(0, window.innerHeight - hand.top);
}

/**
 * Says a nudge beside the part of the interface it is about (a book's button, the grades over the
 * toolbar, a tool's slot), its tail on that part; or puts it away, where the nudge is about a tile
 * of the yard or the part is not on the page just now.
 */
function coach(n: Nudge | null): void {
  const box = $("coach");
  const part = n?.part;
  const at =
    part === "tier" || part === "research"
      ? document.querySelector(`#books [data-book="${part}"]`)
      : part === "grades"
        ? document.querySelector("#hand .grades")
        : part === "tool" && n && typeof n.tool === "number"
          ? document.querySelector(`#dock [data-tool="${n.tool}"]`)
          : part === "ways"
            ? document.querySelector(".k-info .ways")
            : null;
  if (!n || !(at instanceof HTMLElement) || at.hidden || S.panel !== null) {
    box.hidden = true;
    return;
  }
  if (box.textContent !== n.text) box.textContent = n.text;
  box.hidden = false;
  const r = at.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  // Under what is at the top of the page, over what is at the bottom; over a card's ways, whose buttons are under them.
  const below = part !== "ways" && r.top < window.innerHeight / 2;
  const x = Math.round(Math.min(Math.max(8, r.left + r.width / 2 - b.width / 2), window.innerWidth - b.width - 8));
  const y = Math.round(below ? r.bottom + 10 : r.top - b.height - 10);
  box.classList.toggle("below", below);
  box.classList.toggle("on-card", part === "ways");
  box.style.transform = `translate(${x}px, ${y}px)`;
  box.style.setProperty("--tail", `${Math.round(r.left + r.width / 2 - x - 6)}px`);
}

/** The middle of the depot, in the yard's pixels: where the camera starts. */
const home = (): Pt => ({ x: S.world.land.depot[0] * TILE + 8, y: S.world.land.depot[1] * TILE + 8 });

/** Keeps how the member had the screen. */
const keepSettings = (): void => {
  screen.zoom = zoomSteps();
  keepScreen();
};

/** The card for why the yard cannot go on; for nothing to visit, with the way to the member's own yard. */
function card(why: Trouble): void {
  if (why === "nothing") pageCard("No yard to visit", "They have not started one yet.", "My yard", myYard);
  else troubleCard(why);
}

/**
 * Who the member is (their id and name), once the yard is open from Leaf; or nothing, with the card
 * that says why it is not. In a Discord call, the page's line says where the member is.
 */
async function opened(params: URLSearchParams): Promise<{ id: string; name: string } | null> {
  const where = await openLeaf("works");
  if (where === null) return null;
  if (where.mode === "shut") {
    shutCard(where.why);
    return null;
  }
  if (where.mode !== "live") {
    serverCard(NEEDS_LEAF);
    return null;
  }
  const { me } = where;
  const of = params.get("of");
  if (of !== null && of !== me.id) S.visiting = { id: of, name: "Someone" };
  document.body.classList.toggle("visiting", S.visiting !== null);
  // In a visit, the owner's name is asked of Leaf meanwhile.
  const [trouble, owner] = await Promise.all([openYard(me.id, card), S.visiting && askPerson(S.visiting.id)]);
  if (trouble) {
    failedToOpen(trouble);
    card(trouble);
    return null;
  }
  if (S.visiting && owner) S.visiting.name = owner.name;
  callLine(scope(), () => "In the Works");
  return me;
}

/** Says in the yard's place that the browser cannot draw it: the page does not open, or (its graphics card back and refusing to draw) draws no more. */
function cannotDraw(): null {
  const line = document.body.appendChild(document.createElement("p"));
  line.id = "nodraw";
  line.className = "k-plaque";
  line.textContent = NEEDS_WEBGL;
  return null;
}

async function boot(): Promise<Page | null> {
  await fontsReady();
  const params = new URLSearchParams(location.search);
  // Who the member is, and then the yard as Leaf has it. Without Leaf there is no yard, unless a
  // review page handed one in.
  const me = S.alone ? { id: "", name: "" } : await opened(params);
  if (!me) return null;
  const art = makeArt(S.world.land);

  // The yard's picture, shown small and enlarged by the page; over it, the words, which also take every press.
  if (!openPicture(scope(), cannotDraw)) return cannotDraw();
  document.body.prepend(picture);
  const canvas = must(document.querySelector<HTMLCanvasElement>("#words"), "canvas");
  const ctx = must(canvas.getContext("2d"), "2d context");
  canvas.addEventListener("contextrestored", wipe);
  let wordPx = 2;

  // While Leaf's yard is being what is under way is put away and no press or key goes on.
  gate(cancel);
  initNotes();
  initPanels(art);
  initBoard(me.id);
  initCard(art);
  initHud(startSettings(scope(), refreshAll).gear());
  initDock(art);
  initInput(canvas);
  panelHooks.handOver = (order): void => {
    handOver(order);
    refreshAll();
  };
  panelHooks.changed = refreshAll;
  inputHooks.caller = (order): void => {
    handOver(order);
    refreshAll();
  };
  const letter = letters(scope());
  inputHooks.letter = () => letter.putAway();
  // The yard's sheet goes to a place at once, so that a card can sit beside the piece there.
  viewHooks.look = (x, y): void => look(x, y, true);
  followCards(pan);

  function fit(): void {
    measure();
    resize();
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(window.innerWidth * dpr));
    const ch = Math.max(1, Math.round(window.innerHeight * dpr));
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    // The usual text size; on a sharp screen, the size the kit gives second lines.
    wordPx = Math.max(1, Math.round(unit() * dpr * (dpr >= 2 ? 0.75 : 1)));
  }

  setCamera(picture, art.ground);
  setZoom(screen.zoom);
  fit();
  // The dock's height is only known once it has been laid out with its tools in it.
  measure();
  if (!arrive(me, art.ground)) look(home().x, home().y, true);
  const held = scope();
  held.on(window, "resize", fit);
  // The dock grows a row when the story opens more tools than fit: everything over it moves up.
  for (const id of MEASURED) held.observe($(id), "size", measure);

  // ---------- the clock ----------

  onRefused((why) => feed(`${why}. The yard is shown as the server has it.`, "coral"));

  /** What the depot had taken in a moment ago, to hear each thing arrive. */
  let heard = Float64Array.from(S.world.depot);
  let arriveAt = 0;
  function arrivals(): void {
    const w = S.world;
    for (const k of ALL_ITEMS) {
      const n = w.depot[k] ?? 0;
      if (n > (heard[k] ?? 0) && S.t > arriveAt) {
        arriveAt = S.t + 0.11;
        yardSfx.arrive(ITEM_INFO[k]?.step ?? 0);
      }
      heard[k] = n;
    }
  }

  /** When the lessons were last moved on, and where they stand (`teach.ts`). */
  let nudgeAt = 0;
  let lessons = NO_LESSONS;
  function nudges(): void {
    if (S.t < nudgeAt) return;
    nudgeAt = S.t + 0.4;
    const step = stepLessons(lessons, S.world, new Set(screen.taught), {
      t: S.t,
      hidden: letter.reading() || S.visiting !== null,
      finger: S.finger,
      looking: { picked: S.picked, hand: builds(S.tool) ? S.tool : null },
    });
    lessons = step.lessons;
    screen.taught.push(...step.taken);
    const n = step.show;
    S.nudge = n;
    // The first lessons bring the place they are about into view.
    if (n && step.fresh && n.lasting && S.world.done.length === 0 && !inView(n.x * TILE + 8, n.y * TILE + 8))
      look(n.x * TILE + 8, n.y * TILE - 8);
    // About a part of the interface, it is said beside that part; about a tile, over the tile.
    coach(n?.part === undefined ? null : n);
  }

  let slow = 0;
  /** How far into its next tick a yard held still is shown. */
  let heldLead = 0;
  /** A moment of the screen: `now`, the page's clock, runs the yard on to Leaf's tick; without it only the screen moves. */
  function advance(dt: number, now: number | null): void {
    S.t += dt;
    if (now !== null) {
      const news = runYard(now);
      // What reached the depot is counted from its books, a row each second of the yard's clock.
      noteArrivals(S.world);
      // Leaf worked the yard on while nobody watched: its letter says what it did, to its owner.
      if (S.world.away && !letter.reading() && !S.visiting) letter.show(S.world.away, refreshAll);
      // What a visited yard does is its owner's news: the visitor's purse and town are not told.
      if (news.length > 0 && !S.visiting) {
        onNews(news);
        refreshAll();
      }
    }
    stepWalkers(dt);
    stepFlights(dt);
    updateFx(dt);
    stepClearing();
    ease(dt);
    stepInput(dt);
    arrivals();
    nudges();
    tickNotes(dt);
    const p = power(S.world);
    murmur(S.t, Math.min(1, p.demand / 45) * p.pace);
    slow -= dt;
    if (slow > 0) return;
    slow = 0.25;
    if (!S.visiting) capstones();
    callers();
    refreshAll();
  }

  function draw(now: number): void {
    // A window carried to a screen with another pixel ratio is not always told it was resized.
    if ((window.devicePixelRatio || 1) !== S.view.dpr) fit();
    // What is aimed is drawn of the yard as it is: worked out again if the yard or the purse has changed under it.
    keepAim();
    const w = S.world;
    drawYard(art, { lead: S.held ? heldLead : leadAt(now), pace: power(w).pace });
    drawWords(ctx, wordPx, inset.top * S.view.dpr);
    lap("words");
  }

  // With `?meter` in the address, a corner says how the screen is keeping up: the frames a second
  // it reaches, the longest of the last second, and the milliseconds of a frame's work by part
  // (`until free` is how long after the frame's work the page next gets a turn: the browser's own
  // work on the frame, and anything else it had waiting).
  const meter = params.has("meter") ? document.body.appendChild(document.createElement("pre")) : null;
  const after = meter ? new MessageChannel() : null;
  if (meter && after) {
    meter.id = "meter";
    meter.className = "k-plaque k-s";
    spent.on = true;
    after.port1.addEventListener("message", () => lap("until free"));
    after.port1.start();
  }
  let metered = { at: performance.now(), frames: 0, longest: 0, last: performance.now() };
  function count(now: number): void {
    if (!meter || !after) return;
    after.port2.postMessage(0);
    metered.frames++;
    metered.longest = Math.max(metered.longest, now - metered.last);
    metered.last = now;
    if (now - metered.at < 1000) return;
    const { frames } = metered;
    meter.textContent = [
      `${Math.round((frames * 1000) / (now - metered.at))} frames a second`,
      `longest ${metered.longest.toFixed(1)} ms`,
      ...Object.entries(spent.ms).map(([part, ms]) => `${part} ${(ms / frames).toFixed(2)}`),
    ].join("\n");
    metered = { at: now, frames: 0, longest: 0, last: now };
    spent.ms = {};
  }

  let told = false;
  /** A frame, as often as the kit paces them (`pace.ts`): each the screen shows while the member is at the page, a few a second while not. */
  function frame(now: number, dt: number): void {
    count(now);
    lap();
    if (!S.held) advance(dt, now);
    lap("page");
    draw(now);
    if (!told) {
      told = true;
      tell({ town: "ready" });
    }
  }

  // ---------- keeping, and the town ----------

  fromTown((msg) => {
    if (msg.town !== "closing") return;
    // The town says where the member is from here: nothing more from the yard, in case it would come after.
    here(null);
    keepSettings();
  });
  window.addEventListener("pagehide", keepSettings);
  if (!S.alone) {
    here("works");
    // In the town, the town says when the member's Leaf changes; opened on its own, the yard listens itself.
    keepLeaf();
  }
  // A phone may take back what the graphics card keeps while the page is put away: the picture says
  // so itself (`scene.ts`), and only then is the ground painted again.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") keepSettings();
  });

  callers();
  refreshAll();
  paced(scope(), frame).wake();

  return {
    advance,
    draw,
    refresh: refreshAll,
    hold(on, lead = 0, at) {
      S.held = on;
      heldLead = lead;
      if (at !== undefined) S.t = at;
    },
    get lead() {
      return heldLead;
    },
    restaged(lessonsTaken) {
      heard = Float64Array.from(S.world.depot);
      if (lessonsTaken) screen.taught = lessonsTaken;
      lessons = NO_LESSONS;
      nudgeAt = 0;
    },
    nudged: () => lessons.said?.id ?? null,
  };
}

/**
 * The page, once it is open: what a review page (`review/`) works it with from outside. Nothing in
 * this folder reaches any review page.
 */
export interface Page {
  /** A moment of the screen: with `now`, the page's clock, the yard is run on to Leaf's tick too. */
  advance(dt: number, now: number | null): void;
  draw(now: number): void;
  /** Everything over the yard brought up to date. */
  refresh(): void;
  /** Stops the screen running the yard on, showing it `lead` of the way into its next tick, the screen's clock at `at`. */
  hold(on: boolean, lead?: number, at?: number): void;
  /** How far into its next tick a yard held still is shown. */
  readonly lead: number;
  /** A yard was put in place of the copy from outside: the depot's sounds and the lessons begin again from it (with these taken). */
  restaged(lessonsTaken: string[] | null): void;
  /** The nudge being said, by its id. */
  nudged(): string | null;
}

/** The page as it opens: its `Page`, or nothing when it did not open (no Leaf, signed out, a visit to nobody). */
export const page: Promise<Page | null> = boot();
