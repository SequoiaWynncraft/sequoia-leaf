/**
 * Hands on the yard: the mouse, the keys, and fingers. With a mouse, pointing shows what would be
 * built and a click builds it; a drag with the belt lays a run, a drag with Select marks out an
 * area, and a drag with nothing in hand moves the view. With a finger, dragging always moves the
 * view and two fingers zoom, so building is never done by accident: a tap aims, and a second tap
 * (or the Build button) builds; an area is marked by tapping two opposite corners.
 */

import { at, BELT } from "@sequoia-leaf/factory";
import { point, shown, surface } from "@sequoia-leaf/kit/card.ts";
import { placeOf } from "@sequoia-leaf/kit/keyboard.ts";
import { forControl, heldAgain, typing } from "@sequoia-leaf/kit/keys.ts";
import { LONG_PRESS } from "@sequoia-leaf/kit/press.ts";
import { type Scope, scope } from "@sequoia-leaf/kit/scope.ts";
import { unlock } from "@sequoia-leaf/kit/sound.ts";

import { pan, zoom } from "./camera.ts";
import { callerAt } from "./events.ts";
import { aimOf } from "./hand.ts";
import { WORKS_KEYS, type WorksAction } from "./keymap.ts";
import { isWhole } from "./plans.ts";
import { S, tileAt, toYard } from "./state.ts";
import {
  aimAt,
  cancel,
  clearMark,
  confirm,
  dragEnd,
  dragLost,
  dragOver,
  flip,
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
import { setWayIn } from "./tunnel.ts";
import { closeCard, openCard, refAt, riderAt, tileBox } from "./ui/card.ts";
import { openTools, refreshDock } from "./ui/dock.ts";
import { closeBanner } from "./ui/notes.ts";
import { closePanel, togglePanel } from "./ui/panels.ts";
import { hasViews, toggleView } from "./ui/views.ts";

/** What input asks of the rest of the screen. */
export const inputHooks: {
  /** Somebody waiting at the gate was tapped: hand their order over. */
  caller: (order: number) => void;
  /** Escape or Enter while the letter is up. */
  letter: () => boolean;
  /** Escape with nothing else to put away: the settings menu. */
  settings: () => void;
  /** Whether the settings menu is up: the yard takes no keys while it is. */
  settingsUp: () => boolean;
} = { caller: () => {}, letter: () => false, settings: () => {}, settingsUp: () => false };

/** The places of the keys held down that move the view (`WORKS_KEYS.isDown`). */
const held = new Set<string>();

/** A key that moves the view, held until it comes up. */
function moveView(e: KeyboardEvent): void {
  held.add(placeOf(e));
  e.preventDefault();
}

const zoomBy = (step: number): void => {
  zoom(step, window.innerWidth / 2, window.innerHeight / 2);
};

/** The piece pointed at, or else the one last picked, is the tool in hand. */
function another(): void {
  const on =
    S.hover ?? (S.picked >= 0 ? { x: S.picked % S.world.land.w, y: Math.floor(S.picked / S.world.land.w) } : null);
  if (on) pickFrom(on.x, on.y);
}

/** What each action does: given the key, and which of the action's keys it is. */
const DOES: Readonly<Record<WorksAction, (e: KeyboardEvent, nth: number) => void>> = {
  up: moveView,
  left: moveView,
  down: moveView,
  right: moveView,
  zoomIn: () => zoomBy(1),
  zoomOut: () => zoomBy(-1),
  tool: (_, nth) => {
    const picked = openTools()[nth];
    if (picked !== undefined) setTool(S.tool === picked ? null : picked);
  },
  rotate,
  // A sorter sends to its other side.
  flip,
  // Through the grades the kind in hand may be built at.
  grade: stepGrade,
  another,
  remove: () => setTool(S.tool === "remove" ? null : "remove"),
  undo: (e) => {
    e.preventDefault();
    undo();
  },
  select: () => setTool(S.tool === "select" ? null : "select"),
  // With nothing marked, the map, once the yard has one.
  move: () => {
    if (S.mark && !S.group) hold("move");
    else if (hasViews()) toggleView("map");
  },
  paint: () => {
    if (S.mark && !S.group) hold("copy");
    else setTool(S.tool === "paint" ? null : "paint");
  },
  clear: clearMark,
  orders: () => togglePanel("orders"),
  board: () => togglePanel("board"),
  tier: () => togglePanel("tier"),
  research: () => togglePanel("research"),
  depot: () => toggleView("needs"),
  back: (e) => escape(e, false),
};

/** What a visitor may do, who changes nothing: look about, and at the top yards. */
const LOOKS: ReadonlySet<WorksAction> = new Set(["up", "left", "down", "right", "zoomIn", "zoomOut", "board", "back"]);

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
  /** A finger's wait to ask what it rests on (`LONG_PRESS`): let go of as the press moves, ends or gives way to another. */
  readonly hold: Scope;
}
/** The presses on the yard, each by its pointer: one is only ever ended by its own pointer's events. */
const downs = new Map<number, Down>();
let pinch: { d: number; cx: number; cy: number } | null = null;

/** Where the mouse is on the page while it is over the yard: what it is over is worked out again as the yard moves under it. */
let mouse: { x: number; y: number } | null = null;
/** The view as it stood at the last frame: the yard's pixel at the page's corner, and how many of the yard's pixels to one of the page's. */
const view = { x: Number.NaN, y: Number.NaN, k: Number.NaN };
/** Whether the view moved at the last frame. */
let viewMoving = false;

/**
 * What the mouse is on says what it is, after a moment: something riding a belt, or else the tile.
 * Land not bought yet says nothing until it is clicked: the mouse crosses a great deal of it. While
 * the yard moves under the mouse it rests on nothing, so nothing that passes beneath says what it is.
 */
function pointAt(tx: number, ty: number): void {
  const ref = S.tool === null && downs.size === 0 && !viewMoving ? (riderAt(tx, ty) ?? refAt(tx, ty)) : null;
  const b = tileBox(tx, ty);
  point(ref?.startsWith("plot:") ? null : ref, b.x, b.y, b.w, b.h);
}

/** The mouse is over a tile, having moved there or had the yard move under it: the hand aims there, and what is there is pointed at. */
function hoverOn(t: { x: number; y: number }): void {
  if (S.hover && S.hover.x === t.x && S.hover.y === t.y) return;
  S.hover = t;
  if (S.hand.is !== "idle" && !running()) {
    aimAt(t.x, t.y);
    refreshDock();
  }
  pointAt(t.x, t.y);
}

/** A tap or click on a tile with nothing in hand: ask about what is there. What the view was brought to with no card is no longer marked. */
function ask(tx: number, ty: number, pageX: number, pageY: number): void {
  S.brought = null;
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
  // The tunnel's first tap sets where it goes in.
  if (setWayIn(tx, ty)) {
    refreshDock();
    return;
  }
  // A second tap where it is aimed sets it down; a plan of the whole yard is aimed at the whole yard.
  const a = aimOf(h);
  if (a && ((a.x === tx && a.y === ty) || isWhole(S.group?.as))) {
    confirm();
    return;
  }
  aimAt(tx, ty);
  refreshDock();
}

/**
 * A press is over, lifted (`pointerup`), or cancelled by the browser or its hold on the pointer lost:
 * lifted, a finger that did not move was a tap, and a mouse that was laying a run lays it; a press
 * that ended otherwise does nothing more, and its drag ends without doing anything. A press that is
 * not its pointer's (over already) is nothing.
 */
function lift(e: PointerEvent): void {
  const d = downs.get(e.pointerId);
  downs.delete(e.pointerId);
  d?.hold.close();
  if (downs.size < 2) pinch = null;
  if (!d) return;
  const lifted = e.type === "pointerup";
  const t = tileAt(e.clientX, e.clientY);
  if (d.finger) {
    if (d.moved || !lifted) return;
    if (S.hand.is === "idle") ask(t.x, t.y, e.clientX, e.clientY);
    else fingerTap(t.x, t.y);
    return;
  }
  if (d.doing === "hand") {
    if (lifted) dragEnd(d.id);
    else dragLost();
  } else if (d.doing === "pan" && !d.moved && lifted && e.button === 0) ask(t.x, t.y, e.clientX, e.clientY);
}

/** What input uses of the yard's canvas: its events, holding a press, and marking it for the cards. */
export type InputSurface = EventTarget & Pick<HTMLCanvasElement, "setPointerCapture" | "dataset">;

/** A press begins on the yard: by a finger, it waits to ask what it rests on, in a scope of its own (`hold`) under `life`. */
function pressed(e: PointerEvent, canvas: InputSurface, life: Scope): void {
  point(null, 0, 0);
  // A new press ends every other's wait to ask.
  for (const o of downs.values()) o.hold.close();
  const finger = e.pointerType !== "mouse";
  if (S.finger !== finger) {
    S.finger = finger;
    if (finger) S.hover = null;
    refreshDock();
  }
  if (finger) mouse = null;
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
    hold: life.child(),
  };
  downs.set(e.pointerId, d);
  canvas.setPointerCapture(e.pointerId);
  if (finger) fingerDown(d, t);
  else mouseDown(e, d, t);
}

/** A finger goes down: a second begins a pinch, and one alone waits to ask what it rests on. */
function fingerDown(d: Down, t: { x: number; y: number }): void {
  if (downs.size === 2) {
    const [a, b] = [...downs.values()];
    if (a && b) pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    for (const o of downs.values()) o.moved = true;
    return;
  }
  // A finger kept on a thing asks what it is (what rides a belt first): its card, pinned, even with a tool in hand.
  d.hold.after(LONG_PRESS, () => {
    if (d.moved || downs.get(d.id) !== d) return;
    d.moved = true;
    openCard(t.x, t.y, true);
  });
}

/** A mouse button goes down: the right takes away, the middle or an empty hand moves the view, else the hand's drag begins. */
function mouseDown(e: PointerEvent, d: Down, t: { x: number; y: number }): void {
  if (e.button === 2 && !S.visiting) {
    // With pieces in hand it lets them go: taking one away would leave the hand holding what is not
    // there. With a tunnel's way in set, it lets that go.
    if (S.group || S.hand.is === "tunnel") cancel();
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
}

export function initInput(canvas: InputSurface): void {
  const life = scope();
  life.on(document, "pointerdown", () => unlock(), { capture: true });

  // A press on the yard is read here: the cards do not put themselves away for it.
  surface(canvas);
  life.on(canvas, "pointerdown", (e) => pressed(e, canvas, life));

  life.on(canvas, "pointermove", (e) => {
    const d = downs.get(e.pointerId);
    const t = tileAt(e.clientX, e.clientY);
    if (e.pointerType === "mouse") {
      mouse = { x: e.clientX, y: e.clientY };
      hoverOn(t);
    }
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.moved && Math.hypot(d.x - d.sx, d.y - d.sy) > (d.finger ? 9 : 4)) {
      d.moved = true;
      d.hold.close();
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

  life.on(canvas, "pointerup", lift);
  life.on(canvas, "pointercancel", lift);
  // A press whose hold on its pointer is lost (to the browser, or another element) is over, as a cancelled one.
  life.on(canvas, "lostpointercapture", lift);
  // A finger's tap is all told by now. The click a browser makes of it afterwards would land on
  // whatever the tap put under the finger: a button of the card it opened.
  life.on(canvas, "touchend", (e) => e.preventDefault());
  life.on(canvas, "pointerleave", (e) => {
    if (e.pointerType !== "mouse") return;
    mouse = null;
    S.hover = null;
    if (!running() && !S.finger && S.hand.is !== "idle") unaim();
    point(null, 0, 0);
  });
  life.on(
    canvas,
    "wheel",
    (e) => {
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);
    },
    { passive: false },
  );

  life.on(window, "keydown", (e) => {
    unlock();
    // Enter or Space on a button is the button's, whatever the player has put on them.
    if (typing(e) || inputHooks.settingsUp() || forControl(e)) return;
    const act = WORKS_KEYS.of(e);
    // Enter, as Escape does, puts away the letter.
    if (act === undefined && e.key === "Enter") escape(e, true);
    // A key held down rotates, removes or picks once: only moving the view, zooming and undoing go on.
    else if (act !== undefined && !act.again && (!S.visiting || LOOKS.has(act.id))) DOES[act.id](e, act.nth);
  });
  life.on(window, "keyup", (e) => {
    held.delete(placeOf(e));
  });
  life.on(window, "blur", letGo);
}

/**
 * Escape (or Enter, `enter`) for the yard, once no card took it: what is uppermost put away, the
 * letter, else the card, the panel, the hand or the notice, one a press, and a key held down does
 * nothing more; with none of those, Escape opens the settings menu.
 */
function escape(e: KeyboardEvent, enter: boolean): void {
  // The card that was up has taken this Escape.
  if (e.defaultPrevented || heldAgain(e)) return;
  if (inputHooks.letter()) {
    e.preventDefault();
    return;
  }
  if (enter) return;
  if (shown()) closeCard();
  else if (S.panel) closePanel();
  else if (S.hand.is !== "idle") cancel();
  else if (!closeBanner()) inputHooks.settings();
}

/**
 * Lets go of every key and press held: the window has lost the focus, or the settings menu has come
 * up over the yard. A press lost so does nothing more, and the drag the hand held for one ends.
 */
export function letGo(): void {
  held.clear();
  for (const d of downs.values()) d.hold.close();
  downs.clear();
  pinch = null;
  // A finger's long press waiting to ask what it is on finds its press gone, and asks nothing.
  dragLost();
}

/** Each frame: the keys that move the view, and what the mouse is over once the view has moved for the frame. */
export function stepInput(dt: number): void {
  const dx = (WORKS_KEYS.isDown(held, "right") ? 1 : 0) - (WORKS_KEYS.isDown(held, "left") ? 1 : 0);
  const dy = (WORKS_KEYS.isDown(held, "down") ? 1 : 0) - (WORKS_KEYS.isDown(held, "up") ? 1 : 0);
  if (dx !== 0 || dy !== 0) pan(-dx * dt * 620, -dy * dt * 620);
  followView();
}

/**
 * The view moved this frame (the keys, a drag, an eased look, a zoom): the yard moved under a mouse
 * over it, so the tile it is over is worked out again, and it rests on nothing. The first frame the
 * view stands still again, what is under the mouse then is pointed at, and its card may follow.
 */
function followView(): void {
  const k = S.view.dpr / S.view.z;
  const moved = S.cam.x !== view.x || S.cam.y !== view.y || k !== view.k;
  const stopped = viewMoving && !moved;
  view.x = S.cam.x;
  view.y = S.cam.y;
  view.k = k;
  viewMoving = moved;
  if (!mouse) return;
  if (moved) {
    point(null, 0, 0);
    hoverOn(tileAt(mouse.x, mouse.y));
  } else if (stopped && S.hover) pointAt(S.hover.x, S.hover.y);
}
