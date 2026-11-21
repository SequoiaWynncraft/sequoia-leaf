/**
 * A camp as a scene: the member's own place behind the town's gate. It lays the clearing out from
 * its record, moves whoever is in it (the member, their pets, the town's own dropping by), answers
 * touches, and lets everything be picked up and set down somewhere else. `main.ts` drives it
 * through `Scene`; what a camp is and what may stand where are in `camp.ts`.
 *
 * It can also lay out and show somebody else's camp down the trail (`enter(owner)`, with the
 * `mate` it is given, `give`, and the note on their door), for when members' camps can be visited.
 * Nothing reaches that yet: the guild has no camp to give for anybody (`guild.camp`).
 */

import { CREAM, GOLD, GREEN, SKY, STONE } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import type { Dir } from "@sequoia-leaf/kit/skin.ts";
import { sfx, tone } from "@sequoia-leaf/kit/sound.ts";
import { clamp, type Ctx, dist, pick, type Pt, rng } from "@sequoia-leaf/kit/util.ts";

import {
  face,
  headOf,
  hop,
  makeActor,
  makeFolk,
  pushOf,
  release,
  say,
  shove,
  sit,
  stepActor,
  walkTo,
} from "./actors.ts";
import {
  boxOf,
  campFull,
  canPlace,
  CGH,
  CGW,
  freeSpot,
  mayPutAway,
  move,
  type PetId,
  petsOf,
  type Placed,
  putAway,
  setDown,
  setOut,
  standsBy,
  taken,
  TRAIL,
  turned,
  unpackParcel,
  type Verdict,
  walkable,
  WHY_NOT,
} from "./camp.ts";
import { type CampArt, pictureOf } from "./campart.ts";
import {
  CAMP_GROUND,
  campHedge,
  CH,
  CW,
  paintCampGround,
  TRAIL_END,
  TRAIL_IN,
  TRAIL_Y,
  type Trodden,
  troddenD,
  wornPaths,
} from "./campground.ts";
import { csfx } from "./campsfx.ts";
import { extraOf, lightOf, type Live, stepLive, touch, type TouchWorld } from "./camptouch.ts";
import { type CampUi } from "./campui.ts";
import { thingRef } from "./cards.ts";
import { drawPicture, drawProp, drawWords, type Picture, type Prompted, show, sizeBuffers } from "./draw.ts";
import { clearFlights, flights, fling, stepFlights } from "./flights.ts";
import { AT_CAMP, folkNamed, isCaller } from "./folk.ts";
import { bit, burst, float, flutter, puff, ring, sparkle, updateFx } from "./fx.ts";
import { type Actor, after, changed, forgetLater, G, hooks, stepLater } from "./game.ts";
import { trophies } from "./games.ts";
import { CELL, makeGround } from "./grid.ts";
import { paintTrunk } from "./ground.ts";
import { guild, type Happening, type MateCamp } from "./guild.ts";
import { closeCard, closePanel, showCard } from "./hud.ts";
import { BOX_FULL, letter, post, roomInBox, waiting } from "./mail.ts";
import { lineFor } from "./news.ts";
import { comeTo, makePet, MY_PETS, PET_ABOUT, petAt, type PetLive, type PetWorld, pleased, stepPet } from "./pets.ts";
import { type Light, makeProp, type Prop, propUnder } from "./props.ts";
import { camp as mine, greet, roomByTrail, roomFor, sendToCamp } from "./record.ts";
import type { Sprites } from "./sprites.ts";
import type { Hover, Scene, Stage } from "./stage.ts";
import { footprint, thingOf, turnsOf } from "./things.ts";
import type { Seat } from "./world.ts";

/** The camp's own places: things that open something when the member walks up to them. */
export type CampPlace = "cabin" | "mailbox" | "signpost" | "trail";

interface Spot extends Prompted {
  id: CampPlace;
  stand: Pt;
  face: Dir;
}

/** A thing in the member's hand while decorating: which, where it would go, and whether it may. */
interface Hold {
  index: number;
  x: number;
  y: number;
  t: number;
  ok: Verdict;
  dragging: boolean;
  /** Where on the thing it was taken hold of, from its foot. */
  grab: Pt;
  moved: boolean;
}

/** What the tray's bar says about the thing in hand. */
export interface Held {
  name: string;
  turns: boolean;
  stays: boolean;
}

export interface CampScene extends Scene {
  /** Lays out the member's own camp (`null`) or somebody else's, and brings the member in off the trail. */
  enter(owner: string | null): void;
  /** Whose camp is showing: `null` for the member's own. */
  owner(): string | null;
  /** Whose camp this is, as the guild describes it, when it is not the member's. */
  host(): MateCamp | null;
  /** Walk up to one of the camp's places and use it. */
  go(what: CampPlace): void;
  /** Leave down the trail: for the town, for home, or for somebody else's camp. */
  leave(to: "town" | "home" | { visit: string }): void;
  decorating(): boolean;
  decorate(on: boolean): void;
  held(): Held | null;
  /** Takes a thing out of the tray and sets it down near the member, in hand. */
  takeOut(id: string): boolean;
  turn(): void;
  stow(): void;
  /** The member chooses who lives with them first. */
  choose(kind: PetId): void;
  /** A present comes out of a letter and into the camp. */
  unwrap(thing: string): void;
  /** Leaves a small present at the camp the member is visiting. */
  give(thing: string): void;
  /** For looking at the camp from outside. */
  readonly handles: {
    visit(name: string): void;
    home(): void;
    town(): void;
    /** Walks the member up to one of the camp's places and uses it. */
    walk(what: CampPlace): void;
    decorate(on: boolean): void;
    take(id: string): boolean;
    grab(n: number): void;
    dragTo(cx: number, cy: number): void;
    drop(): void;
    things(): { id: string; x: number; y: number; cx: number; cy: number }[];
    /** The thing in hand while decorating: the square it is held over, and whether it may go there. */
    hand(): { id: string; cx: number; cy: number; ok: string } | null;
    pets(): { name: string; x: number; y: number }[];
    pet(n: number): void;
    choose(kind: PetId): void;
    owner(): string | null;
    guests(): string[];
    /** Touches the nth of whoever has dropped by, as the member would: it is greeted. */
    greet(n: number): void;
  };
}

/** What a member at home in their own camp might say, for when members' camps can be visited. */
const THANKS = ["for me? erm. thank you.", "I will treasure it.", "you shouldn't have. (you should.)"];

const nameSeed = (name: string): number => {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return h >>> 0;
};

function player(): Actor {
  if (!G.player) throw new Error("nobody to walk about");
  return G.player;
}

/** Where a thing's picture stands: the middle of the near edge of the ground it takes. */
function footOf(p: Placed): Pt | null {
  const t = thingOf(p.id);
  if (!t) return null;
  const b = boxOf(p, t);
  return { x: (b.x0 + b.x1 + 1) * (CELL / 2), y: (b.y1 + 1) * CELL - 1 };
}

/** A real member as they are in town (visiting, or dozing), for their figure and their name. */
const memberIn = (name: string): Actor | null => G.visitors.find((a) => a.who.name === name) ?? null;

/** Something green at the clearing's edge is touched. */
function leafy(p: Prop): void {
  p.bumpAt = G.t;
  flutter(p.x, p.y - 6, 5, [GREEN[3], GREEN[4], GREEN[2]], 6, 24);
  sfx.rustle();
}

/** What the games say the member has won, that has not arrived yet, is sent on. */
function winnings(): void {
  for (const id of trophies()) {
    const thing = thingOf(id);
    // While the trail is full it is not handed over; it comes another time, when there is room.
    if (!thing || mine.earned.includes(id) || !roomByTrail()) continue;
    mine.earned.push(id);
    // One more of a thing the member has as many of as may be had is won, and simply not added.
    if (sendToCamp(id)) hooks.feed(`Won: ${thing.name}. It is waiting by the trail.`, "gold");
    else changed();
  }
}

/** One square of ground, tinted. */
function tile(g: Ctx, x: number, y: number, col: string, a: number): void {
  g.globalAlpha = a;
  R(g, x + 1, y + 1, CELL - 2, CELL - 2, col);
  g.globalAlpha = 1;
}

/** Which way something held near an edge of the view pushes it: -1, 0 or 1. */
const edgePush = (f: number): number => (f < 0.14 ? -1 : f > 0.86 ? 1 : 0);

export function makeCamp(
  sprites: Sprites,
  art: CampArt,
  stage: Stage,
  town: Scene & { cameFromCamp(): void },
  backdrop: { sky: HTMLCanvasElement; near: HTMLCanvasElement },
  ui: CampUi,
): CampScene {
  // ---------- what is here ----------

  let owner: string | null = null;
  let mate: MateCamp | null = null;
  /** The layout on show: the member's own record, or a copy of somebody else's. */
  let placed: Placed[] = mine.placed;
  /**
   * What is set down in the layout but still in the air on its way there: not drawn standing, in
   * nobody's way and not to be picked up, until it lands or the flights are cleared away.
   */
  const aloft = new Set<Placed>();
  let lives: Live[] = [];
  const kept = new WeakMap<Placed, Live>();
  let scenery: Prop[] = [];
  let flats: Prop[] = [];
  let lights: Light[] = [];
  let gateLights: Light[] = [];
  let seats: Seat[] = [];
  const seatsOf = new WeakMap<Placed, { key: string; seats: Seat[] }>();
  let spots: Spot[] = [];
  let pets: PetLive[] = [];
  let guests: Actor[] = [];
  /** Lanterns going up beyond the far trees, one for each raid the guild finishes. */
  const lanterns: { x: number; y: number; life: number; col: number; over: boolean }[] = [];
  let seed = 0;
  let paths: Trodden[] = wornPaths(null, null);
  let pathsKey = "";
  const ground = makeGround(CGW, CGH, (x, y) => troddenD(paths, x, y));

  const fireAt = (): Pt | null => {
    const l = lives.find((v) => v.thing.id === "fire-ring");
    return l ? { x: l.prop.x, y: l.prop.y - 5 } : null;
  };

  const world: TouchWorld = {
    art,
    mine: true,
    sit(l, wx, wy) {
      sitOn(l, wx, wy);
    },
    open(what) {
      go(what);
    },
    mail: () => owner === null && waiting(mine.letters) > 0,
    trophies: () => (owner === null ? mine.earned : theirTrophies),
    hedge: (x) => campHedge(x, seed),
  };
  let theirTrophies: string[] = [];
  const petWorld: PetWorld = { ground, member: null, fire: null };

  // ---------- laying it out ----------

  function liveOf(p: Placed): Live | null {
    const thing = thingOf(p.id);
    const at = footOf(p);
    if (!thing || !at) return null;
    let l = kept.get(p);
    if (!l) {
      l = {
        placed: p,
        thing,
        prop: makeProp(p.id, null, at.x, at.y),
        light: null,
        at: -9,
        taps: 0,
        backAt: 0,
        glow: null,
      };
      kept.set(p, l);
    }
    const me = l;
    const sprite =
      p.id === "cabin"
        ? (art.cabins[owner === null ? 0 : nameSeed(owner) % art.cabins.length] ?? null)
        : pictureOf(art, p.id, p.t, p.s);
    const boost = me.light?.boost ?? 0;
    me.prop = makeProp(p.id, sprite, at.x, at.y, {
      z: thing.flat ? -1 : at.y,
      bumpAt: me.prop.bumpAt,
      hops: me.prop.hops,
      tip: [thing.name, thing.about],
      tap: (_p, wx, wy) => {
        touch(me, world, wx, wy);
      },
    });
    me.glow = null;
    me.prop.extra = extraOf(me, world);
    me.light = lightOf(me);
    if (me.light) me.light.boost = boost;
    return me;
  }

  function seatsFor(l: Live): Seat[] {
    const n = l.thing.seats;
    if (n <= 0) return [];
    const b = boxOf(l.placed, l.thing);
    const fire = lives.find(
      (v) =>
        (v.thing.id === "fire-ring" || v.thing.id === "brazier") && dist(v.prop.x, v.prop.y, l.prop.x, l.prop.y) < 56,
    );
    const left = b.x0 * CELL;
    const wide = (b.x1 - b.x0 + 1) * CELL;
    const upright = b.y1 - b.y0 > b.x1 - b.x0;
    const out: Seat[] = [];
    for (let i = 0; i < n; i++) {
      const id = l.thing.id;
      const x = upright ? l.prop.x : left + ((i + 0.5) * wide) / n;
      const lift =
        id === "hammock"
          ? -4
          : id === "stump" || id === "rocker"
            ? -3
            : id === "cushion" || id === "crab-throne"
              ? -2
              : 1;
      const y = upright ? b.y0 * CELL + ((i + 0.5) * (b.y1 - b.y0 + 1) * CELL) / n + 5 : l.prop.y + lift;
      let dir: Dir = id === "picnic" ? 3 : 0;
      if (fire && id !== "bench" && id !== "crab-throne" && id !== "picnic") {
        const dx = fire.prop.x - x;
        const dy = fire.prop.y - 5 - y;
        dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 1) : dy > 0 ? 0 : 3;
      } else if (upright) dir = 2;
      out.push({ x, y, dir, from: { x, y: y + 9 }, at: fire ? "fire" : "bench", taken: false });
    }
    return out;
  }

  /** Where somebody steps up from to sit: the nearest clear ground to the side they face. */
  function stepUp(s: Seat): void {
    const tries: readonly (readonly [number, number])[] =
      s.dir === 3
        ? [
            [0, 10],
            [0, -12],
          ]
        : s.dir === 1
          ? [
              [-10, 2],
              [10, 2],
            ]
          : s.dir === 2
            ? [
                [10, 2],
                [-10, 2],
              ]
            : [
                [0, -12],
                [0, 10],
              ];
    for (const [dx, dy] of [...tries, [0, 10], [0, -12], [-10, 2], [10, 2]] as const) {
      if (ground.footBlocked(s.x + dx, s.y + dy)) continue;
      s.from = { x: s.x + dx, y: s.y + dy };
      return;
    }
    s.from = ground.nearestFree(s.x, s.y + 9);
  }

  function block(): void {
    const on = taken(placed.filter((p) => !aloft.has(p)));
    for (let y = 0; y < CGH; y++)
      for (let x = 0; x < CGW; x++) {
        const n = y * CGW + x;
        ground.blocked[n] = !walkable(x, y) || on.solid[n] === 1 ? 1 : 0;
        ground.cost[n] = troddenD(paths, x * CELL + 4, y * CELL + 4) < 1 ? 1 : 1.7;
      }
  }

  const everybody = (): Actor[] => (G.player ? [G.player, ...guests] : guests);

  /** Whether somebody has been shut off from the trail by what stands round them. */
  const cutOff = (a: Pt): boolean =>
    dist(a.x, a.y, TRAIL_IN.x, TRAIL_IN.y) > CELL * 2 && ground.findPath(a, TRAIL_IN, false).length === 0;

  /** The nearest clear square to somebody from which the trail can still be reached. */
  function wayOut(a: Pt): Pt | null {
    const cx = Math.floor(a.x / CELL);
    const cy = Math.floor(a.y / CELL);
    for (let r = 1; r < 14; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || ground.cellBlocked(cx + dx, cy + dy)) continue;
          const to = { x: (cx + dx) * CELL + 4, y: (cy + dy) * CELL + 5 };
          if (!cutOff(to)) return to;
        }
    return null;
  }

  /** Everything is made again from the record: after a thing is moved, turned, put away or set out. */
  function rebuild(): void {
    lives = placed.flatMap((p) => {
      const l = aloft.has(p) ? null : liveOf(p);
      return l ? [l] : [];
    });
    flats = lives.filter((l) => l.thing.flat).map((l) => l.prop);
    pic.props = [...scenery, ...lives.filter((l) => !l.thing.flat).map((l) => l.prop)];
    lights = [...gateLights, ...lives.flatMap((l) => (l.light ? [l.light] : []))];

    // Trodden earth follows the fire and the cabin's door; it is painted again only if they moved.
    const cabin = lives.find((l) => l.thing.id === "cabin");
    const door = cabin ? { x: (cabin.placed.x + 6) * CELL + 4, y: (cabin.placed.y + 3) * CELL + 2 } : null;
    const fire = fireAt();
    const key = `${fire?.x},${fire?.y},${door?.x},${door?.y},${seed}`;
    if (key !== pathsKey) {
      pathsKey = key;
      paths = wornPaths(fire ? { x: fire.x, y: fire.y + 2 } : null, door);
      pic.ground = paintCampGround(seed, paths);
    }
    block();

    // Seats: kept where the thing they belong to has not moved, so that nobody is tipped off one.
    const old = seats;
    seats = lives.flatMap((l) => {
      const k = `${l.placed.x},${l.placed.y},${l.placed.t}`;
      const had = seatsOf.get(l.placed);
      const list = had?.key === k ? had.seats : seatsFor(l);
      seatsOf.set(l.placed, { key: k, seats: list });
      for (const s of list) stepUp(s);
      return list;
    });
    for (const a of everybody()) {
      if (a.seat && old.includes(a.seat) && !seats.includes(a.seat)) release(a);
      // Nobody is left fenced in: whoever can no longer get to the trail hops over to where they can.
      if (!a.seat && a.x < CW - CELL && !ground.footBlocked(a.x, a.y) && cutOff(a)) {
        const to = wayOut(a);
        if (to) {
          a.x = to.x;
          a.y = to.y;
          a.path = [];
          hop(a);
        }
      }
      if (!a.seat && a.x < CW - CELL && ground.footBlocked(a.x, a.y)) {
        const to = ground.nearestFree(a.x, a.y);
        a.x = to.x;
        a.y = to.y;
        a.path = [];
        hop(a);
      }
    }
    for (const p of pets) {
      if (p.x >= CW - CELL || !ground.footBlocked(p.x, p.y)) continue;
      const to = ground.nearestFree(p.x, p.y);
      p.x = to.x;
      p.y = to.y;
      p.path = [];
    }

    // The places somebody can walk up to.
    spots = [];
    const home = owner === null;
    for (const l of lives) {
      const id = l.thing.id;
      if (id !== "cabin" && id !== "mailbox" && id !== "signpost") continue;
      const stands = standsBy(l.placed, l.thing)
        .map((c) => ({ x: c.x * CELL + 4, y: c.y * CELL + 5 }))
        .filter((c) => !ground.footBlocked(c.x, c.y));
      const stand = stands.find((c) => c.y > l.prop.y) ?? stands[0];
      if (!stand) continue;
      const tall = l.prop.sprite?.c.height ?? 16;
      const name =
        id === "cabin"
          ? home
            ? "Cabin"
            : mate?.home
              ? ""
              : "Read the note"
          : id === "mailbox"
            ? home
              ? "Mailbox"
              : "Leave a present"
            : "Signpost";
      if (!name) continue;
      spots.push({
        id,
        name,
        stand,
        face: stand.y > l.prop.y ? 3 : stand.x < l.prop.x ? 2 : stand.x > l.prop.x ? 1 : 0,
        prompt: { x: l.prop.x, y: l.prop.y - tall - 22 },
      });
    }
    spots.push({
      id: "trail",
      name: home ? "Town" : "Home",
      stand: { x: CW - 22, y: TRAIL_Y + 2 },
      face: 2,
      prompt: { x: CW - 30, y: TRAIL_Y - 44 },
    });
    petWorld.fire = fire;
  }

  /** The trees, the green things at the clearing's edge, and the posts either side of the trail. */
  function layScenery(): void {
    scenery = [];
    gateLights = [];
    const random = rng(1000 + seed);
    const trunk = (cx: number, base: number, hw: number, n: number): void => {
      const t = paintTrunk(hw, base + 210, n + seed, 250);
      scenery.push(
        makeProp("trunk", t, cx, base, {
          tap: (p, wx, wy) => {
            p.bumpAt = G.t;
            sfx.knock();
            puff(wx, wy, 3, STONE[1]);
            flutter(wx, G.cam.y - 2, 8, [GREEN[2], GREEN[1]], 30, 0);
          },
        }),
      );
    };
    trunk(6, 108, 42, 11);
    trunk(150 + Math.floor(random() * 30), 98, 24, 12);
    trunk(286 + Math.floor(random() * 30), 97, 26, 13);
    trunk(CW - 4, 110, 42, 14);
    trunk(-12, 214, 38, 15);
    trunk(-6, CH + 8, 44, 16);
    // The trail goes out between these two, and behind the nearer one.
    trunk(CW + 18, TRAIL.y0 * CELL - 8, 34, 17);
    trunk(CW + 44, CH + 4, 44, 18);

    const green = (x: number, y: number): void => {
      const r = random();
      if (r < 0.34) {
        const b = sprites.bushes[Math.floor(random() * sprites.bushes.length)];
        if (b) scenery.push(makeProp("bush", b, x, y, { tap: leafy }));
      } else if (r < 0.7) {
        const f = sprites.ferns[Math.floor(random() * sprites.ferns.length)];
        if (f) scenery.push(makeProp("fern", f, x, y, { tap: leafy }));
      } else if (r < 0.86) {
        const k = Math.floor(random() * sprites.flowers.length);
        const f = sprites.flowers[k];
        if (f)
          scenery.push(
            makeProp("flower", f, x, y, {
              hops: true,
              tap: (p) => {
                p.bumpAt = G.t;
                flutter(p.x, p.y - 5, 4, [SKY[4], CREAM, GOLD[1]], 3, 30);
                sfx.pluck(Math.floor(p.x / 23) % 10);
              },
            }),
          );
      } else {
        const rk = sprites.rocks[Math.floor(random() * sprites.rocks.length)];
        if (rk)
          scenery.push(
            makeProp("rock", rk, x, y, {
              hops: true,
              tap: (p) => {
                p.bumpAt = G.t;
                sfx.knock();
                puff(p.x, p.y, 4, STONE[2]);
              },
            }),
          );
      }
    };
    // Along the back, under the far hedge; down both sides; and along the near edge.
    for (let x = 40; x < CW - 30; x += 22 + Math.floor(random() * 16)) green(x, 84 + Math.floor(random() * 16));
    for (let y = 124; y < CH - 30; y += 26 + Math.floor(random() * 14)) {
      green(14 + Math.floor(random() * 12), y);
      if (y < TRAIL.y0 * CELL - 14 || y > (TRAIL.y1 + 1) * CELL + 22) green(CW - 22 + Math.floor(random() * 12), y);
    }
    for (let x = 30; x < CW - 26; x += 24 + Math.floor(random() * 18)) green(x, CH - 12 + Math.floor(random() * 8));

    // The posts either side of the trail, with a lantern each.
    art.gatepost.forEach((stake, i) => {
      const x = CW - 24;
      const y = i === 0 ? TRAIL.y0 * CELL - 2 : (TRAIL.y1 + 1) * CELL + 7;
      const l: Light = { x: x + (i === 0 ? 8 : -8), y: y - 26, r: 34, power: 0.9, boost: 0, phase: i * 2 };
      gateLights.push(l);
      scenery.push(
        makeProp("post", stake, x, y, {
          tip: ["The trail", owner === null ? "To town, and to everybody else's camp." : "The way home."],
          tap: (p) => {
            p.bumpAt = G.t;
            l.boost = 1;
            sfx.pluck(5 + i * 2);
            burst(l.x, l.y, 5, [GOLD[2], CREAM], 26);
          },
        }),
      );
    });
  }

  // ---------- getting about ----------

  let pending: CampPlace | null = null;
  let leaving = false;
  /** How far the view has been pushed off the member while something is dragged near an edge. */
  const pan = { x: 0, y: 0 };

  function halt(): void {
    const p = player();
    release(p);
    p.path = [];
    p.arrive = null;
    pending = null;
    show.dest = null;
  }

  const awake = (): boolean => G.home && G.dark < 0.35 && !leaving;

  function use(what: CampPlace): void {
    const p = player();
    if (what === "trail") {
      leave(owner === null ? "town" : "home");
      return;
    }
    const spot = spots.find((s) => s.id === what);
    if (spot) p.dir = spot.face;
    if (what === "cabin" && owner !== null) ui.open("note");
    else if (what === "mailbox" && owner !== null) ui.open("present");
    else ui.open(what);
  }

  function go(what: CampPlace): void {
    if (!awake()) return;
    const p = player();
    const spot = spots.find((s) => s.id === what);
    if (!spot) return;
    if (dist(p.x, p.y, spot.stand.x, spot.stand.y) < 14) {
      use(what);
      return;
    }
    halt();
    pending = what;
    show.dest = spot.stand;
    walkTo(
      p,
      spot.stand,
      () => {
        show.dest = null;
        if (pending !== what) return;
        pending = null;
        use(what);
      },
      ground,
    );
  }

  function sitOn(l: Live, wx: number, wy: number): void {
    if (decor) return;
    const p = player();
    const own = (seatsOf.get(l.placed)?.seats ?? []).filter((s) => !s.taken || s === p.seat);
    const best = own.toSorted((a, b) => dist(wx, wy, a.x, a.y - 6) - dist(wx, wy, b.x, b.y - 6))[0];
    if (!best || best === p.seat) {
      if (!best) sfx.knock();
      return;
    }
    halt();
    best.taken = true;
    p.goal = best;
    sfx.tap();
    walkTo(
      p,
      best.from,
      () => {
        sit(p, best);
      },
      ground,
    );
  }

  /** Off down the trail. Night closes in once they are nearly out of sight, or have walked a while. */
  function leave(to: "town" | "home" | { visit: string }): void {
    if (leaving || !G.home) return;
    const p = player();
    halt();
    decorate(false);
    closePanel();
    closeCard();
    leaving = true;
    walkTo(p, { x: CW - 6, y: TRAIL_Y + 2 }, null, ground);
    p.path.push({ ...TRAIL_END });
    const set = (): void => {
      if (to === "town") {
        stage.travel(town, () => {
          leaving = false;
          clear();
          town.cameFromCamp();
        });
        return;
      }
      stage.travel(scene, () => {
        enter(to === "home" ? null : to.visit);
      });
    };
    const started = G.t;
    const wait = (): void => {
      if (dist(p.x, p.y, TRAIL_END.x, TRAIL_END.y) < 70 || G.t - started > 0.9) set();
      else after(0.1, wait);
    };
    wait();
  }

  /** Everything in the air, everything about to happen and everything said is forgotten: the camp is being left. */
  function clear(): void {
    forgetLater("camp");
    // What was on its way down is where it was going already.
    clearFlights();
    aloft.clear();
    for (const s of seats) s.taken = false;
    guests = [];
    unpacking = false;
  }

  // ---------- who is here ----------

  function addPet(kind: PetId, name: string, hue: number, at: Pt): PetLive {
    const p = makePet(kind, name, art.pets(kind, hue), ground.nearestFree(at.x, at.y));
    pets.push(p);
    return p;
  }

  /** Somewhere clear to stand about, not far from a point. */
  function about(at: Pt, reach = 40): Pt {
    return ground.nearestFree(at.x + (Math.random() - 0.5) * reach, at.y + (Math.random() - 0.5) * reach * 0.6);
  }

  function freeSeat(a: Actor): Seat | null {
    const fire = fireAt();
    let best: Seat | null = null;
    let bd = 1e9;
    for (const s of seats) {
      if (s.taken) continue;
      const d = (fire ? dist(s.x, s.y, fire.x, fire.y) : 0) + dist(s.x, s.y, a.x, a.y) * 0.2;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  function sitDown(a: Actor): void {
    const s = freeSeat(a);
    if (!s) return;
    s.taken = true;
    a.goal = s;
    walkTo(
      a,
      s.from,
      () => {
        sit(a, s);
      },
      ground,
    );
  }

  function gone(a: Actor): void {
    release(a);
    guests = guests.filter((g) => g !== a);
    if (show.card === a) closeCard();
  }

  function walkOff(a: Actor): void {
    walkTo(a, { x: CW - 6, y: TRAIL_Y + 2 }, null, ground);
    a.path.push({ ...TRAIL_END });
    a.arrive = (): void => {
      gone(a);
    };
  }

  /**
   * One of the town's own walks in off the trail, says hello, settles by the fire a while, and
   * leaves: sometimes by way of the mailbox. A touch greets it, and the camp keeps count.
   */
  function callIn(h: Extract<Happening, { kind: "call" }>): boolean {
    const t = folkNamed(h.who);
    if (!t || !isCaller(t.id) || owner !== null || guests.length >= 2 || guests.some((g) => g.who.name === h.who))
      return false;
    const lines = AT_CAMP[t.id];
    const a = makeFolk(t, TRAIL_END.x, TRAIL_END.y);
    a.mode = "led";
    a.doing = "call";
    a.alpha = 0;
    a.side = -1;
    guests.push(a);
    hooks.feed(`${t.name.charAt(0).toUpperCase()}${t.name.slice(1)} has wandered into your camp.`, "leaf");
    const fire = fireAt() ?? { x: CW / 2, y: TRAIL_Y };
    const stay = 16 + Math.random() * 10;
    const here = (): boolean => guests.includes(a);
    walkTo(
      a,
      about({ x: fire.x + 30, y: fire.y + 14 }, 24),
      () => {
        if (G.player) face(a, G.player.x, G.player.y);
        hop(a);
        say(a, pick(lines.hello, Math.random()), 2.4);
        for (const p of pets) comeTo(p, a, petWorld);
        // It settles down by the fire: a gnome stands warming its hands, the others curl up.
        after(1.8, () => {
          if (!here()) return;
          walkTo(
            a,
            about({ x: fire.x + (Math.random() < 0.5 ? -20 : 20), y: fire.y + 10 }, 10),
            () => {
              if (G.player) face(a, fire.x, fire.y);
              if (t.kind !== "gnome") a.doing = "asleep";
            },
            ground,
          );
        });
        for (const at of [stay * 0.35, stay * 0.7])
          after(at, () => {
            if (!here()) return;
            if (a.doing === "asleep") a.doing = "call";
            say(a, pick(lines.chat, Math.random()), 2.8);
          });
        after(stay, () => {
          if (!here()) return;
          a.doing = "call";
          const bye = (): void => {
            say(a, pick(lines.bye, Math.random()), 2.2);
            after(1.2, () => {
              if (here()) walkOff(a);
            });
          };
          const box = spots.find((s) => s.id === "mailbox");
          if (!box || (h.note === "" && h.gift === "")) {
            bye();
            return;
          }
          walkTo(
            a,
            box.stand,
            () => {
              a.dir = box.face;
              deliver(h);
              after(1.1, bye);
            },
            ground,
          );
        });
      },
      ground,
    );
    return true;
  }

  /** The member touches one of the town's own who has come by: it is pleased, and has been greeted. */
  const greetedHere = new WeakSet<Actor>();
  function greeted(a: Actor): void {
    const t = a.folk?.t;
    if (!t || !isCaller(t.id)) return;
    if (a.doing === "asleep") a.doing = "call";
    say(a, pick(AT_CAMP[t.id].thanks, Math.random()), 2.4);
    if (greetedHere.has(a)) return;
    greetedHere.add(a);
    float(a.x, a.y - 22, "\u2665", SKY[5], 1.2);
    // A pet who has been waiting for a welcoming camp may move in.
    greet();
  }

  /** A letter goes into the member's mailbox: the flag goes up, wherever the member is. */
  function deliver(h: Extract<Happening, { kind: "call" }>): void {
    if (h.note === "" && h.gift === "") return;
    if (!roomInBox(mine.letters)) {
      hooks.feed(`${h.who} came by. ${BOX_FULL}`, "coral");
      return;
    }
    if (!post(mine.letters, letter(h.id, h.who, h.note || "This is for you.", h.gift))) return;
    changed();
    hooks.feed(`${h.who} left something in your mailbox.`, "leaf");
    if (G.where !== "camp" || owner !== null) return;
    csfx.mail();
    const box = lives.find((l) => l.thing.id === "mailbox");
    if (!box) return;
    box.prop.bumpAt = G.t;
    sparkle(box.prop.x, box.prop.y - 12, 8, 5);
  }

  function cheer(): void {
    for (const a of everybody()) hop(a, 2);
    for (const p of pets) p.joy = 1.1;
    guests.forEach((a, i) => {
      const cheers = a.folk?.t.cheers;
      if (!cheers) return;
      after(0.3 + i * 0.3, () => {
        if (guests.includes(a)) say(a, pick(cheers, Math.random()), 2.2);
      });
    });
  }

  /** The guild's moments, as they reach a camp: a line in the feed, something beyond the trees, and whoever is here answering. */
  function hear(h: Happening): void {
    if (h.kind === "call") {
      // Nobody home (the member is in town, or visiting): they leave what they brought and go.
      if (G.where !== "camp" || !callIn(h)) deliver(h);
      return;
    }
    if (G.where !== "camp") return;
    switch (h.kind) {
      case "party": {
        const line = lineFor(h);
        if (line) hooks.feed(line[0], line[1]);
        sfx.fanfare();
        const x = clamp(G.cam.x + G.view.w * (0.25 + Math.random() * 0.5), 30, CW - 30);
        const col = G.raidsToday % sprites.lanterns.length;
        lanterns.push({ x, y: campHedge(x, seed) + 8, life: 0, col, over: false });
        // Where the far trees are out of sight, one that has drifted this way goes up over the camp.
        if (G.cam.y > campHedge(x, seed) - 20)
          lanterns.push({ x, y: G.cam.y + G.view.h * 0.62, life: 0, col, over: true });
        cheer();
        return;
      }
      case "war": {
        const line = lineFor(h);
        if (line) hooks.feed(line[0], line[1]);
        sfx.fanfare();
        const cabin = lives.find((l) => l.thing.id === "cabin");
        if (cabin) burst(cabin.prop.x + 32, cabin.prop.y - 74, 18, [GOLD[1], SKY[4], CREAM, SKY[5]], 52);
        cheer();
        return;
      }
      case "quest":
        hooks.feed(h.text, h.tone);
        return;
      case "reached":
      case "milestone": {
        const line = lineFor(h);
        if (line) hooks.feed(line[0], line[1]);
      }
    }
  }
  guild.hear(hear);

  // ---------- parcels, presents, and things arriving ----------

  let unpacking = false;
  const PARCEL_AT: readonly Pt[] = [
    { x: CW - 14, y: 246 },
    { x: CW - 5, y: 250 },
    { x: CW - 10, y: 240 },
    { x: CW - 19, y: 254 },
  ];

  /**
   * A free spot near a square with air round it (two squares to either side, three behind and one
   * before, since things stand taller than the ground they take), so that what arrives does not
   * land in a heap.
   */
  function roomy(id: string, near: { x: number; y: number }): { x: number; y: number } | null {
    const thing = thingOf(id);
    if (!thing) return null;
    const [w, d] = footprint(thing, 0);
    const on = taken(placed);
    let best: { x: number; y: number } | null = null;
    let bestD = 1e9;
    for (let y = near.y - 12; y <= near.y + 6; y++)
      for (let x = near.x - 26; x <= near.x + 6; x++) {
        const far = Math.hypot(x - near.x, (y - near.y) * 1.2);
        if (far >= bestD) continue;
        let free = true;
        for (let cy = y - 3; cy <= y + d && free; cy++)
          for (let cx = x - 2; cx <= x + w + 1 && free; cx++)
            if (cx >= 0 && cy >= 0 && cx < CGW && cy < CGH && on.stand[cy * CGW + cx] !== -1) free = false;
        // Not on the earth people walk along, either.
        for (let cy = y; cy < y + d && free; cy++)
          for (let cx = x; cx < x + w && free; cx++)
            if (troddenD(paths, cx * CELL + 4, cy * CELL + 4) < 3) free = false;
        if (!free || canPlace(placed, id, x, y, 0) !== "ok") continue;
        bestD = far;
        best = { x, y };
      }
    return best;
  }

  /** Where a thing arriving near a square comes down: somewhere with air round it, or else anywhere it fits. */
  const landing = (id: string, near: { x: number; y: number }): { x: number; y: number } | null =>
    roomy(id, near) ?? freeSpot(placed, id, near);

  /**
   * Shows a thing that has just been set down (`at`, or `null` if it went into the tray) flying
   * there from somewhere. The layout has it already, and holds its ground while it is in the air:
   * the flight is only how it is seen arriving, so leaving, or a reload, meanwhile loses nothing.
   */
  function comeDown(id: string, at: Placed | null, from: Pt, done: (() => void) | null): void {
    const thing = thingOf(id);
    if (!at) {
      if (thing) float(from.x, from.y - 14, `${thing.name}: in your tray`, CREAM, 2.2);
      changed();
      ui.tray();
      done?.();
      return;
    }
    if (owner === null) changed();
    const sprite = pictureOf(art, id, 0, 0);
    const foot = footOf(at);
    if (!thing || !sprite || !foot) {
      rebuild();
      done?.();
      return;
    }
    aloft.add(at);
    sfx.pop();
    fling(sprite.c, from, foot, 0.6, 30, () => {
      aloft.delete(at);
      rebuild();
      csfx.thud();
      puff(foot.x, foot.y, 5, "#966c4a");
      sparkle(foot.x, foot.y - 8, 8, 6);
      float(foot.x, foot.y - 20, thing.name, GOLD[2], 1.8);
      done?.();
    });
  }

  /** Sets a thing down as near a spot as it will go, flying there from somewhere; into the tray if there is no room. */
  function arrive(id: string, from: Pt, near: { x: number; y: number }, done: (() => void) | null = null): void {
    if (!thingOf(id) || !pictureOf(art, id, 0, 0)) {
      done?.();
      return;
    }
    // The member's own camp, once as full as it may be, has nowhere for it: it goes into the tray.
    const full = owner === null && campFull(placed);
    const spot = full ? null : landing(id, near);
    // Into the member's own camp, or their tray, it is simply not added if they have as many of it as may be had.
    if ((owner === null || !spot) && !roomFor(id)) {
      done?.();
      return;
    }
    if (full) hooks.feed(WHY_NOT.full, "coral");
    comeDown(id, setDown({ placed, tray: mine.tray }, id, spot), from, done);
  }

  /** The parcels by the trail open one after another, and what was in each lands in the camp. */
  function unpack(): void {
    // Not until the member is in and looking, and has somebody to watch it with.
    if (unpacking || owner !== null || mine.parcels.length === 0 || G.where !== "camp" || !mine.first || G.dark > 0)
      return;
    unpacking = true;
    // Said once, the first time a parcel opens into the tray because the camp is full.
    let toldFull = false;
    const next = (): void => {
      const from = PARCEL_AT[Math.min(PARCEL_AT.length, mine.parcels.length) - 1] ?? { x: CW - 14, y: 246 };
      // Out of the parcels and into the camp in one step; then it is seen flying there.
      const got = owner === null ? unpackParcel(mine, (id) => landing(id, { x: 37, y: 31 })) : null;
      if (!got) {
        unpacking = false;
        return;
      }
      if (!got.at && !toldFull && campFull(mine.placed)) {
        toldFull = true;
        hooks.feed(WHY_NOT.full, "coral");
      }
      puff(from.x, from.y - 4, 6, "#a35d3b");
      comeDown(got.id, got.at, { x: from.x, y: from.y }, () => {
        after(0.3, next);
      });
    };
    after(0.5, next);
  }

  /** Somebody new moves in when the camp has earned it; they come in off the trail. */
  function movingIn(): void {
    if (owner !== null) return;
    for (const kind of petsOf(mine)) {
      if (pets.some((p) => p.kind === kind)) continue;
      const p = addPet(kind, MY_PETS[kind], 0, TRAIL_IN);
      p.x = TRAIL_END.x;
      p.y = TRAIL_END.y;
      if (G.player) comeTo(p, G.player, petWorld);
      hooks.feed(`${p.name} has moved in. ${PET_ABOUT[kind]}`, "leaf");
      sfx.twinkle();
    }
  }

  // ---------- coming in ----------

  function enter(who: string | null): void {
    clear();
    G.where = "camp";
    // Somebody the guild does not know has no camp: the trail leads home instead.
    mate = who === null ? null : guild.camp(who);
    owner = mate ? mate.owner : null;
    world.mine = owner === null;
    seed = owner === null ? 0 : nameSeed(owner) % 5000;
    pets = [];
    lanterns.length = 0;
    sel = null;
    decor = false;
    leaving = false;
    pending = null;
    pan.x = 0;
    pan.y = 0;
    show.prompt = null;
    show.promptT = 0;
    show.hover = null;
    show.pointed = null;
    show.dest = null;

    const p = player();
    release(p);
    p.x = TRAIL_END.x;
    p.y = TRAIL_END.y;
    p.dir = 1;
    p.alpha = 0;
    p.speed = 64;
    p.say = "";
    p.path = [{ ...TRAIL_IN }];
    p.arrive = (): void => {
      p.dir = 1;
    };

    if (mate) {
      placed = structuredClone([...mate.placed]);
      // The present left here on an earlier visit is where it was put.
      const gave = mine.gave.find((g) => g.to === mate?.owner);
      const box = placed.find((q) => q.id === "mailbox");
      if (gave && box) {
        const spot = freeSpot(placed, gave.what, { x: box.x - 1, y: box.y + 1 });
        if (spot) placed.push({ id: gave.what, ...spot, t: 0, s: 0 });
      }
      theirTrophies = ["trophy-oldbramble", "model-crab", "trophy-hoardmagpie", "model-beacon"].slice(0, seed % 4);
    } else {
      placed = mine.placed;
      winnings();
    }
    layScenery();
    pathsKey = "";
    rebuild();
    stage.snap();

    const fire = fireAt() ?? { x: CW / 2, y: TRAIL_Y };
    if (mate) {
      mate.pets.forEach((spec, i) => {
        addPet(spec.kind, spec.name, 1 + ((seed + i) % 3), about(fire, 120));
      });
      hooks.feed(`${mate.owner}'s camp.`, "leaf");
      const body = mate.home ? memberIn(mate.owner) : null;
      if (body?.body) {
        const at = about({ x: fire.x - 20, y: fire.y + 16 }, 30);
        const host = makeActor(body.who, body.body, at.x, at.y);
        host.mode = "led";
        host.doing = "home";
        guests.push(host);
        const hello = mate.hello;
        after(1.5, () => {
          if (!guests.includes(host)) return;
          if (G.player) face(host, G.player.x, G.player.y);
          hop(host, 2);
          say(host, hello[0] ?? "oh! a visitor. hi.", 3);
        });
        after(3.4, () => {
          if (guests.includes(host)) sitDown(host);
        });
      } else
        after(1.2, () => {
          float(TRAIL_IN.x - 20, TRAIL_Y - 30, "Nobody home. There is a note on the door.", CREAM, 3);
        });
    } else {
      petsOf(mine).forEach((kind) => {
        const pet = addPet(kind, MY_PETS[kind], 0, about(fire, 100));
        comeTo(pet, TRAIL_IN, petWorld);
      });
      after(1.6, () => {
        if (!mine.first) ui.open("choose");
        else for (const pet of pets) pet.joy = 1;
      });
    }
    ui.arrived();
  }

  // ---------- decorating ----------

  let decor = false;
  let sel: Hold | null = null;

  function decorate(on: boolean): void {
    if (decor === on || (on && owner !== null)) return;
    decor = on;
    if (on) {
      closePanel();
      closeCard();
      halt();
      sfx.open();
    } else {
      settle();
      sel = null;
      sfx.close();
    }
    pan.x = 0;
    pan.y = 0;
    ui.decorating(on);
    ui.tray();
  }

  const liveAt = (n: number): Live | null => lives.find((l) => l.placed === placed[n]) ?? null;

  /** Shows the thing in hand where it would go; anything else is where it stands. */
  function showHeld(): void {
    const h = sel;
    const l = h ? liveAt(h.index) : null;
    if (!h || !l) return;
    const at = footOf({ ...l.placed, x: h.x, y: h.y, t: h.t });
    if (!at) return;
    const sprite = pictureOf(art, l.thing.id, h.t, l.placed.s) ?? l.prop.sprite;
    l.prop.x = at.x;
    l.prop.y = at.y - (h.dragging ? 3 : 0);
    l.prop.sprite = l.thing.id === "cabin" ? l.prop.sprite : sprite;
    l.prop.z = h.dragging ? 1e5 : l.thing.flat ? -1 : at.y;
    const s = l.prop.sprite;
    if (s) l.prop.hit = { x: l.prop.x - s.ax, y: l.prop.y - s.ay, w: s.c.width, h: s.c.height };
    if (l.light) {
      const lit = lightOf(l);
      if (lit) {
        l.light.x = lit.x;
        l.light.y = lit.y;
      }
    }
  }

  function pickUp(n: number, grab: Pt): void {
    const p = placed[n];
    if (!p) return;
    sel = { index: n, x: p.x, y: p.y, t: p.t, ok: "ok", dragging: true, grab, moved: false };
    csfx.lift();
    showHeld();
    ui.tray();
  }

  function dragTo(at: Pt): void {
    const h = sel;
    const p = h ? placed[h.index] : null;
    const thing = p ? thingOf(p.id) : null;
    if (!h || !p || !thing || !h.dragging) return;
    const [w, d] = footprint(thing, h.t);
    const fx = at.x - h.grab.x;
    const fy = at.y - h.grab.y;
    const x = clamp(Math.round((fx - w * (CELL / 2)) / CELL), 0, CGW - w);
    const y = clamp(Math.round((fy + 1 - d * CELL) / CELL), 0, CGH - d);
    if (x === h.x && y === h.y) return;
    h.x = x;
    h.y = y;
    h.moved = true;
    h.ok = canPlace(placed, p.id, x, y, h.t, h.index);
    tone(h.ok === "ok" ? 620 : 300, 0.02, { vol: 0.035, type: "sine" });
    showHeld();
  }

  /** The thing in hand is set down where it is held, or goes back where it came from. */
  function settle(): void {
    const h = sel;
    const p = h ? placed[h.index] : null;
    if (!h || !p) return;
    const was = h.dragging;
    h.dragging = false;
    if (h.moved || h.t !== p.t) {
      const v = move(mine, h.index, h.x, h.y, h.t);
      if (v === "ok") {
        csfx.thud();
        const at = footOf(p);
        if (at) puff(at.x, at.y, 4, "#966c4a");
        changed();
      } else {
        sfx.no();
        const at = footOf({ ...p, x: h.x, y: h.y, t: h.t });
        if (at) float(at.x, at.y - 18, WHY_NOT[v], SKY[5], 1.8);
      }
      h.x = p.x;
      h.y = p.y;
      h.t = p.t;
      h.ok = "ok";
      h.moved = false;
    } else if (was) sfx.tap();
    rebuild();
    ui.tray();
  }

  function turn(): void {
    const h = sel;
    if (!h) return;
    settle();
    const next = turned(mine, h.index);
    const p = placed[h.index];
    if (!next || !p) {
      sfx.no();
      const at = p ? footOf(p) : null;
      const thing = p ? thingOf(p.id) : null;
      if (at)
        float(
          at.x,
          at.y - 18,
          thing && turnsOf(thing) > 1 ? "No room to turn it." : "It only goes one way.",
          SKY[5],
          1.6,
        );
      return;
    }
    p.x = next.x;
    p.y = next.y;
    p.t = next.t;
    h.x = p.x;
    h.y = p.y;
    h.t = p.t;
    sfx.pluck(6);
    changed();
    rebuild();
    const l = liveAt(h.index);
    if (l) l.prop.bumpAt = G.t;
  }

  function stow(): void {
    const h = sel;
    const p = h ? placed[h.index] : null;
    const thing = p ? thingOf(p.id) : null;
    if (!h || !p || !thing) return;
    settle();
    const at = footOf(p);
    if (!mayPutAway(mine, h.index)) {
      sfx.no();
      if (at) float(at.x, at.y - 22, `The ${thing.name.toLowerCase()} stays out.`, SKY[5], 1.8);
      return;
    }
    const sprite = pictureOf(art, p.id, p.t, p.s);
    if (at && sprite) ui.toTray(sprite.c, { x: at.x, y: at.y - sprite.c.height / 2 }, thing.id);
    putAway(mine, h.index);
    sel = null;
    sfx.pop();
    changed();
    rebuild();
    ui.tray();
  }

  function takeOut(id: string): boolean {
    const thing = thingOf(id);
    if (!decor || !thing) return false;
    settle();
    // With as many set out as may be, it stays in the tray.
    if (campFull(mine.placed)) {
      sfx.no();
      hooks.feed(WHY_NOT.full, "coral");
      return false;
    }
    const p = player();
    // In front of the member, in the middle of what is on screen.
    const near = {
      x: clamp(Math.floor((G.cam.x + G.view.w / 2) / CELL), 6, CGW - 6),
      y: clamp(Math.floor(p.y / CELL) + 2, 14, CGH - 6),
    };
    const spot = roomy(id, near) ?? freeSpot(placed, id, near);
    if (!spot || setOut(mine, id, spot.x, spot.y) !== "ok") {
      sfx.no();
      hooks.feed("No room for that. Put something away first.", "coral");
      return false;
    }
    rebuild();
    const n = placed.length - 1;
    const where = placed[n];
    sel = where
      ? { index: n, x: where.x, y: where.y, t: where.t, ok: "ok", dragging: false, grab: { x: 0, y: 0 }, moved: false }
      : null;
    const at = where ? footOf(where) : null;
    if (at) {
      puff(at.x, at.y, 5, "#966c4a");
      sparkle(at.x, at.y - 8, 6, 6);
    }
    csfx.thud();
    changed();
    ui.tray();
    return true;
  }

  // ---------- touches ----------

  function personAt(wx: number, wy: number): Actor | null {
    let best: Actor | null = null;
    for (const a of everybody()) {
      if (a.alpha < 0.5) continue;
      const at = a.seat ?? a;
      if (Math.abs(wx - at.x) > 7 || wy < at.y - headOf(a) - 2 || wy > at.y + 3) continue;
      if (!best || at.y > (best.seat ?? best).y) best = a;
    }
    return best;
  }

  /** The thing of the camp's under a point, as its number in the record; -1 for none. */
  function thingAt(wx: number, wy: number): number {
    const all = lives.map((l) => l.prop);
    // What stands is in front of what lies flat.
    const hit =
      propUnder(
        all.filter((p) => p.z >= 0),
        wx,
        wy,
      ) ?? propUnder(all, wx, wy);
    const l = hit ? lives.find((v) => v.prop === hit) : null;
    return l ? placed.indexOf(l.placed) : -1;
  }

  function tapWorld(wx: number, wy: number): boolean {
    closeCard();
    const p = player();
    if (decor) {
      const n = thingAt(wx, wy);
      if (n >= 0) {
        if (sel && sel.index !== n) settle();
        const l = liveAt(n);
        pickUp(n, l ? { x: wx - l.prop.x, y: wy - l.prop.y } : { x: 0, y: 0 });
        return false;
      }
      if (sel) {
        settle();
        sel = null;
        ui.tray();
      }
    } else {
      const who = personAt(wx, wy);
      if (who) {
        sfx.pop();
        hop(who);
        if (who.you) {
          say(who, pick(["that's me", "hello, me", "o/"], Math.random()), 1.6);
          return false;
        }
        if (!who.seat) face(who, p.x, p.y);
        who.hold = 2.4;
        if (who.folk) greeted(who);
        else if (who.doing === "home" && mate) say(who, pick(mate.hello, Math.random()), 2.6);
        showCard(who);
        return false;
      }
      const pet = petAt(pets, wx, wy);
      if (pet) {
        pleased(pet);
        return false;
      }
      const prop = propUnder([...pic.props, ...flats], wx, wy);
      if (prop?.tap && prop.kind !== "trunk") {
        prop.tap(prop, wx, wy);
        return false;
      }
      if (wy < campHedge(wx, seed)) {
        sfx.star();
        for (let i = 0; i < 14; i++)
          bit({
            x: wx - i * 2.2,
            y: wy - i * 1.1,
            vx: 70,
            vy: 34,
            ttl: 0.5 + i * 0.03,
            life: i * 0.012,
            col: i < 3 ? CREAM : GOLD[2],
            glow: true,
          });
        return false;
      }
      if (prop?.tap) {
        prop.tap(prop, wx, wy);
        return false;
      }
    }
    halt();
    if (G.panel) closePanel();
    const to = ground.nearestFree(clamp(wx, 0, CW - 1), clamp(wy, 0, CH - 1));
    show.dest = to;
    ring(to.x, to.y, GOLD[2], 6);
    sfx.tap();
    walkTo(
      p,
      to,
      () => {
        show.dest = null;
      },
      ground,
    );
    return true;
  }

  function under(wx: number, wy: number): (Hover & { who: Actor | null }) | null {
    if (decor) {
      // The thing in hand has its own corners.
      const n = sel?.dragging ? -1 : thingAt(wx, wy);
      const l = n >= 0 && n !== sel?.index ? liveAt(n) : null;
      return l?.prop.hit
        ? { box: l.prop.hit, tip: [l.thing.name, "Drag it somewhere else."], ref: thingRef(l.thing.id), who: null }
        : null;
    }
    const who = personAt(wx, wy);
    if (who) {
      const at = who.seat ?? who;
      const tall = headOf(who);
      return { box: { x: at.x - 6, y: at.y - tall, w: 12, h: tall + 1 }, tip: null, who };
    }
    const pet = petAt(pets, wx, wy);
    if (pet)
      return { box: { x: pet.x - 6, y: pet.y - 10, w: 12, h: 11 }, tip: [pet.name, PET_ABOUT[pet.kind]], who: null };
    const prop = propUnder([...pic.props, ...flats], wx, wy);
    if (!prop?.hit || prop.kind === "trunk") return null;
    return { box: prop.hit, tip: prop.tip, ref: thingOf(prop.kind) ? thingRef(prop.kind) : null, who: null };
  }

  // ---------- drawing ----------

  const pic: Picture = {
    sprites,
    sky: backdrop.sky,
    skyAt: { x: -210, y: 86 - 252 },
    ground: paintCampGround(0, paths),
    groundAt: { x: CAMP_GROUND.x, y: CAMP_GROUND.y },
    near: backdrop.near,
    nearAt: { x: -72, y: CH - 34 },
    props: [],
    others: () => [...pets, ...flights],
    people: everybody,
    lights: () => [...lights],
    beyond(g, cx, cy) {
      for (const l of lanterns) {
        const lamp = sprites.lanterns[l.col % sprites.lanterns.length];
        if (!lamp || l.over) continue;
        g.globalAlpha = clamp(1 - (l.life - 7) / 3, 0, 1);
        const x = Math.round(l.x) - cx;
        const y = Math.round(l.y) - cy;
        g.drawImage(lamp.c, x - lamp.ax, y - lamp.ay);
        g.globalAlpha *= 0.25;
        R(g, x - 3, y + 2, 8, 6, GOLD[2]);
        R(g, x - 1, y, 4, 10, GOLD[2]);
        g.globalAlpha = 1;
      }
    },
    under(g, cx, cy) {
      // A soft grid round whatever is in hand, and the ground it would take.
      const h = sel;
      const l = h ? liveAt(h.index) : null;
      if (decor && h && l) {
        const [w, d] = footprint(l.thing, h.t);
        if (h.dragging)
          for (let y = h.y - 3; y <= h.y + d + 2; y++)
            for (let x = h.x - 4; x <= h.x + w + 3; x++) {
              if (!walkable(x, y)) continue;
              const far = Math.hypot(x - (h.x + w / 2 - 0.5), y - (h.y + d / 2 - 0.5));
              g.globalAlpha = clamp(0.6 - far * 0.09, 0, 0.6);
              R(g, x * CELL - cx, y * CELL - cy, 1, 1, CREAM);
              R(g, x * CELL + CELL - 1 - cx, y * CELL + CELL - 1 - cy, 1, 1, CREAM);
            }
        g.globalAlpha = 1;
        for (let y = 0; y < d; y++)
          for (let x = 0; x < w; x++)
            tile(
              g,
              (h.x + x) * CELL - cx,
              (h.y + y) * CELL - cy,
              h.ok === "ok" ? "#c9ef9a" : SKY[5],
              h.dragging ? 0.5 : 0.28,
            );
      }
      for (const p of flats) drawProp(g, p, cx, cy);
      // Parcels waiting by the trail.
      if (owner === null)
        mine.parcels.slice(0, PARCEL_AT.length).forEach((_id, i) => {
          const at = PARCEL_AT[i];
          if (at) g.drawImage(art.parcel.c, at.x - art.parcel.ax - cx, at.y - art.parcel.ay - cy);
        });
      // A note on the door of somebody who is out.
      if (mate && !mate.home) {
        const cabin = lives.find((v) => v.thing.id === "cabin");
        if (cabin) noteAt = { x: cabin.prop.x + 16, y: cabin.prop.y - 22 };
      } else noteAt = null;
    },
    over(g, cx, cy) {
      if (!noteAt) return;
      R(g, noteAt.x - 1 - cx, noteAt.y - 1 - cy, 6, 7, "#1a0f1e");
      R(g, noteAt.x - cx, noteAt.y - cy, 4, 5, CREAM);
      R(g, noteAt.x + 1 - cx, noteAt.y + 1 - cy, 2, 1, "#8a4a30");
      R(g, noteAt.x + 1 - cx, noteAt.y + 3 - cy, 2, 1, "#8a4a30");
    },
    glows(g, cx, cy, spark) {
      for (const l of lives) l.glow?.(g, Math.round(l.prop.x) - cx, Math.round(l.prop.y) - cy, spark);
      for (const l of lanterns) {
        const lamp = sprites.lanterns[l.col % sprites.lanterns.length];
        if (!lamp || !l.over) continue;
        const a = clamp(l.life / 0.6, 0, 1) * clamp(1 - (l.life - 7) / 3, 0, 1);
        const x = Math.round(l.x) - cx;
        const y = Math.round(l.y) - cy;
        g.globalAlpha = a * 0.4;
        g.drawImage(spark, x - 12, y - 8, 24, 24);
        g.globalAlpha = a;
        g.drawImage(lamp.c, x - lamp.ax, y - lamp.ay);
        g.globalAlpha = 1;
      }
      // Gold corners round the thing in hand.
      const h = sel;
      const l = h ? liveAt(h.index) : null;
      const box = decor && l ? l.prop.hit : null;
      if (!box) return;
      const x0 = Math.round(box.x) - cx - 2;
      const y0 = Math.round(box.y) - cy - 2;
      const x1 = Math.round(box.x + box.w) - cx + 1;
      const y1 = Math.round(box.y + box.h) - cy + 1;
      const ok = h?.ok === "ok";
      const col = ok ? "#c9ef9a" : SKY[5];
      for (const [x, y, dx, dy] of [
        [x0, y0, 1, 1],
        [x1, y0, -1, 1],
        [x0, y1, 1, -1],
        [x1, y1, -1, -1],
      ] as const) {
        R(g, dx > 0 ? x : x - 3, y, 4, 1, col);
        R(g, x, dy > 0 ? y : y - 3, 1, 4, col);
      }
      if (ok) return;
      // It may not go here: a mark over it says so before it is let go.
      const mx = Math.round((x0 + x1) / 2) - 3;
      const my = y0 - 9 + Math.round(Math.sin(G.t * 8));
      R(g, mx + 1, my, 5, 7, "#1a0f1e");
      R(g, mx, my + 1, 7, 5, "#1a0f1e");
      R(g, mx + 1, my + 1, 5, 5, SKY[5]);
      for (let i = 0; i < 3; i++) {
        R(g, mx + 2 + i, my + 2 + i, 1, 1, CREAM);
        R(g, mx + 4 - i, my + 2 + i, 1, 1, CREAM);
      }
    },
  };
  let noteAt: Pt | null = null;

  // ---------- the scene ----------

  function nearSpot(): Spot | null {
    const p = player();
    for (const s of spots) if (dist(p.x, p.y, s.stand.x, s.stand.y) < (s.id === "trail" ? 26 : 15)) return s;
    return null;
  }
  let prompted: Spot | null = null;
  let lastDrag: Pt | null = null;
  let tick = 0;

  const scene: CampScene = {
    bounds: { w: CW, top: -72, bottom: CH + 24 },

    resize(w, h) {
      sizeBuffers(w, h);
    },

    focus() {
      const p = player();
      const at = p.seat ?? p;
      return { x: clamp(at.x, 0, CW) + pan.x, y: at.y - 12 + pan.y };
    },

    step(dt, steer) {
      G.t += dt;
      const p = player();
      stepActor(p, dt, ground);
      if (awake() && steer) {
        const push = pushOf(p, steer);
        if (push && !sel?.dragging) {
          if (p.seat || p.path.length > 0 || pending) halt();
          shove(p, dt, push.dx, push.dy, ground);
          // Walking on out past the posts is leaving.
          if (p.x > CW - 12 && push.dx > 0) leave(owner === null ? "town" : "home");
        }
      }
      for (const a of guests) stepActor(a, dt, ground);
      // Whoever is out past the posts is behind the great tree, and then gone.
      for (const a of everybody()) a.alpha = clamp((CW + 12 - a.x) / 6, 0, 1);
      petWorld.member = G.dark < 0.5 ? { x: p.x, y: p.y } : null;
      for (const pet of pets) {
        stepPet(pet, dt, petWorld);
        pet.alpha = clamp((CW + 12 - pet.x) / 6, 0, 1);
      }
      for (const l of lives) stepLive(l, world, dt);
      for (const l of gateLights) l.boost = Math.max(0, l.boost - dt * 1.4);
      stepFlights(dt);
      stepLater();
      if (G.home) guild.step(dt);
      updateFx(dt);

      for (let i = lanterns.length - 1; i >= 0; i--) {
        const l = lanterns[i];
        if (!l) continue;
        l.life += dt;
        l.y -= dt * (l.over ? 15 : 11);
        l.x += Math.sin(l.life * 1.3) * dt * 5;
        if (l.life > 10) lanterns.splice(i, 1);
      }

      // The evening itself: a leaf coming down, a firefly, a cricket.
      tick -= dt;
      if (tick <= 0) {
        tick = 0.9 + Math.random() * 1.6;
        if (Math.random() < 0.5) flutter(G.cam.x + Math.random() * G.view.w, G.cam.y - 4, 1, [GOLD[0], GREEN[3]], 2, 0);
        else
          bit({
            x: 40 + Math.random() * (CW - 80),
            y: 130 + Math.random() * (CH - 160),
            vx: (Math.random() - 0.5) * 8,
            vy: -3 - Math.random() * 4,
            ttl: 3 + Math.random() * 3,
            col: GOLD[2],
            glow: true,
            flutter: 1.6,
          });
        if (G.home && Math.random() < 0.3) sfx.cricket();
        movingIn();
        if (!unpacking) unpack();
      }

      // Something dragged near an edge of the view pushes the view along.
      if (sel?.dragging && lastDrag) {
        const fx = (lastDrag.x - G.cam.x) / G.view.w;
        const fy = (lastDrag.y - G.cam.y) / G.view.h;
        pan.x = clamp(pan.x + edgePush(fx) * 90 * dt, -CW, CW);
        pan.y = clamp(pan.y + edgePush(fy) * 90 * dt, -CH, CH);
        if (edgePush(fx) !== 0 || edgePush(fy) !== 0) dragTo(lastDrag);
      } else if (p.moving) {
        pan.x *= Math.max(0, 1 - dt * 4);
        pan.y *= Math.max(0, 1 - dt * 4);
      }
      showHeld();

      const near = G.home && !decor ? nearSpot() : null;
      G.near = near ? (near.id === "trail" ? (owner === null ? "town" : "home") : near.id) : null;
      const on = near !== null && awake() && G.panel === null && !(near.id === "trail" && p.path.length > 0);
      if (near && on) {
        prompted = near;
        show.prompt = near;
      }
      show.promptT = clamp(show.promptT + (on ? dt : -dt) * 5, 0, 1);
    },

    draw: () => drawPicture(pic),
    words(ctx: Ctx, px: number) {
      drawWords(ctx, px, everybody());
    },

    tap(x, y, finger) {
      show.touch = finger;
      lastDrag = { x, y };
      return awake() ? tapWorld(x, y) : false;
    },

    drag(at) {
      lastDrag = at;
      dragTo(at);
    },

    release(_at, over) {
      lastDrag = null;
      if (!sel?.dragging) return;
      if (over?.closest("#tray")) stow();
      else settle();
    },

    point(at) {
      const h = at && awake() ? under(at.x, at.y) : null;
      show.hover = h ? h.box : null;
      show.pointed = h ? h.who : null;
      return h;
    },

    act() {
      if (!awake()) return;
      const p = player();
      if (decor) {
        turn();
        return;
      }
      if (prompted && show.promptT > 0.4) {
        use(prompted.id);
        return;
      }
      if (p.seat) {
        release(p);
        return;
      }
      hop(p);
      sfx.tap();
    },

    back() {
      if (G.panel) closePanel();
      else if (decor) decorate(false);
      else closeCard();
    },

    key(k) {
      if (!decor) return false;
      if (k === "r") turn();
      else if (k === "delete" || k === "backspace") stow();
      else return false;
      return true;
    },

    awake,
    cameBack: () => undefined,

    enter,
    owner: () => owner,
    host: () => mate,
    go,
    leave,
    decorating: () => decor,
    decorate,
    held() {
      const p = sel ? placed[sel.index] : null;
      const thing = p ? thingOf(p.id) : null;
      return thing ? { name: thing.name, turns: turnsOf(thing) > 1, stays: thing.rooted } : null;
    },
    takeOut,
    turn,
    stow,

    choose(kind) {
      if (mine.first || owner !== null) return;
      mine.first = kind;
      changed();
      const cabin = lives.find((l) => l.thing.id === "cabin");
      const from = cabin ? { x: cabin.prop.x + 16, y: cabin.prop.y + 8 } : TRAIL_IN;
      const pet = addPet(kind, MY_PETS[kind], 0, from);
      comeTo(pet, player(), petWorld);
      pet.joy = 1.2;
      sfx.twinkle();
      sparkle(pet.x, pet.y - 8, 12, 8);
      hooks.feed(`${pet.name} lives here now. ${PET_ABOUT[kind]}`, "leaf");
    },

    unwrap(thing) {
      const box = lives.find((l) => l.thing.id === "mailbox");
      const from = box ? { x: box.prop.x, y: box.prop.y - 8 } : player();
      if (box) box.prop.bumpAt = G.t;
      arrive(thing, { x: from.x, y: from.y }, box ? { x: box.placed.x - 2, y: box.placed.y + 2 } : { x: 37, y: 31 });
    },

    give(thing) {
      const what = thingOf(thing);
      if (!mate || !what || mine.gave.some((g) => g.to === mate?.owner)) return;
      const to = mate.owner;
      mine.gave.push({ to, what: thing });
      changed();
      const p = player();
      hop(p, 2);
      const box = placed.find((q) => q.id === "mailbox");
      arrive(thing, { x: p.x, y: p.y - 10 }, box ? { x: box.x - 1, y: box.y + 1 } : { x: 37, y: 31 }, () => {
        const host = guests.find((g) => g.doing === "home");
        if (host) {
          hop(host, 2);
          say(host, pick(THANKS, Math.random()), 3);
        } else float(p.x, p.y - 30, "They will find it when they are back.", CREAM, 2.6);
        for (const pet of pets) pet.joy = 1;
      });
      hooks.feed(`You left ${what.name.toLowerCase()} at ${to}'s camp.`, "leaf");
    },

    handles: {
      visit(name) {
        leave({ visit: name });
      },
      home() {
        leave("home");
      },
      town() {
        leave("town");
      },
      walk: go,
      decorate,
      take: takeOut,
      grab(n) {
        const l = liveAt(n);
        if (!decor || !l) return;
        if (sel && sel.index !== n) settle();
        pickUp(n, { x: 0, y: -4 });
      },
      dragTo(cx, cy) {
        const h = sel;
        const p = h ? placed[h.index] : null;
        const thing = p ? thingOf(p.id) : null;
        if (!h || !thing) return;
        const [w, d] = footprint(thing, h.t);
        dragTo({ x: cx * CELL + w * (CELL / 2), y: (cy + d) * CELL - 1 - 4 });
      },
      drop() {
        settle();
      },
      things() {
        return placed.flatMap((p) => {
          const at = footOf(p);
          return at ? [{ id: p.id, x: at.x, y: at.y, cx: p.x, cy: p.y }] : [];
        });
      },
      hand() {
        const p = sel ? placed[sel.index] : null;
        return sel && p ? { id: p.id, cx: sel.x, cy: sel.y, ok: sel.ok } : null;
      },
      pets() {
        return pets.map((p) => ({ name: p.name, x: Math.round(p.x), y: Math.round(p.y) }));
      },
      pet(n) {
        const p = pets[n];
        if (p) pleased(p);
      },
      choose(kind) {
        scene.choose(kind);
      },
      owner: () => owner,
      guests: () => guests.map((g) => g.who.name),
      greet(n) {
        const a = guests[n];
        if (a) tapWorld(a.x, a.y - 4);
      },
    },
  };

  return scene;
}
