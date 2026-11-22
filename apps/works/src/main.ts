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
import { must, type Pt } from "@sequoia-leaf/kit/util.ts";
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
import { initInput, inputHooks, stepInput } from "./input.ts";
import { layout } from "./layout.ts";
import { drawWords, drawYard } from "./scene.ts";
import { sheets } from "./sheets.ts";
import { murmur, yardSfx } from "./sound.ts";
import { S, type Tool, toPage } from "./state.ts";
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
type Staged = { yard: "small" | "short" | "mid" | "large" | "new" } | { away: number } | { fill: number };

declare global {
  interface Window {
    /** Handles for looking at the yard from outside: stage a moment on the test Leaf, open things, act as a player would. */
    works?: {
      stage: (...ops: Staged[]) => Promise<void>;
      hold: (on: boolean) => void;
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

  const canvas = must(document.querySelector<HTMLCanvasElement>("#view"), "canvas");
  const ctx = must(canvas.getContext("2d"), "2d context");
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

  let slow = 0;
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
    const w = S.world;
    const picture = drawYard(art, { lead: S.held ? 0 : leadAt(now), pace: power(w).pace });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(picture, 0, 0, picture.width * S.view.z, picture.height * S.view.z);
    drawWords(ctx, wordPx, inset.top * S.view.dpr);
  }

  let last = performance.now();
  let told = false;
  function frame(now: number): void {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (!S.held) advance(dt, now);
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
        : ["planks", "pylon", "bench", "board", "short", "starved"];
      shown = "";
      nudgeAt = 0;
      look(home().x, home().y, true);
      refreshAll();
    },
    hold(on) {
      S.held = on;
    },
    skip(seconds) {
      for (let k = 0; k < seconds * 30; k++) advance(1 / 30, null);
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
