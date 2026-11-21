/**
 * Guild Town: the member arrives as their own character in a small town in a clearing among giant
 * redwoods, where every part of the game is a place to walk up to and guild-mates are about.
 * Behind its gate is the member's own camp, and down the trail from that, everybody else's.
 *
 * This file is the stage those places stand on: the canvas, the camera, the keys and fingers, the
 * loop, the walk from one place to another, and the way through a door into a game and back.
 * Everything about the town itself is in `townscene.ts` and about a camp in `campscene.ts`, each
 * reached only through `Scene`.
 */

import { pick as pickCard, point } from "@sequoia-leaf/kit/card.ts";
import { unit } from "@sequoia-leaf/kit/dom.ts";
import { where } from "@sequoia-leaf/kit/live.ts";
import { earn } from "@sequoia-leaf/kit/purse.ts";
import { bake, paintSkin } from "@sequoia-leaf/kit/skin.ts";
import { unlock } from "@sequoia-leaf/kit/sound.ts";
import { fontsReady } from "@sequoia-leaf/kit/text.ts";
import { LONG_PRESS, tipAt, tipOff } from "@sequoia-leaf/kit/tip.ts";
import { clamp, must, type Pt } from "@sequoia-leaf/kit/util.ts";

import { makeCampArt } from "./campart.ts";
import { type CampScene, makeCamp } from "./campscene.ts";
import { makeCampUi } from "./campui.ts";
import { goIn, type Visit } from "./doors.ts";
import { drawIris, show } from "./draw.ts";
import { clearFx } from "./fx.ts";
import { G, hooks, type PanelId, toPage } from "./game.ts";
import { type GameId, GAMES } from "./games.ts";
import { guild, type Moment, stir } from "./guild.ts";
import { closeCard, closePanel, hush, initHud, panelBox, tickHud } from "./hud.ts";
import { showCampSheet, showSheet } from "./sheet.ts";
import { makeSprites } from "./sprites.ts";
import type { Hover, Scene, Stage, Steer } from "./stage.ts";
import { makeTown } from "./townscene.ts";
import { dismissArrival } from "./ui.ts";
import type { PlaceId } from "./world.ts";

declare global {
  interface Window {
    /** Handles for looking at the town from outside: jump the clock, open a place, move the member. */
    town?: {
      skip: (seconds: number) => void;
      enter: () => void;
      open: (id: PanelId) => void;
      close: () => void;
      visit: (id: PlaceId) => void;
      tp: (x: number, y: number) => void;
      tap: (x: number, y: number) => void;
      happen: (kind: Moment) => void;
      page: (x: number, y: number) => Pt;
      who: () => { name: string; x: number; y: number; doing: string }[];
      /** Real members in town just now (on the guild's own server). */
      visitors: () => { name: string; x: number; y: number }[];
      /** Where the member is, and where the missing crab is hiding. */
      me: () => Pt;
      lost: () => Pt;
      /** Milliseconds to work out and draw one frame, averaged over a hundred. */
      bench: () => number;
      /** Goes into a game by its door; says where that has got to; comes back out. */
      inside: (id: GameId) => void;
      door: () => "town" | "closing in" | ReturnType<Visit["state"]>;
      leave: () => void;
      /** Stops the town's clock (it is still drawn), so that `skip` alone moves it on. */
      hold: (on: boolean) => void;
      /** Puts `n` Coins in the purse, for a tour that buys things; only with the made-up guild, never live. */
      coins: (n: number) => void;
      /** What the town has kept, as it would be saved now. */
      kept: () => unknown;
      /** Which place is on the stage, and how dark the walk between two has got (0 for not at all). */
      where: () => { where: "town" | "camp"; dark: number };
      /** The member's camp, and guild-mates': go there, come back, and what `campscene.ts` offers besides. */
      camp: CampScene["handles"] & { go: () => void };
    };
  }
}

/** How long the view takes to close in on a door, and to open out again, in seconds. */
const CLOSE_IN = 0.55;
/** How long night takes to close in on somebody walking off to another place, and to lift on them walking in. */
const NIGHTFALL = 0.6;
const DAYBREAK = 0.75;
/** How long the pointer rests on a thing before its tip shows, in milliseconds. */
const REST = 400;

/** A point on the page, as a point in the scene. */
function toWorld(pageX: number, pageY: number): Pt {
  const k = G.view.dpr / G.view.z;
  return { x: pageX * k + Math.round(G.cam.x), y: pageY * k + Math.round(G.cam.y) };
}

/** A box in the world as a box on the page. */
function pageBox(h: Hover): { x: number; y: number; w: number; h: number } {
  const a = toPage(h.box.x, h.box.y);
  const b = toPage(h.box.x + h.box.w, h.box.y + h.box.h);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

async function boot(): Promise<void> {
  await fontsReady();
  const sprites = makeSprites();
  if (new URLSearchParams(location.search).has("sheet")) {
    const looks = [guild.me().look, guild.keeper().look, ...guild.roster().map((m) => m.look)];
    for (const id of ["purse", "corner", "dock", "feed"]) document.getElementById(id)?.remove();
    if (new URLSearchParams(location.search).get("sheet") === "camp") {
      showCampSheet(makeCampArt(sprites));
      return;
    }
    showSheet(
      sprites,
      looks.map((l) => bake(paintSkin(l))),
    );
    return;
  }

  const canvas = must(document.querySelector<HTMLCanvasElement>("#view"), "canvas");
  const ctx = must(canvas.getContext("2d"), "2d context");
  /** Canvas pixels to one pixel of the font, for the words written over the world. */
  let wordPx = 2;

  // ---------- the camera ----------

  /** Points the camera at what the scene says matters, keeping it clear of whatever panel is open. */
  function aim(snap: boolean): void {
    const k = G.view.dpr / G.view.z;
    const vw = G.view.w;
    const vh = G.view.h;
    let fw = vw;
    let fh = vh;
    const box = panelBox();
    if (box) {
      if (box.width > window.innerWidth * 0.7) fh = Math.max(40, box.top * k);
      else fw = Math.max(40, box.left * k);
    }
    const at = scene.focus();
    const { w, top, bottom } = scene.bounds;
    let tx = at.x - fw / 2;
    let ty = at.y - fh / 2;
    tx = vw > w + (vw - fw) ? (w - vw) / 2 : clamp(tx, 0, w - fw);
    ty = fh > bottom - top ? top + (bottom - top - fh) / 2 : clamp(ty, top, bottom - fh);
    const ease = snap ? 1 : 0.12;
    G.cam.x += (tx - G.cam.x) * ease;
    G.cam.y += (ty - G.cam.y) * ease;
  }

  function resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(window.innerWidth * dpr));
    const ch = Math.max(1, Math.round(window.innerHeight * dpr));
    canvas.width = cw;
    canvas.height = ch;
    // `?zoom=2` shows more of a place at once, for looking at how it is laid out.
    const asked = Math.floor(Number(new URLSearchParams(location.search).get("zoom")));
    const z = asked > 0 ? asked : Math.max(1, Math.floor(Math.min(cw / 160, ch / 176)));
    G.view = { w: Math.ceil(cw / z), h: Math.ceil(ch / z), z, dpr };
    // The usual text size; on a sharp screen, the size the kit gives second lines.
    wordPx = Math.max(1, Math.round(unit() * dpr * (dpr >= 2 ? 0.75 : 1)));
    scene.resize(G.view.w, G.view.h);
    aim(true);
    if (paused) draw();
  }

  // ---------- through a door, and back ----------

  /**
   * The view closes in on a point of the scene before a game opens, and opens out from it after:
   * `open` runs from 1 (the whole view) down to 0 (shut).
   */
  const iris = { at: { x: 0, y: 0 }, open: 1, goal: 1 };
  let visit: Visit | null = null;
  let inside: GameId | null = null;
  /** A game is open over the town: nothing here is stepped or drawn until it is put away. */
  let paused = false;
  let running = false;
  /** The clock is being stepped by hand from outside. */
  let heldStill = false;

  const stage: Stage = {
    goInside(game, at) {
      if (visit) return;
      inside = game;
      // The game says where the member is while it is open.
      guild.here(null);
      iris.at = at;
      iris.goal = 0;
      hush(true);
      visit = goIn(GAMES[game], {
        news(text, tone) {
          hooks.feed(text, tone);
        },
        back() {
          visit = null;
          paused = false;
          iris.goal = 1;
          hush(false);
          if (inside) scene.cameBack(inside);
          inside = null;
          guild.here(G.where);
          wake();
        },
      });
    },
    snap() {
      aim(true);
    },
    put(next) {
      scene = next;
      scene.resize(G.view.w, G.view.h);
      aim(true);
    },
    travel(next, swap) {
      if (trip) return;
      trip = { next, swap, there: false };
      tipOff(TIP);
    },
  };
  /** A walk from one place to another, part-way through: night closing in, or lifting. */
  let trip: { next: Scene; swap: () => void; there: boolean } | null = null;

  initHud();
  const art = makeCampArt(sprites);
  const town = makeTown(sprites, art, stage);
  const campUi = makeCampUi(art, sprites);
  const camp = makeCamp(sprites, art, stage, town, town.backdrop, campUi);
  campUi.bind(camp);
  town.toCamp = (): void => {
    stage.travel(camp, () => {
      camp.enter(null);
    });
  };
  /** The place that is on screen: the town to begin with. */
  let scene: Scene = town;

  // ---------- keys and fingers ----------

  const keys = new Set<string>();
  let held: { x: number; y: number; sx: number; sy: number; steer: boolean } | null = null;
  /** A finger or the mouse is down on the world. */
  let down = false;
  let mouse: Pt | null = null;
  /** What the pointer is resting on, since when, and whether its tip is up. */
  let rest: { hover: Hover; since: number; shown: boolean } | null = null;
  const TIP = {};
  let pressed = 0;

  window.addEventListener("keydown", (e) => {
    unlock();
    if (paused) return;
    const k = e.key.toLowerCase();
    const onButton = e.target instanceof HTMLButtonElement;
    if (k === "enter" || k === " " || k === "e") {
      if (dismissArrival()) {
        e.preventDefault();
        return;
      }
      // A button that has the keyboard answers Enter and Space itself.
      if (!e.repeat && (k === "e" || !onButton)) scene.act();
      if (k === " " && !onButton) e.preventDefault();
      return;
    }
    if (!scene.awake()) return;
    if (k === "escape") {
      scene.back();
      return;
    }
    if (scene.key(k)) {
      e.preventDefault();
      return;
    }
    if (k.startsWith("arrow")) e.preventDefault();
    keys.add(k);
  });
  window.addEventListener("keyup", (e) => {
    keys.delete(e.key.toLowerCase());
  });
  window.addEventListener("blur", () => {
    keys.clear();
    held = null;
  });
  document.addEventListener("pointerdown", unlock, true);

  /** What a thing is: its card, for a camp thing; a line, for anything else. */
  function showTip(h: Hover, pinned = false): void {
    const box = pageBox(h);
    if (h.ref) {
      if (pinned) pickCard(h.ref, box.x, box.y, box.w, box.h);
      else point(h.ref, box.x, box.y, box.w, box.h);
      return;
    }
    if (h.tip) tipAt(box, h.tip[0], h.tip[1], TIP);
  }

  canvas.addEventListener("pointerdown", (e) => {
    tipOff(TIP);
    window.clearTimeout(pressed);
    const finger = e.pointerType !== "mouse";
    const at = toWorld(e.clientX, e.clientY);
    const groundTap = scene.tap(at.x, at.y, finger);
    held = groundTap ? { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, steer: false } : null;
    down = true;
    canvas.setPointerCapture(e.pointerId);
    // A finger kept on a thing asks what it is: a camp thing's card stays until put away, a line goes by itself.
    if (finger && !groundTap)
      pressed = window.setTimeout(() => {
        const h = scene.point(at);
        if (h) showTip(h, true);
        window.setTimeout(() => {
          tipOff(TIP);
          scene.point(null);
        }, 2200);
      }, LONG_PRESS);
  });
  canvas.addEventListener("pointerleave", () => {
    mouse = null;
  });
  canvas.addEventListener("pointermove", (e) => {
    mouse = e.pointerType === "mouse" ? { x: e.clientX, y: e.clientY } : null;
    if (down) scene.drag(toWorld(e.clientX, e.clientY));
    if (!held) return;
    held.x = e.clientX;
    held.y = e.clientY;
    if (!held.steer && Math.hypot(held.x - held.sx, held.y - held.sy) > 10) held.steer = true;
  });
  const lift = (e: PointerEvent): void => {
    held = null;
    window.clearTimeout(pressed);
    if (!down) return;
    down = false;
    scene.release(toWorld(e.clientX, e.clientY), document.elementFromPoint(e.clientX, e.clientY));
  };
  canvas.addEventListener("pointerup", lift);
  canvas.addEventListener("pointercancel", lift);
  window.addEventListener("resize", resize);

  function steering(): Steer {
    const dx = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
    const dy = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
    return { dx, dy, toward: held?.steer ? toWorld(held.x, held.y) : null };
  }

  /** The mouse resting on a thing marks it, and after a moment says what it is. */
  function pointing(): void {
    const h = mouse ? scene.point(toWorld(mouse.x, mouse.y)) : null;
    if (!mouse) scene.point(null);
    canvas.style.cursor = h ? "pointer" : "default";
    // A camp thing explains itself through the cards, which keep their own time.
    if (h?.ref || rest?.hover.ref) {
      const box = h ? pageBox(h) : null;
      point(h?.ref ?? null, box?.x ?? 0, box?.y ?? 0, box?.w ?? 0, box?.h ?? 0);
    }
    const same = h && rest && h.tip === rest.hover.tip && h.box.x === rest.hover.box.x && h.box.y === rest.hover.box.y;
    if (same && rest) {
      if (!rest.shown && !rest.hover.ref && performance.now() - rest.since > REST) {
        rest.shown = true;
        showTip(rest.hover);
      }
      return;
    }
    if (rest?.shown) tipOff(TIP);
    rest = h ? { hover: h, since: performance.now(), shown: false } : null;
  }

  // ---------- every moment ----------

  function tick(dt: number): void {
    scene.step(dt, steering());
    if (trip && !trip.there) {
      // Night closes in on whoever is walking off; at its darkest the next place is put on.
      G.dark = Math.min(1, G.dark + dt / NIGHTFALL);
      if (G.dark >= 1) {
        trip.there = true;
        keys.clear();
        held = null;
        closePanel();
        closeCard();
        clearFx();
        show.prompt = null;
        show.promptT = 0;
        show.hover = null;
        show.pointed = null;
        show.dest = null;
        trip.swap();
        scene = trip.next;
        scene.resize(G.view.w, G.view.h);
        aim(true);
        guild.here(G.where);
      }
    } else if (trip) {
      G.dark = Math.max(0, G.dark - dt / DAYBREAK);
      if (G.dark <= 0) trip = null;
    }
    if (iris.open !== iris.goal) {
      const d = iris.goal - iris.open;
      iris.open += Math.sign(d) * Math.min(Math.abs(d), dt / CLOSE_IN);
    }
    if (visit && iris.open <= 0 && !paused) {
      // The view has closed in: the game takes the page from here.
      paused = true;
      keys.clear();
      held = null;
      const at = toPage(iris.at.x, iris.at.y);
      visit.arrived(at);
    }
  }

  function draw(): void {
    const small = scene.draw();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, small.width * G.view.z, small.height * G.view.z);
    scene.words(ctx, wordPx);
    if (iris.open >= 1) return;
    const at = toPage(iris.at.x, iris.at.y);
    const x = at.x * G.view.dpr;
    const y = at.y * G.view.dpr;
    const far = Math.hypot(Math.max(x, canvas.width - x), Math.max(y, canvas.height - y));
    // Slow at the last, so the eye lands on the door.
    drawIris(ctx, x, y, far * iris.open * iris.open, G.view.z);
  }

  let last = performance.now();
  function frame(now: number): void {
    if (paused) {
      running = false;
      return;
    }
    const dt = heldStill ? 0 : Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (dt > 0) tick(dt);
    aim(false);
    pointing();
    tickHud(dt);
    draw();
    requestAnimationFrame(frame);
  }
  function wake(): void {
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }

  resize();
  town.arrive();
  guild.here("town");
  wake();

  window.town = {
    ...town.handles,
    skip(seconds) {
      for (let i = 0; i < seconds * 30 && !paused; i++) tick(1 / 30);
      aim(true);
    },
    happen: stir,
    page(x, y) {
      return toPage(x, y);
    },
    bench() {
      const t0 = performance.now();
      for (let i = 0; i < 100; i++) {
        tick(1 / 60);
        draw();
      }
      return (performance.now() - t0) / 100;
    },
    door() {
      return visit ? (paused ? visit.state() : "closing in") : "town";
    },
    leave() {
      visit?.leave();
    },
    hold(on) {
      heldStill = on;
    },
    coins(n) {
      if (where().mode !== "live") earn(n, "a tour's pocket money");
    },
    where: () => ({ where: G.where, dark: Math.round(G.dark * 100) / 100 }),
    camp: {
      ...camp.handles,
      go() {
        hooks.toCamp();
      },
    },
  };
  // In whichever place is on the stage: the member, a touch, and the point on the page.
  const outside = window.town;
  outside.tap = (x, y): void => {
    scene.tap(x, y, false);
    scene.release({ x, y }, null);
  };
  outside.me = (): Pt => (G.player ? { x: Math.round(G.player.x), y: Math.round(G.player.y) } : { x: 0, y: 0 });
}

void boot();
