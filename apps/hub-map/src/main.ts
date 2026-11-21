/**
 * The Living Map: the guild's home screen as a map of its province. This file ties the parts
 * together: it plays the "while you were away" moment, sends the member walking when they choose a
 * place, turns touches into reactions, and runs the frame loop.
 */
import { setScene as setSound, sfx, unlock } from "./audio.ts";
import * as fx from "./fx.ts";
import {
  emote,
  findStray,
  force,
  gainCoins,
  gainLeaf,
  goLive,
  hooks,
  hop,
  init,
  lanterns,
  members,
  pushes,
  raids,
  send,
  state,
  update,
  welcome,
  you,
} from "./game.ts";
import { makeLands } from "./lands.ts";
import { P } from "./palette.ts";
import { type Ctx, type IconId, ICONS } from "./pix.ts";
import { clamp } from "./rand.ts";
import { fromImage } from "./skins.ts";
import { buildTerrain, KIND } from "./terrain.ts";
import * as ui from "./ui.ts";
import {
  ambient,
  boat,
  cam,
  dragBy,
  fling,
  flyTo,
  follow,
  grab,
  hot,
  minZoom,
  pickAt,
  poke,
  render,
  renderTop,
  setHover,
  setScene,
  toScreen,
  updateCamera,
  view,
  zoomBy,
} from "./view.ts";
import { CAMP, FIRE, GATES, LANDS, LIGHTHOUSE, MILL, type PlaceId, place, POND, RIVAL, ROPE, STONES, WORKS } from "./world.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#map") as HTMLCanvasElement;
const g = canvas.getContext("2d", { alpha: false }) as Ctx;
const top = document.querySelector<HTMLCanvasElement>("#fx") as HTMLCanvasElement;
const tg = top.getContext("2d") as Ctx;

const terrain = buildTerrain();
const lands = makeLands(terrain);
setScene(terrain, lands);
init(lands);
hooks.feed = ui.pushFeed;
hooks.toast = ui.toast;
hooks.purse = ui.purseChanged;
hooks.quests = ui.questsChanged;
ui.initUI(lands);

// The member's own skin, if there is one beside the page; until it loads, and if it never does, a made-up one.
const skin = new Image();
skin.addEventListener("load", () => {
  you.skin = fromImage(skin);
  ui.skinChanged();
});
skin.src = "skins/player.png";

function resize(): void {
  view.dpr = Math.min(devicePixelRatio || 1, 2);
  view.w = innerWidth;
  view.h = innerHeight;
  for (const c of [canvas, top]) {
    c.width = Math.round(view.w * view.dpr);
    c.height = Math.round(view.h * view.dpr);
  }
  ui.resized();
  view.l = view.wantL;
  view.t = view.wantT;
  view.r = view.wantR;
  view.b = view.wantB;
}
addEventListener("resize", resize);
resize();
cam.x = 500;
cam.y = 372;
cam.z = Math.max(minZoom(), innerWidth < 720 ? 1.2 : 1.3);

// ---------- while you were away: replayed on the map, then summed up ----------

type Step = { x: number; y: number; z: number; icon: IconId; text: string; col: string; note: string; cols: string[]; sound: () => void };
const AWAY: Step[] = [
  {
    x: GATES.gateA.x,
    y: GATES.gateA.y - 8,
    z: 2.6,
    icon: "leaf",
    text: "+18 Leaf",
    col: P.g4,
    note: "A raid cleared at Gloamgate, with Bramblewick's party",
    cols: [P.rose, P.plum3, P.cream],
    sound: sfx.ring,
  },
  {
    x: GATES.gateC.x,
    y: GATES.gateC.y - 8,
    z: 2.6,
    icon: "leaf",
    text: "+22 Leaf",
    col: P.g4,
    note: "Another at Emberroot Gate, with Oakum's",
    cols: [P.coral, P.amber, P.cream],
    sound: sfx.ring,
  },
  {
    x: (LANDS[6] as (typeof LANDS)[number]).bx,
    y: (LANDS[6] as (typeof LANDS)[number]).by - 6,
    z: 2.3,
    icon: "banner",
    text: "Fernhollow won",
    col: P.gold2,
    note: "The guild raised its banner over Fernhollow",
    cols: [P.gold1, P.gold2, P.cream],
    sound: sfx.banner,
  },
  {
    x: WORKS.x,
    y: WORKS.y - 14,
    z: 2.8,
    icon: "coin",
    text: "+340 Coins",
    col: P.gold2,
    note: "Your Works made 24 planks and 6 gears",
    cols: [P.gold1, P.gold2, P.s3],
    sound: sfx.coin,
  },
  {
    x: CAMP.x + 8,
    y: CAMP.y - 6,
    z: 3,
    icon: "heart",
    text: "2 visitors",
    col: P.coral,
    note: "Tansyfoot and Pipkin stopped by your camp",
    cols: [P.coral, P.rose, P.cream],
    sound: sfx.wave,
  },
];
const away = { on: true, t: 0, i: -1, burst: false, card: false };

function stepAway(dt: number): void {
  if (!away.on || away.card) return;
  away.t += dt;
  if (away.i < 0) {
    if (away.t < 0.8) return;
    away.i = 0;
    away.t = 0;
    const s = AWAY[0] as Step;
    flyTo(s.x, s.y, s.z, 0.6);
    return;
  }
  const s = AWAY[away.i] as Step;
  if (!away.burst && away.t >= 0.6) {
    away.burst = true;
    fx.sparks(s.x, s.y - 4, s.cols, 24, 42);
    fx.ring(s.x, s.y, s.cols[0] as string, 26, 0.8);
    fx.ring(s.x, s.y, P.cream, 14, 0.5);
    fx.float(s.x, s.y - 12, s.text, s.col, ICONS[s.icon], 1.5);
    if (s.icon === "banner") fx.bits(s.x, s.y - 8, s.cols, 16);
    ui.awayNote(s.note);
    s.sound();
  }
  if (away.t >= 1.35) {
    away.i++;
    away.t = 0;
    away.burst = false;
    const next = AWAY[away.i];
    if (next) flyTo(next.x, next.y, next.z, 0.6);
    else sumUp();
  }
}

function sumUp(): void {
  if (away.card) return;
  away.card = true;
  flyTo(500, 380, Math.max(minZoom(), 1.3), 0.9);
  ui.showAwayCard(
    [
      { icon: "lantern", title: "Two raids cleared", sub: "Gloamgate and Emberroot Gate", gain: "+40 Leaf" },
      { icon: "cog", title: "Your Works kept going", sub: "24 planks and 6 gears", gain: "+340 Coins" },
      { icon: "banner", title: "Fernhollow was won", sub: "The guild holds 13 lands", gain: "" },
      { icon: "heart", title: "Two visitors", sub: "Tansyfoot and Pipkin. One left a pinecone.", gain: "" },
    ],
    comeHome,
  );
}

function comeHome(from: { x: number; y: number }): void {
  if (!away.on) return;
  away.on = false;
  ui.endAway();
  sfx.leaf();
  ui.flyToPurse("leaf", from, 10);
  ui.flyToPurse("coins", from, 10);
  setTimeout(() => {
    gainLeaf(40);
    gainCoins(340);
  }, 650);
  flyTo(CAMP.x + 12, CAMP.y - 6, 3.3, 1.2);
  goLive();
  // The feed begins with what was just replayed, so it is never an empty column.
  const told = [
    "You cleared <i>Gloamgate</i> with <b>Bramblewick's</b> party · 18 Leaf",
    "You cleared <i>Emberroot Gate</i> with <b>Oakum's</b> party · 22 Leaf",
    "The guild raised its banner over <i>Fernhollow</i>",
    "Your Works made 24 planks and 6 gears · 340 Coins",
    "<b>Tansyfoot</b> and <b>Pipkin</b> stopped by your camp",
  ];
  AWAY.forEach((s, i) => hooks.feed({ icon: s.icon === "leaf" ? "lantern" : s.icon === "coin" ? "cog" : s.icon, html: told[i] as string, x: s.x, y: s.y, earlier: true }));
  // Out of the tent, with a wave.
  setTimeout(() => {
    hop(you);
    emote(you, "hand", 1.8);
    fx.sparks(you.x, you.y - 10, [P.gold2, P.cream, P.g4], 20, 34);
    fx.ring(you.x, you.y, P.gold2, 20, 0.8);
    fx.dust(you.x, you.y, 6);
    sfx.arrive();
    ui.toast("Home. Tap a place on the map, or use the dock.");
  }, 1150);
  setTimeout(welcome, 2400);
}

// ---------- going somewhere ----------

function goTo(id: PlaceId): void {
  if (away.on) return;
  const p = place(id);
  ui.closeCard();
  if (id === "town") {
    ui.closePanel();
    sfx.go();
    flyTo(p.hx, p.hy + 6, 3.4);
    return;
  }
  const arrive = (): void => {
    ui.setGoing(null);
    sfx.arrive();
    hop(you);
    fx.dust(you.x, you.y, 5);
    fx.ring(you.x, you.y, P.gold2, 12, 0.5);
    ui.openPanel(id);
    flyTo(p.hx, p.hy + 4, Math.max(Math.min(cam.z, 4.4), p.zoom), 0.7);
  };
  if (you.at === p.node && !you.route) {
    if (ui.panelOpen() === id) flyTo(p.hx, p.hy + 4, Math.max(cam.z, p.zoom), 0.6);
    else arrive();
    return;
  }
  ui.closePanel();
  sfx.go();
  ui.setGoing(id);
  const len = send(you, p.node, { then: arrive });
  // Never a long wait: a far walk is a brisk one.
  you.speed = len / clamp(len / 85, 0.7, 3.2);
  follow(you, clamp(p.zoom - 0.5, 2.4, 3.2));
}
ui.act.goTo = goTo;
ui.act.ping = (x, y) => {
  fx.ring(x, y, P.gold2, 24, 0.9);
  fx.ring(x, y, P.cream, 12, 0.6);
};
ui.act.zoom = (factor) => zoomBy(factor, (view.l + view.w - view.r) / 2, (view.t + view.h - view.b) / 2);

// ---------- touches ----------

let lastLand = -1;
let lastLandAt = 0;
function tap(sx: number, sy: number): void {
  if (away.on) {
    if (!away.card) sumUp();
    return;
  }
  const hit = pickAt(sx, sy);
  switch (hit.kind) {
    case "member":
      sfx.tap();
      hop(hit.m);
      ui.openCard(hit.m);
      break;
    case "stray": {
      const r = findStray();
      sfx.crab();
      sfx.level();
      gainCoins(3);
      ui.toast(`Crab No. ${r.found}, found ${r.where}!`);
      hooks.feed({
        icon: "crab",
        html: `You found <b>Crab No. ${r.found}</b> ${r.where}. It has been counted. No. ${r.gone} is now unaccounted for.`,
        x: POND.x,
        y: POND.y,
      });
      break;
    }
    case "crab":
      hit.c.hop = 0.5;
      fx.float(hit.c.x, hit.c.y - 6, `No. ${hit.c.n}`, P.coral, null, 1);
      sfx.crab();
      break;
    case "place":
      fx.ring(hit.p.hx, hit.p.hy, P.gold2, Math.min(24, hit.p.hr), 0.5);
      goTo(hit.p.id);
      break;
    case "rope":
      poke.rope = 1;
      for (const l of lanterns) l.swing = 1;
      sfx.jingle();
      fx.sparks((ROPE.ax + ROPE.bx) / 2, ROPE.ay + 8, [P.gold2, P.cream], 8, 16);
      break;
    case "mill":
      poke.mill = 1;
      sfx.sweep();
      fx.float(MILL.x, MILL.y - 34, "whirr", P.cream, null, 1.1);
      break;
    case "light":
      poke.light = 1;
      sfx.soft();
      fx.sparks(LIGHTHOUSE.x, LIGHTHOUSE.y - 27, [P.gold2, P.cream], 10, 24);
      break;
    case "stones":
      poke.stones = 1;
      sfx.stone();
      fx.ring(STONES.x, STONES.y, P.rose, 22, 1.1);
      fx.sparks(STONES.x, STONES.y - 4, [P.rose, P.plum3, P.cream], 10, 16);
      fx.float(STONES.x, STONES.y - 14, "hmmmm", "#f3c4e4", null, 1.4);
      break;
    case "boat":
      poke.boat = 1;
      sfx.splash();
      fx.ring(boat.x, boat.y, P.w4, 10, 0.8, true);
      fx.float(boat.x, boat.y - 12, "ahoy!", P.cream, null, 1.2);
      break;
    case "flag": {
      const l = LANDS[hit.land] as (typeof LANDS)[number];
      const o = lands.owner[hit.land];
      sfx.tap();
      fx.bits(l.bx + 3, l.by - 12, o === 0 ? [P.gold1, P.gold2, P.cream] : [P.coral, P.rose], 10);
      ui.toast(o === 0 ? `${l.name}: the guild's banner flies here.` : `${l.name}: ${RIVAL} hold it, for now.`);
      break;
    }
    case "ground": {
      ui.closeCard();
      const { x, y, what } = hit;
      if (what === KIND.sea || what === KIND.river) {
        fx.ring(x, y, P.w4, 7, 0.7, true);
        fx.ring(x, y, P.cream, 4, 0.45, true);
        sfx.splash();
      } else if (what === KIND.forest) {
        fx.leaves(x, y, 8);
        sfx.rustle();
      } else if (what === KIND.sand || what === KIND.road) {
        fx.dust(x, y, 5, what === KIND.sand ? P.sand2 : "#c9a984");
        sfx.step();
      } else if (what === KIND.rock) {
        fx.sparks(x, y, [P.s3, P.cream], 4, 14);
        sfx.tick();
      } else {
        fx.sparks(x, y, [P.g4, P.gold2, P.cream], 5, 16);
        fx.leaves(x, y, 2);
        sfx.soft();
      }
      const now = performance.now();
      if (hit.land !== 255 && (hit.land !== lastLand || now - lastLandAt > 4000)) {
        lastLand = hit.land;
        lastLandAt = now;
        const l = LANDS[hit.land] as (typeof LANDS)[number];
        const o = lands.owner[hit.land];
        ui.toast(`${l.name} · ${o === 0 ? "held by the guild" : o === 2 ? `held by ${RIVAL}` : "wild land, nobody's yet"}`);
      }
    }
  }
}

const pointers = new Map<number, { x: number; y: number }>();
let drag: { x0: number; y0: number; moved: boolean; at: number; vx: number; vy: number } | null = null;
let pinch: { d: number; mx: number; my: number } | null = null;
const two = (): { d: number; mx: number; my: number } => {
  const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
  return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
};

canvas.addEventListener("contextmenu", (e) => e.preventDefault());
// Sound begins with the first touch, wherever it lands.
document.addEventListener("pointerdown", unlock, { capture: true });
canvas.addEventListener("pointerdown", (e) => {
  unlock();
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) drag = { x0: e.clientX, y0: e.clientY, moved: false, at: performance.now(), vx: 0, vy: 0 };
  else if (pointers.size === 2) {
    pinch = two();
    if (drag) drag.moved = true;
    grab();
  }
});
canvas.addEventListener("pointermove", (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) {
    if (e.pointerType === "mouse" && !away.on) {
      const hit = pickAt(e.clientX, e.clientY);
      setHover(hit.kind === "member" ? hit.m : null);
      canvas.classList.toggle("hot", hot(e.clientX, e.clientY));
    }
    return;
  }
  const dx = e.clientX - p.x;
  const dy = e.clientY - p.y;
  p.x = e.clientX;
  p.y = e.clientY;
  if (pointers.size >= 2 && pinch) {
    const now = two();
    zoomBy(now.d / pinch.d, now.mx, now.my, false);
    dragBy(now.mx - pinch.mx, now.my - pinch.my);
    pinch = now;
    return;
  }
  if (!drag || away.on) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 6) {
    drag.moved = true;
    grab();
    canvas.classList.add("dragging");
  }
  if (drag.moved) {
    dragBy(dx, dy);
    const now = performance.now();
    const ms = Math.max(1, now - drag.at);
    drag.vx = drag.vx * 0.5 + ((dx / ms) * 1000) * 0.5;
    drag.vy = drag.vy * 0.5 + ((dy / ms) * 1000) * 0.5;
    drag.at = now;
  }
});
function release(e: PointerEvent, cancelled: boolean): void {
  if (!pointers.delete(e.pointerId)) return;
  if (pointers.size < 2) pinch = null;
  if (pointers.size > 0 || !drag) return;
  if (!drag.moved && !cancelled) tap(e.clientX, e.clientY);
  else if (drag.moved && performance.now() - drag.at < 90) fling(drag.vx, drag.vy);
  drag = null;
  canvas.classList.remove("dragging");
}
canvas.addEventListener("pointerup", (e) => release(e, false));
canvas.addEventListener("pointercancel", (e) => release(e, true));
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (away.on) return;
    zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0017)), e.clientX, e.clientY);
  },
  { passive: false },
);
window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Escape") {
    ui.closeCard();
    ui.closePanel();
  } else if (e.key === "+" || e.key === "=") ui.act.zoom(1.4);
  else if (e.key === "-") ui.act.zoom(1 / 1.4);
  else if (e.key.startsWith("Arrow") && !away.on) {
    grab();
    const d = 60;
    dragBy(e.key === "ArrowLeft" ? d : e.key === "ArrowRight" ? -d : 0, e.key === "ArrowUp" ? d : e.key === "ArrowDown" ? -d : 0);
  }
});

// ---------- the loop ----------

let soundClock = 0;
function tick(dt: number): void {
  stepAway(dt);
  update(dt);
  fx.update(dt);
  ambient(dt);
  updateCamera(dt);
  ui.tickUI(dt);
  soundClock += dt;
  if (soundClock > 0.3) {
    soundClock = 0;
    const close = clamp((cam.z - 1.8) / 2, 0, 1);
    const toFire = Math.min(Math.hypot(cam.x - FIRE.x, cam.y - FIRE.y), Math.hypot(cam.x - CAMP.fireX, cam.y - CAMP.fireY));
    const shoreInView = clamp((cam.x + view.w / 2 / cam.z - 850) / 160, 0, 1);
    setSound(close * clamp(1 - toFire / 110, 0, 1), shoreInView * (0.4 + close * 0.6));
  }
}
let topDirty = false;
function draw(): void {
  render(g);
  if (topDirty) {
    tg.setTransform(1, 0, 0, 1, 0, 0);
    tg.clearRect(0, 0, top.width, top.height);
  }
  topDirty = renderTop(tg);
}
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  tick(dt);
  draw();
  requestAnimationFrame(frame);
}
tick(0);
draw();
canvas.classList.add("ready");
requestAnimationFrame(frame);

// A handle for looking at the thing from outside: jump the clock, go somewhere, make something happen.
Object.assign(window, {
  hub: {
    cam,
    view,
    state,
    members,
    advance(seconds: number, step = 1 / 30): number {
      for (let t = 0; t < seconds; t += step) tick(step);
      draw();
      return state.T;
    },
    goTo,
    open: ui.openPanel,
    fly(x: number, y: number, z: number): void {
      flyTo(x, y, z, 0.01);
      tick(0.05);
      draw();
    },
    /** Runs the clock on until something is so (or `max` seconds pass). */
    until(cond: () => boolean, max = 60): number {
      for (let t = 0; t < max && !cond(); t += 1 / 30) tick(1 / 30);
      draw();
      return state.T;
    },
    /** How long a frame takes to work out and draw, in milliseconds, over a hundred of them. */
    bench(): number {
      const t0 = performance.now();
      for (let i = 0; i < 100; i++) {
        tick(1 / 60);
        draw();
      }
      return (performance.now() - t0) / 100;
    },
    raids,
    pushes,
    lands,
    fx,
    skip: sumUp,
    home: (): void => comeHome({ x: innerWidth / 2, y: innerHeight / 2 }),
    force,
    tap,
    at: (x: number, y: number) => toScreen(x, y),
  },
});
