/**
 * The player's glade: the welcome's forest with the member's own tree in its clearing, played from
 * the art bundle (`../../bundle/`). Each frame is the clearing's loop for the season and the light,
 * the member's tree stamped on it (the sprite for its level and their variant, drawn at twice the
 * welcome's pixel density), the glade's moments drawn over both in the welcome's vocabulary, and the
 * near layer put back in front; the HUD lies over it on its own grid.
 *
 * The picture is a fixed 256x144, shown at a whole number of device pixels per tree pixel
 * (`bundle/fit.ts`), so every pixel of the clearing is a whole block of them: fitted and centred on
 * a wide screen, a vertical crop centred on the tree on a phone. It no longer zooms with the level.
 */

import type { Mask, Pixels } from "../../bundle/art.ts";
import { fitPicture } from "../../bundle/fit.ts";
import { fill, type GladePick, type Manifest, pickGlade } from "../../bundle/manifest.ts";
import { type Ambiance, Ink, packHex } from "../../bundle/palette.ts";
import { edgeColour, Picture } from "../../bundle/picture.ts";
import { castFrame } from "../../bundle/vocabulary.ts";
import { between, type Grid } from "../../engine/view.ts";
import type { Params, Tool } from "../../game/params.ts";
import { BLOOM_MAX, CHARGE_MAX, CHARGE_SECONDS } from "../../game/rules.ts";
import { spiritForRank } from "../../game/spirits.ts";
import { STAGE_TITLE, stageOf } from "../../game/stages.ts";
import { care, groot, type GroveState, warmCones } from "../../game/state.ts";
import { Canvas, drawHud, drawPopup, drawToast, drawToolIcon, hudLayout, popupSize, TOOLS } from "../../ui/hud.ts";
import { beatOf, type ConeEvent, coneLook, drawConeCard } from "../reveal/cone.ts";
import { cone10Done, type Cone10Event, cone10Of, drawCone10, drawCone10World, makeCone10 } from "../reveal/cone10.ts";
import { type App, lightOf, type Opening, type PointerKind, type Scene, type Screen } from "../scene.ts";
import { CARE_LENGTH, type CareEffect, drawCareTool, drawCareWorld } from "./care.ts";
import { drawGrootWorld, grootDrink, type GrootEvent, grootPopup, grootPopupOpen } from "./groot.ts";
import { drawLevelUp, ggPopup, ggPopupOpen, type LevelUpEvent, levelUpOver, shownLevel } from "./levelup.ts";
import { coneHit, drawAurora, drawRestingCone, drawReveal, drawRevealScreen } from "./reveal.ts";
import { crown, type Fx, type Places, places, type Point, tapsTree, treeMask, type TreeShape } from "./stage.ts";

const GREETING = "I hope you have a moderately excellent next 14 hours.";

/** Rows of the picture above this stay clear of the hotbar: the tree's foot and the resting cone. */
const CLEAR_ROW = 133;
/** The picture's size and the tree's foot before the manifest is in (the bundle's own). */
const PICTURE = { w: 256, h: 144, footX: 116, density: 2 };
/** The page round the picture before its first frame is in: the HUD's dark. */
const DARK = "#150f0d";

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

export class GladeScene implements Scene {
  readonly id = "glade";
  readonly cursor = "pointer";
  private readonly app: App;
  private readonly params: Params;
  private readonly m: Moments;
  private pic = new Picture(PICTURE.w, PICTURE.h, PICTURE.density);
  private world: Grid = { W: 1, H: 1, scale: 1, offX: 0, offY: 0, dpr: 1 };
  private hud: Grid = { W: 1, H: 1, scale: 1, offX: 0, offY: 0, dpr: 1 };
  /** The first buffer column on screen (a phone shows a crop), in the tree's fine pixels. */
  private cropX = 0;
  private narrow = false;
  private ink: Ink;
  private light: Ambiance;
  private lightCheckedAt = -99;
  private edge: { path: string; colour: string } | null = null;
  private lastT = 0;

  constructor(app: App) {
    this.app = app;
    this.params = app.params;
    const p = app.params;
    this.m = new Moments(p, app.store.state.leaf);
    this.light = this.lightNow();
    this.ink = new Ink(this.light);
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
    if (p.care) this.stillCare(p.care);
  }

  // -------------------------------------------------------------------------------------------
  // Where it sits.

  private get manifest(): Manifest | null {
    return this.app.art.manifest.value;
  }

  grid(s: Screen): Grid {
    const man = this.manifest;
    // The world's grid is the tree's: a whole number of device pixels to each of its fine pixels.
    const k = this.density;
    const fit = fitPicture({
      devW: s.devW,
      devH: s.devH,
      picW: (man?.width ?? PICTURE.w) * k,
      picH: (man?.height ?? PICTURE.h) * k,
      phone: s.phone,
      hudScale: s.hud.scale,
      hud: !this.params.bare,
      focusX: (man?.glade.foot.x ?? PICTURE.footX) * k,
      clearRow: CLEAR_ROW * k,
    });
    this.cropX = fit.cropX;
    this.narrow = s.phone;
    return { W: fit.W, H: fit.H, scale: fit.scale, offX: fit.offX, offY: fit.offY, dpr: s.dpr };
  }

  layoutKey(): string {
    const man = this.manifest;
    return man ? `${man.width}x${man.height}@${man.glade.foot.x}x${man.glade.density}` : "";
  }

  pageColour(): string {
    return this.edge?.colour ?? DARK;
  }

  resize(world: Grid, hud: Grid): void {
    this.world = world;
    this.hud = hud;
    const man = this.manifest;
    if (man && (this.pic.W !== man.width || this.pic.H !== man.height || this.pic.density !== man.glade.density))
      this.pic = new Picture(man.width, man.height, man.glade.density);
  }

  /** Tree pixels per picture pixel. */
  private get density(): number {
    return this.manifest?.glade.density ?? PICTURE.density;
  }

  /** A picture point in the world grid's pixels, then the HUD's. */
  private toHud(p: Point): Point {
    const k = this.density;
    return between(this.world, this.hud, { x: p.x * k - this.cropX, y: p.y * k });
  }

  // -------------------------------------------------------------------------------------------
  // The loop for the tree.

  /** The light by the member's clock, unless `?time=` says (`day` is dusk). */
  private lightNow(): Ambiance {
    return lightOf(this.params);
  }

  private pickFor(man: Manifest, level: number): GladePick {
    const p = this.params;
    return pickGlade(man.glade, { level, seed: p.seed, season: p.season, ambiance: this.light });
  }

  private placesOf(man: Manifest): Places {
    const g = man.glade;
    return places(g.foot, g.hearth, g.cone, g.ground, this.narrow);
  }

  private treeOf(man: Manifest, pick: GladePick): TreeShape {
    const sprite = this.app.art.image(pick.treePath).value;
    const mask: Mask | null = sprite ? treeMask(sprite, pick.at, man.glade.density, man.width, man.height) : null;
    return { level: pick.level, box: pick.box, foot: man.glade.foot, mask };
  }

  // -------------------------------------------------------------------------------------------
  // The frame.

  render(t: number, out: Uint32Array, hudOut: Uint32Array, fonts: boolean): void {
    this.tick(t);
    const m = this.m;
    const art = this.app.art;
    const man = this.manifest;
    const pic = this.pic;
    const look = m.cone ? coneLook(m.cone, t) : null;
    if (look?.done) m.cone = null;
    // Yggdrasil stops the world: the loop holds still while it opens.
    const tw = look ? look.worldT : t;
    if (t - this.lightCheckedAt > 10) {
      this.lightCheckedAt = t;
      const light = this.lightNow();
      if (light !== this.light) {
        this.light = light;
        this.ink = new Ink(light);
      }
    }

    let pick: GladePick | null = null;
    let frameIndex = 0;
    if (man) {
      pick = this.pickFor(man, m.shownLevel(this.params.level, t));
      const after = m.levelUp ? this.pickFor(man, m.levelUp.to) : null;
      const next = after && after.level !== pick.level ? after : null;
      art.keep([pick.loopPath]);
      // The next level's tree, ready by the swap.
      if (next) art.image(next.treePath);
      const loop = art.loop(pick.loopPath).value;
      const sprite = art.image(pick.treePath).value;
      if (loop && sprite) {
        frameIndex = loop.indexAt(tw * 1000);
        const frame = loop.frame(frameIndex, performance.now() + 4, () => performance.now());
        if (frame) {
          pic.begin(frame);
          // The member's tree, on its own finer grid, in front of the clearing and behind everything else.
          pic.stamp(sprite, pick.at.x, pick.at.y);
          if (this.edge?.path !== pick.loopPath)
            this.edge = { path: pick.loopPath, colour: edgeColour(frame, loop.width, loop.height) };
        }
      }
    }
    if (!man || !pick || !pic.ready) {
      pic.blank(packHex(this.pageColour()));
      pic.blit(out, this.world.W, this.world.H, this.cropX);
      this.renderHud(t, hudOut, fonts, null);
      return;
    }

    const fx: Fx = {
      pic,
      ink: this.ink,
      tree: this.treeOf(man, pick),
      season: pick.season,
      ambiance: pick.ambiance,
      ground: man.glade.ground,
      places: this.placesOf(man),
      cast: art.cast.value,
      props: art.props.value,
      front: art.mask(man.glade.front).value,
    };
    // A still's care (`?care=`) is aimed at the crown's lit shoulder once the tree is known.
    for (const e of m.effects)
      if (e.x < 0) {
        const c = crown(fx.tree);
        e.x = Math.round(c.x + c.w * 0.62);
        e.y = Math.round(c.y + c.h * 0.3);
      }
    const aurora = this.aurora(man, pick, t);
    if (m.cone10 && aurora)
      drawAurora(fx, aurora, frameIndex, { strength: Math.min(1, (t - m.cone10.t0) / 1.2), span: 140, gold: false });
    this.drawCompanion(fx, tw);
    if (m.cone && look) drawReveal(fx, m.cone, look, t, aurora, frameIndex);
    else drawRestingCone(fx);
    if (m.levelUp) drawLevelUp(fx, m.levelUp, t);
    for (const e of m.effects) drawCareWorld(fx, e, t);
    if (m.groot) drawGrootWorld(fx, m.groot, t);
    if (m.cone10) drawCone10World(fx, m.cone10, t);
    // The near layer back in front of everything drawn in the world.
    pic.restore(art.mask(fill(man.glade.near, { season: pick.season })).value);
    // What stands over the world: the reveal's dark and flash, the tools in hand.
    if (m.cone && look) drawRevealScreen(pic, fx.places, look, m.cone.rank);
    if (m.effects.length > 0) {
      // The tools are drawn in picture pixels on a copy of the picture, and what they changed comes back.
      const before = pic.coarse();
      const after = before.slice();
      const wc = new Canvas(after, pic.W, pic.H);
      for (const e of m.effects) drawCareTool(wc, e, t);
      pic.merge(after, before);
    }
    pic.blit(out, this.world.W, this.world.H, this.cropX, look?.shake.x ?? 0, look?.shake.y ?? 0);

    this.renderHud(t, hudOut, fonts, fx.tree);
    // Whatever time the frame leaves goes to decoding the loops ahead.
    art.idle(performance.now() + 3);
  }

  /** The welcome's aurora, fetched for a moment that needs it and let go after. */
  private aurora(man: Manifest, pick: GladePick, t: number): Pixels | null {
    const fxm = man.effects;
    if (!fxm) return null;
    const path = fill(fxm.aurora, { season: pick.season });
    const m = this.m;
    const wanted = m.cone10 !== null || (m.cone !== null && beatOf(m.cone.rank).aurora > 0 && t - m.cone.t0 > 0);
    if (!wanted) {
      this.app.art.drop(path);
      return null;
    }
    return this.app.art.image(path).value;
  }

  /** Your companion waits on the path, once the cast's sheets are in. */
  private drawCompanion(fx: Fx, t: number): void {
    const id = this.app.store.state.companion;
    if (!id) return;
    const f = castFrame(fx, [id], ["idle"], t * 1000);
    if (f) fx.pic.sprite(f, fx.places.companion.x, fx.places.companion.y);
  }

  private renderHud(t: number, hudOut: Uint32Array, fonts: boolean, tree: TreeShape | null): void {
    const m = this.m;
    const p = this.params;
    const st = this.state;
    const c = new Canvas(hudOut, this.hud.W, this.hud.H);
    c.clear();
    if (p.bare) return;
    const busy = m.cone !== null || m.cone10 !== null;
    const level = m.shownLevel(p.level, t);
    const stage = STAGE_TITLE[stageOf(level)];
    const cast = this.app.art.cast.value;
    if (!busy) {
      const grootDrank = m.groot ? grootDrink(m.groot, t) : null;
      drawHud(
        c,
        {
          leaf: Math.round(m.shownLeaf),
          bloom: grootDrank && grootDrank.bloom < BLOOM_MAX ? grootDrank.bloom : st.bloom,
          bloomMax: BLOOM_MAX,
          level,
          xp: m.levelUp && level === m.levelUp.to ? 0.04 : p.xp,
          stage,
          charges: st.charges,
          tool: m.tool,
          bloomFlash: Math.max(grootDrank?.flash ?? 0, Math.max(0, 1 - (t - m.bloomFlashAt) / 0.6)),
          chargeFlash: Math.max(0, 1 - (t - m.chargeFlashAt) / 0.6),
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
        const spec = ggPopup(m.levelUp, stage);
        drawPopup(c, spec, place(popupSize(spec, maxW).w), top, maxW, open, t);
      }
    }
    if (m.greetAt !== null && !busy && !m.levelUp && !m.groot)
      drawToast(c, GREETING, narrowHud ? 36 : 4, narrowHud ? this.hud.W - 8 : 180, t - m.greetAt);
    const man = this.manifest;
    if (m.cone && man)
      drawConeCard(c, this.toHud(this.placesOf(man).hearth), m.cone, t, cast?.portrait(m.cone.spirit) ?? null);
    if (m.cone10) {
      const box = tree ? crown(tree) : { x: 100, y: 80, w: 32, h: 40 };
      drawCone10(
        c,
        m.cone10,
        t,
        this.toHud({ x: box.x, y: box.y }),
        this.toHud({ x: box.x + box.w, y: Math.min(box.y + box.h, 120) }),
        { spriteFor: (id) => cast?.portrait(id) ?? null },
      );
      if (cone10Done(m.cone10, t)) m.cone10 = null;
    }
  }

  private get state(): GroveState {
    return this.app.store.state;
  }

  private tick(t: number): void {
    const m = this.m;
    const dt = Math.max(0, Math.min(0.25, t - this.lastT));
    this.lastT = t;
    m.effects = m.effects.filter((e) => t - e.t0 < CARE_LENGTH[e.tool]);
    if (m.levelUp && levelUpOver(m.levelUp, t) && !this.params.still) {
      // The ceremony is over; the tree stays at its new level.
      m.levelUp = null;
    }
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
  }

  // -------------------------------------------------------------------------------------------
  // Taps and keys.

  /** The tree as it stands now, or null before the bundle is in. */
  private tree(): TreeShape | null {
    const man = this.manifest;
    return man ? this.treeOf(man, this.pickFor(man, this.m.shownLevel(this.params.level, this.lastT))) : null;
  }

  /** Where things are, for a test driver (`?debug`): world points, and the HUD's first slot. */
  probe(name: "crown" | "cone" | "slot"): Point | null {
    if (name === "slot") {
      const s = hudLayout(this.hud.W, this.hud.H).slots[0];
      return s ? { x: s.x + s.w / 2, y: s.y + s.h / 2 } : null;
    }
    const man = this.manifest;
    if (!man) return null;
    const k = this.density;
    if (name === "cone") {
      const cone = this.placesOf(man).cone;
      return { x: cone.x * k - this.cropX, y: (cone.y - 4) * k };
    }
    const tree = this.tree();
    if (!tree) return null;
    const c = crown(tree);
    return { x: Math.round(c.x + c.w / 2) * k - this.cropX, y: Math.round(c.y + c.h * 0.45) * k };
  }

  /** A still of care mid-way (`?care=`): aimed at the crown, as a player would tap. */
  private stillCare(tool: Tool): void {
    const t0 = this.params.still ? this.params.t - this.params.careT : 0.5;
    this.m.effects.push({ tool, t0, x: -1, y: -1 });
  }

  busy(t: number): boolean {
    const m = this.m;
    return m.cone !== null || m.cone10 !== null || (m.levelUp !== null && t - m.levelUp.t0 < 9);
  }

  /** Plays cones opened from the banner: one by the tree, or ten falling from it. */
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
    } else this.m.cone10 = cone10Of(t + 0.3, openings);
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
    // A reveal in progress: once the card is up, a tap keeps the spirit.
    if (m.cone) {
      if (coneLook(m.cone, t).cardOpen && m.cone.closedAt === null) m.cone.closedAt = t;
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
    // The pointer comes in the world grid's fine pixels; the glade's places are in picture pixels.
    const x = Math.floor((world.x + this.cropX) / this.density);
    const y = Math.floor(world.y / this.density);
    const man = this.manifest;
    if (man && coneHit(this.placesOf(man), x, y)) return this.openCone(t);
    if (m.tool) this.care(m.tool, x, y, t, touch);
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

  /** The cone on the moss by the tree: a banked cone if there is one, otherwise one for Leaf. */
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
  }

  private care(tool: Tool, x: number, y: number, t: number, touch: boolean): void {
    const m = this.m;
    const tree = this.tree();
    if (!tree || !tapsTree(tree, x, y, touch ? 4 : 2)) return;
    const done = care(this.state);
    if (!done) {
      m.chargeFlashAt = t;
      return;
    }
    this.app.store.set(done.state);
    m.effects.push({ tool, t0: t, x, y });
    if (done.bloomed) {
      m.bloomFlashAt = t;
      this.app.say("Full Bloom! A free cone is banked.");
    }
  }
}
