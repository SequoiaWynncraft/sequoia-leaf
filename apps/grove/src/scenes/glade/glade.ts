/**
 * The player's glade: builds the still layers once, then draws each frame's life over them, and
 * answers taps. The world and the HUD are two grids: the world zooms with the tree's level (a
 * seedling's glade is close and its pixels big), the HUD does not.
 */

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
} from "../../art/life.ts";
import { SHEET } from "../../art/sprites.ts";
import { growTree, padHit, STAGE_TITLE, type Tree } from "../../art/tree.ts";
import { buildLut, ix, type Lut, PALETTE_SIZE, R, rampOf } from "../../engine/palette.ts";
import { compose, type Indices, Light, Surface } from "../../engine/raster.ts";
import { hashString } from "../../engine/rng.ts";
import { between, type Grid } from "../../engine/view.ts";
import type { Params, Tool } from "../../game/params.ts";
import { BLOOM_MAX, CHARGE_MAX, CHARGE_SECONDS } from "../../game/rules.ts";
import { spiritForRank } from "../../game/spirits.ts";
import { care, groot, type GroveState, warmCones } from "../../game/state.ts";
import { Canvas, drawHud, drawPopup, drawToast, drawToolIcon, hex, hudLayout, popupSize, TOOLS } from "../../ui/hud.ts";
import { drawAurora } from "../reveal/aurora.ts";
import {
  type ConeEvent,
  coneHit,
  coneLook,
  coneScreen,
  drawConeCard,
  drawConeWorld,
  drawRestingCone,
  rankColour,
  shakeFrame,
} from "../reveal/cone.ts";
import { cone10Done, type Cone10Event, cone10Of, drawCone10, drawCone10World, makeCone10 } from "../reveal/cone10.ts";
import type { App, Opening, PointerKind, Scene } from "../scene.ts";
import { spiritFrame } from "./actors.ts";
import { type Backdrop, drawBackdrop } from "./backdrop.ts";
import { breath, CARE_LENGTH, type CareEffect, drawCareTool, drawCareWorld } from "./care.ts";
import { drawSign, drawWanderer, placeWanderer, type Wanderer } from "./critters.ts";
import { drawGrootWorld, grootDrink, type GrootEvent, grootPopup, grootPopupOpen } from "./groot.ts";
import { buildGlade, type Glade, type Placed } from "./ground.ts";
import { artHeight, type Layout, layout, type Point } from "./layout.ts";
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

const GREETING = "I hope you have a moderately excellent next 14 hours.";

/** What outlives a resize: the moments under way, the tool in hand and the HUD's counters. */
class Moments {
  shownLeaf: number;
  chargeClock = 0;
  tool: Tool | null;
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
  /** The pointer in the HUD's grid. */
  hudHover: Point | null = null;

  constructor(params: Params, leaf: number) {
    this.shownLeaf = leaf;
    this.tool = params.tool;
    this.greetAt = params.greet ? (params.still ? 0 : 0.4) : null;
  }

  shownLevel(level: number, t: number): number {
    return this.levelUp ? shownLevel(this.levelUp, t) : level;
  }
}

/** A grown tree with its still parts painted on their own layer, and its colours. */
interface Grown {
  tree: Tree;
  still: Surface;
  lut: Lut;
}

export class GladeScene implements Scene {
  readonly id = "glade";
  readonly cursor = "pointer";
  private readonly app: App;
  private readonly params: Params;
  private readonly m: Moments;
  private view: GladeView | null = null;

  constructor(app: App) {
    this.app = app;
    this.params = app.params;
    this.m = new Moments(app.params, app.store.state.leaf);
    const p = app.params;
    const t0 = p.still ? 0 : 0.6;
    if (p.groot > 0) {
      this.m.groot = { t0, count: p.groot, bloomFrom: app.store.state.bloom };
      app.store.set(groot(app.store.state, p.groot));
    }
    if (p.levelup) this.m.levelUp = { t0, from: p.level - 1, to: p.level };
    if (p.scene === "cone10") this.m.cone10 = makeCone10(t0, p.rank, p.seed, (rank) => spiritForRank(rank).id);
    if (p.scene === "cone")
      this.m.cone = {
        t0: p.still ? p.t - p.coneT : 0.6,
        rank: p.rank,
        spirit: spiritForRank(p.rank).id,
        verdant: p.verdant,
        closedAt: null,
      };
  }

  worldRows(_devW: number, _devH: number, t: number): number {
    return this.params.sheet ? 72 : artHeight(this.m.shownLevel(this.params.level, t));
  }

  resize(world: Grid, hud: Grid, t: number): void {
    this.view = new GladeView(world, hud, this.app, this.m, t);
  }

  render(t: number, world: Uint32Array, hud: Uint32Array, fonts: boolean): void {
    this.view?.render(t, world, hud, fonts);
  }

  pointer(world: Point, hud: Point, kind: PointerKind, t: number, touch: boolean): void {
    this.view?.pointer(world, hud, kind, t, touch);
  }

  key(key: string, t: number): void {
    this.view?.key(key, t);
  }

  busy(t: number): boolean {
    const m = this.m;
    return m.cone !== null || m.cone10 !== null || (m.levelUp !== null && t - m.levelUp.t0 < 9);
  }

  /** Where things are, for a test driver (`?debug`): world points, and the HUD's first slot. */
  probe(name: "crown" | "cone" | "slot"): Point | null {
    return this.view?.probe(name) ?? null;
  }

  /** Plays cones opened from the banner: one by the fire, or ten falling from the tree. */
  play(openings: readonly Opening[], t: number): void {
    const first = openings[0];
    if (!first) return;
    if (openings.length === 1) {
      this.m.cone = {
        t0: t + 0.3,
        rank: first.rank,
        spirit: first.spirit,
        verdant: first.verdant,
        closedAt: null,
        bond: first.count,
      };
      this.view?.recolour();
    } else this.m.cone10 = cone10Of(t + 0.3, openings);
  }
}

class GladeView {
  readonly L: Layout;
  private readonly base: Surface;
  private readonly surface: Surface;
  private readonly light: Light;
  private readonly rare: Light;
  private readonly backdrop: Backdrop;
  private readonly glade: Glade;
  /** The tree as it is, and during a level-up the tree it is becoming. */
  private now: Grown;
  private next: Grown | null = null;
  private readonly seed: number;
  private readonly fireflies: Mote[];
  private readonly needles: Needle[];
  private readonly brighter: Indices;
  private readonly wanderer: Wanderer | null;
  /** Winter: a garland swagged across the crown, pad to pad, down the tree. */
  private garland: { x: number; y: number }[];
  private lastT = 0;

  private readonly world: Grid;
  private readonly hud: Grid;
  private readonly W: number;
  private readonly H: number;
  private readonly app: App;
  private readonly params: Params;
  private readonly m: Moments;

  constructor(world: Grid, hud: Grid, app: App, m: Moments, t: number) {
    this.world = world;
    this.hud = hud;
    this.W = world.W;
    this.H = world.H;
    this.app = app;
    this.params = app.params;
    this.m = m;
    const params = app.params;
    // The hotbar's panel is 36 HUD pixels tall; that much of the world is under it.
    this.L = layout(world.W, world.H, Math.ceil((36 * hud.scale) / world.scale));
    this.seed = hashString(params.seed);
    this.base = new Surface(this.W, this.H);
    this.surface = new Surface(this.W, this.H);
    this.light = new Light(this.W, this.H);
    this.rare = new Light(this.W, this.H);
    this.backdrop = drawBackdrop(this.base, this.L, params.time, this.seed);
    this.glade = buildGlade(this.base, this.L, params.time, params.season, this.seed);
    if (this.L.sign) drawSign(this.base, this.L.sign, params.season);
    const shown = m.shownLevel(params.level, t);
    this.now = this.grow(shown);
    if (m.levelUp && shown !== m.levelUp.to) this.next = this.grow(m.levelUp.to);
    this.fireflies = placeFireflies(this.L, params.time, this.seed);
    this.needles = this.placeNeedles();
    this.garland = this.placeGarland();
    this.wanderer = this.L.sign ? placeWanderer(this.L, this.seed) : null;
    // A table that lifts foliage a level, for the crown's breath.
    this.brighter = new Uint16Array(PALETTE_SIZE);
    for (let i = 0; i < PALETTE_SIZE; i++)
      this.brighter[i] = rampOf(i) === R.FOLI ? ix(R.FOLI, Math.min(7, (i & 7) + 1)) : i;
    if (params.care && m.effects.length === 0) this.stillCare(params.care);
  }

  probe(name: "crown" | "cone" | "slot"): Point {
    if (name === "cone") return this.L.cone;
    if (name === "slot") {
      const s = hudLayout(this.hud.W, this.hud.H).slots[0];
      return s ? { x: s.x + s.w / 2, y: s.y + s.h / 2 } : { x: 0, y: 0 };
    }
    const crown = this.now.tree.crown;
    return { x: Math.round((crown.x0 + crown.x1) / 2), y: Math.round(crown.y0 + (crown.y1 - crown.y0) * 0.4) };
  }

  private get state(): GroveState {
    return this.app.store.state;
  }

  private prunedKey(level: number): string {
    return `${this.params.seed}:${level}`;
  }

  private pruned(level: number): Set<number> {
    return new Set(this.state.pruned[this.prunedKey(level)] ?? []);
  }

  private grow(level: number): Grown {
    const p = this.params;
    const tree = growTree(level, p.seed, this.L.treeX, this.L.ground, p.season, this.pruned(level));
    const still = new Surface(this.W, this.H);
    tree.paintStill(still);
    return { tree, still, lut: this.lutFor(tree) };
  }

  private lutFor(tree: Tree): Lut {
    const rank = this.m.cone?.rank ?? this.params.rank;
    return buildLut(this.params.time, this.params.season, rankColour(rank), tree.gold);
  }

  /** The rarity's light needs its own colours in the palette. */
  recolour(): void {
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
    const tree = this.now.tree;
    const crown = tree.crown;
    const x = Math.round(this.L.treeX + (crown.x1 - this.L.treeX) * 0.35);
    const y = Math.round(crown.y0 + (tree.foot.y - crown.y0) * 0.3);
    const t0 = this.params.still ? this.params.t - this.params.careT : 0.5;
    const pad = tree.pads
      .toReversed()
      .find((p) => !p.back && x >= p.box.x0 && x < p.box.x1 && y >= p.box.y0 && y < p.box.y1);
    this.m.effects.push(tool === "shears" && pad ? { tool: "shears", t0, x, y, pad: pad.box } : { tool, t0, x, y });
  }

  render(t: number, out: Uint32Array, hudOut: Uint32Array, fonts: boolean): void {
    if (this.params.sheet) return this.renderSheet(out, hudOut);
    this.tick(t);
    const s = this.surface;
    const m = this.m;
    const p = this.params;
    s.copyFrom(this.base);
    this.light.clear();
    this.rare.clear();
    const look = m.cone ? coneLook(m.cone, t) : null;
    if (look?.done) m.cone = null;
    const fire = { flare: look?.flare ?? 0 };
    // Yggdrasil stops the world: everything but the cone holds still while it opens.
    const tw = look ? look.worldT : t;

    drawStars(s, this.backdrop.stars, tw);
    if (look && m.cone && look.aurora > 0) drawAurora(s, this.L, look.aurora, tw, this.seed, look.curtains);
    drawGuildLanterns(s, this.backdrop.lanterns, tw);
    drawLakeGlints(s, this.backdrop.lake, tw, p.time);
    for (const f of this.glade.ferns) drawSway(s, f, tw);
    this.drawTree(tw, t);
    drawLantern(s, this.light, this.L, tw, p.time);

    // The fire, its cone and the companions round it.
    drawFireBack(s, this.L);
    contactShadow(s, this.L.squirrel.x, this.L.squirrel.y + 1, 6);
    if (this.L.crab.x < this.W + 8) contactShadow(s, this.L.crab.x, this.L.crab.y + 1, 7);
    const sq = squirrelFrame(tw, m.squirrelHop);
    s.blit(sq.sprite, this.L.squirrel.x - 8, this.L.squirrel.y - sq.sprite.h + 1 + sq.dy);
    if (this.wanderer) drawWanderer(s, this.wanderer, tw);
    drawFlames(s, this.L, tw, fire);
    if (m.cone) drawConeWorld(s, this.light, this.rare, this.L, m.cone, t);
    else drawRestingCone(s, this.L, m.spentCone);
    drawFireFront(s, this.L);
    drawSmoke(s, this.L, tw);
    drawEmbers(s, this.L, tw, look?.embers ?? 0);
    const cr = crabFrame(tw, m.crabParty);
    s.blit(cr.sprite, this.L.crab.x - 8 + cr.dx, this.L.crab.y - cr.sprite.h + 1 + cr.dy);
    if (m.levelUp) drawHeralds(s, this.light, this.L, m.levelUp, t);

    drawNeedles(s, this.needles, tw);
    for (const e of m.effects) drawCareWorld(s, e, t);
    if (m.groot) drawGrootWorld(s, this.light, this.now.tree, m.groot, t, this.L);
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
    const rc = hex(rankColour(m.cone?.rank ?? p.rank));
    compose(s, this.light, this.now.lut, out, this.rare, rc);
    if (look && m.cone) {
      coneScreen(out, this.W, this.H, this.L, look, rankColour(m.cone.rank));
      shakeFrame(out, this.W, this.H, look.shake.x, look.shake.y);
    }
    const wc = new Canvas(out, this.W, this.H);
    for (const e of m.effects) drawCareTool(wc, e, t);

    this.renderHud(t, hudOut, fonts);
  }

  private renderHud(t: number, hudOut: Uint32Array, fonts: boolean): void {
    const m = this.m;
    const p = this.params;
    const st = this.state;
    const c = new Canvas(hudOut, this.hud.W, this.hud.H);
    c.clear();
    if (p.bare) return;
    // The level-up's flash, which covers the world opening.
    const flash = m.levelUp ? levelUpFlash(m.levelUp, t) : 0;
    if (flash > 0) c.rect(0, 0, c.W, c.H, [255, 244, 214], flash * 0.9);
    const busy = m.cone !== null || m.cone10 !== null;
    if (!busy) {
      const grootDrank = m.groot ? grootDrink(m.groot, t) : null;
      drawHud(
        c,
        {
          leaf: Math.round(m.shownLeaf),
          bloom: grootDrank && grootDrank.bloom < BLOOM_MAX ? grootDrank.bloom : st.bloom,
          bloomMax: BLOOM_MAX,
          level: m.shownLevel(p.level, t),
          xp: m.levelUp && m.shownLevel(p.level, t) === m.levelUp.to ? 0.04 : p.xp,
          stage: STAGE_TITLE[this.now.tree.stage],
          charges: st.charges,
          tool: m.tool,
          bloomFlash: Math.max(grootDrank?.flash ?? 0, Math.max(0, 1 - (t - m.bloomFlashAt) / 0.6)),
          chargeFlash: Math.max(0, 1 - (t - m.chargeFlashAt) / 0.6),
          rgb: this.now.lut.rgb,
        },
        fonts,
      );
      const h = m.hudHover;
      if (m.tool && h && !this.overHud(h.x, h.y)) drawToolIcon(c, m.tool, h.x - 3, h.y - 13, 0.9);
    }
    if (!fonts) return;
    // Popups stand at the top right, under the Leaf balance, clear of the tree; on a phone, under
    // the top row.
    const narrowHud = this.hud.W < 200;
    const top = narrowHud ? 36 : 24;
    const maxW = narrowHud ? this.hud.W - 8 : Math.min(200, Math.round(this.hud.W * 0.5));
    const place = (w: number): number => (narrowHud ? Math.floor((this.hud.W - w) / 2) : this.hud.W - w - 4);
    if (m.groot) {
      const open = grootPopupOpen(m.groot, t);
      if (open > 0) {
        const spec = grootPopup(m.groot);
        drawPopup(c, spec, place(popupSize(spec, maxW).w), top, maxW, open, t);
      }
    }
    if (m.levelUp) {
      const open = ggPopupOpen(m.levelUp, t);
      if (open > 0) {
        const spec = ggPopup(m.levelUp, STAGE_TITLE[this.now.tree.stage]);
        drawPopup(c, spec, place(popupSize(spec, maxW).w), top, maxW, open, t);
      }
    }
    if (m.greetAt !== null && !busy && !m.levelUp && !m.groot) {
      drawToast(c, GREETING, narrowHud ? 36 : 4, narrowHud ? this.hud.W - 8 : 180, t - m.greetAt);
    }
    if (m.cone) drawConeCard(c, this.toHud(this.L.fire), m.cone, t, this.now.lut.rgb);
    if (m.cone10) {
      const crown = this.now.tree.crown;
      drawCone10(
        c,
        m.cone10,
        t,
        this.toHud({ x: crown.x0, y: crown.y0 }),
        this.toHud({ x: crown.x1, y: Math.min(crown.y1, this.L.ground - 20) }),
        { spriteFor: (id) => spiritFrame(id, 0).sprite, rgb: this.now.lut.rgb },
      );
      if (cone10Done(m.cone10, t)) m.cone10 = null;
    }
  }

  /** A world point in the HUD's grid. */
  private toHud(p: Point): Point {
    return between(this.world, this.hud, p);
  }

  private tick(t: number): void {
    const m = this.m;
    const dt = Math.max(0, Math.min(0.25, t - this.lastT));
    this.lastT = t;
    m.effects = m.effects.filter((e) => t - e.t0 < CARE_LENGTH[e.tool]);
    const st = this.state;
    if (st.charges < CHARGE_MAX && !this.params.still) {
      m.chargeClock += dt;
      if (m.chargeClock > CHARGE_SECONDS) {
        m.chargeClock = 0;
        this.app.store.set({ ...st, charges: st.charges + 1 });
      }
    }
    // The balance ticks toward its value, as a counter does.
    const diff = this.state.leaf - m.shownLeaf;
    m.shownLeaf += Math.abs(diff) < 1 ? diff : diff * Math.min(1, dt * 6);
    // A level-up's new tree takes over on its flash.
    if (m.levelUp && this.next && t - m.levelUp.t0 >= LEVELUP_SWAP) {
      this.now = this.next;
      this.next = null;
      this.garland = this.placeGarland();
    }
  }

  private drawTree(t: number, real: number): void {
    const { tree, still } = this.now;
    const m = this.m;
    const reveal = m.levelUp ? treeReveal(m.levelUp, real, tree) : null;
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
      const drink = m.groot ? grootDrink(m.groot, real) : null;
      const pruned = this.pruned(tree.level);
      for (const p of tree.pads) {
        if (p.back) continue;
        if (p.box.y1 < from) continue;
        const sway = Math.round(
          Math.sin((t / 4.6) * Math.PI * 2 + p.phase * 0.35 + (tree.foot.y - p.box.y0) * 0.02) * p.sway * 0.9,
        );
        const b = breath(m.effects, real, p.box.y0, tree.foot.y, tree.top, drink?.drinkAt);
        const pop = reveal && reveal.edge >= 0 && p.box.y0 < reveal.edge + 6 && p.box.y1 > reveal.edge - 2 ? 1 : 0;
        const a = pruned.has(p.id) ? p.pruned : p.art;
        const lit = b.bright || pop > 0 || glow;
        this.surface.blit(a.sprite, a.ox + sway, a.oy - b.lift - pop, lit ? { map: this.brighter } : {});
      }
    }
    if (m.levelUp) drawGrowth(this.surface, this.light, tree, m.levelUp, real);
    if (m.cone10) drawCone10World(this.surface, m.cone10, real, tree);
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

  pointer(world: Point, hudPoint: Point, kind: PointerKind, t: number, touch: boolean): void {
    const m = this.m;
    if (kind === "leave") {
      m.hudHover = null;
      return;
    }
    m.hudHover = touch ? null : hudPoint;
    if (kind !== "down") return;
    const { x, y } = world;
    // A reveal in progress: once the card is up, a tap keeps the spirit.
    if (m.cone) {
      if (coneLook(m.cone, t).cardOpen && m.cone.closedAt === null) {
        m.cone.closedAt = t;
        m.spentCone = true;
      }
      return;
    }
    if (m.cone10) {
      // Once every card is in the grid, a tap puts it away; the book has them all.
      if (t - m.cone10.t0 > 9) m.cone10 = null;
      return;
    }
    const lay = hudLayout(this.hud.W, this.hud.H, Math.round(m.shownLeaf).toLocaleString("en-US"));
    const inBox = (b: { x: number; y: number; w: number; h: number }): boolean =>
      hudPoint.x >= b.x && hudPoint.x < b.x + b.w && hudPoint.y >= b.y && hudPoint.y < b.y + b.h;
    const slot = lay.slots.find(inBox);
    if (slot) {
      m.tool = m.tool === slot.tool ? null : slot.tool;
      return;
    }
    // The level badge opens your rings; the Leaf balance opens Cinfy's Treasury.
    if (inBox({ x: lay.badge.x, y: lay.badge.y, w: lay.topLeftRight - lay.badge.x, h: 24 }))
      return this.app.go("rings");
    if (inBox(lay.leaf)) return this.app.go("shop");
    if (this.overHud(hudPoint.x, hudPoint.y)) return;
    if (coneHit(this.L, x, y)) return this.openCone(t);
    if (near(x, y, this.L.squirrel.x, this.L.squirrel.y - 7, 9)) {
      m.squirrelHop = t;
      return;
    }
    if (near(x, y, this.L.crab.x, this.L.crab.y - 5, 10)) {
      m.crabParty = t;
      return;
    }
    if (m.tool) this.care(m.tool, x, y, t);
  }

  key(key: string, t: number): void {
    const n = Number(key);
    const m = this.m;
    if (n >= 1 && n <= TOOLS.length) {
      const tool = TOOLS[n - 1] ?? null;
      m.tool = m.tool === tool ? null : tool;
    } else if (key === "Escape") m.tool = null;
    else if (key === "c") this.openCone(t);
    else if (key === "g") {
      m.groot = { t0: t, count: 3, bloomFrom: this.state.bloom };
      this.app.store.set(groot(this.state, 3));
    }
  }

  /** The cone on its stone by the fire: a banked cone if there is one, otherwise one for Leaf. */
  private openCone(t: number): void {
    if (this.m.cone || this.m.cone10) return;
    const opened = warmCones(this.state, 1, Math.random);
    const pull = opened?.pulls[0];
    if (!opened || !pull) {
      this.app.say("Treasury@seqwawa regrets to inform you: more Leaf needed.");
      return;
    }
    this.app.store.set(opened.state);
    this.m.cone = {
      t0: t,
      rank: pull.rank,
      spirit: pull.spirit,
      verdant: pull.verdant,
      closedAt: null,
      bond: pull.count,
    };
    this.recolour();
  }

  private care(tool: Tool, x: number, y: number, t: number): void {
    const m = this.m;
    const tree = this.now.tree;
    const crown = tree.crown;
    const onTree = x >= crown.x0 - 2 && x <= crown.x1 + 2 && y >= crown.y0 - 4 && y <= tree.foot.y + 2;
    if (!onTree) return;
    let pad: CareEffect["pad"];
    let prunedId: number | null = null;
    if (tool === "shears") {
      const pruned = this.pruned(tree.level);
      const hit = tree.pads.toReversed().find((p) => !p.back && padHit(p, pruned.has(p.id), x, y));
      if (!hit || pruned.has(hit.id)) return;
      pad = hit.box;
      prunedId = hit.id;
    }
    const done = care(this.state);
    if (!done) {
      m.chargeFlashAt = t;
      return;
    }
    let next = done.state;
    if (prunedId !== null) {
      const key = this.prunedKey(tree.level);
      next = { ...next, pruned: { ...next.pruned, [key]: [...(next.pruned[key] ?? []), prunedId] } };
    }
    this.app.store.set(next);
    m.effects.push({ tool, t0: t, x, y, ...(pad ? { pad } : {}) });
    if (done.bloomed) {
      m.bloomFlashAt = t;
      this.app.say("Full Bloom! A free cone is banked.");
    }
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
