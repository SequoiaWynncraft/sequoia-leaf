/**
 * Your Camp: the home screen as one small clearing that belongs to the member. This file starts
 * it, keeps the frames coming, and passes touches to the scene.
 */
import { inventFigure, loadSkin } from "./figure.ts";
import { MATES } from "./content.ts";
import { unlock } from "./sfx.ts";
import { drawSheet } from "./sheet.ts";
import { boot, type Debug, decorating, drag, drop, frame, grab, hover, resize, scenePoint, tap } from "./world.ts";

declare global {
  interface Window {
    camp?: Debug;
  }
}

const el = document.querySelector<HTMLCanvasElement>("#scene")!;
// The member's own skin sits beside the page; without one they wear a made-up one.
const mine = await loadSkin("skins/player.png");

if (new URLSearchParams(location.search).has("sheet")) {
  drawSheet([mine ?? inventFigure(MATES[0]!.look), ...MATES.map((m) => inventFigure(m.look))]);
} else {
  window.camp = boot(el, mine);

  let last = performance.now();
  const loop = (now: number): void => {
    frame((now - last) / 1000);
    last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.addEventListener("resize", resize);

  // A touch is a tap unless it travels; while decorating, a touch on a thing carries it.
  let down: { x: number; y: number; id: number; carrying: boolean } | null = null;
  el.addEventListener("pointerdown", (e) => {
    unlock();
    const [x, y] = scenePoint(e.clientX, e.clientY);
    down = { x: e.clientX, y: e.clientY, id: e.pointerId, carrying: decorating() && grab(x, y) };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // A made-up pointer (a test) cannot be captured; nothing depends on it.
    }
  });
  el.addEventListener("pointermove", (e) => {
    const [x, y] = scenePoint(e.clientX, e.clientY);
    if (down?.carrying) drag(x, y, e.clientX, e.clientY);
    else if (!down && e.pointerType === "mouse") el.style.cursor = hover(x, y) ? "pointer" : "default";
  });
  const up = (e: PointerEvent): void => {
    if (!down || e.pointerId !== down.id) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (down.carrying) {
      drop(e.clientX, e.clientY);
      if (moved < 6) tap(...scenePoint(e.clientX, e.clientY));
    } else if (moved < 14) tap(...scenePoint(e.clientX, e.clientY));
    down = null;
  };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", () => {
    if (down?.carrying) drop(-1, -1);
    down = null;
  });
  window.addEventListener("pointerdown", unlock, { capture: true });
}
