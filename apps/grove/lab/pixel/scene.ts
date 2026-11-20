/**
 * The glade: builds the still layers once, then draws each frame's life over them, and answers
 * taps. The world and the HUD are two grids (see main.ts): the world zooms with the tree's level,
 * the HUD does not.
 */

import { castLut, frameOf, occlude, spiritOf } from "./actors.ts";
import { drawAurora } from "./aurora.ts";
import { type Backdrop, drawBackdrop } from "./backdrop.ts";
import { breath, CARE_LENGTH, type CareEffect, drawCareTool, drawCareWorld } from "./care.ts";
import {
  type ConeEvent,
  coneHit,
  coneLook,
  coneScreen,
  drawConeCard,
  drawConeWorld,
  drawRestingCone,
  rankColour,
  rollRank,
  shakeFrame,
} from "./cone.ts";
import { cone10Done, type Cone10Event, drawCone10, drawCone10World, makeCone10 } from "./cone10.ts";
import { drawSign, drawWanderer, placeWanderer, type Wanderer } from "./critters.ts";
import { buildGlade, type Glade, type Placed } from "./glade.ts";
import { drawGrootWorld, grootDrink, type GrootEvent, grootPopup, grootPopupOpen } from "./groot.ts";
import { Canvas, drawHud, drawPopup, drawToast, drawToolIcon, hex, hudLayout, popupSize, TOOLS } from "./hud.ts";
import { type Layout, layout, type Point } from "./layout.ts";
import {
  drawGrowth,
  drawHeralds,
  ggPopup,
  ggPopupOpen,
  LEVELUP_SWAP,
  type LevelUpEvent,
  levelUpFlash,
  shownLevel,
  treeReveal,
} from "./levelup.ts";
import {
  crabFrame,
  drawEmbers,
  drawFestoon,
  drawFireBack,
  drawFireflies,
  drawFireFront,
  drawFlames,
  drawGuildLanterns,
  drawLakeGlints,
  drawLantern,
  drawNeedles,
  drawSmoke,
  drawSnow,
  drawStars,
  fireLight,
  lightShaft,
  type Mote,
  type Needle,
  placeFireflies,
  placeNeedles,
  squirrelFrame,
  sunbeams,
} from "./life.ts";
import { buildLut, ix, type Lut, R, rampOf } from "./palette.ts";
import type { Params, Tool } from "./params.ts";
import { compose, Light, Surface } from "./raster.ts";
import { hashString } from "./rng.ts";
import { SHEET } from "./sprites.ts";
import { growTree, padHit, STAGE_TITLE, type Tree } from "./tree.ts";

const BLOOM_MAX = 10;
const CHARGE_MAX = 6;
const CONE_PRICE = 400;
const GREETING = "I hope you have a moderately excellent next 14 hours.";

/** One canvas's pixel grid: its art size and how it lies on the screen. */
export interface Grid {
  W: number;
  H: number;
  scale: number;
  offX: number;
  offY: number;
  dpr: number;
}

/** What outlives a resize: the player's balance, care, pruning and whatever is mid-flight. */
export class State {
  leaf = 12480;
  shownLeaf = 12480;
  bloom = 4;
  charges = CHARGE_MAX;
  chargeClock = 0;
  freeCones = 0;
  tool: Tool | null;
  pruned: Set<number>;
  effects: CareEffect[] = [];
  cone: ConeEvent | null = null;
  cone10: Cone10Event | null = null;
  groot: GrootEvent | null = null;
  levelUp: LevelUpEvent | null = null;
  greetAt: number | null;
  spentCone = false;
  squirrelHop = -99;
  crabParty = -99;
  bloomFlashAt = -99;
  chargeFlashAt = -99;
  /** The pointer in the world's grid and in the HUD's. */
  hover: Point | null = null;
  hudHover: Point | null = null;
  readonly key: string;
  readonly params: Params;

  constructor(params: Params) {
    this.params = params;
    this.tool = params.tool;
    this.key = `sequoia-grove-pixel:pruned:${params.seed}:${params.level}`;
    this.pruned = new Set(load(this.key));
    const t0 = params.still ? 0 : 0.6;
    this.greetAt = params.greet ? (params.still ? 0 : 0.4) : null;
    if (params.groot > 0) this.groot = { t0, count: params.groot, bloomFrom: this.bloom };
    if (params.levelup) this.levelUp = { t0, from: params.level - 1, to: params.level };
    if (params.scene === "cone10") this.cone10 = makeCone10(t0, params.rank, params.seed);
  }

  /** The level the world is showing at `t`: the old one until a level-up's flash. */
  shownLevel(t: number): number {
    return this.levelUp ? shownLevel(this.levelUp, t) : this.params.level;
  }

  savePruned(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify([...this.pruned]));
    } catch {
      // Private windows and previews keep no storage; pruning then lasts the visit.
    }
  }
}

function load(key: string): number[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((n): n is number => typeof n === "number") : [];
  } catch {
    return [];
  }
}

/** A grown tree with its still parts painted on their own layer, and its colours. */
interface Grown {
  tree: Tree;
  still: Surface;
  lut: Lut;
}

export class Scene {
  readonly L: Layout;
  private readonly base: Surface;
  private readonly surface: Surface;
  private readonly light: Light;
  private readonly rare: Light;
  /** The guild's cast (heralds, spirits, the Mossmote), in its own palette, laid over the glade. */
  private readonly cast: Surface;
  private castLut: Lut;
  private readonly backdrop: Backdrop;
  private readonly glade: Glade;
  /** The tree as it is, and during a level-up the tree it is becoming. */
  private now: Grown;
  private next: Grown | null = null;
  private readonly seed: number;
  private readonly fireflies: Mote[];
  private readonly needles: Needle[];
  private readonly brighter: Uint8Array;
  private readonly wanderer: Wanderer | null;
  /** Winter: a garland swagged across the crown, pad to pad, down the tree. */
  private garland: { x: number; y: number }[];
  private lastT = 0;

  readonly world: Grid;
  readonly hud: Grid;
  readonly W: number;
  readonly H: number;
  readonly params: Params;
  readonly state: State;

  constructor(world: Grid, hud: Grid, params: Params, state: State, t: number) {
    this.world = world;
    this.hud = hud;
    this.W = world.W;
    this.H = world.H;
    this.params = params;
    this.state = state;
    // The hotbar's panel is 36 HUD pixels tall; that much of the world is under it.
    this.L = layout(world.W, world.H, Math.ceil((36 * hud.scale) / world.scale));
    this.seed = hashString(params.seed);
    this.base = new Surface(this.W, this.H);
    this.surface = new Surface(this.W, this.H);
    this.light = new Light(this.W, this.H);
    this.rare = new Light(this.W, this.H);
    this.cast = new Surface(this.W, this.H);
    this.castLut = castLut(params.time, params.season, rankColour(state.cone?.rank ?? params.rank));
    this.backdrop = drawBackdrop(this.base, this.L, params.time, this.seed);
    this.glade = buildGlade(this.base, this.L, params.time, params.season, this.seed);
    if (this.L.sign) drawSign(this.base, this.L.sign, params.season);
    const shown = state.shownLevel(t);
    this.now = this.grow(shown);
    if (state.levelUp && shown !== state.levelUp.to) this.next = this.grow(state.levelUp.to);
    this.fireflies = placeFireflies(this.L, params.time, this.seed);
    this.needles = this.placeNeedles();
    this.garland = this.placeGarland();
    this.wanderer = this.L.sign ? placeWanderer(this.L, this.seed) : null;
    // A table that lifts foliage a level, for the crown's breath.
    this.brighter = new Uint8Array(256);
    for (let i = 0; i < 256; i++) this.brighter[i] = rampOf(i) === R.FOLI ? ix(R.FOLI, Math.min(7, (i & 7) + 1)) : i;
    if (params.care && state.effects.length === 0) this.stillCare(params.care);
    if (params.scene === "cone" && !state.cone) {
      state.cone = {
        t0: params.still ? params.t - params.coneT : 0.6,
        rank: params.rank,
        verdant: params.verdant,
        closedAt: null,
      };
      this.recolour();
    }
  }

  private grow(level: number): Grown {
    const tree = growTree(level, this.params.seed, this.L.treeX, this.L.ground, this.params.season, this.state.pruned);
    const still = new Surface(this.W, this.H);
    tree.paintStill(still);
    return { tree, still, lut: this.lutFor(tree) };
  }

  private lutFor(tree: Tree): Lut {
    const rank = this.state.cone?.rank ?? this.params.rank;
    return buildLut(this.params.time, this.params.season, rankColour(rank), tree.gold);
  }

  /** The rarity's light needs its own colours in the palette. */
  private recolour(): void {
    this.castLut = castLut(this.params.time, this.params.season, rankColour(this.state.cone?.rank ?? this.params.rank));
    this.now.lut = this.lutFor(this.now.tree);
    if (this.next) this.next.lut = this.lutFor(this.next.tree);
  }

  private placeNeedles(): Needle[] {
    const tree = this.now.tree;
    return tree.stage === "seedling" || tree.stage === "sapling"
      ? []
      : placeNeedles(tree.crown, this.L.ground, this.seed, 6);
  }

  private placeGarland(): { x: number; y: number }[] {
    const front = this.now.tree.pads.filter((pd) => !pd.back).toSorted((a, b) => a.box.y1 - b.box.y1);
    return front
      .filter((_, i) => i % 2 === 0)
      .map((pd, i) => ({ x: Math.round(pd.box.x0 + (pd.box.x1 - pd.box.x0) * (i % 2 ? 0.7 : 0.3)), y: pd.box.y1 - 4 }));
  }

  /** A still of care mid-way: aimed at the crown's lit shoulder, as a player would tap. */
  private stillCare(tool: Tool): void {
    const st = this.state;
    const tree = this.now.tree;
    const crown = tree.crown;
    const x = Math.round(this.L.treeX + (crown.x1 - this.L.treeX) * 0.35);
    const y = Math.round(crown.y0 + (tree.foot.y - crown.y0) * 0.3);
    const t0 = this.params.still ? this.params.t - this.params.careT : 0.5;
    const pad = tree.pads
      .toReversed()
      .find((p) => !p.back && x >= p.box.x0 && x < p.box.x1 && y >= p.box.y0 && y < p.box.y1);
    if (tool === "shears" && pad) {
      st.pruned.add(pad.id);
      st.effects.push({ tool: "shears", t0, x, y, pad: pad.box });
    } else st.effects.push({ tool, t0, x, y });
  }

  render(t: number, out: Uint32Array, hudOut: Uint32Array, fonts: boolean): void {
    if (this.params.sheet) return this.renderSheet(out, hudOut);
    this.tick(t);
    const s = this.surface;
    const st = this.state;
    const p = this.params;
    s.copyFrom(this.base);
    this.cast.data.fill(0);
    this.light.clear();
    this.rare.clear();
    const look = st.cone ? coneLook(st.cone, t) : null;
    if (look?.done) st.cone = null;
    const fire = { flare: look?.flare ?? 0 };
    // Yggdrasil stops the world: everything but the cone holds still while it opens.
    const tw = look ? look.worldT : t;

    drawStars(s, this.backdrop.stars, tw);
    if (look && st.cone && look.aurora > 0) drawAurora(s, this.L, look.aurora, tw, this.seed, look.curtains);
    drawGuildLanterns(s, this.backdrop.lanterns, tw);
    drawLakeGlints(s, this.backdrop.lake, tw, p.time);
    for (const f of this.glade.ferns) drawSway(s, f, tw);
    this.drawTree(tw, t);
    drawLantern(s, this.light, this.L, tw, p.time);

    // The fire, its cone and the companions round it.
    drawFireBack(s, this.L);
    contactShadow(s, this.L.squirrel.x, this.L.squirrel.y + 1, 6);
    if (this.L.crab.x < this.W + 8) contactShadow(s, this.L.crab.x, this.L.crab.y + 1, 7);
    const sq = squirrelFrame(tw, st.squirrelHop);
    s.blit(sq.sprite, this.L.squirrel.x - 8, this.L.squirrel.y - sq.sprite.h + 1 + sq.dy);
    if (this.wanderer) drawWanderer(this.cast, this.wanderer, tw);
    drawFlames(s, this.L, tw, fire);
    if (st.cone) drawConeWorld(s, this.cast, this.light, this.rare, this.L, st.cone, t);
    else drawRestingCone(s, this.L, st.spentCone);
    drawFireFront(s, this.L);
    drawSmoke(s, this.L, tw);
    drawEmbers(s, this.L, tw, look?.embers ?? 0);
    const cr = crabFrame(tw, st.crabParty);
    s.blit(cr.sprite, this.L.crab.x - 8 + cr.dx, this.L.crab.y - cr.sprite.h + 1 + cr.dy);
    if (st.levelUp) drawHeralds(s, this.cast, this.light, this.L, st.levelUp, t);

    drawNeedles(s, this.needles, tw);
    for (const e of st.effects) drawCareWorld(s, e, t);
    if (st.groot) drawGrootWorld(s, this.light, this.now.tree, st.groot, t, this.L);
    s.overlay(this.glade.front);
    for (const f of this.glade.frontFerns) drawSway(s, f, tw);
    for (const c of this.glade.canopy) drawSway(s, c, tw);
    if (p.season === "winter") {
      drawFestoon(s, this.light, this.glade.festoon, tw);
      drawFestoon(s, this.light, this.garland, tw, 90);
    }
    drawFireflies(s, this.light, this.fireflies, tw);
    if (p.season === "winter") drawSnow(s, this.L, tw, this.seed);

    const young = this.now.tree.stage === "seedling" || this.now.tree.stage === "sapling";
    if (young && p.time !== "night") lightShaft(s, this.light, this.now.tree.foot, this.now.tree.top, tw, this.H);
    fireLight(this.light, this.L, tw, p.time, fire);
    if (p.time === "day") sunbeams(this.light, this.L, tw);
    const rc = hex(rankColour(st.cone?.rank ?? p.rank));
    compose(s, this.light, this.now.lut, out, this.rare, rc);
    // The cast over the glade, under whatever stands in front of it.
    occlude(this.cast, this.glade.front);
    layCast(this.cast, this.light, this.castLut, out);
    if (look && st.cone) {
      coneScreen(out, this.W, this.H, this.L, look, rankColour(st.cone.rank));
      shakeFrame(out, this.W, this.H, look.shake.x, look.shake.y);
    }
    const wc = new Canvas(out, this.W, this.H);
    for (const e of st.effects) drawCareTool(wc, e, t);

    this.renderHud(t, hudOut, fonts);
  }

  private renderHud(t: number, hudOut: Uint32Array, fonts: boolean): void {
    const st = this.state;
    const p = this.params;
    const c = new Canvas(hudOut, this.hud.W, this.hud.H);
    c.clear();
    // The level-up's flash, which covers the world opening.
    const flash = st.levelUp ? levelUpFlash(st.levelUp, t) : 0;
    if (flash > 0) c.rect(0, 0, c.W, c.H, [255, 244, 214], flash * 0.9);
    const busy = st.cone !== null || st.cone10 !== null;
    if (!busy) {
      const grootDrank = st.groot ? grootDrink(st.groot, t) : null;
      drawHud(
        c,
        {
          leaf: Math.round(st.shownLeaf),
          bloom: grootDrank ? grootDrank.bloom : st.bloom,
          bloomMax: BLOOM_MAX,
          level: st.shownLevel(t),
          xp: st.levelUp && st.shownLevel(t) === st.levelUp.to ? 0.04 : p.xp,
          stage: STAGE_TITLE[this.now.tree.stage],
          charges: st.charges,
          tool: st.tool,
          bloomFlash: Math.max(grootDrank?.flash ?? 0, Math.max(0, 1 - (t - st.bloomFlashAt) / 0.6)),
          chargeFlash: Math.max(0, 1 - (t - st.chargeFlashAt) / 0.6),
          rgb: this.now.lut.rgb,
        },
        fonts,
      );
      const h = st.hudHover;
      if (st.tool && h && !this.overHud(h.x, h.y)) drawToolIcon(c, st.tool, h.x - 3, h.y - 13, 0.9);
    }
    if (!fonts) return;
    // Popups stand at the top right, under the Leaf balance, clear of the tree; on a phone, under
    // the top row.
    const narrowHud = this.hud.W < 200;
    const top = narrowHud ? 36 : 24;
    const maxW = narrowHud ? this.hud.W - 8 : Math.min(200, Math.round(this.hud.W * 0.5));
    const place = (w: number): number => (narrowHud ? Math.floor((this.hud.W - w) / 2) : this.hud.W - w - 4);
    if (st.groot) {
      const open = grootPopupOpen(st.groot, t);
      if (open > 0) {
        const spec = grootPopup(st.groot);
        drawPopup(c, spec, place(popupSize(spec, maxW).w), top, maxW, open, t);
      }
    }
    if (st.levelUp) {
      const open = ggPopupOpen(st.levelUp, t);
      if (open > 0) {
        const spec = ggPopup(st.levelUp, STAGE_TITLE[this.now.tree.stage]);
        drawPopup(c, spec, place(popupSize(spec, maxW).w), top, maxW, open, t);
      }
    }
    if (st.greetAt !== null && !busy && !st.levelUp && !st.groot) {
      drawToast(c, GREETING, narrowHud ? 36 : 4, narrowHud ? this.hud.W - 8 : 180, t - st.greetAt);
    }
    if (st.cone) drawConeCard(c, this.toHud(this.L.fire), st.cone, t, this.castLut.rgb);
    if (st.cone10) {
      const crown = this.now.tree.crown;
      drawCone10(
        c,
        st.cone10,
        t,
        this.toHud({ x: crown.x0, y: crown.y0 }),
        this.toHud({ x: crown.x1, y: Math.min(crown.y1, this.L.ground - 20) }),
        { spriteFor: (rank) => frameOf(spiritOf(rank), 0).sprite, rgb: this.castLut.rgb },
      );
      if (cone10Done(st.cone10, t)) st.cone10 = null;
    }
  }

  /** A world point in the HUD's grid. */
  private toHud(p: Point): Point {
    const w = this.world;
    const h = this.hud;
    return {
      x: Math.round((p.x * w.scale + w.offX - h.offX) / h.scale),
      y: Math.round((p.y * w.scale + w.offY - h.offY) / h.scale),
    };
  }

  private tick(t: number): void {
    const st = this.state;
    const dt = Math.max(0, Math.min(0.25, t - this.lastT));
    this.lastT = t;
    st.effects = st.effects.filter((e) => t - e.t0 < CARE_LENGTH[e.tool]);
    if (st.charges < CHARGE_MAX) {
      st.chargeClock += dt;
      if (st.chargeClock > 9) {
        st.chargeClock = 0;
        st.charges++;
      }
    }
    // The balance ticks toward its value, as a counter does.
    const diff = st.leaf - st.shownLeaf;
    st.shownLeaf += Math.abs(diff) < 1 ? diff : diff * Math.min(1, dt * 6);
    // A level-up's new tree takes over on its flash.
    if (st.levelUp && this.next && t - st.levelUp.t0 >= LEVELUP_SWAP) {
      this.now = this.next;
      this.next = null;
      this.garland = this.placeGarland();
    }
  }

  private drawTree(t: number, real: number): void {
    const { tree, still } = this.now;
    const st = this.state;
    const reveal = st.levelUp ? treeReveal(st.levelUp, real, tree) : null;
    // During a level-up's growth, the new tree rises from its foot: rows above `from` not yet grown.
    const from = reveal ? reveal.from : 0;
    const glow = reveal?.bright ?? false;
    this.surface.overlay(still, from);
    if (tree.seedling) {
      // The last of the sun finds the seedling: a soft pool to lead the eye to it.
      this.light.pool(tree.foot.x, tree.foot.y - 5, 20, 2.6, 1.3);
      const frame = tree.seedling[swayIndex(t, 3.6, 0, 3)] ?? tree.seedling[0];
      if (frame) this.surface.blit(frame, tree.foot.x - Math.floor(frame.w / 2), tree.foot.y - frame.h + 1);
      // First light: two motes keep the seedling company, drifting round it and twinkling.
      for (let i = 0; i < 2; i++) {
        const a = t * 0.5 + i * Math.PI;
        const b = 0.5 + 0.5 * Math.sin(t * 2.3 + i * 2);
        if (b < 0.35) continue;
        const x = Math.round(tree.foot.x + Math.cos(a) * (11 + i * 2));
        const y = Math.round(tree.top - 2 + Math.sin(a * 1.3) * 4 + i * 5);
        this.surface.set(x, y, ix(R.GLOW, b > 0.8 ? 7 : 6));
        if (b > 0.85) {
          this.surface.set(x + 1, y, ix(R.GLOW, 4));
          this.surface.set(x - 1, y, ix(R.GLOW, 4));
        }
        this.light.pool(x, y, 5, 1.4, 1);
      }
    } else {
      tree.lanterns.forEach((l, i) => {
        // A short cord and a small lantern, glowing on its own slow beat.
        const b = 0.75 + 0.25 * Math.sin(t * 1.1 + i * 2.3);
        for (let k = 0; k < 4; k++) this.surface.set(l.x, l.y + k, ix(R.METAL, 1));
        this.surface.rect(l.x - 1, l.y + 4, 3, 1, ix(R.METAL, 3));
        this.surface.rect(l.x - 1, l.y + 5, 3, 2, ix(R.GLOW, b > 0.8 ? 6 : 5));
        this.surface.set(l.x, l.y + 5, ix(R.GLOW, 7));
        this.surface.rect(l.x - 1, l.y + 7, 3, 1, ix(R.METAL, 2));
        this.light.pool(l.x, l.y + 6, 9 * b, 2, 1);
      });
      const groot = st.groot ? grootDrink(st.groot, real) : null;
      for (const p of tree.pads) {
        if (p.back) continue;
        if (p.box.y1 < from) continue;
        const sway = Math.round(
          Math.sin((t / 4.6) * Math.PI * 2 + p.phase * 0.35 + (tree.foot.y - p.box.y0) * 0.02) * p.sway * 0.9,
        );
        const b = breath(st.effects, real, p.box.y0, tree.foot.y, tree.top, groot?.drinkAt);
        const pop = reveal && reveal.edge >= 0 && p.box.y0 < reveal.edge + 6 && p.box.y1 > reveal.edge - 2 ? 1 : 0;
        const a = st.pruned.has(p.id) ? p.pruned : p.art;
        const lit = b.bright || pop > 0 || glow;
        this.surface.blit(a.sprite, a.ox + sway, a.oy - b.lift - pop, lit ? { map: this.brighter } : {});
      }
    }
    if (st.levelUp) drawGrowth(this.surface, this.light, tree, st.levelUp, real);
    if (st.cone10) drawCone10World(this.surface, st.cone10, real, tree);
  }

  private renderSheet(out: Uint32Array, hudOut: Uint32Array): void {
    const s = this.surface;
    s.rect(0, 0, this.W, this.H, ix(R.SKY1, 2));
    s.rect(0, this.H / 2, this.W, this.H / 2, ix(R.MOSS, 2));
    let x = 2;
    let y = 2;
    for (const [, sp] of SHEET) {
      if (x + sp.w > this.W - 2) {
        x = 2;
        y += 22;
      }
      s.blit(sp, x, y);
      x += sp.w + 3;
    }
    this.light.clear();
    compose(s, this.light, this.now.lut, out);
    const c = new Canvas(out, this.W, this.H);
    TOOLS.forEach((tool, i) => drawToolIcon(c, tool, 4 + i * 20, this.H - 20));
    new Canvas(hudOut, this.hud.W, this.hud.H).clear();
  }

  private overHud(x: number, y: number): boolean {
    const bar = hudLayout(this.hud.W, this.hud.H).bar;
    return y >= bar.y - 2 && x >= bar.x - 2 && x <= bar.x + bar.w + 2;
  }

  pointer(world: Point | null, hudPoint: Point | null, kind: "down" | "hover" | "drag" | "leave", t: number): void {
    const st = this.state;
    if (kind === "leave" || !world || !hudPoint) {
      st.hover = null;
      st.hudHover = null;
      return;
    }
    st.hover = world;
    st.hudHover = hudPoint;
    if (kind !== "down") return;
    const { x, y } = world;
    // A reveal in progress: once the card is up, a tap keeps the spirit.
    if (st.cone) {
      if (coneLook(st.cone, t).cardOpen && st.cone.closedAt === null) {
        st.cone.closedAt = t;
        st.spentCone = true;
      }
      return;
    }
    if (st.cone10) return;
    const slot = hudLayout(this.hud.W, this.hud.H).slots.find(
      (s) => hudPoint.x >= s.x && hudPoint.x < s.x + s.w && hudPoint.y >= s.y && hudPoint.y < s.y + s.h,
    );
    if (slot) {
      st.tool = st.tool === slot.tool ? null : slot.tool;
      return;
    }
    if (coneHit(this.L, x, y)) return this.openCone(t);
    if (near(x, y, this.L.squirrel.x, this.L.squirrel.y - 7, 9)) {
      st.squirrelHop = t;
      return;
    }
    if (near(x, y, this.L.crab.x, this.L.crab.y - 5, 10)) {
      st.crabParty = t;
      return;
    }
    if (st.tool) this.care(st.tool, x, y, t);
  }

  key(key: string, t: number): void {
    const n = Number(key);
    if (n >= 1 && n <= TOOLS.length) {
      const tool = TOOLS[n - 1] ?? null;
      this.state.tool = this.state.tool === tool ? null : tool;
    } else if (key === "Escape") this.state.tool = null;
    else if (key === "c") this.openCone(t);
    else if (key === "g") this.state.groot = { t0: t, count: 3, bloomFrom: this.state.bloom };
  }

  private openCone(t: number): void {
    const st = this.state;
    if (st.cone) return;
    if (st.freeCones > 0) st.freeCones--;
    else st.leaf = Math.max(0, st.leaf - CONE_PRICE);
    const rank = this.params.scene === "cone" ? this.params.rank : rollRank(Math.random());
    st.cone = { t0: t, rank, verdant: Math.random() < 0.04, closedAt: null };
    this.recolour();
  }

  private care(tool: Tool, x: number, y: number, t: number): void {
    const st = this.state;
    const tree = this.now.tree;
    const crown = tree.crown;
    const onTree = x >= crown.x0 - 2 && x <= crown.x1 + 2 && y >= crown.y0 - 4 && y <= tree.foot.y + 2;
    if (!onTree) return;
    let pad: CareEffect["pad"];
    if (tool === "shears") {
      const hit = tree.pads.toReversed().find((p) => !p.back && padHit(p, st.pruned.has(p.id), x, y));
      if (!hit || st.pruned.has(hit.id)) return;
      pad = hit.box;
      st.pruned.add(hit.id);
      st.savePruned();
    }
    if (st.charges <= 0) {
      st.chargeFlashAt = t;
      return;
    }
    st.charges--;
    st.effects.push({ tool, t0: t, x, y, ...(pad ? { pad } : {}) });
    st.bloom++;
    if (st.bloom >= BLOOM_MAX) {
      st.bloom = 0;
      st.freeCones++;
      st.bloomFlashAt = t;
    }
  }
}

/** Lays the cast's surface over the composed frame, through the cast's own colour table and the warm light. */
function layCast(cast: Surface, light: Light, lut: Lut, out: Uint32Array): void {
  const { data } = cast;
  const tables = lut.levels;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] ?? 0;
    if (v) out[i] = tables[light.data[i] ?? 0]?.[v] ?? 0;
  }
}

/** A soft oval of shade where a companion sits, so it rests on the ground rather than floats. */
function contactShadow(s: Surface, cx: number, cy: number, rx: number): void {
  for (let dx = -rx; dx <= rx; dx++) {
    const edge = Math.abs(dx) > rx - 2;
    s.set(cx + dx, cy, ix(R.SOIL, edge ? 1 : 0));
    if (!edge) s.set(cx + dx, cy - 1, ix(R.SOIL, 1));
  }
}

const near = (x: number, y: number, cx: number, cy: number, r: number): boolean =>
  Math.abs(x - cx) <= r && Math.abs(y - cy) <= r;

/** A stepped sway: rest, lean one way, rest, lean the other, as pixel animation is drawn. */
function swayIndex(t: number, period: number, phase: number, frames: number): number {
  const u = ((((t + phase) / period) % 1) + 1) % 1;
  if (frames === 3) return u < 0.25 ? 0 : u < 0.5 ? 1 : u < 0.75 ? 0 : 2;
  if (frames === 4) return Math.floor(u * 4) % 4;
  return Math.floor(u * frames) % frames;
}

function drawSway(s: Surface, p: Placed, t: number): void {
  const frame = p.frames[swayIndex(t, p.period, p.phase, p.frames.length)] ?? p.frames[0];
  if (frame) s.blit(frame, p.x, p.y);
}
