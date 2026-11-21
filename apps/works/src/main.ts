/**
 * The Works: the yard behind the guild's workshop, where gatherers, belts and machines turn what
 * lies on the forest floor into what the guild has asked for.
 *
 * This file is the stage: it opens the yard, owns the canvas and the loop, and joins the parts
 * together. The rules are in `sim/`, the picture in `scene.ts` and `art/`, what the member does in
 * `tools.ts` and `input.ts`, and everything that sits over the yard in `ui/`.
 */

import { before, pickUp, pull } from "@sequoia-leaf/kit/cloud.ts";
import { unit } from "@sequoia-leaf/kit/dom.ts";
import { followLeaf, shutCard, start } from "@sequoia-leaf/kit/live.ts";
import { post } from "@sequoia-leaf/kit/postcard.ts";
import { here } from "@sequoia-leaf/kit/presence.ts";
import { balance, earn, grant, spend } from "@sequoia-leaf/kit/purse.ts";
import { fromTown, inTown, tell } from "@sequoia-leaf/kit/shell.ts";
import { fontsReady } from "@sequoia-leaf/kit/text.ts";
import { tipOff } from "@sequoia-leaf/kit/tip.ts";
import { clamp, must, type Pt } from "@sequoia-leaf/kit/util.ts";

import { stepFlights, stepWalkers } from "./actors.ts";
import { TILE } from "./art/belts.ts";
import { makeArt } from "./art/index.ts";
import { ease, inset, inView, look, pan, resize, setCamera, setZoom, zoom, zoomSteps } from "./camera.ts";
import { callers, capstones, forget, handOver, onNews, shiftOn } from "./events.ts";
import { updateFx } from "./fx.ts";
import { initInput, inputHooks, stepInput } from "./input.ts";
import { layout } from "./layout.ts";
import { drawWords, drawYard } from "./scene.ts";
import { sheets } from "./sheets.ts";
import {
  type Away,
  boost,
  boosted,
  create,
  deliver,
  type Dir,
  ITEM,
  ITEMS,
  type Kind,
  load,
  type PlanId,
  type PlotId,
  postcard,
  power,
  step,
  storyOrder,
  type Tally,
  TICK_MS,
} from "./sim/index.ts";
import { murmur, yardSfx } from "./sound.ts";
import { S, type Tool, toPage, touched } from "./state.ts";
import { nudge } from "./teach.ts";
import {
  aimAt,
  buyIdea,
  buyLand,
  confirm,
  place,
  runEnd,
  runOver,
  runStart,
  setTool,
  stepClearing,
  takeAway,
  tapBelt,
} from "./tools.ts";
import { cardHooks, closeCard, initCard, openCard, refreshCard } from "./ui/card.ts";
import { initDock, refreshDock } from "./ui/dock.ts";
import { initHud, refreshHud } from "./ui/hud.ts";
import { putAway, reading, showLetter } from "./ui/letter.ts";
import { closeBanner, feed, initNotes, tickNotes } from "./ui/notes.ts";
import { closePanel, initPanels, openPanel, panelHooks, type PanelId, refreshPanel } from "./ui/panels.ts";
import { $ } from "./ui/parts.ts";
import { forgetYard, keep, openYard, screen, swapYard, tick } from "./yard.ts";
import large from "./yards/large.json";
import mid from "./yards/mid.json";
import short from "./yards/short.json";
import small from "./yards/small.json";

/** Yards kept part-way through the story by `review/balance.ts --yards`, for looking at the game at each stage. */
const STAGES = { small, short, mid, large } as const;
type Stage = keyof typeof STAGES | "new";

declare global {
  interface Window {
    /** Handles for looking at the yard from outside: load a yard, run the clock, open things, act as a player would. */
    works?: {
      stage: (name: Stage, story?: number) => void;
      hold: (on: boolean) => void;
      run: (ticks: number) => void;
      skip: (seconds: number) => void;
      pick: (tool: Tool, dir?: Dir) => void;
      finger: (on: boolean) => void;
      aim: (x: number, y: number) => void;
      tap: (x: number, y: number) => void;
      build: (kind: Kind, x: number, y: number, dir?: Dir) => boolean;
      remove: (x: number, y: number) => boolean;
      drag: (x0: number, y0: number, x1: number, y1: number) => void;
      drop: () => void;
      confirm: () => boolean;
      open: (panel: PanelId) => void;
      close: () => void;
      card: (x: number, y: number) => boolean;
      look: (x: number, y: number) => void;
      zoom: (by: number) => void;
      purse: (coins: number, leaf?: number) => void;
      boost: (minutes: number) => void;
      away: (hours: number) => void;
      plot: (id: PlotId) => boolean;
      plan: (id: PlanId) => boolean;
      taught: (ids: string[]) => void;
      /** Sends the depot everything a standing order still wants, as if the yard had made it. */
      fill: (slot: number) => void;
      page: (x: number, y: number) => Pt;
      /** The tiles where a kind of thing stands. */
      where: (kind: Kind) => Pt[];
      bench: () => number;
      state: () => Record<string, unknown>;
    };
  }
}

/** A long enough absence gets a letter; a short one, a line. */
const LETTER_AFTER = 300;

function refreshAll(): void {
  refreshHud();
  refreshDock();
  refreshPanel();
  refreshCard();
}

/** How much of the screen the interface covers, so the camera can keep the yard clear of it. */
function measure(): void {
  const top = $("top").getBoundingClientRect();
  const track = $("track").getBoundingClientRect();
  const hand = $("hand").getBoundingClientRect();
  const dock = $("dock").getBoundingClientRect();
  // On a narrow screen the order in hand runs the width of it, and the yard is clear only below.
  inset.top = track.width > window.innerWidth * 0.6 ? Math.max(top.bottom, track.bottom) : top.bottom;
  inset.bottom = Math.max(0, window.innerHeight - hand.top);
  document.documentElement.style.setProperty("--toph", `${Math.round(top.bottom)}px`);
  document.documentElement.style.setProperty("--dockh", `${Math.round(dock.height)}px`);
  document.documentElement.style.setProperty("--handh", `${Math.round(hand.height)}px`);
}

/** The middle of the depot, in the yard's pixels: where the camera starts. */
const home = (): Pt => ({ x: S.world.land.depot[0] * TILE + 8, y: S.world.land.depot[1] * TILE + 8 });

/** Keeps the yard, and how the member had it zoomed. */
const save = (): void => {
  screen.zoom = zoomSteps();
  keep();
};

/** Sets the purse to exact amounts, for looking at the game with more or less to spend. */
const setPurse = (coins: number, leaf?: number): void => {
  const now = balance();
  if (coins > now.coins) earn(coins - now.coins, "review");
  else spend("coins", now.coins - coins, "review");
  if (leaf === undefined) return;
  if (leaf > now.leaf) grant(leaf - now.leaf, "review");
  else spend("leaf", now.leaf - leaf, "review");
};

/** What the town was last told about the yard, so that it is told only what has changed. */
let carded = "";
/** Leaves the town a postcard about the yard, if anything on it has changed. */
function sendCard(): void {
  const card = postcard(S.world);
  const text = JSON.stringify(card);
  if (text === carded) return;
  carded = text;
  post("works", card);
}

async function boot(): Promise<void> {
  // Where the game is, and on the guild's server the member's saves, before anything kept is read.
  const where = await start();
  if (where.mode === "shut") {
    shutCard(where.why, where.signIn);
    return;
  }
  const live = where.mode === "live";
  // Opened on its own, the yard also keeps the town's slot, where its postcard is.
  if (live && !(await pull(inTown() ? ["purse", "works"] : ["purse", "works", "town"], { onReplaced: pickUp }))) {
    shutCard("closed", where.signIn);
    return;
  }
  await fontsReady();
  const params = new URLSearchParams(location.search);
  if (params.has("fresh")) {
    // Start the yard over, once: the address is put right so that a reload does not do it again.
    // On the guild's server the yard is the member's account's, and is not thrown away from an address.
    if (!live) forgetYard();
    params.delete("fresh");
    const rest = params.toString();
    history.replaceState(null, "", `${location.pathname}${rest ? `?${rest}` : ""}${location.hash}`);
  }
  const away = openYard();
  const art = makeArt(S.world.land);
  if (params.has("sheet")) {
    sheets(art, params.get("sheet") ?? "");
    return;
  }

  const canvas = must(document.querySelector<HTMLCanvasElement>("#view"), "canvas");
  const ctx = must(canvas.getContext("2d"), "2d context");
  let wordPx = 2;

  initNotes();
  initPanels(art);
  initCard(art);
  initHud(art);
  initDock(art);
  initInput(canvas);
  panelHooks.handOver = (slot): void => {
    handOver(slot);
    refreshAll();
  };
  panelHooks.shiftOn = shiftOn;
  panelHooks.changed = refreshAll;
  inputHooks.caller = (order): void => {
    const slot = S.world.board.findIndex((o) => o.id === order);
    if (slot >= 0) handOver(slot);
    refreshAll();
  };
  inputHooks.letter = putAway;
  cardHooks.opened = (x, y, box): void => {
    const at = toPage(x * TILE + 8, y * TILE + 8);
    const under = at.y > box.top - 24 && at.x > box.left - 16 && at.x < box.right + 16;
    // Moved up just far enough to stand clear of the card.
    if (under) pan(0, box.top - 40 - at.y);
  };

  function fit(): void {
    measure();
    resize();
    const dpr = window.devicePixelRatio || 1;
    // The usual text size; on a sharp screen, the size the kit gives second lines.
    wordPx = Math.max(1, Math.round(unit() * dpr * (dpr >= 2 ? 0.75 : 1)));
  }

  setCamera(canvas, art.ground);
  setZoom(screen.zoom);
  fit();
  // The dock's height is only known once it has been laid out with its tools in it.
  measure();
  look(home().x, home().y, true);
  window.addEventListener("resize", fit);
  // The dock grows a row when the story opens more tools than fit: everything over it moves up.
  const watch = new ResizeObserver(measure);
  for (const id of ["top", "dock", "hand", "track"]) watch.observe($(id));

  // ---------- the clock ----------

  function absent(a: Away): void {
    if (a.seconds >= LETTER_AFTER && !reading()) showLetter(art, a, refreshAll);
    else if (a.coins > 0) feed(`While you were away the yard made ${a.coins.toLocaleString("en-US")} Coins.`, "gold");
  }

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
    const n = reading() ? null : nudge(S.world, new Set(screen.taught), S.finger);
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

  let slow = 0;
  function advance(dt: number, clock: boolean): void {
    S.t += dt;
    if (clock) {
      const { away: gone, news } = tick(Date.now());
      if (gone) absent(gone);
      if (news.length > 0) {
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
    murmur(S.t, Math.min(1, p.demand / 45) * p.pace * (boosted(S.world, Date.now()) ? 1.3 : 1));
    slow -= dt;
    if (slow > 0) return;
    slow = 0.25;
    capstones();
    callers();
    sendCard();
    refreshAll();
  }

  function draw(): void {
    const w = S.world;
    const fast = boosted(w, Date.now());
    const lead = S.held ? 0 : clamp((Date.now() - w.seen) / TICK_MS, 0, 1) * (fast ? 2 : 1);
    const picture = drawYard(art, { lead, pace: power(w).pace, boosted: fast });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(picture, 0, 0, picture.width * S.view.z, picture.height * S.view.z);
    drawWords(ctx, wordPx);
  }

  let last = performance.now();
  let told = false;
  function frame(now: number): void {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (!S.held) advance(dt, true);
    draw();
    if (!told) {
      told = true;
      tell({ town: "ready" });
    }
    requestAnimationFrame(frame);
  }

  // ---------- keeping, and the town ----------

  fromTown((msg) => {
    if (msg.town === "closing") {
      save();
      sendCard();
    }
  });
  window.addEventListener("pagehide", save);
  before(() => {
    save();
    sendCard();
  });
  here("works");
  // Opened on its own, nobody else is listening for the member's Leaf.
  if (live && !inTown()) followLeaf();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save();
  });

  if (away) absent(away);
  callers();
  refreshAll();
  requestAnimationFrame(frame);

  // ---------- handles for looking at it from outside ----------

  window.works = {
    stage(name, story = 0) {
      const world = name === "new" ? create({ seed: 20261121, story }) : load(JSON.stringify(STAGES[name]));
      if (!world) throw new Error(`the ${name} yard would not load`);
      forget();
      tipOff();
      $("feed").replaceChildren();
      closeBanner();
      closeCard();
      closePanel();
      setTool(null);
      swapYard(world);
      heard = { ...world.depot };
      screen.taught = name === "new" && story === 0 ? [] : ["planks", "pylon", "bench", "board", "short", "starved"];
      shown = "";
      nudgeAt = 0;
      look(home().x, home().y, true);
      refreshAll();
    },
    hold(on) {
      S.held = on;
      S.world.seen = Date.now();
    },
    run(ticks) {
      S.held = true;
      for (let k = 0; k < ticks; k++) {
        step(S.world);
        if (k % 3 === 0) advance(0.3, false);
      }
      const news = tick(Date.now()).news;
      if (news.length > 0) onNews(art, news);
      S.world.seen = Date.now();
      refreshAll();
    },
    skip(seconds) {
      for (let k = 0; k < seconds * 30; k++) advance(1 / 30, false);
      refreshAll();
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
      if (S.tool === "belt") tapBelt(x, y);
      else if (S.tool === null) openCard(x, y);
      else if (S.aim && S.aim.x === x && S.aim.y === y) confirm();
      else aimAt(x, y);
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
    purse: setPurse,
    boost(minutes) {
      boost(S.world, Date.now(), minutes * 60_000);
      shiftOn();
      refreshAll();
    },
    away(hours) {
      S.world.seen = Date.now() - hours * 3_600_000;
      S.held = false;
      const { away: gone, news } = tick(Date.now());
      if (gone) absent(gone);
      if (news.length > 0) onNews(art, news);
      S.held = true;
      touched();
      refreshAll();
    },
    plot: buyLand,
    plan: buyIdea,
    taught(ids) {
      screen.taught = ids;
      nudgeAt = 0;
    },
    fill(slot) {
      const order = S.world.board[slot];
      if (!order) return;
      for (const k of ITEMS) {
        const n = (order.want[k] ?? 0) - (order.filled[k] ?? 0);
        // Whatever the story order wants of it first, and then the board's.
        if (n > 0) deliver(S.world, k, n + Math.max(0, (storyOrder(S.world)?.want[k] ?? 0) - (S.world.filled[k] ?? 0)));
      }
      const news = tick(Date.now()).news;
      if (news.length > 0) onNews(art, news);
      S.world.seen = Date.now();
      refreshAll();
    },
    page(x, y) {
      return toPage(x * TILE + 8, y * TILE + 8);
    },
    where(kind) {
      const w = S.world;
      return w.cells.flatMap((b, i) => (b?.kind === kind ? [{ x: i % w.land.w, y: Math.floor(i / w.land.w) }] : []));
    },
    bench() {
      const t0 = performance.now();
      for (let i = 0; i < 100; i++) {
        step(S.world);
        advance(1 / 60, false);
        draw();
      }
      return (performance.now() - t0) / 100;
    },
    state() {
      const w = S.world;
      return {
        coins: balance().coins,
        leaf: balance().leaf,
        story: w.story,
        built: layout(w, S.rev).built,
        nudge: S.nudge?.id ?? null,
        tool: S.tool,
        aim: S.aim,
        run: S.run ? { legs: S.run.legs.length, cost: S.run.cost, why: S.run.why } : null,
        panel: S.panel,
        picked: S.picked,
        power: power(w),
        z: S.view.z,
      };
    },
  };
}

void boot();
