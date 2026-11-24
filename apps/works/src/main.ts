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

import { ALL_ITEMS, ITEM_INFO, postcard, power } from "@sequoia-leaf/factory";
import { unit } from "@sequoia-leaf/kit/dom.ts";
import { keepLeaf, pageCard, serverCard, shutCard, start, troubleCard } from "@sequoia-leaf/kit/live.ts";
import { askPerson } from "@sequoia-leaf/kit/person.ts";
import type { Trouble } from "@sequoia-leaf/kit/play.ts";
import { post } from "@sequoia-leaf/kit/postcard.ts";
import { here } from "@sequoia-leaf/kit/presence.ts";
import { failedToOpen, watchPage } from "@sequoia-leaf/kit/report.ts";
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
import { updateFx } from "./fx.ts";
import { initInput, inputHooks, stepInput } from "./input.ts";
import { stepClearing } from "./plots.ts";
import { drawWords, drawYard, lap, picture, spent, wipe } from "./scene.ts";
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
import { viewHooks } from "./ui/views.ts";
import { gate, keepScreen, leadAt, onRefused, openYard, runYard, screen } from "./yard.ts";

/** What the page says where no Leaf answers: the yard is the guild's server's. */
const NEEDS_LEAF = "The Works needs the guild's server.";

function refreshAll(): void {
  // What is aimed is said over the dock: of the yard as it is.
  keepAim();
  refreshHud();
  refreshDock();
  refreshPanel();
  refreshCard();
}

/** How much of the screen the interface covers, so the camera can keep the yard clear of it. */
function measure(): void {
  const top = $("top").getBoundingClientRect();
  // Under the top bar: the order in hand, or in a visit whose yard it is.
  const track = $(S.visiting ? "visit" : "track").getBoundingClientRect();
  const hand = $("hand").getBoundingClientRect();
  const dock = $("dock").getBoundingClientRect();
  document.documentElement.style.setProperty("--trackb", `${Math.round(track.bottom)}px`);
  // The research being studied hangs under the order in hand, when it is there: read once it has
  // moved with it, for it moves without changing size, and nothing would measure again.
  const study = $("study").hidden ? track : $("study").getBoundingClientRect();
  // On a narrow screen the order in hand runs the width of it, and the yard is clear only below.
  inset.top = track.width > window.innerWidth * 0.6 ? Math.max(top.bottom, track.bottom, study.bottom) : top.bottom;
  // A visit has nothing along the bottom.
  inset.bottom = S.visiting ? 0 : Math.max(0, window.innerHeight - hand.top);
  document.documentElement.style.setProperty("--toph", `${Math.round(top.bottom)}px`);
  document.documentElement.style.setProperty("--dockh", `${Math.round(dock.height)}px`);
  // The line over the dock is as wide as it: unrounded, so that their edges meet.
  document.documentElement.style.setProperty("--dockw", `${dock.width}px`);
  // A card's sheet stops above the dock.
  const floor = dock.height > 0 ? window.innerHeight - dock.top : 0;
  document.documentElement.style.setProperty("--sheet-floor", `${Math.round(floor)}px`);
  document.documentElement.style.setProperty("--handh", `${Math.round(hand.height)}px`);
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

/** What the town was last told about the yard, so that it is told only what has changed. */
let carded = "";
/** Leaves the town a postcard about the yard, if anything on it has changed. Not of somebody else's. */
function sendCard(): void {
  if (S.visiting) return;
  const card = postcard(S.world);
  const text = JSON.stringify(card);
  if (text === carded) return;
  carded = text;
  post("works", card);
}

/** Who the member is, once the yard is open from Leaf; or nothing, with the card that says why it is not. */
async function opened(params: URLSearchParams): Promise<{ id: string } | null> {
  watchPage("works");
  const where = await start();
  if (where.mode === "shut") {
    shutCard(where.why, where.signIn);
    return null;
  }
  if (where.mode !== "live") {
    serverCard(NEEDS_LEAF);
    return null;
  }
  const { signIn, me } = where;
  const of = params.get("of");
  if (of !== null && of !== me.id) S.visiting = { id: of, name: "Someone" };
  document.body.classList.toggle("visiting", S.visiting !== null);
  const card = (why: Trouble): void => {
    if (why === "nothing") pageCard("No yard to visit", "They have not started one yet.", "My yard", myYard);
    else troubleCard(why, signIn);
  };
  // In a visit, the owner's name is asked of Leaf meanwhile.
  const [trouble, owner] = await Promise.all([openYard(me.id, card), S.visiting && askPerson(S.visiting.id)]);
  if (trouble) {
    failedToOpen(trouble);
    card(trouble);
    return null;
  }
  if (S.visiting && owner) S.visiting.name = owner.name;
  return me;
}

async function boot(): Promise<Page | null> {
  await fontsReady();
  const params = new URLSearchParams(location.search);
  // Who the member is, and then the yard as Leaf has it. Without Leaf there is no yard, unless a
  // review page handed one in.
  const me = S.alone ? { id: "" } : await opened(params);
  if (!me) return null;
  const art = makeArt(S.world.land);

  // The yard's picture, shown small and enlarged by the page; over it, the words, which also take every press.
  picture.id = "view";
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
  initHud();
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
  look(home().x, home().y, true);
  window.addEventListener("resize", fit);
  // The dock grows a row when the story opens more tools than fit: everything over it moves up.
  const watch = new ResizeObserver(measure);
  for (const id of ["top", "dock", "hand", "track", "visit", "study"]) watch.observe($(id));

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
    sendCard();
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
  let metered = { at: performance.now(), frames: 0, longest: 0 };
  function count(now: number, gap: number): void {
    if (!meter || !after) return;
    after.port2.postMessage(0);
    metered.frames++;
    metered.longest = Math.max(metered.longest, gap);
    if (now - metered.at < 1000) return;
    const { frames } = metered;
    meter.textContent = [
      `${Math.round((frames * 1000) / (now - metered.at))} frames a second`,
      `longest ${metered.longest.toFixed(1)} ms`,
      ...Object.entries(spent.ms).map(([part, ms]) => `${part} ${(ms / frames).toFixed(2)}`),
    ].join("\n");
    metered = { at: now, frames: 0, longest: 0 };
    spent.ms = {};
  }

  let last = performance.now();
  let told = false;
  function frame(now: number): void {
    // The next frame is asked for first: a fault in this one is told to the console and the yard goes on.
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    count(now, now - last);
    last = now;
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
    sendCard();
  });
  window.addEventListener("pagehide", keepSettings);
  if (!S.alone) {
    here("works");
    // In the town, the town says when the member's Leaf changes; opened on its own, the yard listens itself.
    keepLeaf();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") keepSettings();
    // A phone may empty the pictures the frame keeps while the page is put away.
    else wipe();
  });

  callers();
  refreshAll();
  requestAnimationFrame(frame);

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
