/**
 * The Forest: builds the valley's still layers once, then each frame copies the visible slice of
 * each (at its parallax), draws only what moves between them, lights it and lays the HUD over it.
 */

import { Canvas, mix, UI } from "../pixel/hud.ts";
import { layout } from "../pixel/layout.ts";
import {
  drawEmbers,
  drawFestoon,
  drawFireBack,
  drawFireFront,
  drawFlames,
  drawSmoke,
  fireLight,
  squirrelFrame,
} from "../pixel/life.ts";
import { buildLut, ix, type Lut, R, rampOf } from "../pixel/palette.ts";
import { compose, Light, Surface } from "../pixel/raster.ts";
import { hash3 } from "../pixel/rng.ts";
import { CRAB } from "./cast.ts";
import {
  clamp01,
  drawLevelUp,
  drawNewPennant,
  drawRaid,
  drawRave,
  drawWarLeaves,
  LENGTH,
  levelCamera,
  raidCamera,
  raidLantern,
  type RaidSetup,
  raidShimmer,
  type RaveSetup,
  type View,
  warCamera,
} from "./events.ts";
import { DOOR_ID, type Great, GREAT_FOOT, GREAT_ID, type Hook, paintGreat } from "./great.ts";
import { paintTrees, type Planted, plantForest } from "./grove.ts";
import { playerHead } from "./heads.ts";
import { drawHud, type FeedIcon, type HudHits, type HudModel, inside, type Tooltip } from "./hud.ts";
import { ID, paintPlaces, type Places } from "./landmarks.ts";
import {
  type Crab,
  crabPose,
  drawBanners,
  drawBirds,
  drawCinfy,
  drawDucks,
  drawFireflies,
  drawFireside,
  drawHanging,
  drawMist,
  drawNeedles,
  drawOwl,
  drawSnow,
  type Mist,
  type Mote,
  type Needle,
  type Place,
  placeCrabs,
  placeFireflies,
  placeNeedles,
  put,
} from "./life.ts";
import type { EventKind, Params } from "./params.ts";
import { stageLabel } from "./roster.ts";
import { paintForeground, paintGround, paintRidge, paintWildForest } from "./scenery.ts";
import { drawStars, paintSky, type Star } from "./sky.ts";
import { glintMap, reflectionMap, reflectWater } from "./water.ts";
import { clampCam, HEART_X, Layer, PLACES, placeX, ROWS, WORLD_H } from "./world.ts";

type Rgb = readonly [number, number, number];

const MIST_HEX = { dusk: "#52a292", day: "#9aab92", night: "#305f59" } as const;

const JOKES: readonly (readonly string[])[] = [
  ["Why do trees hate tests?", "They get stumped."],
  ["What's a tree's favourite", "drink? Root beer."],
  ["Crabs never share.", "They're shellfish."],
  ["I'm rooting for you."],
  ["What did the tree say", "to autumn? Leaf me be."],
];

interface Moment {
  kind: EventKind;
  t0: number;
  from: number;
}

interface Splash {
  id: number;
  t0: number;
}

export class Forest {
  readonly params: Params;
  private readonly lut: Lut;
  private readonly layers: {
    sky: Layer;
    ridge: Layer;
    haze: Layer;
    far: Layer;
    near: Layer;
    back: Layer;
    mid: Layer;
    front: Layer;
    fore: Layer;
  };
  private readonly rows: Layer[];
  private readonly stars: Star[];
  private readonly great: Great;
  private readonly places: Places;
  private readonly planted: Planted[];
  private readonly byName = new Map<string, Planted>();
  private readonly liveSeedlings: Planted[];
  private readonly fireflies: Mote[];
  private readonly needles: Needle[];
  private readonly crabs: Crab[];
  private readonly mists: { layer: Layer; banks: Mist[] }[];
  private readonly reflect = reflectionMap();
  private readonly glint = glintMap();
  private readonly shimmer: Uint8Array;
  private readonly shine: Uint8Array;
  /** Lanterns hung by raids since the page opened. */
  private readonly hung: Hook[] = [];
  readonly buildMs: number;

  // Per screen size.
  private W = 0;
  private H = 0;
  private top = 0;
  private frame = new Surface(1, 1);
  private light = new Light(1, 1);

  // Camera and input.
  cx = HEART_X;
  vx = 0;
  private target: number | null = null;
  private lastT = 0;
  private drag: { x: number; cx: number; moved: number; lastX: number; lastT: number } | null = null;
  private hover: { x: number; y: number } | null = null;
  private pinned: { kind: "tree"; id: number } | { kind: "place"; id: number } | null = null;
  hits: HudHits = { find: null, action: null, debug: [], panels: [] };
  private moment: Moment | null = null;
  private cameraFree = false;
  private rave: boolean;
  private feed: { icon: FeedIcon; text: string; short: string; detail: string; ago: string; at: number } = {
    icon: "raid",
    text: "Party of 4 cleared TCC",
    short: "TCC cleared",
    detail: "Party of 4",
    ago: "2m",
    at: -99,
  };
  private watered = new Set<number>();
  private splashes: Splash[] = [];
  private meAt = -99;
  private catAt = -99;
  private catJoke = 0;
  private crabHop = new Map<number, number>();
  private no8At = -99;
  private raidHookIndex = 0;
  cursor: "grab" | "grabbing" | "pointer" = "grab";

  constructor(params: Params) {
    const started = performance.now();
    this.params = params;
    this.rave = params.anniversary;
    const { time, season } = params;
    this.lut = buildLut(time, season, MIST_HEX[time]);
    const L = {
      sky: new Layer(0.04, false),
      ridge: new Layer(0.18, true),
      haze: new Layer(0.32, false),
      far: new Layer(0.5, false),
      near: new Layer(0.68, false),
      back: new Layer(ROWS[0]?.f ?? 0.84, true),
      mid: new Layer(ROWS[1]?.f ?? 0.92, true),
      front: new Layer(ROWS[2]?.f ?? 1, true),
      fore: new Layer(1.14, false),
    };
    this.layers = L;
    this.rows = [L.back, L.mid, L.front];
    this.stars = paintSky(L.sky, time, 0x5e9);
    paintRidge(L.ridge, season);
    paintWildForest(L.haze, "haze", 101);
    paintWildForest(L.far, "far", 202);
    paintWildForest(L.near, "near", 303);
    const [rb, rm, rf] = ROWS;
    if (!rb || !rm || !rf) throw new Error("rows");
    const grounds = {
      back: paintGround(L.back, rb, season, 11),
      mid: paintGround(L.mid, rm, season, 22),
      front: paintGround(L.front, rf, season, 33),
    };
    this.places = paintPlaces({ back: L.back, mid: L.mid, front: L.front }, grounds, season);
    this.great = paintGreat(L.front, season);
    this.planted = plantForest(this.rows, season);
    paintTrees(this.rows, this.planted);
    paintForeground(L.fore, season, 44);
    for (const layer of Object.values(L)) layer.seal();
    for (const p of this.planted) this.byName.set(p.member.name.toLowerCase(), p);
    this.liveSeedlings = this.planted.filter((p) => p.sway).toSorted((a, b) => a.foot - b.foot);

    this.fireflies = time === "day" ? [] : placeFireflies(L.front, time === "night", 77);
    const gx = L.front.lx(HEART_X);
    this.needles = placeNeedles(gx - 150, gx + 150, 9, 14);
    const pond = this.places.pond;
    this.crabs = placeCrabs(pond.x0 + 6, pond.x1 - 6, pond.shore, pond.back);
    this.mists = [
      {
        layer: L.haze,
        banks: [
          { X0: -200, X1: 2000, y: 171, thick: 4, density: 0.55, speed: 1.1, seed: 1 },
          { X0: -200, X1: 330, y: 180, thick: 6, density: 0.95, speed: 1.5, seed: 2, teal: true },
        ],
      },
      { layer: L.near, banks: [{ X0: -200, X1: 420, y: 191, thick: 7, density: 1, speed: 2.2, seed: 3, teal: true }] },
      { layer: L.back, banks: [{ X0: -200, X1: 330, y: 199, thick: 5, density: 0.9, speed: 3, seed: 5, teal: true }] },
      { layer: L.mid, banks: [{ X0: -200, X1: 290, y: 213, thick: 4, density: 0.8, speed: 4, seed: 6, teal: true }] },
    ];

    // Highlight tables: a party tree's shimmer lifts its foliage and bark a level, its bright band two.
    this.shimmer = new Uint8Array(256);
    this.shine = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      const r = rampOf(i);
      const lift = r === R.FOLI || r === R.OLIVE || r === R.CANOPY || r === R.BARK || r === R.FERN || r === R.MOSS;
      this.shimmer[i] = lift ? ix(r, (i & 7) + 1) : i;
      this.shine[i] = lift ? (r === R.BARK ? ix(r, (i & 7) + 2) : ix(R.OLIVE, Math.min(7, (i & 7) + 3))) : i;
    }

    const at = params.at ? placeX(params.at) : null;
    this.cx = at ?? (params.anniversary ? PLACES.pond : HEART_X);
    if (params.event) {
      const et = params.still ? Math.max(0, params.et < 0 ? 0 : params.et) : Math.max(0, params.et);
      this.startMoment(params.event, params.still ? params.t - et : params.et >= 0 ? -et : 0.6);
    }
    if (params.tip) {
      const p = this.byName.get(params.tip.toLowerCase());
      if (p) {
        this.pinned = { kind: "tree", id: p.id };
        if (!params.at) this.cx = p.X;
      }
    }
    if (params.look) {
      const id = lookId(params.look);
      if (id) this.pinned = { kind: "place", id };
    }
    if (this.rave) this.feed = BIRTHDAY(-99);
    this.buildMs = performance.now() - started;
  }

  resize(W: number, H: number): void {
    this.W = W;
    this.H = H;
    // A phone keeps its button at the bottom, where a thumb is; so the view drops a little and the
    // ground runs on beneath the world, leaving the button on grass rather than on the campfire.
    this.top = Math.max(0, WORLD_H - H) + (W < 200 ? FOOT_ROOM : 0);
    this.frame = new Surface(W, H);
    this.light = new Light(W, H);
    this.cx = clampCam(this.cx, W);
  }

  // -------------------------------------------------------------------------------------------
  // The frame.

  render(t: number, out: Uint32Array, fonts: boolean): void {
    this.tick(t);
    const { W, H, top } = this;
    const s = this.frame;
    const light = this.light;
    const L = this.layers;
    const night = this.params.time === "night";
    const winter = this.params.season === "winter";
    light.clear();
    const cx = Math.round(this.cx);
    const place = (layer: Layer): Place => ({ ox: layer.offset(cx, W), oy: top });
    const view: View = { W, H, cx, top, place };
    const m = this.moment;
    const e = m ? t - m.t0 : -1;

    this.copy(L.sky, cx, null);
    drawStars(s, this.stars, t, place(L.sky).ox, top);
    this.copy(L.ridge, cx, null);
    drawBanners(s, L.ridge, t, place(L.ridge));
    if (m?.kind === "war") drawNewPennant(s, light, L.ridge, e, t, view);
    else if (this.warDone) drawNewPennant(s, light, L.ridge, 99, t, view);
    if (this.params.time !== "night") drawBirds(s, L.ridge, t, place(L.ridge), ix(R.MID, 1));
    this.copy(L.haze, cx, null);
    for (const mist of this.mists) if (mist.layer === L.haze) drawMist(s, mist.layer, mist.banks, t, place(mist.layer));
    this.copy(L.far, cx, null);
    this.copy(L.near, cx, null);
    for (const mist of this.mists) if (mist.layer === L.near) drawMist(s, mist.layer, mist.banks, t, place(mist.layer));

    // The member rows, back to front, shimmering where a party's trees stand or a tree is watered.
    const glow = this.glowing(t, e);
    this.copy(L.back, cx, glow);
    for (const mist of this.mists) if (mist.layer === L.back) drawMist(s, mist.layer, mist.banks, t, place(mist.layer));
    this.copy(L.mid, cx, glow);
    for (const mist of this.mists) if (mist.layer === L.mid) drawMist(s, mist.layer, mist.banks, t, place(mist.layer));
    this.copy(L.front, cx, glow);

    const pf = place(L.front);
    // The Great Sequoia's lanterns and the root office's window.
    this.great.lanterns.forEach((h, i) => drawHanging(s, light, h, t, i, pf, night));
    this.hung.forEach((h, i) => {
      const x = h.x - pf.ox;
      for (let k = 0; k < h.cord; k++) s.set(x, h.y - top + k, ix(R.METAL, 1));
      raidLantern(s, light, x, h.y - top + h.cord, 0.9 + 0.1 * Math.sin(t * 1.4 + i), t);
    });
    const door = this.great.door;
    light.pool(door.x - pf.ox, door.y - top + 1, night ? 12 : 7, 1.6, 1.2);
    if (night) drawOwl(s, L.front.lx(HEART_X - 96), 70, t, pf);
    if (winter) {
      const pts = this.great.festoon.map((p) => ({ x: p.x - pf.ox, y: p.y - top }));
      drawFestoon(s, light, pts, t, 80);
    }
    // Front-row seedlings sway, back to front.
    for (const p of this.liveSeedlings) {
      if (!p.sway) continue;
      const x = L.front.lx(p.X) - pf.ox;
      if (x < -10 || x > W + 10) continue;
      const k = swayIndex(t, 3.6, hash3(p.id, 1, 1) * 3.6);
      const fr = p.sway[k] ?? p.sway[0];
      if (fr) s.blit(fr, x - Math.floor(fr.w / 2), p.foot - fr.h + 1 - top);
    }

    // The campfire.
    const fx = this.places.fire.x - pf.ox;
    if (fx > -60 && fx < W + 60) {
      const FL = { ...layout(W, H), fire: { x: fx, y: this.places.fire.y - top } };
      drawFireBack(s, FL);
      drawFlames(s, FL, t, { flare: 0 });
      drawFireFront(s, FL);
      drawSmoke(s, FL, t);
      drawEmbers(s, FL, t, 0);
      fireLight(light, FL, t, this.params.time, { flare: 0 });
      drawFireside(
        s,
        this.places.fire.x,
        this.places.fire.y,
        t,
        pf,
        t - this.catAt < 0.3 || (Math.floor(t / 4.3) % 3 === 2 && t % 4.3 < 0.15),
      );
    }
    // The squirrel on the left buttress.
    const sq = squirrelFrame(t, -99);
    put(s, sq.sprite, L.front.lx(HEART_X - 40) - 8, GREAT_FOOT + sq.dy, pf);
    // Cinfy at the stall, and its lantern; the gate's lantern.
    const st = this.places.stall;
    drawCinfy(s, st.x, st.counter, t, pf);
    drawHanging(s, light, { x: st.lantern.x, y: st.lantern.y, cord: 2 }, t, 7, pf, night);
    drawHanging(s, light, { x: this.places.gate.lantern.x, y: this.places.gate.lantern.y, cord: 3 }, t, 9, pf, night);
    // The old Swamp pennant, faded, still flying.
    this.oldPennant(s, t, pf);
    drawNeedles(s, this.needles, t, pf);

    // Water: everything that stands above it is now drawn, so fill it with its reflection.
    this.reflectWater(t, pf.ox);

    // Life on the water and its shore.
    for (const [i, c] of this.crabs.entries()) {
      const hop = t - (this.crabHop.get(i) ?? -99);
      const pose = hop >= 0 && hop < 0.8 ? { sp: CRAB.up, dx: 0, dy: hop < 0.25 ? -2 : 0 } : crabPose(c, t, this.rave);
      put(s, pose.sp, c.x - 4 + pose.dx, c.foot + pose.dy, pf);
    }
    // No. 08, by the Swamp's sign.
    const no8 = t - this.no8At;
    const n8 =
      no8 >= 0 && no8 < 1
        ? { sp: CRAB.up, dy: no8 < 0.25 ? -2 : 0 }
        : crabPose({ x: 0, foot: 0, phase: 2.2, roam: 1 }, t, this.rave);
    put(s, n8.sp, this.places.swampSign.x + 4, this.places.swampSign.y + n8.dy, pf);
    drawDucks(s, L.front.lx(14), L.front.lx(120), 228, t, pf);
    if (this.rave) drawRave(s, light, this.raveSetup(), t, view);

    // Events in the world.
    let raidOut: ReturnType<typeof drawRaid> | null = null;
    if (m?.kind === "raid") raidOut = drawRaid(s, light, this.raidSetup(), e, view);
    if (m?.kind === "levelup") drawLevelUp(s, light, L.front, [...this.great.lanterns, ...this.great.free], e, t, view);
    this.drawSplashes(t);

    this.copy(L.fore, cx, null);
    drawFireflies(s, light, this.fireflies, t, pf);
    if (winter) drawSnow(s, t, pf, 7);
    if (m?.kind === "war") drawWarLeaves(s, light, e, W);

    compose(s, light, this.lut, out);

    // The HUD, on the same pixel grid.
    if (this.params.bare) return;
    const c = new Canvas(out, W, H);
    const model = this.hudModel(t, e, raidOut);
    this.hits = drawHud(c, model, fonts);
  }

  private warDone = false;

  /** Copies the visible slice of a layer into the frame; `glow` lights the given trees. */
  private copy(layer: Layer, cx: number, glow: Map<number, number> | null): void {
    const { W, H, top } = this;
    const src = layer.s.data;
    const dst = this.frame.data;
    const ox = layer.offset(cx, W);
    const x0 = Math.max(0, -ox);
    const x1 = Math.min(W, layer.w - ox);
    const owner = glow && glow.size && layer.owner ? layer.owner : null;
    for (let y = 0; y < H; y++) {
      let wy = y + top;
      if (wy >= WORLD_H) {
        // Below the world: the front ground's last rows, repeated, for a phone's foot room.
        if (layer !== this.layers.front) break;
        wy = WORLD_H - 1 - ((wy - WORLD_H) % 4);
      }
      const si = wy * layer.w + ox;
      const di = y * W;
      if (!owner && wy >= layer.opaqueFrom && x0 === 0 && x1 === W) {
        dst.set(src.subarray(si, si + W), di);
        continue;
      }
      if (!owner) {
        for (let x = x0; x < x1; x++) {
          const v = src[si + x] ?? 0;
          if (v) dst[di + x] = v;
        }
        continue;
      }
      for (let x = x0; x < x1; x++) {
        let v = src[si + x] ?? 0;
        if (!v) continue;
        const k = glow?.get(owner[si + x] ?? 0);
        if (k) {
          // A band of light sweeps up through the tree.
          const band = (x + ox - wy * 0.6 + this.lastT * 40) % 22;
          v = k > 1 && band >= 0 && band < 3 ? (this.shine[v] ?? v) : (this.shimmer[v] ?? v);
        }
        dst[di + x] = v;
      }
    }
  }

  /** Which trees glow this frame, and how strongly (1 lit, 2 with the sweeping band). */
  private glowing(t: number, e: number): Map<number, number> {
    const out = new Map<number, number>();
    if (this.moment?.kind === "raid") {
      const k = raidShimmer(e);
      if (k > 0.05) for (const p of this.raidSetup().party) out.set(p.id, k > 0.4 ? 2 : 1);
    }
    for (const sp of this.splashes) if (t - sp.t0 > 0.5 && t - sp.t0 < 2.2) out.set(sp.id, 1);
    const focus = this.pinned ?? (this.hover && !this.drag ? this.pick(this.hover.x, this.hover.y) : null);
    if (focus?.kind === "tree" && !out.has(focus.id)) out.set(focus.id, 2);
    return out;
  }

  private reflectWater(t: number, phase: number): void {
    reflectWater(this.frame, t, this.reflect, this.glint, this.params.season === "winter", phase);
  }

  private oldPennant(s: Surface, t: number, pf: Place): void {
    const { x } = this.places.oldPennant;
    const px = x - pf.ox - 3;
    const py = 200 - pf.oy;
    if (px < -10 || px > s.w + 10) return;
    // Faded to straw, frayed at the tail, hanging rather than flying.
    const rows = [
      ["ggggg.", "goGgg.", "gggg..", "gg.g..", "g....."],
      ["gggg..", "goGgg.", "ggggg.", "g.gg..", "g....."],
    ];
    const fr = rows[Math.floor(t / 1.7) % 2] ?? rows[0] ?? [];
    fr.forEach((row, ry) => {
      for (let k = 0; k < row.length; k++) {
        const ch = row[k];
        const v = ch === "g" ? ix(R.SHROOM, 2) : ch === "G" ? ix(R.SHROOM, 3) : ch === "o" ? ix(R.CRAB, 3) : 0;
        if (v) s.set(px + 1 + k, py + 1 + ry, v);
      }
    });
  }

  private drawSplashes(t: number): void {
    const s = this.frame;
    this.splashes = this.splashes.filter((sp) => t - sp.t0 < 2.4);
    for (const sp of this.splashes) {
      const p = this.planted[sp.id - 1];
      const layer = p ? this.rows[p.rowIndex] : null;
      if (!p || !layer) continue;
      const off = layer.offset(Math.round(this.cx), this.W);
      const age = t - sp.t0;
      for (let k = 0; k < 9; k++) {
        const u = age * 1.4 - k * 0.09;
        if (u < 0 || u > 1) continue;
        const x = p.box.x0 + (p.box.x1 - p.box.x0) * (0.2 + 0.6 * hash3(k, sp.id, 1)) - off;
        const y = p.box.y0 - 10 + u * (p.foot - p.box.y0 + 6) - this.top;
        s.set(x, y, ix(R.WATER, 6));
        s.set(x, y - 1, ix(R.WATER, 4));
      }
      if (age > 0.6 && age < 1.8)
        for (let k = 0; k < 5; k++) {
          const tw = Math.floor(age * 8 + k);
          const x = p.box.x0 + hash3(k, tw, 3) * (p.box.x1 - p.box.x0) - off;
          const y = p.box.y0 + hash3(k, tw, 4) * (p.box.y1 - p.box.y0) * 0.7 - this.top;
          s.set(x, y, ix(R.GLOW, 6));
        }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Events.

  private raidCache: RaidSetup | null = null;

  private raidSetup(): RaidSetup {
    if (this.raidCache) return this.raidCache;
    const party = raidParty(this.planted, this.params.me);
    const hook = this.great.free[this.raidHookIndex] ?? this.great.free[0] ?? { x: 0, y: 0, cord: 4 };
    this.raidCache = { party, layers: this.rows, front: this.layers.front, fire: this.places.fire, hook };
    return this.raidCache;
  }

  private raveSetup(): RaveSetup {
    const f = this.layers.front;
    return {
      front: f,
      from: { x: f.lx(PLACES.rules) + 25, y: 189 },
      to: { x: f.lx(PLACES.rollcall) - 18, y: 192 },
      shore: this.places.pond.shore,
    };
  }

  startMoment(kind: EventKind, t0: number): void {
    if (this.moment?.kind === "war") this.warDone = true;
    if (this.moment?.kind === "raid") this.finishRaid();
    this.moment = { kind, t0, from: this.cx };
    this.cameraFree = false;
    this.target = null;
    this.raidCache = null;
    this.pinned = null;
  }

  private finishRaid(): void {
    const r = this.raidSetup();
    this.hung.push(r.hook);
    this.raidHookIndex++;
  }

  private tick(t: number): void {
    const dt = Math.max(0, Math.min(0.1, t - this.lastT));
    this.lastT = t;
    const m = this.moment;
    if (m) {
      const e = t - m.t0;
      if (!this.cameraFree && e >= 0) {
        if (m.kind === "raid") this.cx = raidCamera(this.raidSetup(), e, m.from, this.W);
        else if (m.kind === "war") this.cx = warCamera(e, m.from);
        else this.cx = levelCamera(e, m.from);
      }
      // Feed updates as each moment lands.
      const landed = m.kind === "raid" ? 6.5 : m.kind === "war" ? 3.2 : 2.2;
      if (e >= landed && this.feed.at < m.t0) {
        this.feed =
          m.kind === "raid"
            ? {
                icon: "raid",
                text: "Party of 4 cleared TCC",
                short: "TCC cleared",
                detail: "Party of 4",
                ago: "now",
                at: t,
              }
            : m.kind === "war"
              ? {
                  icon: "war",
                  text: "SEQ took a Fruma territory",
                  short: "War won",
                  detail: "Fruma",
                  ago: "now",
                  at: t,
                }
              : {
                  icon: "level",
                  text: "Guild reached level 251",
                  short: "Level 251!",
                  detail: "GG",
                  ago: "now",
                  at: t,
                };
      }
      if (e > LENGTH[m.kind]) {
        if (m.kind === "raid") this.finishRaid();
        if (m.kind === "war") this.warDone = true;
        this.moment = null;
      }
    }
    if (!this.drag) {
      if (this.target !== null) {
        const k = 1 - Math.exp(-dt * 3.2);
        this.cx += (this.target - this.cx) * k;
        if (Math.abs(this.target - this.cx) < 0.5) {
          this.cx = this.target;
          this.target = null;
        }
      } else if (Math.abs(this.vx) > 1) {
        this.cx += this.vx * dt;
        this.vx *= Math.exp(-dt * 3.5);
      } else this.vx = 0;
    }
    this.cx = clampCam(this.cx, this.W);
  }

  // -------------------------------------------------------------------------------------------
  // The HUD's model.

  private hudModel(t: number, e: number, raid: ReturnType<typeof drawRaid> | null): HudModel {
    const m = this.moment;
    const me = this.byName.get(this.params.me.toLowerCase()) ?? null;
    let mePos: { x: number; y: number } | null = null;
    const marked =
      this.pinned?.kind === "tree" ? this.planted[this.pinned.id - 1] : me && t - this.meAt < 6 ? me : null;
    if (marked) {
      const layer = this.rows[marked.rowIndex];
      const topY = marked.sway ? marked.foot - (marked.sway[0]?.h ?? 12) : marked.box.y0;
      if (layer) mePos = { x: layer.lx(marked.X) - layer.offset(Math.round(this.cx), this.W), y: topY - this.top - 2 };
    }
    let card: HudModel["card"] = null;
    if (m?.kind === "levelup") {
      const a = clamp01((e - 2.2) / 0.4) * (1 - clamp01((e - 8.4) / 0.6));
      if (a > 0) card = { title: "GG!", sub: "Guild level 251", lore: "No gg left behind", a };
    }
    let label: HudModel["label"] = null;
    if (raid?.lantern && raid.labelA > 0)
      label = {
        x: raid.lantern.x,
        y: raid.lantern.y,
        title: "TCC cleared",
        names: this.raidSetup().party.map((p) => p.member.name),
        a: raid.labelA,
      };
    const bubble =
      t - this.catAt < 4.5
        ? {
            x: this.places.fire.x + 40 - this.layers.front.offset(Math.round(this.cx), this.W),
            y: this.places.fire.y - this.top - 2,
            lines: JOKES[this.catJoke % JOKES.length] ?? [],
          }
        : null;
    return {
      trees: this.planted.length + 1,
      feed: { ...this.feed, flash: Math.max(0, 1 - (t - this.feed.at) / 1.2) },
      findHot: !!this.hover && inside(this.hits.find, this.hover.x, this.hover.y),
      findOn: t - this.meAt < 6,
      tooltip: this.tooltip(t),
      debug: this.params.debug ? { labels: ["Raid", "War", "Level up", "Rave"], hot: this.debugHot() } : null,
      card,
      label,
      bubble,
      me: mePos,
      t,
    };
  }

  private debugHot(): number {
    if (!this.hover) return -1;
    const h = this.hover;
    return this.hits.debug.findIndex((r) => inside(r, h.x, h.y));
  }

  private tooltip(t: number): Tooltip | null {
    const at = this.pinned ? null : this.hover;
    const target = this.pinned ?? (at ? this.pick(at.x, at.y) : null);
    if (!target) return null;
    const anchor = this.anchorOf(target, at);
    if (!anchor) return null;
    if (target.kind === "tree") {
      const p = this.planted[target.id - 1];
      if (!p) return null;
      const lv = p.member.level;
      const colour = mix([146, 196, 106], [253, 211, 111], (lv - 1) / 9);
      const done = this.watered.has(p.id);
      const actionHot = !!this.hover && inside(this.hits.action, this.hover.x, this.hover.y);
      return {
        ax: anchor.x,
        ay: anchor.y,
        head: playerHead(p.member.seed),
        title: p.member.name,
        titleColour: UI.text,
        lines: [{ text: `Level ${lv} · ${stageLabel(p.member.stage)}`, colour }],
        action: done
          ? { text: "Watered · thank you!", colour: UI.muted, hot: false }
          : { text: "Water (1 care)", colour: UI.leaf, hot: actionHot },
      };
    }
    void t;
    const info = PLACE_INFO[target.id];
    if (!info) return null;
    return {
      ax: anchor.x,
      ay: anchor.y,
      head: null,
      title: info.title,
      titleColour: info.colour,
      lines: info.lines,
      action: null,
    };
  }

  private anchorOf(
    target: { kind: "tree" | "place"; id: number },
    at: { x: number; y: number } | null,
  ): { x: number; y: number } | null {
    if (at) return at;
    const cx = Math.round(this.cx);
    if (target.kind === "tree") {
      const p = this.planted[target.id - 1];
      const layer = p ? this.rows[p.rowIndex] : null;
      if (!p || !layer) return null;
      return { x: layer.lx(p.X) - layer.offset(cx, this.W), y: p.box.y0 - this.top + 4 };
    }
    const f = this.layers.front;
    const X = PLACE_X[target.id] ?? HEART_X;
    return { x: f.lx(X) - f.offset(cx, this.W), y: (PLACE_Y[target.id] ?? 200) - this.top };
  }

  // -------------------------------------------------------------------------------------------
  // Input.

  /** What is under a screen point: a tree, a place, or nothing. Front layers first. */
  private pick(x: number, y: number): { kind: "tree" | "place"; id: number } | null {
    if (this.hits.panels.some((r) => inside(r, x, y))) return null;
    const cx = Math.round(this.cx);
    const wy = y + this.top;
    if (wy < 0 || wy >= WORLD_H) return null;
    // No. 08, by the sign.
    const pf = this.layers.front.offset(cx, this.W);
    const n8x = this.places.swampSign.x + 4 - pf;
    if (x >= n8x - 1 && x <= n8x + 10 && wy >= this.places.swampSign.y - 8 && wy <= this.places.swampSign.y + 1)
      return { kind: "place", id: NO8_ID };
    // Front seedlings sway outside the layer: test their boxes.
    for (const p of this.planted) {
      if (!p.sway) continue;
      const sx = this.layers.front.lx(p.X) - pf;
      if (Math.abs(x - sx) <= 6 && wy <= p.foot + 1 && wy >= p.foot - 20) return { kind: "tree", id: p.id };
    }
    for (const layer of [this.layers.front, this.layers.mid, this.layers.back, this.layers.ridge]) {
      const lx = x + layer.offset(cx, this.W);
      if (lx < 0 || lx >= layer.w) continue;
      const i = wy * layer.w + lx;
      if (!layer.s.data[i]) continue;
      const id = layer.owner?.[i] ?? 0;
      if (!id) {
        if (layer === this.layers.ridge) continue;
        return null;
      }
      return id <= this.planted.length ? { kind: "tree", id } : { kind: "place", id };
    }
    return null;
  }

  pointer(x: number, y: number, kind: "down" | "move" | "up" | "leave", t: number, touch: boolean): void {
    if (kind === "leave") {
      this.hover = null;
      return;
    }
    if (kind === "down") {
      this.drag = { x, cx: this.cx, moved: 0, lastX: x, lastT: t };
      this.vx = 0;
      if (!touch) this.hover = { x, y };
      return;
    }
    if (kind === "move") {
      if (!touch || !this.drag) this.hover = touch ? null : { x, y };
      const d = this.drag;
      if (d) {
        d.moved = Math.max(d.moved, Math.abs(x - d.x));
        if (d.moved > 2) {
          const dt = Math.max(1 / 240, t - d.lastT);
          this.vx = ((d.lastX - x) / dt) * 0.6 + this.vx * 0.4;
          d.lastX = x;
          d.lastT = t;
          this.cx = clampCam(d.cx - (x - d.x), this.W);
          this.cameraFree = true;
          this.target = null;
          if (this.pinned) this.pinned = null;
        }
      }
      this.cursor = this.drag && this.drag.moved > 2 ? "grabbing" : this.isHot(x, y) ? "pointer" : "grab";
      return;
    }
    // Up: a tap if it barely moved.
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.moved > 2) {
      if (t - d.lastT > 0.08) this.vx = 0;
      return;
    }
    this.vx = 0;
    this.tap(x, y, t);
  }

  private isHot(x: number, y: number): boolean {
    const h = this.hits;
    if (inside(h.find, x, y) || inside(h.action, x, y) || h.debug.some((r) => inside(r, x, y))) return true;
    return this.pick(x, y) !== null;
  }

  private tap(x: number, y: number, t: number): void {
    const h = this.hits;
    if (inside(h.find, x, y)) return this.findMe(t);
    if (inside(h.action, x, y) && this.pinned?.kind === "tree") {
      const id = this.pinned.id;
      if (!this.watered.has(id)) {
        this.watered.add(id);
        this.splashes.push({ id, t0: t });
      }
      return;
    }
    const di = h.debug.findIndex((r) => inside(r, x, y));
    if (di >= 0) return this.debug(di, t);
    if (h.panels.some((r) => inside(r, x, y))) return;
    const target = this.pick(x, y);
    if (target?.kind === "place" && target.id === ID.campfire && this.nearCat(x, y)) {
      this.catAt = t;
      this.catJoke++;
      return;
    }
    if (target?.kind === "place" && target.id === NO8_ID) this.no8At = t;
    // A crab on the shore: it hops and waves.
    const hit = this.crabAt(x, y);
    if (hit >= 0) {
      this.crabHop.set(hit, t);
      this.pinned = { kind: "place", id: ID.rollcall };
      return;
    }
    if (target && this.pinned && target.kind === this.pinned.kind && target.id === this.pinned.id) this.pinned = null;
    else this.pinned = target;
  }

  private nearCat(x: number, y: number): boolean {
    const pf = this.layers.front.offset(Math.round(this.cx), this.W);
    const cx = this.places.fire.x + 41 - pf;
    const cy = this.places.fire.y + 2 - this.top;
    return Math.abs(x - cx) < 8 && Math.abs(y - cy) < 7;
  }

  private crabAt(x: number, y: number): number {
    const pf = this.layers.front.offset(Math.round(this.cx), this.W);
    return this.crabs.findIndex(
      (c) => Math.abs(x - (c.x - pf)) <= 5 && y + this.top <= c.foot + 1 && y + this.top >= c.foot - 7,
    );
  }

  findMe(t: number): void {
    const me = this.byName.get(this.params.me.toLowerCase());
    if (!me) return;
    this.target = clampCam(me.X, this.W);
    this.vx = 0;
    this.cameraFree = true;
    this.meAt = t;
    this.pinned = { kind: "tree", id: me.id };
  }

  private debug(i: number, t: number): void {
    if (i === 0) this.startMoment("raid", t);
    else if (i === 1) this.startMoment("war", t);
    else if (i === 2) this.startMoment("levelup", t);
    else {
      this.rave = !this.rave;
      if (this.rave) {
        this.target = PLACES.pond;
        this.feed = BIRTHDAY(t);
      }
    }
  }

  key(k: string, t: number): void {
    if (k === "r") this.startMoment("raid", t);
    else if (k === "w") this.startMoment("war", t);
    else if (k === "l") this.startMoment("levelup", t);
    else if (k === "a") this.debug(3, t);
    else if (k === "f") this.findMe(t);
    else if (k === "ArrowLeft" || k === "ArrowRight") {
      this.target = clampCam((this.target ?? this.cx) + (k === "ArrowLeft" ? -1 : 1) * this.W * 0.5, this.W);
      this.cameraFree = true;
    } else if (k === "Escape") this.pinned = null;
  }

  /** Where each tree stands, for the README and tests. */
  get trees(): readonly Planted[] {
    return this.planted;
  }
}

// ---------------------------------------------------------------------------------------------

const NO8_ID = 120;
/** Extra ground rows under a phone's view, for its button. */
const FOOT_ROOM = 18;

const BIRTHDAY = (
  at: number,
): { icon: FeedIcon; text: string; short: string; detail: string; ago: string; at: number } => ({
  icon: "crab",
  text: "Happy 4th birthday, SEQ!",
  short: "Happy 4th, SEQ!",
  detail: "Crab rave",
  ago: "today",
  at,
});

const PLACE_X: Record<number, number> = {
  [GREAT_ID]: HEART_X,
  [DOOR_ID]: HEART_X + 22,
  [ID.swampSign]: PLACES.swampSign,
  [ID.rules]: PLACES.rules,
  [ID.rollcall]: PLACES.rollcall,
  [ID.farm]: PLACES.farm,
  [ID.stall]: PLACES.stall,
  [ID.campfire]: PLACES.campfire,
  [ID.pennant]: 106,
  [NO8_ID]: PLACES.swampSign + 8,
};

const PLACE_Y: Record<number, number> = {
  [GREAT_ID]: 150,
  [DOOR_ID]: 206,
  [ID.swampSign]: 208,
  [ID.rules]: 192,
  [ID.rollcall]: 193,
  [ID.farm]: 207,
  [ID.stall]: 190,
  [ID.campfire]: 222,
  [ID.pennant]: 200,
  [NO8_ID]: 226,
};

const GOLD: Rgb = [242, 192, 68];
const CRABBY: Rgb = [238, 122, 68];

const PLACE_INFO: Record<number, { title: string; colour: Rgb; lines: { text: string; colour: Rgb }[] }> = {
  [GREAT_ID]: {
    title: "The Great Sequoia",
    colour: GOLD,
    lines: [
      { text: "The guild's tree · Level 250", colour: UI.text },
      { text: "Every lantern is a gift of Leaf.", colour: UI.lore },
    ],
  },
  [DOOR_ID]: {
    title: "Root Office",
    colour: GOLD,
    lines: [{ text: "Open whenever someone's in.", colour: UI.lore }],
  },
  [ID.swampSign]: {
    title: "The Swamp",
    colour: GOLD,
    lines: [
      { text: "Held for two years, 2024 to 2026.", colour: UI.text },
      { text: "We moved on to Fruma.", colour: UI.lore },
    ],
  },
  [ID.pennant]: {
    title: "The Swamp's banner",
    colour: GOLD,
    lines: [{ text: "It flew for two years.", colour: UI.lore }],
  },
  [ID.rules]: {
    title: "Crab Rules",
    colour: CRABBY,
    lines: [
      { text: "1. Walk sideways.", colour: UI.text },
      { text: "2. No crabellions.", colour: UI.text },
      { text: "3. Snacks are shared.", colour: UI.text },
    ],
  },
  [ID.rollcall]: {
    title: "Roll Call",
    colour: CRABBY,
    lines: [
      { text: "11 of 12 present.", colour: UI.text },
      { text: "No. 08: unaccounted for.", colour: UI.lore },
    ],
  },
  [NO8_ID]: {
    title: "Crab No. 08",
    colour: CRABBY,
    lines: [
      { text: "Found!", colour: UI.text },
      { text: "Still holding the Swamp.", colour: UI.lore },
    ],
  },
  [ID.farm]: {
    title: "Do Not The Farm",
    colour: GOLD,
    lines: [{ text: "Guild policy.", colour: UI.lore }],
  },
  [ID.stall]: {
    title: "Cinfy's Stall",
    colour: GOLD,
    lines: [
      { text: "Treasury@seqwawa regrets to", colour: UI.text },
      { text: "inform you the vault is closed", colour: UI.text },
      { text: "for counting.", colour: UI.text },
    ],
  },
  [ID.campfire]: {
    title: "The Campfire",
    colour: GOLD,
    lines: [
      { text: "Sit round it in a Discord call.", colour: UI.text },
      { text: "Burn cones. Play Leafle.", colour: UI.lore },
    ],
  },
};

function lookId(name: string): number | null {
  const ids: Record<string, number> = {
    great: GREAT_ID,
    door: DOOR_ID,
    swamp: ID.swampSign,
    pennant: ID.pennant,
    rules: ID.rules,
    rollcall: ID.rollcall,
    no8: NO8_ID,
    farm: ID.farm,
    stall: ID.stall,
    campfire: ID.campfire,
  };
  return ids[name] ?? null;
}

/**
 * The lab's raid party: you, and the three trees nearest yours that a player would see (no back-row
 * seedlings), so the camera can show all four shimmering before their lights set off.
 */
function raidParty(planted: readonly Planted[], me: string): Planted[] {
  const mine = planted.find((p) => p.member.name.toLowerCase() === me.toLowerCase());
  const anchor = mine && mine.X > 960 ? mine.X : 1130;
  const seen = planted.filter((p) => p !== mine && !(p.rowIndex === 0 && p.member.level < 3) && p.X > 990);
  const near = seen
    .toSorted((a, b) => Math.abs(a.X - anchor) - Math.abs(b.X - anchor))
    .slice(0, mine && mine.X > 960 ? 3 : 4);
  return (mine && mine.X > 960 ? [mine, ...near] : near).toSorted((a, b) => a.X - b.X);
}

function swayIndex(t: number, period: number, phase: number): number {
  const u = ((((t + phase) / period) % 1) + 1) % 1;
  return u < 0.25 ? 0 : u < 0.5 ? 1 : u < 0.75 ? 0 : 2;
}
