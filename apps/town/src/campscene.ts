/**
 * A camp as a scene: the member's own place behind the town's gate. It lays the clearing out from
 * Leaf's copy of the camp (`leaf.ts`), moves whoever is in it (the member, their pets, the caller
 * Leaf says is waiting), answers touches, and lets everything be picked up and set down somewhere
 * else, each by its id. Everything that changes the camp is a command: the page works out where a
 * thing goes, and the rules (`@sequoia-leaf/town`) check it. `main.ts` drives it through `Scene`.
 *
 * It shows somebody else's camp the same way, in a visit (`leaf.ts`'s `visiting()`, which every
 * part that differs asks): laid out from Leaf's copy of theirs, their pet about, and nothing there
 * to act with (no cabin, mailbox, tray or decorating; only the signpost, home or to town).
 *
 * Whoever else is in the camp, its owner at home or anybody visiting, is there live, as in town
 * (`players.ts`): drawn with the camp's things, walking its ground, hidden behind the great tree out
 * past the trail's posts as the member is.
 */

import { CREAM, GOLD, GREEN, SKY, STONE } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import type { Dir } from "@sequoia-leaf/kit/skin.ts";
import { sfx, tone } from "@sequoia-leaf/kit/sound.ts";
import { clamp, type Ctx, dist, pick, type Pt, rng } from "@sequoia-leaf/kit/util.ts";
import type { Visit } from "@sequoia-leaf/town";
import {
  boxOf,
  campFull,
  canPlace,
  CGH,
  CGW,
  freeSpot,
  type PetId,
  petsOf,
  type Placed,
  standsBy,
  taken,
  TRAIL,
  turned,
  type Verdict,
  walkable,
  WHY_NOT,
} from "@sequoia-leaf/town/camp.ts";
import { AT_CAMP, folk } from "@sequoia-leaf/town/folk.ts";
import { BOX_FULL, waiting } from "@sequoia-leaf/town/mail.ts";
import { footprint, thingOf, turnsOf } from "@sequoia-leaf/town/things.ts";

import { face, hop, hopTo, makeFolk, say, stepActor, stop, walkAlong, walkTo, walkToSeat, wayTo } from "./actors.ts";
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
import { extraOf, lightOf, type Live, stateOf, stepLive, touch as touchThing, type TouchWorld } from "./camptouch.ts";
import { type CampUi } from "./campui.ts";
import { thingRef } from "./cards.ts";
import { makeApart } from "./crowd.ts";
import { drawPicture, drawProp, drawWords, type Picture, sizeBuffers } from "./draw.ts";
import { bit, burst, float, flutter, puff, sparkle, updateFx } from "./fx.ts";
import { type Actor, after, changed, cue, forgetLater, G, hooks, show, stepCues, stepLater, today } from "./game.ts";
import { CELL, makeGround } from "./grid.ts";
import { paintTrunk } from "./ground.ts";
import { guild, type Happening } from "./guild.ts";
import { closeCard, closePanel, covered, setStrip, showCard } from "./hud.ts";
import {
  ask,
  doNow,
  lookAt,
  type Looked,
  mine,
  numbered,
  ok,
  onTown,
  refusal,
  setOutAs,
  shown,
  visiting,
} from "./leaf.ts";
import { comeTo, makePet, MY_PETS, PET_ABOUT, petAt, type PetLive, type PetWorld, pleased, stepPet } from "./pets.ts";
import { livePlayers, meetLive, putAway, stepPlayers, touched } from "./players.ts";
import { type Light, makeProp, type Prop, propUnder } from "./props.ts";
import type { Sprites } from "./sprites.ts";
import type { Hover, Scene, Stage } from "./stage.ts";
import { type Door, makeTouch } from "./touch.ts";
import type { Seat } from "./world.ts";

/** The camp's own places: things that open something when the member walks up to them. */
export type CampPlace = "cabin" | "mailbox" | "signpost" | "trail";

/** A thing in the member's hand while decorating: which (by its id), where it would go, and whether it may. */
interface Hold {
  n: number;
  x: number;
  y: number;
  t: number;
  ok: Verdict;
  /** While it is dragged, where it stood when taken hold of: it goes back there if the drag is cut short. */
  drag: { readonly x: number; readonly y: number; readonly t: number } | null;
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
  /** Walk up to one of the camp's places and use it. */
  go(what: CampPlace): void;
  decorating(): boolean;
  decorate(on: boolean): void;
  held(): Held | null;
  /** Takes a thing out of the tray and sets it down near the member, in hand. */
  takeOut(id: string): boolean;
  turn(): void;
  stow(): void;
  /** The member chooses who lives with them first. */
  choose(kind: PetId): void;
  /** For looking at the camp from outside. */
  readonly handles: {
    home(): void;
    town(): void;
    /** Walks the member up to one of the camp's places and uses it. */
    walk(what: CampPlace): void;
    decorate(on: boolean): void;
    take(id: string): boolean;
    /** Takes hold of a thing by its id. */
    grab(n: number): void;
    dragTo(cx: number, cy: number): void;
    drop(): void;
    things(): { n: number; id: string; x: number; y: number; cx: number; cy: number }[];
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

const nameSeed = (name: string): number => {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** The layout on show: Leaf's copy of the camp, the member's own or the one visited. */
const layout = (): readonly Placed[] => shown().camp.placed;
const placedAt = (n: number): Placed | null => layout().find((p) => p.n === n) ?? null;

function player(): Actor {
  if (!G.player) throw new Error("nobody to walk about");
  return G.player;
}

/** The member stops whatever they are doing: walking somewhere, sitting. */
function halt(): void {
  stop(player());
  show.dest = null;
}

/** Where a thing's picture stands: the middle of the near edge of the ground it takes. */
function footOf(p: Placed): Pt | null {
  const t = thingOf(p.id);
  if (!t) return null;
  const b = boxOf(p, t);
  return { x: (b.x0 + b.x1 + 1) * (CELL / 2), y: (b.y1 + 1) * CELL - 1 };
}

/** Something green at the clearing's edge is touched. */
function leafy(p: Prop): void {
  p.bumpAt = G.t;
  flutter(p.x, p.y - 6, 5, [GREEN[3], GREEN[4], GREEN[2]], 6, 24);
  sfx.rustle();
}

/** One square of ground, tinted. */
function tile(g: Ctx, x: number, y: number, col: string, a: number): void {
  g.globalAlpha = a;
  R(g, x + 1, y + 1, CELL - 2, CELL - 2, col);
  g.globalAlpha = 1;
}

/** How much of somebody can be seen: out past the posts, they are behind the great tree, and then gone. */
const seen = (a: Pt): number => clamp((CW + 12 - a.x) / 6, 0, 1);

/** Which way something held near an edge of the view pushes it: -1, 0 or 1. */
const edgePush = (f: number): number => (f < 0.14 ? -1 : f > 0.86 ? 1 : 0);

export function makeCamp(
  sprites: Sprites,
  art: CampArt,
  stage: Stage,
  backdrop: { sky: HTMLCanvasElement; near: HTMLCanvasElement },
  ui: CampUi,
): CampScene {
  // ---------- what is here ----------

  let lives: Live[] = [];
  /** Each thing's life in the camp, by its id, so that it is the same thing whatever Leaf's copy is. */
  const byId = new Map<number, Live>();
  let scenery: Prop[] = [];
  let flats: Prop[] = [];
  let lights: Light[] = [];
  let gateLights: Light[] = [];
  let seats: Seat[] = [];
  /** Each seat thing's seats by its id, kept while it stands where it stood, so that nobody is tipped off one. */
  const seatsOf = new Map<number, { key: string; seats: Seat[] }>();
  let spots: Door[] = [];
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
    toggle: (l) => !visiting() && ok(doNow({ do: "toggle", n: l.placed.n })),
    spot() {
      const did = visiting() ? null : doNow({ do: "spotCrab" });
      return ok(did) ? shown().sightings : null;
    },
    sit(l, wx, wy) {
      sitOn(l, wx, wy);
    },
    mail: () => waiting(shown().camp.letters) > 0,
    // Of what the camp has been sent, the trophies alone: a pull's prize is noted there too.
    trophies: () => shown().camp.earned.filter((id) => thingOf(id)?.kind === "trophies"),
    hedge: (x) => campHedge(x, seed),
  };
  const petWorld: PetWorld = { ground, member: null, fire: null };

  // ---------- laying it out ----------

  function liveOf(p: Placed): Live | null {
    const thing = thingOf(p.id);
    const at = footOf(p);
    if (!thing || !at) return null;
    let l = byId.get(p.n);
    if (!l || l.thing.id !== p.id) {
      l = {
        placed: p,
        thing,
        prop: makeProp(p.id, null, at.x, at.y),
        light: null,
        at: -9,
        taps: 0,
        moment: null,
        backAt: 0,
        glow: null,
      };
      byId.set(p.n, l);
    }
    const me = l;
    me.placed = p;
    const host = visiting();
    const sprite =
      p.id === "cabin"
        ? (art.cabins[host ? nameSeed(host.id) % art.cabins.length : 0] ?? null)
        : pictureOf(art, p.id, p.t, stateOf(me));
    const boost = me.light?.boost ?? 0;
    me.prop = makeProp(p.id, sprite, at.x, at.y, {
      z: thing.flat ? -1 : at.y,
      bumpAt: me.prop.bumpAt,
      hops: me.prop.hops,
      tip: [thing.name, thing.about],
      ref: thingRef(thing.id),
      place: p.id,
      tap: (_p, wx, wy) => {
        touchThing(me, world, wx, wy);
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
    const on = taken(layout());
    for (let y = 0; y < CGH; y++)
      for (let x = 0; x < CGW; x++) {
        const n = y * CGW + x;
        ground.blocked[n] = !walkable(x, y) || on.solid[n] === 1 ? 1 : 0;
        ground.cost[n] = troddenD(paths, x * CELL + 4, y * CELL + 4) < 1 ? 1 : 1.7;
      }
  }

  const everybody = (): Actor[] => (G.player ? [G.player, ...guests] : guests);
  /** Everybody drawn in the camp: those who are here, and the other players live in it. */
  const drawn = (): Actor[] => [...everybody(), ...livePlayers()];
  const standApart = makeApart(ground, drawn);

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

  /** Everything is made again from the layout: after a thing is moved, turned, put away or set out, or Leaf's copy came. */
  function rebuild(): void {
    lives = layout().flatMap((p) => {
      const l = liveOf(p);
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
      const had = seatsOf.get(l.placed.n);
      const list = had?.key === k ? had.seats : seatsFor(l);
      seatsOf.set(l.placed.n, { key: k, seats: list });
      for (const s of list) stepUp(s);
      return list;
    });
    for (const a of everybody()) {
      if (a.seat && old.includes(a.seat) && !seats.includes(a.seat)) stop(a);
      // Nobody is left fenced in: whoever can no longer get to the trail hops over to where they can,
      // and goes on with whatever walk they were on.
      if (!a.seat && a.x < CW - CELL && !ground.footBlocked(a.x, a.y) && cutOff(a)) {
        const to = wayOut(a);
        if (to) hopTo(a, to, ground);
      }
      if (!a.seat && a.x < CW - CELL && ground.footBlocked(a.x, a.y)) hopTo(a, ground.nearestFree(a.x, a.y), ground);
    }
    for (const p of pets) {
      if (p.x >= CW - CELL || !ground.footBlocked(p.x, p.y)) continue;
      const to = ground.nearestFree(p.x, p.y);
      p.x = to.x;
      p.y = to.y;
      p.path = [];
    }

    // The places somebody can walk up to: at somebody else's camp, only the signpost.
    spots = [];
    const home = !visiting();
    for (const l of lives) {
      const id = l.thing.id;
      if (id !== "signpost" && (!home || (id !== "cabin" && id !== "mailbox"))) continue;
      const stands = standsBy(l.placed, l.thing)
        .map((c) => ({ x: c.x * CELL + 4, y: c.y * CELL + 5 }))
        .filter((c) => !ground.footBlocked(c.x, c.y));
      const stand = stands.find((c) => c.y > l.prop.y) ?? stands[0];
      if (!stand) continue;
      const tall = l.prop.sprite?.c.height ?? 16;
      spots.push({
        id,
        name: id === "cabin" ? "Cabin" : id === "mailbox" ? "Mailbox" : "Signpost",
        stand,
        face: stand.y > l.prop.y ? 3 : stand.x < l.prop.x ? 2 : stand.x > l.prop.x ? 1 : 0,
        prompt: { x: l.prop.x, y: l.prop.y - tall - 22 },
        reach: 15,
        use: () => ui.open(id),
      });
    }
    // The way out: the trail between the two posts and on past them.
    spots.push({
      id: "trail",
      name: home ? "Town" : "Home",
      stand: { x: CW - 22, y: TRAIL_Y + 2 },
      face: 2,
      prompt: { x: CW - 30, y: TRAIL_Y - 44 },
      reach: 26,
      box: { x: CW - 34, y: TRAIL.y0 * CELL - 4, w: 48, h: (TRAIL.y1 - TRAIL.y0 + 1) * CELL + 12 },
      use: () => hooks.go(home ? { to: "town" } : { to: "camp" }),
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
          tip: ["The trail", visiting() ? "The way home." : "To town, and to everybody else's camp."],
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

  /** How far the view has been pushed off the member while something is dragged near an edge. */
  const pan = { x: 0, y: 0 };

  const awake = (): boolean => stage.mayAct();

  function go(what: CampPlace): void {
    const spot = spots.find((s) => s.id === what);
    if (spot && awake()) touch.go(spot);
  }

  function sitOn(l: Live, wx: number, wy: number): void {
    if (decor()) return;
    const p = player();
    const own = (seatsOf.get(l.placed.n)?.seats ?? []).filter((s) => !s.taken || s === p.seat);
    const best = own.toSorted((a, b) => dist(wx, wy, a.x, a.y - 6) - dist(wx, wy, b.x, b.y - 6))[0];
    if (!best || best === p.seat) {
      if (!best) sfx.knock();
      return;
    }
    halt();
    sfx.tap();
    walkToSeat(p, best, null, ground);
  }

  /** Everything about to happen and everything said is forgotten: the camp is being left. */
  function clear(): void {
    forgetLater("camp");
    for (const s of seats) s.taken = false;
    guests = [];
    caller = null;
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

  function gone(a: Actor): void {
    stop(a);
    guests = guests.filter((g) => g !== a);
    if (show.card === a) closeCard();
  }

  function walkOff(a: Actor): void {
    walkAlong(a, [...wayTo(a, { x: CW - 6, y: TRAIL_Y + 2 }, ground), { ...TRAIL_END }], () => {
      gone(a);
    });
  }

  /** The caller Leaf says is waiting at the camp, and their figure here. */
  let caller: { visit: Visit; a: Actor } | null = null;

  /**
   * One of the town's own walks in off the trail, says hello, and settles by the fire, chatting now
   * and then, for as long as Leaf says they are waiting. A touch greets them.
   */
  function callIn(visit: Visit): Actor {
    const t = folk(visit.who);
    const lines = AT_CAMP[visit.who];
    const a = makeFolk(t, TRAIL_END.x, TRAIL_END.y);
    a.doing = "call";
    a.alpha = 0;
    a.side = -1;
    guests.push(a);
    hooks.feed(`${t.name.charAt(0).toUpperCase()}${t.name.slice(1)} has wandered into your camp.`, "leaf");
    const fire = fireAt() ?? { x: CW / 2, y: TRAIL_Y };
    const here = (): boolean => guests.includes(a) && caller?.a === a;
    const chat = (): void => {
      if (!here()) return;
      if (a.doing === "asleep") a.doing = "call";
      say(a, pick(lines.chat, Math.random()), 2.8);
      after(8 + Math.random() * 8, chat);
    };
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
        after(6, chat);
      },
      ground,
    );
    return a;
  }

  /**
   * Somebody Leaf no longer has waiting (greeted, or gone as the next set out) says goodbye and
   * goes: by way of the mailbox if they brought something, where Leaf has put it, or would have
   * but for a box full of presents.
   */
  function sendOff({ visit, a }: { visit: Visit; a: Actor }): void {
    const lines = AT_CAMP[visit.who];
    const who = folk(visit.who).name;
    const bye = (): void => {
      if (a.doing === "asleep") a.doing = "call";
      say(a, pick(lines.bye, Math.random()), 2.2);
      after(1.2, () => {
        if (guests.includes(a)) walkOff(a);
      });
    };
    const box = spots.find((sp) => sp.id === "mailbox");
    if (!box || (visit.note === "" && visit.gift === "")) {
      after(1.4, bye);
      return;
    }
    after(1.4, () => {
      walkTo(
        a,
        box.stand,
        () => {
          a.dir = box.face;
          delivered(
            who,
            mine().letters.some((l) => l.id === `v-${visit.id}`),
          );
          after(1.1, bye);
        },
        ground,
      );
    });
  }

  /** Whoever Leaf says is waiting comes in, and whoever it no longer has goes. */
  function meetCaller(): void {
    if (G.where !== "camp" || !G.home || stage.now().at === "dusk") return;
    const visit = shown().visit;
    if (caller && caller.visit.id !== visit?.id) {
      sendOff(caller);
      caller = null;
    }
    if (visit && !caller) caller = { visit, a: callIn(visit) };
  }

  /** The member touches the caller: they are pleased, Leaf counts the greeting, and they go. */
  function greeted(a: Actor): void {
    const c = caller;
    if (!c || c.a !== a) return;
    if (a.doing === "asleep") a.doing = "call";
    say(a, pick(AT_CAMP[c.visit.who].thanks, Math.random()), 2.4);
    float(a.x, a.y - 22, "\u2665", SKY[5], 1.2);
    // A pet who has been waiting for a welcoming camp may move in.
    void ask({ do: "greet", visit: c.visit.id });
  }

  /** A letter has gone into the member's mailbox (`posted`), or would have but for the presents in it: said in the feed, and seen at the box. */
  function delivered(who: string, posted: boolean): void {
    if (!posted) {
      hooks.feed(`${who} came by. ${BOX_FULL}`, "coral");
      return;
    }
    hooks.feed(`${who} left something in your mailbox.`, "leaf");
    if (G.where !== "camp" || visiting()) return;
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

  /**
   * The guild's moments, as they reach a camp: a line in the feed, something beyond the trees, and
   * whoever is here answering, as each begins by Leaf's clock (`cue`, as in town).
   */
  function hear(h: Happening): void {
    if (G.where !== "camp") return;
    switch (h.kind) {
      case "party":
        cue(h.at, () => {
          guild.say(h, hooks.feed);
          sfx.fanfare();
          const x = clamp(G.cam.x + G.view.w * (0.25 + Math.random() * 0.5), 30, CW - 30);
          const col = today("party").n % sprites.lanterns.length;
          lanterns.push({ x, y: campHedge(x, seed) + 8, life: 0, col, over: false });
          // Where the far trees are out of sight, one that has drifted this way goes up over the camp.
          if (G.cam.y > campHedge(x, seed) - 20)
            lanterns.push({ x, y: G.cam.y + G.view.h * 0.62, life: 0, col, over: true });
          cheer();
        });
        return;
      case "war":
        cue(h.at, () => {
          guild.say(h, hooks.feed);
          sfx.fanfare();
          const cabin = lives.find((l) => l.thing.id === "cabin");
          if (cabin) burst(cabin.prop.x + 32, cabin.prop.y - 74, 18, [GOLD[1], SKY[4], CREAM, SKY[5]], 52);
          cheer();
        });
        return;
      case "reached":
      case "milestone": {
        guild.say(h, hooks.feed);
      }
    }
  }
  guild.hear(hear);

  /** Somebody new moves in when the camp has earned it; they come in off the trail. */
  function movingIn(): void {
    if (visiting()) return;
    for (const kind of petsOf(mine())) {
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

  /** Lays out the camp walked to (`of`, somebody's opened), or else the member's own, and brings the member in off the trail. */
  function enter(of: Looked | null): void {
    clear();
    lookAt(of);
    const host = visiting();
    seed = host ? nameSeed(host.id) % 5000 : 0;
    pets = [];
    lanterns.length = 0;
    decorating = null;
    pan.x = 0;
    pan.y = 0;

    const p = player();
    stop(p);
    p.x = TRAIL_END.x;
    p.y = TRAIL_END.y;
    p.dir = 1;
    p.alpha = 0;
    p.speed = 64;
    p.say = "";
    walkAlong(p, [{ ...TRAIL_IN }], () => {
      p.dir = 1;
    });

    byId.clear();
    seatsOf.clear();
    layScenery();
    pathsKey = "";
    rebuild();
    stage.snap();

    const fire = fireAt() ?? { x: CW / 2, y: TRAIL_Y };
    // The member's own come to meet them; somebody else's pets are about their camp, in a colour of their own.
    petsOf(shown().camp).forEach((kind, i) => {
      const pet = addPet(kind, MY_PETS[kind], host ? 1 + ((seed + i) % 3) : 0, about(fire, host ? 120 : 100));
      if (!host) comeTo(pet, TRAIL_IN, petWorld);
    });
    if (!host) {
      after(1.6, () => {
        if (!shown().camp.first) ui.open("choose");
        else for (const pet of pets) pet.joy = 1;
      });
      meetCaller();
    }
    ui.arrived();
  }

  /** Leaf's copy has changed: the camp is laid out from it again, and its caller comes or goes. */
  onTown(() => {
    if (G.where !== "camp") return;
    rebuild();
    meetCaller();
    ui.tray();
    changed();
  });

  // ---------- decorating ----------

  /** Decorating, and whatever is in hand meanwhile; null while not decorating, when nothing can be in hand. */
  let decorating: { hand: Hold | null } | null = null;
  const decor = (): boolean => decorating !== null;
  /** What is in hand, while decorating. */
  const hand = (): Hold | null => decorating?.hand ?? null;
  /** Takes something in hand, or puts it down (null): only while decorating. */
  function grip(h: Hold | null): void {
    if (decorating) decorating.hand = h;
  }

  /** Escape while decorating: decorating stops. Says whether it was decorating. */
  function stopDecorating(): boolean {
    if (!decor()) return false;
    decorate(false);
    return true;
  }

  function decorate(on: boolean): void {
    if (decor() === on || (on && visiting())) return;
    if (on) {
      decorating = { hand: null };
      closePanel();
      closeCard();
      halt();
      sfx.open();
    } else {
      settle();
      decorating = null;
      sfx.close();
    }
    pan.x = 0;
    pan.y = 0;
    ui.decorating(on);
    ui.tray();
  }

  const liveAt = (n: number): Live | null => lives.find((l) => l.placed.n === n) ?? null;

  /** Shows the thing in hand where it would go; anything else is where it stands. */
  function showHeld(): void {
    const h = hand();
    const l = h ? liveAt(h.n) : null;
    if (!h || !l) return;
    const at = footOf({ ...l.placed, x: h.x, y: h.y, t: h.t });
    if (!at) return;
    const sprite = pictureOf(art, l.thing.id, h.t, stateOf(l)) ?? l.prop.sprite;
    l.prop.x = at.x;
    l.prop.y = at.y - (h.drag ? 3 : 0);
    l.prop.sprite = l.thing.id === "cabin" ? l.prop.sprite : sprite;
    l.prop.z = h.drag ? 1e5 : l.thing.flat ? -1 : at.y;
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
    const p = placedAt(n);
    if (!p) return;
    grip({ n, x: p.x, y: p.y, t: p.t, ok: "ok", drag: { x: p.x, y: p.y, t: p.t }, grab, moved: false });
    csfx.lift();
    showHeld();
    ui.tray();
  }

  function dragTo(at: Pt): void {
    const h = hand();
    const p = h ? placedAt(h.n) : null;
    const thing = p ? thingOf(p.id) : null;
    if (!h || !p || !thing || !h.drag) return;
    const [w, d] = footprint(thing, h.t);
    const fx = at.x - h.grab.x;
    const fy = at.y - h.grab.y;
    const x = clamp(Math.round((fx - w * (CELL / 2)) / CELL), 0, CGW - w);
    const y = clamp(Math.round((fy + 1 - d * CELL) / CELL), 0, CGH - d);
    if (x === h.x && y === h.y) return;
    h.x = x;
    h.y = y;
    h.moved = true;
    const placed = layout();
    h.ok = canPlace(placed, p.id, x, y, h.t, placed.indexOf(p));
    tone(h.ok === "ok" ? 620 : 300, 0.02, { vol: 0.035, type: "sine" });
    showHeld();
  }

  /** The thing in hand is set down where it is held, or goes back where it came from. */
  function settle(): void {
    const h = hand();
    const p = h ? placedAt(h.n) : null;
    if (!h || !p) return;
    const was = h.drag !== null;
    h.drag = null;
    // Just set out, and not numbered by Leaf yet: it is held where it was let go, and moved there
    // once it is (`numberedAs`).
    if (h.n < 0) {
      if (was) sfx.tap();
      return;
    }
    if (h.moved || h.t !== p.t) {
      const did = doNow({ do: "move", n: h.n, x: h.x, y: h.y, t: h.t });
      const now = placedAt(h.n) ?? p;
      if (did && "notes" in did) {
        csfx.thud();
        const at = footOf(now);
        if (at) puff(at.x, at.y, 4, "#966c4a");
      } else {
        sfx.no();
        const at = footOf({ ...p, x: h.x, y: h.y, t: h.t });
        if (at && did) float(at.x, at.y - 18, refusal(did.refused), SKY[5], 1.8);
      }
      h.x = now.x;
      h.y = now.y;
      h.t = now.t;
      h.ok = "ok";
      h.moved = false;
    } else if (was) sfx.tap();
    rebuild();
    ui.tray();
  }

  function turn(): void {
    const h = hand();
    if (!h) return;
    // Nothing is done to a thing Leaf has not numbered yet: it is a moment.
    if (h.n < 0) {
      sfx.no();
      return;
    }
    settle();
    const next = turned(layout(), h.n);
    const p = placedAt(h.n);
    if (!next || !p) {
      sfx.no();
      const at = p ? footOf(p) : null;
      const thing = p ? thingOf(p.id) : null;
      if (at)
        float(
          at.x,
          at.y - 18,
          thing && turnsOf(thing) > 1 ? "No room to rotate it." : "It cannot be rotated.",
          SKY[5],
          1.6,
        );
      return;
    }
    if (!ok(doNow({ do: "move", n: h.n, ...next }))) {
      sfx.no();
      return;
    }
    h.x = next.x;
    h.y = next.y;
    h.t = next.t;
    sfx.pluck(6);
    rebuild();
    const l = liveAt(h.n);
    if (l) l.prop.bumpAt = G.t;
  }

  function stow(): void {
    const h = hand();
    const p = h ? placedAt(h.n) : null;
    const thing = p ? thingOf(p.id) : null;
    if (!h || !p || !thing) return;
    if (h.n < 0) {
      sfx.no();
      return;
    }
    settle();
    const at = footOf(p);
    const sprite = pictureOf(art, p.id, p.t, p.s);
    const did = doNow({ do: "putAway", n: h.n });
    if (!did || "refused" in did) {
      sfx.no();
      if (at && did?.refused === "rooted")
        float(at.x, at.y - 22, `The ${thing.name.toLowerCase()} cannot be put away.`, SKY[5], 1.8);
      return;
    }
    if (at && sprite) ui.toTray(sprite.c, { x: at.x, y: at.y - sprite.c.height / 2 }, thing.id);
    grip(null);
    sfx.pop();
    rebuild();
    ui.tray();
  }

  /**
   * A free spot near a square with air round it (two squares to either side, three behind and one
   * before, since things stand taller than the ground they take), so that what is taken out of the
   * tray is not set down in a heap.
   */
  function roomy(id: string, near: { x: number; y: number }): { x: number; y: number } | null {
    const thing = thingOf(id);
    if (!thing) return null;
    const [w, d] = footprint(thing, 0);
    const placed = layout();
    const on = taken(layout());
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

  /**
   * Leaf has answered for a thing just set out (`mark`, the page's own number for it): whatever has
   * it in hand from now names Leaf's number, and is moved to where it was let go meanwhile; if Leaf
   * did not set it out, nothing is in hand.
   */
  async function numberedAs(mark: number): Promise<void> {
    const n = await numbered(mark);
    const h = hand();
    if (!h || h.n !== mark) return;
    if (n === null) {
      grip(null);
      ui.tray();
      return;
    }
    h.n = n;
    if (!h.drag && h.moved) settle();
    ui.tray();
  }

  function takeOut(id: string): boolean {
    const thing = thingOf(id);
    if (!decor() || !thing) return false;
    settle();
    // With as many set out as may be, it stays in the tray.
    if (campFull(mine().placed)) {
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
    const spot = roomy(id, near) ?? freeSpot(layout(), id, near);
    const did = spot ? doNow({ do: "setOut", thing: id, x: spot.x, y: spot.y, t: 0 }) : null;
    // Held by the page's own number for it until Leaf gives it one (`numberedAs`).
    const n = did ? setOutAs(did) : null;
    if (n === null) {
      sfx.no();
      hooks.feed("No room for that. Put something away first.", "coral");
      return false;
    }
    void numberedAs(n);
    rebuild();
    const where = placedAt(n);
    grip(
      where
        ? { n, x: where.x, y: where.y, t: where.t, ok: "ok", drag: null, grab: { x: 0, y: 0 }, moved: false }
        : null,
    );
    const at = where ? footOf(where) : null;
    if (at) {
      puff(at.x, at.y, 5, "#966c4a");
      sparkle(at.x, at.y - 8, 6, 6);
    }
    csfx.thud();
    ui.tray();
    return true;
  }

  // ---------- touches ----------

  /** The thing of the camp's under a point, by its id; null for none. */
  function thingAt(wx: number, wy: number): number | null {
    const all = lives.map((l) => l.prop);
    // What stands is in front of what lies flat.
    const hit =
      propUnder(
        all.filter((p) => p.z >= 0),
        wx,
        wy,
      ) ?? propUnder(all, wx, wy);
    const l = hit ? lives.find((v) => v.prop === hit) : null;
    return l ? l.placed.n : null;
  }

  /** Somebody in the camp is touched. */
  function meet(who: Actor): void {
    if (meetLive(who)) return;
    hop(who);
    if (!who.seat) face(who, player().x, player().y);
    who.hold = 2.4;
    if (who.folk) greeted(who);
    showCard(who);
  }

  const touch = makeTouch({
    ground,
    // While decorating, nothing is walked up to and used.
    doors: () => (decor() ? [] : spots),
    people: drawn,
    greet: meet,
    own(x, y) {
      const pet = petAt(pets, x, y);
      if (pet) pleased(pet);
      return pet !== null;
    },
    ownAt(x, y) {
      const pet = petAt(pets, x, y);
      return pet ? { box: { x: pet.x - 6, y: pet.y - 10, w: 12, h: 11 }, tip: [pet.name, PET_ABOUT[pet.kind]] } : null;
    },
    props: () => [...pic.props, ...flats],
    sky(x, y) {
      if (y >= campHedge(x, seed)) return false;
      sfx.star();
      for (let i = 0; i < 14; i++)
        bit({
          x: x - i * 2.2,
          y: y - i * 1.1,
          vx: 70,
          vy: 34,
          ttl: 0.5 + i * 0.03,
          life: i * 0.012,
          col: i < 3 ? CREAM : GOLD[2],
          glow: true,
        });
      return true;
    },
    awake,
    halt,
  });

  // ---------- drawing ----------

  const pic: Picture = {
    sky: backdrop.sky,
    skyAt: { x: -210, y: 86 - 252 },
    ground: paintCampGround(0, paths),
    groundAt: { x: CAMP_GROUND.x, y: CAMP_GROUND.y },
    near: backdrop.near,
    nearAt: { x: -72, y: CH - 34 },
    props: [],
    others: () => pets,
    people: drawn,
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
      const h = hand();
      const l = h ? liveAt(h.n) : null;
      if (decor() && h && l) {
        const [w, d] = footprint(l.thing, h.t);
        if (h.drag)
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
              h.drag ? 0.5 : 0.28,
            );
      }
      for (const p of flats) drawProp(g, p, cx, cy);
    },
    over: () => undefined,
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
      const h = hand();
      const l = h ? liveAt(h.n) : null;
      const box = decor() && l ? l.prop.hit : null;
      if (!box) return;
      const x0 = Math.round(box.x) - cx - 2;
      const y0 = Math.round(box.y) - cy - 2;
      const x1 = Math.round(box.x + box.w) - cx + 1;
      const y1 = Math.round(box.y + box.h) - cy + 1;
      const fits = h?.ok === "ok";
      const col = fits ? "#c9ef9a" : SKY[5];
      for (const [x, y, dx, dy] of [
        [x0, y0, 1, 1],
        [x1, y0, -1, 1],
        [x0, y1, 1, -1],
        [x1, y1, -1, -1],
      ] as const) {
        R(g, dx > 0 ? x : x - 3, y, 4, 1, col);
        R(g, x, dy > 0 ? y : y - 3, 1, 4, col);
      }
      if (fits) return;
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

  // ---------- the scene ----------

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
      touch.step(dt, hand()?.drag ? null : steer);
      // The camp's room hears where the member is (a new room each camp: their first move is a jump).
      stepPlayers(p, dt, false, { ground, seen });
      for (const a of guests) stepActor(a, dt, ground);
      for (const a of everybody()) a.alpha = seen(a);
      standApart(dt);
      petWorld.member = G.dark < 0.5 ? { x: p.x, y: p.y } : null;
      for (const pet of pets) {
        stepPet(pet, dt, petWorld);
        pet.alpha = seen(pet);
      }
      for (const l of lives) stepLive(l, world, dt);
      for (const l of gateLights) l.boost = Math.max(0, l.boost - dt * 1.4);
      stepLater();
      stepCues();
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
      }

      // Something dragged near an edge of the view pushes the view along: of as much of it as the tray leaves.
      if (hand()?.drag && lastDrag) {
        const tray = covered();
        const fx = (lastDrag.x - G.cam.x) / G.view.w;
        const fy = (lastDrag.y - G.cam.y) / (tray?.under ? (tray.top * G.view.dpr) / G.view.z : G.view.h);
        pan.x = clamp(pan.x + edgePush(fx) * 90 * dt, -CW, CW);
        pan.y = clamp(pan.y + edgePush(fy) * 90 * dt, -CH, CH);
        if (edgePush(fx) !== 0 || edgePush(fy) !== 0) dragTo(lastDrag);
      } else if (p.moving) {
        pan.x *= Math.max(0, 1 - dt * 4);
        pan.y *= Math.max(0, 1 - dt * 4);
      }
      showHeld();
    },

    draw: () => drawPicture(pic),
    words(ctx: Ctx, px: number) {
      drawWords(ctx, px, drawn());
    },

    tap(x, y, finger) {
      lastDrag = { x, y };
      touched();
      if (!decor() || !awake()) return touch.tap(x, y, finger);
      // Decorating, a touch takes hold of a thing, or puts down what is in hand and walks.
      show.touch = finger;
      closeCard();
      const n = thingAt(x, y);
      if (n !== null) {
        if ((hand()?.n ?? n) !== n) settle();
        const l = liveAt(n);
        pickUp(n, l ? { x: x - l.prop.x, y: y - l.prop.y } : { x: 0, y: 0 });
        return false;
      }
      if (hand()) {
        settle();
        grip(null);
        ui.tray();
      }
      return touch.walk(x, y);
    },

    drag(at) {
      lastDrag = at;
      dragTo(at);
    },

    release(_at, over) {
      lastDrag = null;
      if (!hand()?.drag) return;
      if (over?.closest("#tray")) stow();
      else settle();
    },

    cancel() {
      lastDrag = null;
      const h = hand();
      if (!h?.drag) return;
      // Let go of nowhere: it goes back where it was taken hold of, and nothing is done.
      h.x = h.drag.x;
      h.y = h.drag.y;
      h.t = h.drag.t;
      h.ok = "ok";
      h.moved = false;
      h.drag = null;
      rebuild();
      ui.tray();
    },

    point(at) {
      if (!decor() || !at || !awake()) return touch.point(at);
      // The thing in hand has its own corners.
      const n = hand()?.drag ? null : thingAt(at.x, at.y);
      const l = n !== null && n !== hand()?.n ? liveAt(n) : null;
      const h: Hover | null = l?.prop.hit
        ? { box: l.prop.hit, tip: [l.thing.name, ""], ref: thingRef(l.thing.id) }
        : null;
      show.hover = h?.box ?? null;
      show.pointed = null;
      return h;
    },
    act: () => (decor() ? turn() : touch.act()),

    back: () => putAway(stopDecorating),

    key(k) {
      if (!decor()) return false;
      if (k === "r") turn();
      else if (k === "delete" || k === "backspace") stow();
      else return false;
      return true;
    },

    cameBack: () => undefined,
    wayOut() {
      halt();
      decorate(false);
      closePanel();
      closeCard();
      // Off down the trail, and on past the posts.
      return [...wayTo(player(), { x: CW - 6, y: TRAIL_Y + 2 }, ground), { ...TRAIL_END }];
    },
    // Night falls once they are nearly out of sight behind the great tree.
    nightFrom: 70,
    putAway() {
      clear();
      lookAt(null);
      // The strip that says whose camp it is goes with the camp.
      setStrip(null, () => {});
    },
    putOn(to) {
      enter(to.place === "camp" ? to.of : null);
    },

    go,
    decorating: () => decor(),
    decorate,
    held() {
      const h = hand();
      const p = h ? placedAt(h.n) : null;
      const thing = p ? thingOf(p.id) : null;
      return thing ? { name: thing.name, turns: turnsOf(thing) > 1, stays: thing.rooted } : null;
    },
    takeOut,
    turn,
    stow,

    choose(kind) {
      if (!ok(doNow({ do: "choosePet", pet: kind }))) return;
      const cabin = lives.find((l) => l.thing.id === "cabin");
      const from = cabin ? { x: cabin.prop.x + 16, y: cabin.prop.y + 8 } : TRAIL_IN;
      const pet = addPet(kind, MY_PETS[kind], 0, from);
      comeTo(pet, player(), petWorld);
      pet.joy = 1.2;
      sfx.twinkle();
      sparkle(pet.x, pet.y - 8, 12, 8);
      hooks.feed(`${pet.name} lives here now. ${PET_ABOUT[kind]}`, "leaf");
    },

    handles: {
      home: () => hooks.go({ to: "camp" }),
      town: () => hooks.go({ to: "town" }),
      walk: go,
      decorate,
      take: takeOut,
      grab(n) {
        const l = liveAt(n);
        if (!decor() || !l) return;
        if ((hand()?.n ?? n) !== n) settle();
        pickUp(n, { x: 0, y: -4 });
      },
      dragTo(cx, cy) {
        const h = hand();
        const p = h ? placedAt(h.n) : null;
        const thing = p ? thingOf(p.id) : null;
        if (!h || !thing) return;
        const [w, d] = footprint(thing, h.t);
        dragTo({ x: cx * CELL + w * (CELL / 2), y: (cy + d) * CELL - 1 - 4 });
      },
      drop() {
        settle();
      },
      things() {
        return layout().flatMap((p) => {
          const at = footOf(p);
          return at ? [{ n: p.n, id: p.id, x: at.x, y: at.y, cx: p.x, cy: p.y }] : [];
        });
      },
      hand() {
        const h = hand();
        const p = h ? placedAt(h.n) : null;
        return h && p ? { id: p.id, cx: h.x, cy: h.y, ok: h.ok } : null;
      },
      pets() {
        return pets.map((p) => ({ name: p.name, x: Math.round(p.x), y: Math.round(p.y) }));
      },
      pet(n) {
        const p = pets[n];
        if (p) pleased(p);
      },
      choose: (kind) => scene.choose(kind),
      owner: () => visiting()?.id ?? null,
      guests: () => guests.map((g) => g.who.name),
      greet(n) {
        const a = guests[n];
        if (a) touch.tap(a.x, a.y - 4, false);
      },
    },
  };

  return scene;
}
