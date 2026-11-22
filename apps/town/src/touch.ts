/**
 * What a touch means, in the town and in a camp: a tap or a click on a point, the pointer resting
 * on one, the key, and the member's own feet. A scene hands over who and what is in it and its
 * doors (the places with a prompt: where each is, what its prompt says, what it does), and this
 * decides what happens. Every door is used four ways, all the same: a touch on its prompt, a touch
 * on the door itself (the member walks up to it first), walking on into it, and the key while its
 * prompt is showing.
 */

import { GOLD } from "@sequoia-leaf/kit/palette.ts";
import type { Dir } from "@sequoia-leaf/kit/skin.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { clamp, dist, must, type Pt, type Rect } from "@sequoia-leaf/kit/util.ts";

import { headOf, hop, pushOf, release, shove, walkTo } from "./actors.ts";
import { ring } from "./fx.ts";
import { type Actor, G, type Prompted, show } from "./game.ts";
import type { Ground } from "./grid.ts";
import { closeCard, closePanel } from "./hud.ts";
import { type Prop, propUnder } from "./props.ts";
import type { Hover, Steer } from "./stage.ts";

/** Somewhere with a prompt: one of the town's places, one of a camp's own, a way out. */
export interface Door extends Prompted {
  id: string;
  /** Where the member stands to use it, which way they face there, and how near that counts as there. */
  stand: Pt;
  face: Dir;
  reach: number;
  /** Ground that is the door itself, besides the things standing that name it as their `place`. */
  box?: Rect | undefined;
  /** Being at it some other way than near the stand: sitting at it, or anywhere along a shore. */
  at?: ((m: Actor) => boolean) | undefined;
  use: () => void;
  /** What walking on into it does, when that goes further than using it: in through a game's door. */
  enter?: (() => void) | undefined;
}

/** What a scene hands over. */
export interface Here {
  ground: Ground;
  doors(): readonly Door[];
  /** Whoever can be touched, and what touching one does. */
  people(): readonly Actor[];
  greet(who: Actor): void;
  /** The scene's own small things that answer before anything standing (says whether one did), and the one under a point. */
  own(x: number, y: number): boolean;
  ownAt(x: number, y: number): Hover | null;
  props(): readonly Prop[];
  /** A touch above the far hedge: says whether the point was sky. */
  sky(x: number, y: number): boolean;
  /** Whether the member may move about. */
  awake(): boolean;
  /** Stops whatever the member is doing: walking somewhere, sitting. */
  halt(): void;
}

/** Pushing on into a door for this long goes through it, in seconds. */
const PUSH = 0.32;
/** A finger's grace round the prompt, in the place's pixels. */
const PAD = 3;

const inside = (r: Rect, x: number, y: number, pad = 0): boolean =>
  x >= r.x - pad && y >= r.y - pad && x < r.x + r.w + pad && y < r.y + r.h + pad;
const me = (): Actor => must(G.player, "the member");
/** The way a push mostly goes. */
const dirOf = (dx: number, dy: number): Dir => (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : dy < 0 ? 3 : 0);

export function makeTouch(here: Here) {
  /** The door the prompt hangs by, kept while it fades. */
  let prompted: Door | null = null;
  let pushed = 0;

  const showing = (): Door | null => (show.promptT > 0.02 ? prompted : null);
  const onSign = (x: number, y: number): boolean =>
    showing() !== null && show.sign !== null && inside(show.sign, x, y, PAD);
  const boxAt = (x: number, y: number): Door | undefined =>
    here.doors().find((d) => d.box !== undefined && inside(d.box, x, y));

  /** Whether the member is at a door's stand, or on its ground; and at it in any way at all. */
  function by(d: Door): boolean {
    const m = me();
    return dist(m.x, m.y, d.stand.x, d.stand.y) < d.reach || (d.box !== undefined && inside(d.box, m.x, m.y));
  }
  const at = (d: Door): boolean => by(d) || d.at?.(me()) === true;

  function use(d: Door): void {
    if (!me().seat) me().dir = d.face;
    d.use();
  }

  /** The member sets off for a point, marked until they are there. */
  function head(to: Pt, then: () => void): void {
    here.halt();
    show.dest = to;
    const done = (): void => {
      show.dest = null;
      then();
    };
    walkTo(me(), to, done, here.ground);
  }

  /** Walks the member up to a door and uses it; at once if they are there. */
  function go(d: Door): void {
    if (at(d)) use(d);
    else head(d.stand, () => use(d));
  }

  /** Off to a point on bare ground, as a touch there sends the member. */
  function walk(x: number, y: number): true {
    closePanel();
    const to = here.ground.nearestFree(x, y);
    ring(to.x, to.y, GOLD[2], 6);
    sfx.tap();
    head(to, () => undefined);
    return true;
  }

  function personAt(x: number, y: number): Actor | null {
    let best: Actor | null = null;
    for (const a of here.people()) {
      if (a.away || a.alpha < 0.5) continue;
      const foot = a.seat ?? a;
      if (Math.abs(x - foot.x) > 7 || y < foot.y - headOf(a) - 2 || y > foot.y + 3 - a.lift) continue;
      if (!best || foot.y > (best.seat ?? best).y) best = a;
    }
    return best;
  }

  /** A thing standing is touched: it answers, and if it is part of a door the member goes there. */
  function touched(p: Prop, x: number, y: number): false {
    p.tap?.(p, x, y);
    const d = here.doors().find((o) => o.id === p.place);
    if (d) go(d);
    return false;
  }

  function under(x: number, y: number): (Hover & { who?: Actor }) | null {
    if (onSign(x, y) && show.sign) return { box: show.sign, tip: null };
    const who = personAt(x, y);
    if (who) {
      const foot = who.seat ?? who;
      const tall = headOf(who);
      return { box: { x: foot.x - 6, y: foot.y - tall, w: 12, h: tall + 1 - who.lift }, tip: null, who };
    }
    const own = here.ownAt(x, y);
    if (own) return own;
    const prop = propUnder(here.props(), x, y);
    if (prop?.hit && prop.kind !== "trunk") return { box: prop.hit, tip: prop.tip, ref: prop.ref };
    const door = boxAt(x, y);
    return door?.box ? { box: door.box, tip: null } : null;
  }

  /** A touch with a finger or the mouse; says whether it was bare ground, so that a drag may steer. */
  function tap(x: number, y: number, finger: boolean): boolean {
    show.touch = finger;
    if (!here.awake()) return false;
    closeCard();
    // The prompt is a button: it does what it says, and nothing under it is touched as well.
    const d = showing();
    if (d && onSign(x, y)) {
      use(d);
      return false;
    }
    const who = personAt(x, y);
    if (who) {
      sfx.pop();
      here.greet(who);
      return false;
    }
    if (here.own(x, y)) return false;
    const prop = propUnder(here.props(), x, y);
    if (prop && prop.kind !== "trunk") return touched(prop, x, y);
    // Ground that is a door: the way through it.
    const door = boxAt(x, y);
    if (door) {
      go(door);
      return false;
    }
    // The great trunks reach up into the sky; what is sky there is sky.
    if (here.sky(x, y)) return false;
    return prop ? touched(prop, x, y) : walk(x, y);
  }

  /** The pointer resting at a point, or nowhere: what is under it, marked. */
  function point(p: Pt | null): Hover | null {
    const h = p && here.awake() ? under(p.x, p.y) : null;
    show.hover = h ? h.box : null;
    show.pointed = h?.who ?? null;
    return h;
  }

  /** The key for "use what I am standing at". */
  function act(): void {
    if (!here.awake()) return;
    const d = showing();
    const m = me();
    if (d) use(d);
    else if (m.seat) release(m);
    else {
      hop(m);
      sfx.tap();
    }
  }

  /** The member's feet: steered by hand, walking on into a door, standing at one with its prompt up. */
  function step(dt: number, steer: Steer | null): void {
    const m = me();
    const awake = here.awake();
    const doors = awake ? here.doors() : [];
    const push = awake && steer ? pushOf(m, steer) : null;
    if (push) {
      if (m.seat || m.path.length > 0) here.halt();
      shove(m, dt, push.dx, push.dy, here.ground);
    }
    // Walking on into a door, for a moment, goes through it.
    const into = push && doors.find((d) => d.face === dirOf(push.dx, push.dy) && by(d));
    pushed = into ? pushed + dt : 0;
    if (into && pushed > PUSH) {
      pushed = 0;
      if (into.enter) into.enter();
      else use(into);
    }
    // The prompt hangs by the door the member is standing at, while nothing is open.
    const near = doors.find(at) ?? null;
    G.near = near?.id ?? null;
    const on = near !== null && G.panel === null && m.path.length === 0;
    if (near && on) {
      prompted = near;
      show.prompt = near;
    }
    show.promptT = clamp(show.promptT + (on ? dt : -dt) * 5, 0, 1);
  }

  return { go, walk, tap, point, act, step };
}
