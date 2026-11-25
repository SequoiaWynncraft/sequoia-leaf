/**
 * Guild Town: the member arrives as their own character in a small town in a clearing among giant
 * redwoods, where every part of the game is a place to walk up to, the town's own are about, and so are
 * the guild's real members when they are in the game.
 * Behind its gate is the member's own camp, and down the trail from that, everybody else's: the page
 * opened with `?camp=<player>` goes to theirs once the member is home.
 *
 * This file is the stage those places stand on: the canvas, the camera, the keys and fingers, the
 * loop, the walk from one place to another, and the way through a door into a game and back.
 * Everything about the town itself is in `townscene.ts` and about a camp in `campscene.ts`, each
 * reached only through `Scene`.
 */

import { pick as pickCard, point } from "@sequoia-leaf/kit/card.ts";
import { unit } from "@sequoia-leaf/kit/dom.ts";
import { dwell } from "@sequoia-leaf/kit/dwell.ts";
import { member } from "@sequoia-leaf/kit/live.ts";
import { paced } from "@sequoia-leaf/kit/pace.ts";
import { scope } from "@sequoia-leaf/kit/scope.ts";
import { bake, lookFor, paintSkin } from "@sequoia-leaf/kit/skin.ts";
import { unlock } from "@sequoia-leaf/kit/sound.ts";
import { fontsReady } from "@sequoia-leaf/kit/text.ts";
import { tipAt, tipOff, tipTo } from "@sequoia-leaf/kit/tip.ts";
import { clamp, must, type Pt } from "@sequoia-leaf/kit/util.ts";
import { FOLK } from "@sequoia-leaf/town/folk.ts";

import { stepAbout } from "./aboutui.ts";
import { walkAlong, walkLeft } from "./actors.ts";
import { makeCampArt } from "./campart.ts";
import { makeCamp } from "./campscene.ts";
import { makeCampUi } from "./campui.ts";
import { goIn } from "./doors.ts";
import { drawIris } from "./draw.ts";
import { folkArt, initFolkArt } from "./folkart.ts";
import { clearFx } from "./fx.ts";
import { G, type Going, hooks, show, toPage } from "./game.ts";
import { GAMES } from "./games.ts";
import { worldPress } from "./gesture.ts";
import { makeGrove } from "./grovescene.ts";
import { guild } from "./guild.ts";
import { closeCard, closePanel, covered, hush, initHud, tickHud } from "./hud.ts";
import { TOWN_KEYS } from "./keymap.ts";
import { here, keepTold, onTown, openCamp, town as kept, troubleCard, visiting, whoseCamp } from "./leaf.ts";
import { showMapSheet } from "./mapsheet.ts";
import { leafNow, onStage } from "./players.ts";
import { lookFromOutside } from "./review.ts";
import { darkOf, inGame, mayAct, next, openOf, type Place, placeOf, takesWalk } from "./screen.ts";
import { startSettings } from "./settings.ts";
import { showCampSheet, showSheet } from "./sheet.ts";
import { makeSprites } from "./sprites.ts";
import type { Bound, Hover, Scene, Stage, Steer, Stood } from "./stage.ts";
import { nameStatues } from "./statues.ts";
import { listenKeys } from "./townkeys.ts";
import { makeTown } from "./townscene.ts";

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
    // The member and a few others in made-up looks; the town's own as themselves.
    const looks = [guild.me().look, ...["Quillfeather", "Fernwhistle", "Wrenly", "Bramblewick"].map(lookFor)];
    for (const id of ["purse", "corner", "dock", "feed"]) document.getElementById(id)?.remove();
    const part = new URLSearchParams(location.search).get("sheet");
    if (part === "map") return showMapSheet(sprites);
    const campArt = makeCampArt(sprites);
    if (part === "camp") return showCampSheet(campArt);
    initFolkArt(campArt);
    const folk = FOLK.flatMap((t) => {
      const a = folkArt(t);
      return [...a.sit, ...a.walkR, a.sleep, a.glad, a.bend, a.lean].flatMap((p) => p ?? []);
    });
    showSheet(
      sprites,
      looks.map((l) => bake(paintSkin(l))),
      folk,
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
    const box = covered();
    if (box) {
      if (box.under) fh = Math.max(40, box.top * k);
      else fw = Math.max(40, box.left * k);
    }
    const on = scene();
    const at = on.focus();
    const { left = 0, w, top, bottom } = on.bounds;
    let tx = at.x - fw / 2;
    let ty = at.y - fh / 2;
    tx = vw > w + (vw - fw) ? left + (w - vw) / 2 : clamp(tx, left, left + w - fw);
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
    scene().resize(G.view.w, G.view.h);
    aim(true);
    if (screen.at === "inside") draw();
  }

  // ---------- the stage ----------

  /** Where the stage is (`screen.ts`): the town to begin with. Only `move` changes it. */
  let screen: Stood = { at: "playing", place: "town" };
  /** The clock is being stepped by hand from outside. */
  let heldStill = false;
  /** Each command given, numbered: what Leaf answers for one is acted on only if no other has come since. */
  let asked = 0;

  const stage: Stage = {
    mayAct: () => G.home && mayAct(screen),
    now: () => screen,
    goInside(game, at, of) {
      if (!stage.mayAct()) return false;
      const door = GAMES[game];
      const visit = goIn(of === undefined ? door : { ...door, url: `${door.url}?of=${encodeURIComponent(of)}` }, {
        news(text, tone) {
          hooks.feed(text, tone);
        },
        back(onTo) {
          move(next(screen, { kind: "back" }));
          if (onTo !== undefined) go({ to: "camp", of: onTo });
        },
      });
      move(next(screen, { kind: "door", game, door: at, visit }));
      return true;
    },
    snap() {
      aim(true);
    },
  };

  const menu = startSettings(scope(), () => letGo());
  initHud(menu.gear());
  const art = makeCampArt(sprites);
  void nameStatues(art);
  const town = makeTown(sprites, art, stage);
  const campUi = makeCampUi(art);
  const camp = makeCamp(sprites, art, stage, town.backdrop, campUi);
  campUi.bind(camp);
  const grove = makeGrove(sprites, art, stage);
  const scenes: Readonly<Record<Place, Scene>> = { town, camp, grove };
  /** The place that is on screen. */
  const scene = (): Scene => scenes[placeOf(screen)];

  /**
   * The stage moves on (`next`), and everything that follows from where it is changes with it, here
   * and nowhere else: which place is on, how dark it is, where the member is said to be, the town's
   * live room, the sound, and the loop.
   */
  function move(now: Stood): void {
    const was = screen;
    if (now === was) return;
    screen = now;
    G.where = placeOf(now);
    G.dark = darkOf(now);
    if (now.at === "dusk" && was.at !== "dusk") setOff(now);
    if (was.at === "dusk" && now.at !== "dusk") swap(was);
    const game = inGame(now);
    if (game !== inGame(was)) hush(game);
    const at = game ? null : placeOf(now);
    // Where the member is, and at a camp whose, told when it changes. In a game, the game says where
    // the member is, and calls Leaf itself: the town's time stops here, and it says so as they go in
    // and again as they come out.
    guild.here(at, at === "camp" ? whoseCamp() : null);
    if (game !== inGame(was)) here();
    // The live room follows the place on the stage, and a camp's whose camp it is (`players.ts`).
    onStage(at);
    if (now.at === "inside" && was.at !== "inside") {
      // The view has closed in: the game takes the page from here.
      keys.clear();
      press.letGo();
      now.visit.arrived(toPage(now.door.x, now.door.y));
    }
    if (now.at === "opening" && was.at !== "opening") {
      scene().cameBack(now.game);
      loop.wake();
    }
  }

  /** The member sets off for another place, on the way the place they are leaving gives. */
  function setOff(off: Extract<Stood, { at: "dusk" }>): void {
    // Whatever is held on the place being left goes back, and the line a long press put up goes with it.
    press.newPlace();
    tipOff(TIP);
    const p = G.player;
    const way = scenes[off.from].wayOut(off.to.place);
    if (p) walkAlong(p, way);
  }

  /** At the darkest moment of a walk: the place walked off from is put away, and the next put on. */
  function swap(off: Extract<Stood, { at: "dusk" }>): void {
    keys.clear();
    closePanel();
    closeCard();
    clearFx();
    show.prompt = null;
    show.promptT = 0;
    show.hover = null;
    show.pointed = null;
    show.dest = null;
    scenes[off.from].putAway();
    scenes[off.to.place].putOn(off.to, off.from);
    scene().resize(G.view.w, G.view.h);
    aim(true);
  }

  /** Sets off for a place, if the stage takes the walk; says whether it did. */
  function walkOff(to: Bound): boolean {
    const was = screen;
    move(next(screen, { kind: "walk", to }));
    return screen !== was;
  }

  /** Where the member asks to go, as the stage allows: the one way between places, and into the games. */
  function go(g: Going): void {
    const n = ++asked;
    const latest = (): boolean => n === asked;
    if (!G.home) return;
    switch (g.to) {
      case "game":
        if (stage.mayAct() && placeOf(screen) === "town") town.goIn(g.game, g.of);
        return;
      case "town":
        walkOff({ place: "town" });
        return;
      case "grove":
        if (!takesWalk(screen)) return;
        closePanel();
        closeCard();
        void (async () => {
          const trouble = await grove.open();
          if (trouble === "signedout" || trouble === "unreadable") troubleCard(trouble);
          else if (trouble) hooks.feed("The Grove could not be opened. Try again in a moment.", "coral");
          // While Leaf answered, the member may have asked for somewhere else, or gone into a game.
          else if (latest()) walkOff({ place: "grove" });
        })();
        return;
      case "camp": {
        if (g.of === undefined || g.of === member()?.id) {
          // At home already: whatever it was asked from is put away.
          if (placeOf(screen) === "camp" && visiting() === null) closePanel();
          else walkOff({ place: "camp", of: null });
          return;
        }
        if (!takesWalk(screen)) return;
        const { of, name } = g;
        void (async () => {
          const opened = await openCamp(of, name);
          if (typeof opened === "string") troubleCard(opened);
          // Not set off for (another command came meanwhile, or the stage will not take the walk): put away.
          else if (!latest() || !walkOff({ place: "camp", of: opened })) opened.play.close();
        })();
      }
    }
  }
  hooks.go = go;

  // ---------- keys and fingers ----------

  const keys = listenKeys(scope(), {
    away: () => screen.at === "inside" || menu.isOpen,
    mayAct: () => stage.mayAct(),
    scene,
    settings: () => {
      menu.open();
    },
  });
  let mouse: Pt | null = null;
  const TIP = {};
  /** Lets go of every key and press held: the window has lost the keyboard, or the settings menu is up. */
  const letGo = (): void => {
    keys.clear();
    press.letGo();
  };
  window.addEventListener("blur", letGo);
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

  // A finger or the mouse down on the world, one at a time (`gesture.ts`).
  const press = worldPress(scope(), canvas, {
    down(x, y, finger) {
      tipOff(TIP);
      const at = toWorld(x, y);
      return scene().tap(at.x, at.y, finger);
    },
    drag: (x, y) => scene().drag(toWorld(x, y)),
    release: (x, y) => scene().release(toWorld(x, y), document.elementFromPoint(x, y)),
    cancel: () => scene().cancel(),
    // A finger kept on a thing asks what it is: a camp thing's card stays until put away, a line goes by itself.
    asked(x, y) {
      const h = scene().point(toWorld(x, y));
      if (h) showTip(h, true);
    },
    cleared() {
      tipOff(TIP);
      scene().point(null);
    },
  });
  // A touch on the world is the world's: the click it ends in never lands on a panel that opened under it.
  let worldDown = false;
  window.addEventListener("pointerdown", (e) => (worldDown = e.target === canvas), true);
  window.addEventListener(
    "click",
    (e) => {
      if (worldDown && e.detail > 0 && e.target !== canvas) {
        e.preventDefault();
        e.stopPropagation();
      }
      worldDown = false;
    },
    true,
  );
  canvas.addEventListener("pointerleave", () => {
    mouse = null;
  });
  canvas.addEventListener("pointermove", (e) => {
    mouse = e.pointerType === "mouse" ? { x: e.clientX, y: e.clientY } : null;
  });
  window.addEventListener("resize", resize);

  function steering(): Steer {
    const dx = (TOWN_KEYS.isDown(keys, "right") ? 1 : 0) - (TOWN_KEYS.isDown(keys, "left") ? 1 : 0);
    const dy = (TOWN_KEYS.isDown(keys, "down") ? 1 : 0) - (TOWN_KEYS.isDown(keys, "up") ? 1 : 0);
    const toward = press.toward();
    return { dx, dy, toward: toward ? toWorld(toward.x, toward.y) : null };
  }

  /** A thing with a line of its own, rested on: its line shows, and goes with it as it moves. */
  const resting = dwell<Hover>({
    ms: REST,
    show: (h) => {
      showTip(h);
    },
    follow: (h) => {
      tipTo(pageBox(h), TIP);
    },
    hide: () => {
      tipOff(TIP);
    },
  });

  /** The mouse resting on a thing marks it, and after a moment says what it is. */
  function pointing(): void {
    const h = mouse ? scene().point(toWorld(mouse.x, mouse.y)) : null;
    if (!mouse) scene().point(null);
    canvas.style.cursor = h ? "pointer" : "default";
    // A camp thing explains itself through the cards, which keep their own time; anything else with its line.
    const box = h ? pageBox(h) : null;
    point(h?.ref ?? null, box?.x ?? 0, box?.y ?? 0, box?.w ?? 0, box?.h ?? 0);
    resting(h?.tip && !h.ref ? h : null, performance.now());
  }

  // ---------- every moment ----------

  function tick(dt: number): void {
    G.now = leafNow();
    const on = scene();
    on.step(dt, steering());
    // Night begins to fall once the member walking off is nearly out of sight.
    const p = G.player;
    move(next(screen, { kind: "tick", dt, near: !p || walkLeft(p) <= on.nightFrom }));
  }

  function draw(): void {
    const on = scene();
    const small = on.draw();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, small.width * G.view.z, small.height * G.view.z);
    on.words(ctx, wordPx);
    if (screen.at !== "closing" && screen.at !== "inside" && screen.at !== "opening") return;
    const open = openOf(screen);
    const at = toPage(screen.door.x, screen.door.y);
    const x = at.x * G.view.dpr;
    const y = at.y * G.view.dpr;
    const far = Math.hypot(Math.max(x, canvas.width - x), Math.max(y, canvas.height - y));
    // Slow at the last, so the eye lands on the door.
    drawIris(ctx, x, y, far * open * open, G.view.z);
  }

  /** A frame, as often as the kit paces them (`pace.ts`); none while a game is open over the town. */
  function frame(_now: number, step: number): void {
    if (screen.at === "inside") {
      loop.stop();
      return;
    }
    const dt = heldStill ? 0 : step;
    if (dt > 0) tick(dt);
    aim(false);
    pointing();
    tickHud(dt);
    stepAbout(dt);
    draw();
  }
  const loop = paced(scope(), frame);

  resize();
  town.arrive();
  // Whether the member's character stays in town after they go, as they last said in their cabin.
  guild.stay(kept().stay);
  // Another page of the member's may change it: presence is told again whenever Leaf's town is not what this page showed.
  onTown((differs) => {
    if (differs) guild.stay(kept().stay);
  });
  // Where the stage starts: the member is in town, and so in its live room.
  guild.here("town");
  onStage("town");
  keepTold({
    home: () => G.home,
    inCamp: () => screen.at !== "dusk" && placeOf(screen) === "camp",
    // In the Grove the member is playing the pulls, as in a game opened over the town.
    inGame: () => inGame(screen) || placeOf(screen) === "grove",
    cursor: () => guild.told(),
  });
  loop.wake();
  const camped = new URLSearchParams(location.search).get("camp");
  const goAsked = (): void => {
    if (camped === null) return;
    if (G.home) go({ to: "camp", of: camped });
    else window.setTimeout(goAsked, 250);
  };
  goAsked();

  lookFromOutside({
    town,
    camp,
    grove,
    tick,
    draw,
    snap: () => {
      aim(true);
    },
    stood: () => screen,
    hold: (on) => {
      heldStill = on;
    },
    tap(x, y) {
      scene().tap(x, y, false);
      scene().release({ x, y }, null);
    },
    go,
  });
}

void boot();
