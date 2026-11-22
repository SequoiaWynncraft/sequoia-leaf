/**
 * The Works: the yard behind the guild's workshop, where gatherers, belts and machines turn what
 * lies on the forest floor into what the guild has asked for.
 *
 * This file is the stage: it opens the yard, owns the canvas and the loop, and joins the parts
 * together. The rules are `@sequoia-leaf/yard`, the picture in `scene.ts` and `art/`, what the
 * member does in `tools.ts` and `input.ts`, and everything that sits over the yard in `ui/`.
 *
 * Opened with `?of=<player>`, it is a visit to that player's yard (`S.visiting`): the same yard,
 * with nothing to act with, no lessons or letters, and nothing told to the town.
 */

import { unit } from "@sequoia-leaf/kit/dom.ts";
import { keepLeaf, pageCard, serverCard, shutCard, start, troubleCard } from "@sequoia-leaf/kit/live.ts";
import { askPerson } from "@sequoia-leaf/kit/person.ts";
import type { Trouble } from "@sequoia-leaf/kit/play.ts";
import { post } from "@sequoia-leaf/kit/postcard.ts";
import { here } from "@sequoia-leaf/kit/presence.ts";
import { balance } from "@sequoia-leaf/kit/purse.ts";
import { fromTown, tell } from "@sequoia-leaf/kit/shell.ts";
import { fontsReady } from "@sequoia-leaf/kit/text.ts";
import { tipOff } from "@sequoia-leaf/kit/tip.ts";
import { makeCanvas, must, type Pt } from "@sequoia-leaf/kit/util.ts";
import {
  type Dir,
  ITEM,
  ITEMS,
  type Kind,
  LAND,
  type PlanId,
  type PlotId,
  postcard,
  power,
  type Tally,
} from "@sequoia-leaf/yard";

import { stepFlights, stepWalkers } from "./actors.ts";
import { TILE } from "./art/belts.ts";
import { makeArt } from "./art/index.ts";
import { ease, inset, inView, look, pan, resize, setCamera, setZoom, zoom, zoomSteps } from "./camera.ts";
import { callers, capstones, forget, handOver, onNews } from "./events.ts";
import { updateFx } from "./fx.ts";
import { fingerTap, initInput, inputHooks, stepInput } from "./input.ts";
import { layout } from "./layout.ts";
import { drawWords, drawYard, lap, picture, spent, wipe } from "./scene.ts";
import { sheets } from "./sheets.ts";
import { murmur, yardSfx } from "./sound.ts";
import { S, type Tool, toPage } from "./state.ts";
import { nudge } from "./teach.ts";
import {
  aimAt,
  buyIdea,
  buyLand,
  confirm,
  paintAt,
  place,
  runEnd,
  runOver,
  runStart,
  setTool,
  stepClearing,
  takeAway,
} from "./tools.ts";
import { initBoard } from "./ui/board.ts";
import { closeCard, followCards, initCard, openCard, refreshCard, riderAt } from "./ui/card.ts";
import { initDock, refreshDock } from "./ui/dock.ts";
import { initHud, myYard, refreshHud } from "./ui/hud.ts";
import { putAway, reading, showLetter } from "./ui/letter.ts";
import { closeBanner, feed, initNotes, tickNotes } from "./ui/notes.ts";
import { closePanel, initPanels, openPanel, panelHooks, type PanelId, refreshPanel } from "./ui/panels.ts";
import { $ } from "./ui/parts.ts";
import { again, keepScreen, leadAt, onRefused, openYard, runYard, screen } from "./yard.ts";

/** What the page says where no Leaf answers: the yard is the guild's server's. */
const NEEDS_LEAF = "The Works needs the guild's server.";

/** A moment staged in the yard by the play server on a developer's machine (`apps/api/test/play.ts`), for the tours. */
type Staged =
  { yard: "small" | "short" | "mid" | "large" | "new" } | { text: string } | { away: number } | { fill: number };

declare global {
  interface Window {
    /** Handles for looking at the yard from outside: stage a moment on the test Leaf, open things, act as a player would. */
    works?: {
      stage: (...ops: Staged[]) => Promise<void>;
      /**
       * Stops the screen running the yard on, and shows it so far (`lead`, 0 to 1) into its next
       * tick; with `at`, the screen's own clock stands at that many seconds, so a picture can be
       * taken twice the same.
       */
      hold: (on: boolean, lead?: number, at?: number) => void;
      skip: (seconds: number) => void;
      /**
       * Does so many frames' work one after another, as if the screen showed `hz` of them a second,
       * and says what one took: milliseconds by part, the picture's size in the yard's pixels, and
       * how many pieces are on it. The yard is run that far ahead of Leaf, and waits there for it.
       */
      bench: (frames: number, hz?: number) => { ms: Record<string, number>; picture: Pt; pieces: number };
      pick: (tool: Tool, dir?: Dir) => void;
      finger: (on: boolean) => void;
      aim: (x: number, y: number) => void;
      tap: (x: number, y: number) => void;
      build: (kind: Kind, x: number, y: number, dir?: Dir) => boolean;
      remove: (x: number, y: number) => boolean;
      paint: (x: number, y: number, tint: number) => boolean;
      drag: (x0: number, y0: number, x1: number, y1: number) => void;
      drop: () => void;
      confirm: () => boolean;
      open: (panel: PanelId) => void;
      close: () => void;
      card: (x: number, y: number) => boolean;
      look: (x: number, y: number) => void;
      zoom: (by: number) => void;
      plot: (id: PlotId) => boolean;
      plan: (id: PlanId) => boolean;
      taught: (ids: string[]) => void;
      page: (x: number, y: number) => Pt;
      /** What is riding a belt on a tile, as a card's reference, if anything. */
      rider: (x: number, y: number) => string | null;
      /** The tiles where a kind of thing stands. */
      where: (kind: Kind) => Pt[];
      state: () => Record<string, unknown>;
    };
  }
}

function refreshAll(): void {
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
  // On a narrow screen the order in hand runs the width of it, and the yard is clear only below.
  inset.top = track.width > window.innerWidth * 0.6 ? Math.max(top.bottom, track.bottom) : top.bottom;
  // A visit has nothing along the bottom.
  inset.bottom = S.visiting ? 0 : Math.max(0, window.innerHeight - hand.top);
  document.documentElement.style.setProperty("--toph", `${Math.round(top.bottom)}px`);
  document.documentElement.style.setProperty("--dockh", `${Math.round(dock.height)}px`);
  // A card's sheet stops above the dock.
  const floor = dock.height > 0 ? window.innerHeight - dock.top : 0;
  document.documentElement.style.setProperty("--sheet-floor", `${Math.round(floor)}px`);
  document.documentElement.style.setProperty("--handh", `${Math.round(hand.height)}px`);
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

async function boot(): Promise<void> {
  await fontsReady();
  // Every sprite on sheets: a picture of the art, which needs no yard.
  const params = new URLSearchParams(location.search);
  if (params.has("sheet")) {
    sheets(makeArt(LAND), params.get("sheet") ?? "");
    return;
  }
  // Who the member is, and then the yard as Leaf has it. Without Leaf there is no yard.
  const where = await start();
  if (where.mode === "shut") {
    shutCard(where.why, where.signIn);
    return;
  }
  if (where.mode !== "live") {
    serverCard(NEEDS_LEAF);
    return;
  }
  const { signIn, me } = where;
  const of = params.get("of");
  if (of !== null && of !== me.id) S.visiting = { id: of, name: "Someone" };
  document.body.classList.toggle("visiting", S.visiting !== null);
  const card = (why: Trouble): void => {
    if (why === "nothing") pageCard("No yard to visit", "They have not started one yet.", "My yard", myYard);
    else troubleCard(why, signIn, NEEDS_LEAF);
  };
  // In a visit, the owner's name is asked of Leaf meanwhile.
  const [trouble, owner] = await Promise.all([openYard(me.id, card), S.visiting && askPerson(S.visiting.id)]);
  if (trouble) {
    card(trouble);
    return;
  }
  if (S.visiting && owner) S.visiting.name = owner.name;
  const art = makeArt(S.world.land);

  // The yard's picture, shown small and enlarged by the page; over it, the words, which also take every press.
  picture.id = "view";
  document.body.prepend(picture);
  const canvas = must(document.querySelector<HTMLCanvasElement>("#words"), "canvas");
  const ctx = must(canvas.getContext("2d"), "2d context");
  canvas.addEventListener("contextrestored", wipe);
  let wordPx = 2;

  initNotes();
  initPanels(art);
  initBoard(me.id);
  initCard(art);
  initHud(art);
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
  inputHooks.letter = putAway;
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
  for (const id of ["top", "dock", "hand", "track", "visit"]) watch.observe($(id));

  // ---------- the clock ----------

  onRefused((why) => feed(`${why}. The yard is shown as the server has it.`, "coral"));

  /** What the depot had taken in a moment ago, to hear each thing arrive. */
  let heard: Tally = { ...S.world.depot };
  let arriveAt = 0;
  function arrivals(): void {
    const w = S.world;
    for (const k of ITEMS) {
      const n = w.depot[k] ?? 0;
      if (n > (heard[k] ?? 0) && S.t > arriveAt) {
        arriveAt = S.t + 0.11;
        yardSfx.arrive(ITEM[k].step);
      }
      heard[k] = n;
    }
  }

  /** The nudge showing, since when, and the last one the camera was turned towards. */
  let nudgeAt = 0;
  let shown = "";
  let since = 0;
  function nudges(): void {
    if (S.t < nudgeAt) return;
    nudgeAt = S.t + 0.4;
    const n = reading() || S.visiting ? null : nudge(S.world, new Set(screen.taught), S.finger);
    if (!n) {
      S.nudge = null;
      S.nudgeTool = null;
      shown = "";
      return;
    }
    if (n.id !== shown) {
      shown = n.id;
      since = S.t;
      // The first lessons bring the place they are about into view.
      if (n.lasting && S.world.story === 0 && !inView(n.x * TILE + 8, n.y * TILE + 8))
        look(n.x * TILE + 8, n.y * TILE - 8);
    }
    // A lesson that is not learnt by doing is said for a while, and then counts as taken.
    if (!n.lasting && S.t - since > 14) {
      screen.taught.push(n.id);
      return;
    }
    S.nudge = { x: n.x, y: n.y, text: n.text, id: n.id };
    S.nudgeTool = n.tool;
  }

  /** A single pixel to take the picture onto, for `bench`. */
  const taken = makeCanvas(1, 1).g;
  let slow = 0;
  /** How far into its next tick a yard held still is shown. */
  let heldLead = 0;
  /** A moment of the screen: `now`, the page's clock, runs the yard on to Leaf's tick; without it only the screen moves. */
  function advance(dt: number, now: number | null): void {
    S.t += dt;
    if (now !== null) {
      const news = runYard(now);
      // Leaf worked the yard on while nobody watched: its letter says what it did, to its owner.
      if (S.world.away && !reading() && !S.visiting) showLetter(S.world.away, refreshAll);
      // What a visited yard does is its owner's news: the visitor's purse and town are not told.
      if (news.length > 0 && !S.visiting) {
        onNews(art, news);
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
    const w = S.world;
    drawYard(art, { lead: S.held ? heldLead : leadAt(now), pace: power(w).pace });
    drawWords(ctx, wordPx, inset.top * S.view.dpr);
    lap("words");
  }

  // With `?meter` in the address, a corner says how the screen is keeping up: the frames a second
  // it reaches, the longest of the last second, and the milliseconds of a frame's work by part
  // (`browser` is what the browser itself does with the frame before the page is free again).
  const meter = params.has("meter") ? document.body.appendChild(document.createElement("pre")) : null;
  const after = meter ? new MessageChannel() : null;
  if (meter && after) {
    meter.id = "meter";
    meter.className = "k-plaque k-s";
    spent.on = true;
    after.port1.addEventListener("message", () => lap("browser"));
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
    requestAnimationFrame(frame);
  }

  // ---------- keeping, and the town ----------

  fromTown((msg) => {
    if (msg.town === "closing") {
      keepSettings();
      sendCard();
    }
  });
  window.addEventListener("pagehide", keepSettings);
  here("works");
  // In the town, the town says when the member's Leaf changes; opened on its own, the yard listens itself.
  keepLeaf();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") keepSettings();
    // A phone may empty the pictures the frame keeps while the page is put away.
    else wipe();
  });

  callers();
  refreshAll();
  requestAnimationFrame(frame);

  // ---------- handles for looking at it from outside ----------

  window.works = {
    async stage(...ops) {
      await fetch("/test/play/works", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: ops }),
      });
      await again();
      advance(0, performance.now());
      forget();
      tipOff();
      $("feed").replaceChildren();
      closeBanner();
      closeCard();
      closePanel();
      setTool(null);
      S.picked = -1;
      S.clearing.clear();
      heard = { ...S.world.depot };
      screen.taught = ops.some((op) => "yard" in op && op.yard === "new")
        ? []
        : ["planks", "pylon", "bench", "board", "select", "short", "starved"];
      shown = "";
      nudgeAt = 0;
      look(home().x, home().y, true);
      refreshAll();
    },
    hold(on, lead = 0, at) {
      S.held = on;
      heldLead = lead;
      if (at !== undefined) S.t = at;
    },
    skip(seconds) {
      for (let k = 0; k < seconds * 30; k++) advance(1 / 30, null);
      refreshAll();
    },
    bench(frames, hz = 60) {
      const was = spent.on;
      const kept = spent.ms;
      spent.on = true;
      spent.ms = {};
      const began = performance.now();
      for (let k = 0; k < frames; k++) {
        lap();
        advance(1 / hz, began + (k * 1000) / hz);
        lap("page");
        draw(began + (k * 1000) / hz);
        // A browser may put off the drawing it was asked for: taking the picture makes it do it now.
        taken.drawImage(picture, 0, 0);
        lap("browser");
      }
      const ms = Object.fromEntries(Object.entries(spent.ms).map(([part, sum]) => [part, sum / frames]));
      spent.on = was;
      spent.ms = kept;
      const { land, cells } = S.world;
      const x0 = S.cam.x / TILE;
      const y0 = S.cam.y / TILE;
      const pieces = cells.filter((b, i) => {
        const x = i % land.w;
        const y = Math.floor(i / land.w);
        return b && x + 1 > x0 && x < x0 + S.view.w / TILE && y + 1 > y0 && y < y0 + S.view.h / TILE;
      }).length;
      return { ms, picture: { x: picture.width, y: picture.height }, pieces };
    },
    pick(tool, dir) {
      if (dir !== undefined) S.dir = dir;
      setTool(tool);
    },
    finger(on) {
      S.finger = on;
      if (on) S.hover = null;
      refreshDock();
    },
    aim(x, y) {
      S.hover = S.finger ? null : { x, y };
      aimAt(x, y);
      refreshDock();
    },
    tap(x, y) {
      if (S.tool === null) openCard(x, y);
      else fingerTap(x, y);
      refreshDock();
    },
    build(kind, x, y, dir = 0) {
      S.dir = dir;
      setTool(kind);
      const ok = place(x, y);
      setTool(null);
      return ok;
    },
    remove: (x, y) => takeAway(x, y),
    paint(x, y, tint) {
      S.tint = tint;
      return paintAt(x, y);
    },
    drag(x0, y0, x1, y1) {
      runStart(x0, y0);
      runOver(x1, y1);
    },
    drop: runEnd,
    confirm,
    open: openPanel,
    close() {
      closePanel();
      closeCard();
    },
    card: openCard,
    look(x, y) {
      look(x * TILE + 8, y * TILE + 8, true);
    },
    zoom(by) {
      zoom(by, window.innerWidth / 2, window.innerHeight / 2);
    },
    plot: buyLand,
    plan: buyIdea,
    taught(ids) {
      screen.taught = ids;
      nudgeAt = 0;
    },
    rider: riderAt,
    page(x, y) {
      return toPage(x * TILE + 8, y * TILE + 8);
    },
    where(kind) {
      const w = S.world;
      return w.cells.flatMap((b, i) => (b?.kind === kind ? [{ x: i % w.land.w, y: Math.floor(i / w.land.w) }] : []));
    },
    state() {
      const w = S.world;
      return {
        coins: balance().coins,
        leaf: balance().leaf,
        tick: w.tick,
        till: w.till,
        board: w.board.map((o) => o.id),
        story: w.story,
        built: layout(w, S.rev).built,
        painted: w.cells.filter((b) => b && b.tint > 0).length,
        nudge: S.nudge?.id ?? null,
        tool: S.tool,
        aim: S.aim,
        run: S.run ? { legs: S.run.legs.length, cost: S.run.cost, why: S.run.why } : null,
        mark: S.mark ? { pieces: S.mark.pieces.length, cost: S.mark.cost } : null,
        group: S.group
          ? { as: S.group.as, turns: S.group.turns, bad: S.group.why.filter((r) => r !== null).length }
          : null,
        blueprints: w.blueprints.map((b) => b?.length ?? 0),
        panel: S.panel,
        picked: S.picked,
        power: power(w),
        z: S.view.z,
      };
    },
  };
}

void boot();
