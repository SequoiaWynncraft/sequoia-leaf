/**
 * Guild Town: the member arrives as their own character in a small town in a clearing among giant
 * redwoods, where every part of the game is a place to walk up to and guild-mates are about.
 * This file puts the pieces together: who is here, what the keys and fingers do, where the camera
 * looks, and the loop that moves it all.
 */

import { face, footfall, hop, makeActor, release, say, sit, stepActor, stepMates, walkTo } from "./actors.ts";
import { sfx, unlock } from "./audio.ts";
import { CINFY, GREETS, MATES, YOU } from "./cast.ts";
import { after, beginEvents, happen, type Moment, stepEvents } from "./events.ts";
import { ring, updateFx } from "./fx.ts";
import { type Actor, G, hooks, type PanelId } from "./game.ts";
import { paintBackdrop, paintGround, paintNear } from "./ground.ts";
import { GOLD } from "./palette.ts";
import { drawTown, drawWords, show, sizeBuffers, type Stage } from "./scene.ts";
import { showSheet } from "./sheet.ts";
import { bake, paintSkin } from "./skin.ts";
import { makeSprites } from "./sprites.ts";
import {
  buildTown,
  crabAt,
  crabs,
  propAt,
  stepTown,
  tapCrab,
  tapSky,
  tapString,
  tapWater,
  twinkleAll,
} from "./town.ts";
import {
  closeCard,
  closePanel,
  dismissArrival,
  initUI,
  openPanel,
  panelBox,
  refreshFace,
  showArrival,
  showCard,
  tickUI,
} from "./ui.ts";
import { clamp, dist, must, pick, type Pt, type Rect } from "./util.ts";
import { footBlocked, H, hedgeY, nearestFree, place, type PlaceId, PLACES, pondD, SEATS, SPOTS, W } from "./world.ts";

declare global {
  interface Window {
    /** Handles for looking at the town from outside: jump the clock, open a place, move the player. */
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
      /** Where the player is, and where the missing crab is hiding. */
      me: () => Pt;
      lost: () => Pt;
      /** Milliseconds to work out and draw one frame, averaged over a hundred. */
      bench: () => number;
    };
  }
}

/** A point on the page, as a point in the town. */
function toWorld(pageX: number, pageY: number): Pt {
  const k = G.view.dpr / G.view.z;
  return { x: pageX * k + Math.round(G.cam.x), y: pageY * k + Math.round(G.cam.y) };
}

function boot(): void {
  const sprites = makeSprites();
  const bodies = [YOU, CINFY.look, ...MATES.map((m) => m.look)].map((l) => bake(paintSkin(l)));
  if (new URLSearchParams(location.search).has("sheet")) {
    showSheet(sprites, bodies);
    return;
  }

  const canvas = must(document.querySelector<HTMLCanvasElement>("#view"), "canvas");
  const ctx = must(canvas.getContext("2d"), "2d context");
  const ground = paintGround();
  buildTown(sprites, must(ground.getContext("2d"), "ground"));
  const stage: Stage = { sprites, ground, near: paintNear(), sky: paintBackdrop() };

  // ---------- who is here ----------

  const player = makeActor(
    { name: "You", rank: "Ranger", level: G.level, voice: 560, look: YOU },
    must(bodies[0]),
    256,
    85,
    true,
  );
  player.alpha = 0;
  G.player = player;
  const cinfy = makeActor(CINFY, must(bodies[1]), 104, 113);
  cinfy.mode = "led";
  G.cinfy = cinfy;
  G.mates = MATES.map((m, i) => {
    const a = makeActor(m, must(bodies[i + 2]), 256, 216);
    // The evening is already under way: three by the fire, the rest about their errands.
    const seat = [SEATS[0], SEATS[3], SEATS[4]][i];
    const spot = SPOTS[(i * 5 + 2) % SPOTS.length];
    if (seat) {
      sit(a, seat);
      a.x = seat.x;
      a.y = seat.y;
      a.sat = -9;
      a.doing = "fire";
      a.wait = 12 + i * 7;
    } else if (spot) {
      spot.taken = true;
      a.spot = spot;
      a.x = spot.x;
      a.y = spot.y;
      a.dir = spot.dir;
      a.doing = spot.errand;
      a.wait = 3 + i * 1.7;
    }
    a.mode = "busy";
    return a;
  });

  // The member's own skin, if it is there beside the page.
  const skin = new Image();
  skin.addEventListener("load", () => {
    try {
      player.body = bake(skin);
      refreshFace();
    } catch {
      // A picture the page may not read: the made-up skin stays.
    }
  });
  skin.src = "skins/player.png";

  initUI(sprites);

  // ---------- the screen ----------

  function resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(window.innerWidth * dpr));
    const ch = Math.max(1, Math.round(window.innerHeight * dpr));
    canvas.width = cw;
    canvas.height = ch;
    const z = Math.max(1, Math.floor(Math.min(cw / 160, ch / 176)));
    G.view = { w: Math.ceil(cw / z), h: Math.ceil(ch / z), z, dpr };
    sizeBuffers(G.view.w, G.view.h);
    aim(true);
  }

  /** Points the camera at the player, keeping them clear of whatever panel is open. */
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
    const at = player.seat ?? player;
    let tx = at.x - fw / 2;
    let ty = at.y - 12 - fh / 2;
    tx = vw > W + (vw - fw) ? (W - vw) / 2 : clamp(tx, 0, W - fw);
    const top = -72;
    const bottom = H + 24;
    ty = fh > bottom - top ? top + (bottom - top - fh) / 2 : clamp(ty, top, bottom - fh);
    const ease = snap ? 1 : 0.12;
    G.cam.x += (tx - G.cam.x) * ease;
    G.cam.y += (ty - G.cam.y) * ease;
  }

  // ---------- going places ----------

  /** A place the player is walking to, to be opened on arrival. */
  let pending: PlaceId | null = null;
  let throughGate = false;

  function halt(): void {
    release(player);
    player.path = [];
    player.arrive = null;
    pending = null;
    show.dest = null;
  }

  function visit(id: PlaceId, now = false): void {
    const pl = place(id);
    const there =
      dist(player.x, player.y, pl.stand.x, pl.stand.y) < 26 || (id === "fire" && player.seat?.at === "fire");
    if (now || there) openPanel(id);
    if (there) {
      if (!player.seat) player.dir = pl.face;
      return;
    }
    halt();
    pending = now ? null : id;
    if (!now) show.dest = pl.stand;
    walkTo(player, pl.stand, () => {
      player.dir = pl.face;
      show.dest = null;
      if (pending === id) {
        pending = null;
        openPanel(id);
      }
    });
  }
  hooks.visit = visit;

  function personAt(wx: number, wy: number): Actor | null {
    let best: Actor | null = null;
    for (const a of [...G.mates, player, cinfy]) {
      if (a.away || a.alpha < 0.5) continue;
      const at = a.seat ?? a;
      if (Math.abs(wx - at.x) > 7 || wy < at.y - 23 || wy > at.y + 3) continue;
      if (!best || at.y > (best.seat ?? best).y) best = a;
    }
    return best;
  }

  /** What the mouse is resting on, as the box to put corners round; nothing for bare ground. */
  function under(wx: number, wy: number): Rect | null {
    const who = personAt(wx, wy);
    if (who) {
      const at = who.seat ?? who;
      return { x: at.x - 6, y: at.y - 21, w: 12, h: 22 };
    }
    const crab = crabAt(wx, wy);
    if (crab) return { x: crab.x - 6, y: crab.y - 8, w: 12, h: 9 };
    const prop = propAt(wx, wy);
    if (!prop?.hit || prop.kind === "trunk") return null;
    return prop.hit;
  }

  /** A touch somewhere in the town. Returns whether it was bare ground (so a drag may steer). */
  function tapWorld(wx: number, wy: number): boolean {
    closeCard();
    const who = personAt(wx, wy);
    if (who) {
      sfx.pop();
      hop(who);
      if (who.you) {
        say(who, pick(["that's me", "hello, me", "o/"], Math.random()), 1.6);
        return false;
      }
      if (who === cinfy)
        say(
          who,
          pick(["The gold is load-bearing.", "Leaf in, shiny out.", "No, you can't hold the sun."], Math.random()),
        );
      else {
        if (!who.seat) face(who, player.x, player.y);
        who.hold = 2.6;
        say(who, pick(GREETS, Math.random()), 2);
      }
      showCard(who);
      return false;
    }
    const crab = crabAt(wx, wy);
    if (crab) {
      tapCrab(crab);
      return false;
    }
    if (tapString(wx, wy)) return false;
    const prop = propAt(wx, wy);
    if (prop?.tap) {
      prop.tap(prop, wx, wy);
      return false;
    }
    if (wy < hedgeY(wx)) {
      tapSky(wx, wy);
      return false;
    }
    if (pondD(wx, wy) < 1) {
      tapWater(wx, wy);
      visit("pond");
      return false;
    }
    halt();
    if (G.panel) closePanel();
    const to = nearestFree(wx, wy);
    show.dest = to;
    ring(to.x, to.y, GOLD[2], 6);
    sfx.tap();
    walkTo(player, to, () => {
      show.dest = null;
    });
    return true;
  }

  /** The key by a place: open it; or, sitting down, get up. */
  function interact(): void {
    if (show.prompt && show.promptT > 0.4) {
      openPanel(show.prompt.id);
      player.dir = show.prompt.face;
      return;
    }
    if (player.seat) {
      release(player);
      return;
    }
    hop(player);
    sfx.tap();
  }

  // ---------- keys and fingers ----------

  const keys = new Set<string>();
  let held: { x: number; y: number; sx: number; sy: number; steer: boolean } | null = null;

  window.addEventListener("keydown", (e) => {
    unlock();
    const k = e.key.toLowerCase();
    if (!G.home) {
      if (k === "enter" || k === " " || k === "e") dismissArrival();
      return;
    }
    if (k === "escape") {
      if (G.panel) closePanel();
      else closeCard();
      return;
    }
    if (k === "e" || k === " " || k === "enter") {
      if (!e.repeat && !(e.target instanceof HTMLButtonElement)) interact();
      if (k === " ") e.preventDefault();
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

  canvas.addEventListener("pointerdown", (e) => {
    show.touch = e.pointerType !== "mouse";
    if (!G.home) return;
    const at = toWorld(e.clientX, e.clientY);
    const groundTap = tapWorld(at.x, at.y);
    held = groundTap ? { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, steer: false } : null;
    if (held) canvas.setPointerCapture(e.pointerId);
  });
  let mouse: Pt | null = null;
  canvas.addEventListener("pointerleave", () => {
    mouse = null;
  });
  canvas.addEventListener("pointermove", (e) => {
    mouse = e.pointerType === "mouse" ? { x: e.clientX, y: e.clientY } : null;
    if (!held) return;
    held.x = e.clientX;
    held.y = e.clientY;
    if (!held.steer && Math.hypot(held.x - held.sx, held.y - held.sy) > 10) held.steer = true;
  });
  const lift = (): void => {
    held = null;
  };
  canvas.addEventListener("pointerup", lift);
  canvas.addEventListener("pointercancel", lift);
  window.addEventListener("resize", resize);

  /** Walking by hand: the keys, or a finger held down and dragged. */
  function steer(dt: number): void {
    let dx = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
    let dy = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
    if (dx === 0 && dy === 0 && held?.steer) {
      const to = toWorld(held.x, held.y);
      if (dist(to.x, to.y, player.x, player.y) > 5) {
        dx = to.x - player.x;
        dy = to.y - player.y;
      }
    }
    if (dx === 0 && dy === 0) return;
    if (player.seat || player.path.length > 0 || pending) halt();
    const len = Math.hypot(dx, dy);
    const go = player.speed * dt;
    const before = player.walked;
    const nx = player.x + (dx / len) * go;
    const ny = player.y + (dy / len) * go;
    let moved = 0;
    if (!footBlocked(nx, player.y)) {
      moved += Math.abs(nx - player.x);
      player.x = nx;
    }
    if (!footBlocked(player.x, ny)) {
      moved += Math.abs(ny - player.y);
      player.y = ny;
    }
    player.dir = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 1 : 2) : dy < 0 ? 3 : 0;
    if (moved > 0) {
      player.walked += moved;
      player.moving = true;
      footfall(player, before);
    }
  }

  /** The place the player is standing at, if any: the prompt hangs by it. */
  function nearPlace(): PlaceId | null {
    for (const pl of PLACES) {
      if (G.panel === pl.id) continue;
      const d = dist(player.x, player.y, pl.stand.x, pl.stand.y);
      if (d < 22) return pl.id;
      if (pl.id === "pond" && pondD(player.x, player.y) < 13) return pl.id;
      if (pl.id === "fire" && (player.seat?.at === "fire" || dist(player.x, player.y, 256, 214) < 30)) return pl.id;
    }
    return null;
  }

  // ---------- every moment ----------

  function step(dt: number): void {
    G.t += dt;
    stepActor(player, dt);
    if (G.home) steer(dt);
    stepActor(cinfy, dt);
    stepMates(dt);
    stepTown(dt);
    stepEvents();
    updateFx(dt);

    const over = mouse && G.home ? toWorld(mouse.x, mouse.y) : null;
    show.hover = over ? under(over.x, over.y) : null;
    canvas.style.cursor = show.hover ? "pointer" : "default";

    const near = G.home ? nearPlace() : null;
    if (near) show.prompt = place(near);
    show.promptT = clamp(show.promptT + (near ? dt : -dt) * 5, 0, 1);

    // Stepping into the gateway is asking about the camp beyond it.
    if (G.home && player.y < 92 && !throughGate) {
      throughGate = true;
      openPanel("camp");
    } else if (player.y > 104) throughGate = false;
  }

  function draw(): void {
    const small = drawTown(stage);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, small.width * G.view.z, small.height * G.view.z);
    drawWords(ctx);
  }

  let last = performance.now();
  function frame(now: number): void {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    step(dt);
    aim(false);
    tickUI(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // ---------- arriving ----------

  resize();
  after(0.35, () => {
    walkTo(player, { x: 256, y: 152 }, () => {
      player.dir = 0;
    });
  });
  showArrival(() => {
    beginEvents();
    twinkleAll();
    hooks.feed("You are home. The fire is lit and nine guild-mates are about.", "leaf");
    // Whoever is nearest looks up and says so.
    const nearest = G.mates
      .filter((a) => !a.away)
      .toSorted((a, b) => dist(a.x, a.y, player.x, player.y) - dist(b.x, b.y, player.x, player.y))
      .slice(0, 2);
    nearest.forEach((a, i) => {
      after(0.5 + i * 0.6, () => {
        if (!a.seat && !a.moving) face(a, player.x, player.y);
        hop(a);
        say(a, i === 0 ? "welcome back!" : "you're here!", 2.4);
      });
    });
  });
  requestAnimationFrame(frame);

  window.town = {
    skip(seconds) {
      for (let i = 0; i < seconds * 30; i++) step(1 / 30);
      aim(true);
    },
    enter() {
      dismissArrival();
    },
    open: openPanel,
    close: closePanel,
    visit(id) {
      visit(id, true);
    },
    tp(x, y) {
      halt();
      player.x = x;
      player.y = y;
      aim(true);
    },
    tap(x, y) {
      tapWorld(x, y);
    },
    happen,
    page(x, y) {
      const k = G.view.z / G.view.dpr;
      return { x: (x - Math.round(G.cam.x)) * k, y: (y - Math.round(G.cam.y)) * k };
    },
    who() {
      return G.mates.map((a) => ({ name: a.who.name, x: Math.round(a.x), y: Math.round(a.y), doing: a.doing }));
    },
    me() {
      return { x: Math.round(player.x), y: Math.round(player.y) };
    },
    lost() {
      const c = crabs.find((k) => k.lost);
      return c ? { x: Math.round(c.x), y: Math.round(c.y) } : { x: 0, y: 0 };
    },
    bench() {
      const t0 = performance.now();
      for (let i = 0; i < 100; i++) {
        step(1 / 60);
        draw();
      }
      return (performance.now() - t0) / 100;
    },
  };
}

boot();
