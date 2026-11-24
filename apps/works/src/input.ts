/**
 * Hands on the yard: the mouse, the keys, and fingers. With a mouse, pointing shows what would be
 * built and a click builds it; a drag with the belt lays a run, a drag with Select marks out an
 * area, and a drag with nothing in hand moves the view. With a finger, dragging always moves the
 * view and two fingers zoom, so building is never done by accident: a tap aims, and a second tap
 * (or the Build button) builds; an area is marked by tapping two opposite corners.
 */

import { at, BELT } from "@sequoia-leaf/factory";
import { pick, point, shown, surface } from "@sequoia-leaf/kit/card.ts";
import { unlock } from "@sequoia-leaf/kit/sound.ts";
import { LONG_PRESS } from "@sequoia-leaf/kit/tip.ts";

import { pan, zoom } from "./camera.ts";
import { callerAt } from "./events.ts";
import { aimOf } from "./hand.ts";
import { S, tileAt, toYard } from "./state.ts";
import {
  aimAt,
  cancel,
  clearMark,
  confirm,
  dragEnd,
  dragLost,
  dragOver,
  hold,
  markEnd,
  markOver,
  markStart,
  paintAt,
  pickFrom,
  press,
  rotate,
  running,
  setTool,
  stepGrade,
  takeAway,
  tapBelt,
  unaim,
  undo,
} from "./tools.ts";
import { closeCard, openCard, refAt, riderAt, tileBox } from "./ui/card.ts";
import { refreshDock, toolForKey } from "./ui/dock.ts";
import { closeBanner } from "./ui/notes.ts";
import { closePanel, togglePanel } from "./ui/panels.ts";
import { hasViews, toggleView } from "./ui/views.ts";

/** What input asks of the rest of the screen. */
export const inputHooks: {
  /** Somebody waiting at the gate was tapped: hand their order over. */
  caller: (order: number) => void;
  /** Escape or Enter while the letter is up. */
  letter: () => boolean;
} = { caller: () => {}, letter: () => false };

const keys = new Set<string>();

interface Down {
  id: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  moved: boolean;
  /**
   * What this press is doing: moving the view, taking things away (the spade, or the right button),
   * or whatever the hand holds a drag for (a run of belt, a stroke of the brush, an area being
   * marked: `hand.ts`, which ends with the hand), or nothing yet.
   */
  doing: "pan" | "take" | "hand" | "none";
  finger: boolean;
  last: { x: number; y: number };
}
const downs = new Map<number, Down>();
let pinch: { d: number; cx: number; cy: number } | null = null;
let pressTimer = 0;

/**
 * What the mouse is on says what it is, after a moment: something riding a belt, or else the tile.
 * Land not bought yet says nothing until it is clicked: the mouse crosses a great deal of it.
 */
function pointAt(tx: number, ty: number): void {
  const ref = S.tool === null && downs.size === 0 ? (riderAt(tx, ty) ?? refAt(tx, ty)) : null;
  const b = tileBox(tx, ty);
  point(ref?.startsWith("plot:") ? null : ref, b.x, b.y, b.w, b.h);
}

/** A tap or click on a tile with nothing in hand: ask about what is there. */
function ask(tx: number, ty: number, pageX: number, pageY: number): void {
  const p = toYard(pageX, pageY);
  const who = callerAt(p.x, p.y);
  if (who && !S.visiting) {
    inputHooks.caller(who.order);
    return;
  }
  if (at(S.world, tx, ty) < 0) {
    closeCard();
    return;
  }
  openCard(tx, ty);
}

/** A finger's tap with a tool in hand: aim first, build on the second tap of the same tile. Paint goes on at the first. */
export function fingerTap(tx: number, ty: number): void {
  const h = S.hand;
  if ((h.is === "build" && h.kind === BELT) || h.is === "beltTaps") {
    tapBelt(tx, ty);
    return;
  }
  if (h.is === "paint") {
    paintAt(tx, ty);
    return;
  }
  if (h.is === "select" && h.stage.is !== "holding") {
    // One corner, then the opposite one.
    if (h.stage.is !== "marking") markStart(tx, ty);
    else {
      markOver(tx, ty);
      markEnd();
    }
    return;
  }
  const a = aimOf(h);
  if (a && a.x === tx && a.y === ty) {
    confirm();
    return;
  }
  aimAt(tx, ty);
  refreshDock();
}

/** A press is over: a finger that did not move was a tap, a mouse that was laying a run lays it. */
function lift(e: PointerEvent): void {
  const d = downs.get(e.pointerId);
  downs.delete(e.pointerId);
  window.clearTimeout(pressTimer);
  if (downs.size < 2) pinch = null;
  if (!d) return;
  const t = tileAt(e.clientX, e.clientY);
  if (d.finger) {
    if (d.moved || e.type === "pointercancel") return;
    if (S.hand.is === "idle") ask(t.x, t.y, e.clientX, e.clientY);
    else fingerTap(t.x, t.y);
    return;
  }
  // A press the browser cancelled ends its drag without doing anything; let go, it finishes it.
  if (d.doing === "hand") {
    if (e.type === "pointercancel") dragLost();
    else dragEnd(d.id);
  } else if (d.doing === "pan" && !d.moved && e.button === 0) ask(t.x, t.y, e.clientX, e.clientY);
}

export function initInput(canvas: HTMLCanvasElement): void {
  document.addEventListener("pointerdown", unlock, true);

  // A press on the yard is read here: the cards do not put themselves away for it.
  surface(canvas);
  canvas.addEventListener("pointerdown", (e) => {
    point(null, 0, 0);
    window.clearTimeout(pressTimer);
    const finger = e.pointerType !== "mouse";
    if (S.finger !== finger) {
      S.finger = finger;
      if (finger) S.hover = null;
      refreshDock();
    }
    const t = tileAt(e.clientX, e.clientY);
    const d: Down = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      sx: e.clientX,
      sy: e.clientY,
      moved: false,
      doing: "none",
      finger,
      last: t,
    };
    downs.set(e.pointerId, d);
    canvas.setPointerCapture(e.pointerId);
    if (finger) {
      if (downs.size === 2) {
        const [a, b] = [...downs.values()];
        if (a && b) pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        for (const o of downs.values()) o.moved = true;
        return;
      }
      // A finger kept on a thing asks what it is: its card, pinned, even with a tool in hand.
      pressTimer = window.setTimeout(() => {
        if (d.moved || !downs.has(d.id)) return;
        d.moved = true;
        const ref = riderAt(t.x, t.y) ?? refAt(t.x, t.y);
        const b = tileBox(t.x, t.y);
        if (ref) pick(ref, b.x, b.y, b.w, b.h);
      }, LONG_PRESS);
      return;
    }
    if (e.button === 2 && !S.visiting) {
      // With pieces in hand it lets them go: taking one away would leave the hand holding what is not there.
      if (S.group) cancel();
      else {
        d.doing = "take";
        takeAway(t.x, t.y, true);
      }
      return;
    }
    if (e.button === 1 || S.hand.is === "idle") {
      d.doing = "pan";
      return;
    }
    if (S.hand.is === "remove") {
      d.doing = "take";
      takeAway(t.x, t.y);
      return;
    }
    d.doing = "hand";
    press(t.x, t.y, e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    const d = downs.get(e.pointerId);
    const t = tileAt(e.clientX, e.clientY);
    if (e.pointerType === "mouse") {
      if (!S.hover || S.hover.x !== t.x || S.hover.y !== t.y) {
        S.hover = t;
        if (S.hand.is !== "idle" && !running()) {
          aimAt(t.x, t.y);
          refreshDock();
        }
        pointAt(t.x, t.y);
      }
    }
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.moved && Math.hypot(d.x - d.sx, d.y - d.sy) > (d.finger ? 9 : 4)) {
      d.moved = true;
      window.clearTimeout(pressTimer);
    }
    if (d.finger) {
      if (pinch && downs.size >= 2) {
        const [a, b] = [...downs.values()];
        if (!a || !b) return;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        pan(cx - pinch.cx, cy - pinch.cy);
        pinch.cx = cx;
        pinch.cy = cy;
        // The picture goes in whole steps: one more each time the fingers have spread or closed by a third.
        if (dist > pinch.d * 1.3 && zoom(1, cx, cy)) pinch.d = dist;
        else if (dist < pinch.d / 1.3 && zoom(-1, cx, cy)) pinch.d = dist;
        return;
      }
      if (d.moved) pan(dx, dy);
      return;
    }
    const fresh = t.x !== d.last.x || t.y !== d.last.y;
    if (d.doing === "pan" && d.moved) pan(dx, dy);
    else if (d.doing === "take" && fresh) takeAway(t.x, t.y, true);
    else if (d.doing === "hand" && fresh) dragOver(t.x, t.y, d.id);
    d.last = t;
  });

  canvas.addEventListener("pointerup", lift);
  canvas.addEventListener("pointercancel", lift);
  // A finger's tap is all told by now. The click a browser makes of it afterwards would land on
  // whatever the tap put under the finger: a button of the card it opened.
  canvas.addEventListener("touchend", (e) => e.preventDefault());
  canvas.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "mouse") return;
    S.hover = null;
    if (!running() && !S.finger && S.hand.is !== "idle") unaim();
    point(null, 0, 0);
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);
    },
    { passive: false },
  );

  window.addEventListener("keydown", (e) => {
    unlock();
    if (e.target instanceof HTMLInputElement) return;
    const k = e.key.toLowerCase();
    if (k === "escape" || k === "enter") {
      // The card that was up has taken this Escape.
      if (e.defaultPrevented) return;
      if (inputHooks.letter()) {
        e.preventDefault();
        return;
      }
      if (k === "enter") return;
      if (S.hand.is !== "idle") cancel();
      else if (shown()) closeCard();
      else if (S.panel) closePanel();
      else closeBanner();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // A visitor changes nothing: only the keys that look about work.
    if (S.visiting && !/^(t|\+|=|_|arrow\w+|[wasd])$/.test(k)) return;
    const picked = toolForKey(e.key);
    if (picked !== undefined) {
      setTool(S.tool === picked ? null : picked);
      return;
    }
    if (k === "r") rotate();
    // G steps through the grades the kind in hand may be built at.
    else if (k === "g") stepGrade();
    else if (k === "e") setTool(S.tool === "remove" ? null : "remove");
    else if (k === "f") setTool(S.tool === "select" ? null : "select");
    else if (k === "m" && S.mark && !S.group) hold("move");
    // With nothing marked, M is the map, once the yard has one.
    else if (k === "m" && hasViews()) toggleView("map");
    // C copies a marked area; with none marked it is the brush.
    else if (k === "c" && S.mark && !S.group) hold("copy");
    else if (k === "c") setTool(S.tool === "paint" ? null : "paint");
    else if (k === "delete") clearMark();
    else if (k === "z") undo();
    else if (k === "q") {
      const on =
        S.hover ?? (S.picked >= 0 ? { x: S.picked % S.world.land.w, y: Math.floor(S.picked / S.world.land.w) } : null);
      if (on) pickFrom(on.x, on.y);
    } else if (k === "o") togglePanel("orders");
    else if (k === "t") togglePanel("board");
    else if (k === "p") togglePanel("tier");
    else if (k === "l") togglePanel("research");
    else if (k === "i") toggleView("needs");
    else if (k === "+" || k === "=") zoom(1, window.innerWidth / 2, window.innerHeight / 2);
    else if (k === "_") zoom(-1, window.innerWidth / 2, window.innerHeight / 2);
    else if (k.startsWith("arrow") || k === "w" || k === "a" || k === "s" || k === "d") {
      keys.add(k);
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => {
    keys.delete(e.key.toLowerCase());
  });
  window.addEventListener("blur", () => {
    keys.clear();
    downs.clear();
    pinch = null;
    // Every press is lost with the focus, and the drag the hand held for one with it.
    dragLost();
  });
}

/** Each frame: the keys that move the view. */
export function stepInput(dt: number): void {
  const dx = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
  const dy = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
  if (dx !== 0 || dy !== 0) pan(-dx * dt * 620, -dy * dt * 620);
}
