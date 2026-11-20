/**
 * The Forest, the guild's valley round the Great Sequoia, composed from the art bundle's still
 * parallax layers (grove/forest.py) the way the welcome renderer composes a frame:
 *
 *   1. the far valley and its sky (opaque), at depth 0.35, and a war's pennant on its ridge;
 *   2. the ground at depth 1: the floor, the Great Sequoia at the heart with the lanterns hung in
 *      its canopy, the crab pond and the "Do Not The Farm" sign at the gate;
 *   3. the members' trees from the row atlases, the back row then the front, each on its spot;
 *   4. the crabs, the moments and the ambient life, in the welcome's vocabulary (`moments.ts`);
 *   5. the near ferns and the welcome's giant trunks at depth 1.3, over everything;
 *   6. falling leaves and snow, then the HUD on its own grid (`hud.ts`).
 *
 * The picture is the bundle's 256x144 at a whole-pixel scale (`bundle/fit.ts`); a phone shows a
 * crop of it, and its crop slides on past the camera's range so it reaches the valley's ends
 * (`valley.ts`). Drag or swipe to pan; tap a tree, the Great Sequoia, its hollow, the pond, a crab
 * or the sign.
 */

import type { Pixels } from "../../bundle/art.ts";
import { fitPicture } from "../../bundle/fit.ts";
import { type AtlasBox, fill, type ForestManifest, type Manifest, type Rect } from "../../bundle/manifest.ts";
import { type Ambiance, Ink, packHex } from "../../bundle/palette.ts";
import { edgeColour, Picture } from "../../bundle/picture.ts";
import { castFrame } from "../../bundle/vocabulary.ts";
import { between, type Grid, type Point } from "../../engine/view.ts";
import type { EventKind, Params } from "../../game/params.ts";
import { waterFriend } from "../../game/state.ts";
import { Canvas, mix, UI } from "../../ui/hud.ts";
import { type App, lightOf, type PointerKind, type Scene, type Screen } from "../scene.ts";
import { playerHead } from "./heads.ts";
import { drawHud, type FeedIcon, type HudHits, type HudModel, inside, type Tooltip } from "./hud.ts";
import {
  clamp01,
  type Crab,
  crabPose,
  drawDew,
  drawFallingLeaves,
  drawFireflies,
  drawLantern,
  drawPennant,
  drawRaid,
  drawRave,
  drawSeq,
  drawSkyLanterns,
  drawSnow,
  drawWatering,
  ease,
  type Firefly,
  lanternAt,
  LENGTH,
  lightTree,
  placeCrabs,
  placeFireflies,
  raidCamera,
  type RaidSetup,
  raidShimmer,
  type Stage,
  warCamera,
} from "./moments.ts";
import { type Member, ROSTER, stageLabel } from "./roster.ts";
import { layerOffset, look, lookRange, plant, type Planted, toGround, toPicture } from "./valley.ts";

/** The picture's size before the manifest is in (the bundle's own). */
const PICTURE = { w: 256, h: 144 };
/** The page round the picture before its first frame: the HUD's dark. */
const DARK = "#150f0d";
/** How many lanterns already hang in the Great Sequoia this week. */
const WEEK_LANTERNS = 3;

type PlaceId = "great" | "hollow" | "pond" | "no8" | "farm";
type Target = { kind: "tree"; id: number } | { kind: "place"; id: PlaceId };

interface Moment {
  kind: EventKind;
  t0: number;
  /** Where the camera was looking when it began. */
  from: number;
}

interface Feed {
  icon: FeedIcon;
  text: string;
  short: string;
  detail: string;
  ago: string;
  at: number;
}

/** A tree as it stands this frame: its atlas box, and where its box's corner is on the ground. */
interface Standing {
  id: number;
  planted: Planted<Member>;
  atlas: Pixels;
  box: AtlasBox;
  /** Ground x of its box's left edge, and its box's top row. */
  left: number;
  top: number;
}

export class Forest implements Scene {
  readonly id = "forest";
  cursor: "grab" | "grabbing" | "pointer" = "grab";
  private readonly app: App;
  private readonly params: Params;
  private pic = new Picture(PICTURE.w, PICTURE.h);
  private world: Grid = { W: 1, H: 1, scale: 1, offX: 0, offY: 0, dpr: 1 };
  private hudGrid: Grid = { W: 1, H: 1, scale: 1, offX: 0, offY: 0, dpr: 1 };
  /** The columns on screen: the whole picture, or a phone's crop of it. */
  private shown = PICTURE.w;
  /** The ground x at the screen's middle, and the camera and crop it makes. */
  private at = 512;
  private cx = 512;
  private cropX = 0;
  private placed = false;
  private vx = 0;
  private target: number | null = null;
  private lastT = 0;
  private drag: { x: number; at: number; moved: number; lastX: number; lastT: number } | null = null;
  private hover: Point | null = null;
  private hudHover: Point | null = null;
  private pinned: Target | null = null;
  hits: HudHits = { find: null, action: null, debug: [], panels: [] };
  private moment: Moment | null = null;
  private cameraFree = false;
  private rave: boolean;
  private warDone = false;
  private feed: Feed = {
    icon: "raid",
    text: "Party of 4 cleared TCC",
    short: "TCC cleared",
    detail: "Party of 4",
    ago: "2m",
    at: -99,
  };
  private splashes: { id: number; t0: number }[] = [];
  private meAt = -99;
  private crabHop = new Map<number, number>();
  /** Lanterns hung by raids since the page opened, by hook. */
  private hung: number[] = [];
  private light: Ambiance;
  private ink: Ink;
  private lightCheckedAt = -99;
  private edge: { key: string; colour: string } | null = null;
  private hudKey = "";
  private hudBuffer: ArrayBufferLike | null = null;
  // Worked out once the manifest and the ground layer are in.
  private trees: Planted<Member>[] = [];
  private crabs: Crab[] = [];
  private fireflies: Firefly[] = [];
  private ground: Pixels | null = null;
  private raidCache: RaidSetup | null = null;
  private standing: Standing[] = [];

  constructor(app: App) {
    this.app = app;
    const params = app.params;
    this.params = params;
    this.rave = params.anniversary;
    this.light = lightOf(params);
    this.ink = new Ink(this.light);
    if (params.event) {
      const et = Math.max(0, params.et);
      this.startMoment(params.event, params.still ? params.t - et : params.et >= 0 ? -et : 0.6);
    }
    if (this.rave) this.feed = birthday(-99);
  }

  // -------------------------------------------------------------------------------------------
  // Where it sits.

  private get manifest(): Manifest | null {
    return this.app.art.manifest.value;
  }

  private get forest(): ForestManifest | null {
    return this.manifest?.forest ?? null;
  }

  private get view(): number {
    return this.manifest?.width ?? PICTURE.w;
  }

  grid(s: Screen): Grid {
    const man = this.manifest;
    // No hotbar here: the picture fills the screen, and a phone keeps room under it for the button.
    const fit = fitPicture({
      devW: s.devW,
      devH: s.devH,
      picW: man?.width ?? PICTURE.w,
      picH: man?.height ?? PICTURE.h,
      phone: s.phone,
      hudScale: s.hud.scale,
      hud: s.phone && !this.params.bare,
      focusX: (man?.width ?? PICTURE.w) / 2,
      clearRow: man?.height ?? PICTURE.h,
    });
    this.shown = fit.W;
    return { W: fit.W, H: fit.H, scale: fit.scale, offX: fit.offX, offY: fit.offY, dpr: s.dpr };
  }

  layoutKey(): string {
    const man = this.manifest;
    return man ? `${man.width}x${man.height}:${man.forest ? "forest" : ""}` : "";
  }

  pageColour(): string {
    return this.edge?.colour ?? DARK;
  }

  resize(world: Grid, hud: Grid): void {
    this.world = world;
    this.hudGrid = hud;
    const man = this.manifest;
    if (man && (this.pic.W !== man.width || this.pic.H !== man.height)) this.pic = new Picture(man.width, man.height);
    this.lookAt(this.at);
  }

  busy(): boolean {
    return this.moment !== null;
  }

  /** Points the screen's middle at ground x `at`, kept inside the valley. */
  private lookAt(at: number): void {
    const f = this.forest;
    const valley = f?.width ?? 1024;
    const [lo, hi] = lookRange(Math.min(this.shown, this.view), valley);
    this.at = Math.max(lo, Math.min(hi, at));
    const l = look(this.at, this.shown, valley, this.view);
    this.cx = l.cx;
    this.cropX = l.cropX;
  }

  /** The first time the manifest is in: who stands where, and where the camera starts. */
  private settle(f: ForestManifest): void {
    if (this.placed) return;
    this.placed = true;
    this.trees = plant(ROSTER, f.spots);
    this.crabs = placeCrabs(f.crabs);
    this.fireflies = placeFireflies(f.width, 30);
    const p = this.params;
    let at = this.rave ? f.pond : f.heart;
    const named = p.at ? placeX(p.at, f) : null;
    if (named !== null) at = named;
    if (p.tip) {
      const id = this.trees.findIndex((tr) => tr.member.name.toLowerCase() === p.tip?.toLowerCase());
      if (id >= 0) {
        this.pinned = { kind: "tree", id };
        if (named === null) at = this.trees[id]?.x ?? at;
      }
    }
    if (p.look && isPlace(p.look)) this.pinned = { kind: "place", id: p.look };
    this.lookAt(at);
  }

  // -------------------------------------------------------------------------------------------
  // The frame.

  render(t: number, out: Uint32Array, hudOut: Uint32Array, fonts: boolean): void {
    if (t - this.lightCheckedAt > 10) {
      this.lightCheckedAt = t;
      const light = lightOf(this.params);
      if (light !== this.light) {
        this.light = light;
        this.ink = new Ink(light);
      }
    }
    const f = this.forest;
    if (f) this.settle(f);
    this.tick(t);
    const pic = this.pic;
    const art = this.app.art;
    const season = f ? this.seasonNow(f) : "normal";
    const ambiance = f ? this.ambianceNow(f) : "dusk";
    const img = (layer: string): Pixels | null =>
      f ? art.image(fill(f.layer, { layer, season, ambiance })).value : null;
    const far = img("far");
    const ground = img("ground");
    const near = img("near");
    if (!f || !far || !ground) {
      pic.blank(packHex(DARK));
      pic.blit(out, this.world.W, this.world.H, 0);
      this.renderHud(t, hudOut, fonts, null);
      return;
    }
    this.ground = ground;

    const view = this.view;
    const cx = this.cx;
    const stage: Stage = {
      pic,
      ink: this.ink,
      cast: art.cast.value,
      props: art.props.value,
      season,
      ambiance,
      view,
      mid: this.cropX + this.shown / 2,
      at: (x, depth = 1) => toPicture(x, cx, view, depth),
    };
    const m = this.moment;
    const e = m ? t - m.t0 : -1;

    // 1. The far valley, and a war's pennant on its ridge.
    pic.layer(far, layerOffset(cx, f.layers.far.depth, view), true);
    if (m?.kind === "war") drawPennant(stage, f.ridge, e, t, f.layers.far.depth);
    else if (this.warDone) drawPennant(stage, f.ridge, 99, t, f.layers.far.depth);

    // 2. The ground, and the lanterns in the Great Sequoia.
    pic.layer(ground, layerOffset(cx, 1, view));
    const hooks = f.hooks;
    for (let i = 0; i < Math.min(WEEK_LANTERNS, hooks.length); i++) {
      const h = hooks[i * 2 + 1] ?? hooks[i];
      if (h) drawLantern(stage, h, t);
    }
    for (const i of this.hung) {
      const h = hooks[i];
      if (h) drawLantern(stage, h, t);
    }

    // 3. The members' trees, back row then front, each lit when it is the focus or in a raid.
    this.standing = [];
    const glow = this.glowing(t, e);
    for (const row of f.rows) {
      const atlas = art.image(fill(f.trees, { row: row.name, season, ambiance })).value;
      const index = f.index.get(season)?.get(row.name);
      if (!atlas || !index) continue;
      const mine = this.trees
        .map((p, id) => ({ p, id, box: index.get(p.key) }))
        .filter((x): x is { p: Planted<Member>; id: number; box: AtlasBox } => x.p.row === row.name && !!x.box)
        .toSorted((a, b) => b.box.h - a.box.h);
      for (const { p, id, box } of mine) {
        const s: Standing = { id, planted: p, atlas, box, left: p.x - box.footX, top: row.foot - box.footY };
        this.standing.push(s);
        const dx = stage.at(s.left);
        if (dx + box.w < 0 || dx > view) continue;
        pic.paste(atlas, box.x, box.y, box.w, box.h, dx, s.top);
        const k = glow.get(id);
        if (k) lightTree(stage, atlas, box, dx, s.top, k.k, k.band ? box.h - ((t * 40) % (box.h + 8)) : null);
      }
    }

    // 4. The crabs, the moments and the life among the trees.
    this.drawCrabs(stage, t);
    let raidOut: ReturnType<typeof drawRaid> | null = null;
    if (m?.kind === "raid") raidOut = drawRaid(stage, this.raidSetup(), e, t);
    if (m?.kind === "levelup") drawSkyLanterns(stage, this.lanternSources(f), e, t);
    if (this.rave) drawRave(stage, f.pond, t);
    this.splashes = this.splashes.filter((sp) => t - sp.t0 < 2.4);
    for (const sp of this.splashes) {
      const c = this.crownOf(sp.id);
      if (c) drawWatering(stage, c, t - sp.t0, t);
    }
    for (const name of this.app.store.state.watered) {
      const id = this.trees.findIndex((p) => p.member.name === name);
      const c = id >= 0 && !this.splashes.some((sp) => sp.id === id) ? this.crownOf(id) : null;
      if (c) drawDew(stage, c, t);
    }
    if (season !== "winter") drawFireflies(stage, this.fireflies, t);

    // 5. The near ferns and trunks, over everything.
    if (near) pic.layer(near, layerOffset(cx, f.layers.near.depth, view));

    // 6. What falls in front: leaves, snow, and a war's S E Q.
    drawFallingLeaves(stage, season === "winter" ? 3 : 7, t);
    if (season === "winter") drawSnow(stage, t);
    if (m?.kind === "war") drawSeq(stage, e);

    const key = `${season}-${ambiance}`;
    if (this.edge?.key !== key) this.edge = { key, colour: edgeColour(pic.px, pic.W, pic.H) };
    pic.blit(out, this.world.W, this.world.H, this.cropX);
    this.renderHud(t, hudOut, fonts, raidOut);
  }

  private seasonNow(f: ForestManifest): string {
    return f.seasons.includes(this.params.season) ? this.params.season : (f.seasons[0] ?? "normal");
  }

  private ambianceNow(f: ForestManifest): Ambiance {
    return f.ambiances.includes(this.light) ? this.light : "dusk";
  }

  private drawCrabs(s: Stage, t: number): void {
    this.crabs.forEach((c, i) => {
      // No. 08 turns up for the rave.
      const at = this.raveSpot(c);
      const pose = crabPose(at, t, this.rave, t - (this.crabHop.get(i) ?? -99));
      const f = castFrame(s, [c.numbered ? "crab-08" : "crab"], [pose.anim, "idle"], pose.ms);
      const x = s.at(pose.x);
      if (f && x > -16 && x < s.view + 16) s.pic.sprite(f, x, at.foot, pose.flip);
    });
  }

  /** Where a crab is: No. 08 comes in from the gate to the rave, between the last crab and the sign. */
  private raveSpot(c: Crab): Crab {
    const f = this.forest;
    if (!c.numbered || !this.rave || !f) return c;
    const bank = this.crabs.filter((k) => !k.numbered);
    const last = Math.max(...bank.map((k) => k.x));
    return { ...c, x: Math.round((last + f.places.farm.x0) / 2), foot: bank.at(-1)?.foot ?? c.foot };
  }

  /** Which trees are lit this frame, how strongly, and whether a band of light climbs them. */
  private glowing(t: number, e: number): Map<number, { k: number; band: boolean }> {
    const out = new Map<number, { k: number; band: boolean }>();
    if (this.moment?.kind === "raid") {
      const k = raidShimmer(e);
      if (k > 0.05) for (const id of this.raidParty()) out.set(id, { k, band: k > 0.4 });
    }
    for (const sp of this.splashes) if (t - sp.t0 > 0.5 && t - sp.t0 < 2.2) out.set(sp.id, { k: 0.6, band: false });
    const focus = this.pinned ?? (this.hover && !this.drag ? this.pick(this.hover.x, this.hover.y) : null);
    if (focus?.kind === "tree" && !out.has(focus.id)) out.set(focus.id, { k: 0.55, band: false });
    return out;
  }

  /** A tree's crown on the ground: its middle, its top row and its width. */
  private crownOf(id: number): { x: number; top: number; w: number } | null {
    const s = this.standing.find((x) => x.id === id);
    return s ? { x: s.left + s.box.w / 2, top: s.top, w: s.box.w } : null;
  }

  // -------------------------------------------------------------------------------------------
  // Moments.

  /** The lab's raid party: your tree and the three nearest yours a player would see. */
  private raidParty(): number[] {
    const me = this.meId();
    const anchor = me >= 0 ? (this.trees[me]?.x ?? 640) : (this.trees[9]?.x ?? 640);
    const near = this.trees
      .map((p, id) => ({ p, id }))
      .filter(({ p, id }) => id !== me && p.member.level >= 3)
      .toSorted((a, b) => Math.abs(a.p.x - anchor) - Math.abs(b.p.x - anchor))
      .slice(0, me >= 0 ? 3 : 4)
      .map(({ id }) => id);
    return (me >= 0 ? [me, ...near] : near).toSorted((a, b) => (this.trees[a]?.x ?? 0) - (this.trees[b]?.x ?? 0));
  }

  private raidSetup(): RaidSetup {
    if (this.raidCache && this.raidCache.party.length > 0) return this.raidCache;
    const hooks = this.forest?.hooks ?? [];
    const taken = new Set([...Array.from({ length: WEEK_LANTERNS }, (_, i) => i * 2 + 1), ...this.hung]);
    const free = hooks.findIndex((_, i) => !taken.has(i));
    const hook = hooks[free] ?? hooks[0] ?? { x: this.forest?.heart ?? 512, y: 12, cord: 5 };
    const party = this.raidParty().flatMap((id) => {
      const c = this.crownOf(id);
      return c ? [{ x: c.x, top: c.top }] : [];
    });
    this.raidCache = { party, hook };
    return this.raidCache;
  }

  /** Where the level-up's sky lanterns lift from: the Great Sequoia's lanterns, then the trees round the heart. */
  private lanternSources(f: ForestManifest): Point[] {
    const fromGreat = f.hooks.slice(0, 6).map((h) => lanternAt(h).glass);
    const fromTrees = this.standing
      .filter((s) => Math.abs(s.planted.x - f.heart) < 200)
      .slice(0, 10)
      .map((s) => ({ x: s.left + s.box.w / 2, y: s.top + 4 }));
    return [...fromGreat, ...fromTrees].toSorted((a, b) => Math.abs(a.x - this.at) - Math.abs(b.x - this.at));
  }

  startMoment(kind: EventKind, t0: number): void {
    if (this.moment?.kind === "war") this.warDone = true;
    if (this.moment?.kind === "raid") this.finishRaid();
    this.moment = { kind, t0, from: this.at };
    this.cameraFree = false;
    this.target = null;
    this.raidCache = null;
    this.pinned = null;
  }

  private finishRaid(): void {
    const hook = this.raidSetup().hook;
    const i = this.forest?.hooks.indexOf(hook) ?? -1;
    if (i >= 0) this.hung.push(i);
  }

  private tick(t: number): void {
    const dt = Math.max(0, Math.min(0.1, t - this.lastT));
    this.lastT = t;
    const m = this.moment;
    const f = this.forest;
    if (m && f) {
      const e = t - m.t0;
      if (!this.cameraFree && e >= 0) {
        if (m.kind === "raid" && this.standing.length > 0) this.lookAt(raidCamera(this.raidSetup(), e, m.from));
        else if (m.kind === "war") {
          // The ridge's pennant in the middle of the picture.
          const ridgeCx = this.view / 2 + (f.ridge.x - this.view / 2) / f.layers.far.depth;
          this.lookAt(warCamera(e, m.from, ridgeCx));
        } else if (m.kind === "levelup") this.lookAt(m.from + (f.heart - m.from) * ease(e / 2));
      }
      // The feed updates as each moment lands.
      const landed = m.kind === "raid" ? 6.5 : m.kind === "war" ? 3.2 : 2.2;
      if (e >= landed && this.feed.at < m.t0) this.feed = { ...FEEDS[m.kind], at: t };
      if (e > LENGTH[m.kind] && !this.params.still) {
        if (m.kind === "raid") this.finishRaid();
        if (m.kind === "war") this.warDone = true;
        this.moment = null;
      }
    }
    if (!this.drag) {
      if (this.target !== null) {
        const k = 1 - Math.exp(-dt * 3.2);
        const next = this.at + (this.target - this.at) * k;
        if (Math.abs(this.target - next) < 0.5) {
          this.lookAt(this.target);
          this.target = null;
        } else this.lookAt(next);
      } else if (Math.abs(this.vx) > 1) {
        this.lookAt(this.at + this.vx * dt);
        this.vx *= Math.exp(-dt * 3.5);
      } else this.vx = 0;
    }
  }

  // -------------------------------------------------------------------------------------------
  // The HUD.

  /** A picture point in the HUD's grid. */
  private toHud(p: Point): Point {
    return between(this.world, this.hudGrid, { x: p.x - this.cropX, y: p.y });
  }

  private renderHud(t: number, hudOut: Uint32Array, fonts: boolean, raid: ReturnType<typeof drawRaid> | null): void {
    const c = new Canvas(hudOut, this.hudGrid.W, this.hudGrid.H);
    if (this.params.bare) {
      c.clear();
      return;
    }
    const model = this.hudModel(t, raid);
    const key = `${fonts}:${this.hudGrid.W}x${this.hudGrid.H}:${JSON.stringify({ ...model, t: model.me ? Math.round(t * 12) : 0 })}`;
    if (key === this.hudKey && hudOut.buffer === this.hudBuffer) return;
    this.hudKey = key;
    this.hudBuffer = hudOut.buffer;
    c.clear();
    this.hits = drawHud(c, model, fonts);
  }

  private meId(): number {
    const me = this.params.me.toLowerCase();
    return this.trees.findIndex((p) => p.member.name.toLowerCase() === me);
  }

  private hudModel(t: number, raid: ReturnType<typeof drawRaid> | null): HudModel {
    const m = this.moment;
    const e = m ? t - m.t0 : -1;
    const me = this.meId();
    const marked = this.pinned?.kind === "tree" ? this.pinned.id : me >= 0 && t - this.meAt < 6 ? me : -1;
    const crown = marked >= 0 ? this.crownOf(marked) : null;
    const mePos = crown ? this.toHud({ x: toPicture(crown.x, this.cx, this.view), y: crown.top - 2 }) : null;
    let card: HudModel["card"] = null;
    if (m?.kind === "levelup") {
      const a = clamp01((e - 2.2) / 0.4) * (1 - clamp01((e - 8.4) / 0.6));
      if (a > 0) card = { title: "GG!", sub: "Guild level 251", lore: "No gg left behind", a };
    }
    let label: HudModel["label"] = null;
    if (raid?.lantern && raid.labelA > 0)
      label = {
        ...this.toHud(raid.lantern),
        title: "TCC cleared",
        names: this.raidParty().map((id) => this.trees[id]?.member.name ?? ""),
        a: raid.labelA,
      };
    return {
      trees: this.trees.length,
      feed: { ...this.feed, flash: Math.max(0, 1 - (t - this.feed.at) / 1.2) },
      findHot: !!this.hudHover && inside(this.hits.find, this.hudHover.x, this.hudHover.y),
      findOn: t - this.meAt < 6,
      tooltip: this.tooltip(),
      debug: this.params.debug ? { labels: ["Raid", "War", "Level up", "Rave"], hot: this.debugHot() } : null,
      card,
      label,
      me: mePos,
      t,
    };
  }

  private debugHot(): number {
    const h = this.hudHover;
    return h ? this.hits.debug.findIndex((r) => inside(r, h.x, h.y)) : -1;
  }

  private tooltip(): Tooltip | null {
    const at = this.pinned ? null : this.hover;
    const target = this.pinned ?? (at ? this.pick(at.x, at.y) : null);
    if (!target) return null;
    const anchor = this.anchorOf(target, at);
    if (!anchor) return null;
    const a = this.toHud(anchor);
    const actionHot = !!this.hudHover && inside(this.hits.action, this.hudHover.x, this.hudHover.y);
    if (target.kind === "tree") {
      const p = this.trees[target.id];
      if (!p) return null;
      const lv = p.member.level;
      const done = this.app.store.state.watered.includes(p.member.name);
      const mine = target.id === this.meId();
      return {
        ax: a.x,
        ay: a.y,
        head: playerHead(p.member.seed),
        title: p.member.name,
        titleColour: UI.text,
        lines: [
          {
            text: `Level ${lv} · ${stageLabel(p.member.stage)}`,
            colour: mix([146, 196, 106], [253, 211, 111], (lv - 1) / 9),
          },
        ],
        action: mine
          ? { text: "Your tree · visit your glade", colour: UI.purpleHover, hot: actionHot }
          : done
            ? { text: "Watered · thank you!", colour: UI.muted, hot: false }
            : { text: "Water (1 care)", colour: UI.leaf, hot: actionHot },
      };
    }
    const info = PLACE_INFO[target.id];
    const go = PLACE_ACTION[target.id];
    return {
      ax: a.x,
      ay: a.y,
      head: null,
      title: info.title,
      titleColour: info.colour,
      lines: info.lines,
      action: go ? { text: go.text, colour: UI.purpleHover, hot: actionHot } : null,
    };
  }

  /** Where a tooltip points, in the picture: the pointer, or the target's top. */
  private anchorOf(target: Target, at: Point | null): Point | null {
    if (at) return { x: at.x + this.cropX, y: at.y };
    const f = this.forest;
    if (!f) return null;
    if (target.kind === "tree") {
      const c = this.crownOf(target.id);
      return c ? { x: toPicture(c.x, this.cx, this.view), y: c.top + 4 } : null;
    }
    const spot = placeSpot(target.id, f, this.crabs);
    return { x: toPicture(spot.x, this.cx, this.view), y: spot.y };
  }

  // -------------------------------------------------------------------------------------------
  // Input.

  /** What is under a point of the screen's grid: a crab, a tree (by its own pixels), a place, or nothing. */
  private pick(x: number, y: number): Target | null {
    const f = this.forest;
    if (!f || y < 0 || y >= this.pic.H) return null;
    const gx = toGround(x + this.cropX, this.cx, this.view);
    const crab = this.crabAt(x, y);
    if (crab >= 0) return { kind: "place", id: this.crabs[crab]?.numbered ? "no8" : "pond" };
    // Front row first: it stands in front.
    for (const s of this.standing.toReversed()) {
      const lx = Math.round(gx - s.left);
      const ly = Math.round(y - s.top);
      if (lx < 0 || ly < 0 || lx >= s.box.w || ly >= s.box.h) continue;
      if ((s.atlas.data[(s.box.y + ly) * s.atlas.w + s.box.x + lx] ?? 0) >>> 24 >= 128)
        return { kind: "tree", id: s.id };
    }
    const ground = this.ground;
    const solid =
      !!ground &&
      gx >= 0 &&
      gx < ground.w &&
      (ground.data[Math.round(y) * ground.w + Math.round(gx)] ?? 0) >>> 24 >= 128;
    for (const id of ["hollow", "farm", "great", "pond"] as const) {
      const r = placeRect(id, f, this.crabs);
      if (gx >= r.x0 && gx < r.x1 && y >= r.y0 && y < r.y1 && (solid || id === "hollow")) return { kind: "place", id };
    }
    return null;
  }

  /** The crab under a screen point, or -1. */
  private crabAt(x: number, y: number): number {
    const t = this.lastT;
    return this.crabs.findIndex((c, i) => {
      const at = this.raveSpot(c);
      const pose = crabPose(at, t, this.rave, t - (this.crabHop.get(i) ?? -99));
      const sx = toPicture(pose.x, this.cx, this.view) - this.cropX;
      return Math.abs(x - sx) <= 9 && y <= at.foot + 1 && y >= at.foot - 13;
    });
  }

  pointer(world: Point, hud: Point, kind: PointerKind, t: number, touch: boolean): void {
    const { x, y } = world;
    if (kind === "leave") {
      this.hover = null;
      this.hudHover = null;
      return;
    }
    if (kind === "down") {
      this.drag = { x, at: this.at, moved: 0, lastX: x, lastT: t };
      this.vx = 0;
      if (!touch) {
        this.hover = { x, y };
        this.hudHover = hud;
      }
      return;
    }
    if (kind === "move") {
      if (!touch || !this.drag) {
        this.hover = touch ? null : { x, y };
        this.hudHover = touch ? null : hud;
      }
      const d = this.drag;
      if (d) {
        d.moved = Math.max(d.moved, Math.abs(x - d.x));
        if (d.moved > 2) {
          const dt = Math.max(1 / 240, t - d.lastT);
          this.vx = ((d.lastX - x) / dt) * 0.6 + this.vx * 0.4;
          d.lastX = x;
          d.lastT = t;
          this.lookAt(d.at - (x - d.x));
          this.cameraFree = true;
          this.target = null;
          this.pinned = null;
        }
      }
      this.cursor = this.drag && this.drag.moved > 2 ? "grabbing" : this.isHot(world, hud) ? "pointer" : "grab";
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
    this.tap(world, hud, t);
  }

  private isHot(world: Point, hud: Point): boolean {
    const h = this.hits;
    if (inside(h.find, hud.x, hud.y) || inside(h.action, hud.x, hud.y) || h.debug.some((r) => inside(r, hud.x, hud.y)))
      return true;
    if (h.panels.some((r) => inside(r, hud.x, hud.y))) return false;
    return this.pick(world.x, world.y) !== null;
  }

  private tap(world: Point, hud: Point, t: number): void {
    const h = this.hits;
    if (inside(h.find, hud.x, hud.y)) return this.findMe(t);
    if (inside(h.action, hud.x, hud.y) && this.pinned) return this.act(this.pinned, t);
    const di = h.debug.findIndex((r) => inside(r, hud.x, hud.y));
    if (di >= 0) return this.debug(di, t);
    if (h.panels.some((r) => inside(r, hud.x, hud.y))) return;
    // A crab: it explodes affectionately.
    const crab = this.crabAt(world.x, world.y);
    if (crab >= 0) {
      this.crabHop.set(crab, t);
      this.pinned = { kind: "place", id: this.crabs[crab]?.numbered ? "no8" : "pond" };
      return;
    }
    const target = this.pick(world.x, world.y);
    const same = target && this.pinned && target.kind === this.pinned.kind && target.id === this.pinned.id;
    this.pinned = same ? null : target;
  }

  /** A pinned tooltip's action: water a friend's tree, or go where a place leads. */
  private act(target: Target, t: number): void {
    if (target.kind === "place") {
      const go = PLACE_ACTION[target.id];
      if (go) this.app.go(go.route);
      return;
    }
    const member = this.trees[target.id]?.member;
    if (!member) return;
    if (target.id === this.meId()) return this.app.go("glade");
    const next = waterFriend(this.app.store.state, member.name);
    if (next) {
      this.app.store.set(next);
      this.splashes.push({ id: target.id, t0: t });
      this.app.say(`You watered ${member.name}'s tree. It will wait for them as dew.`);
    } else if (!this.app.store.state.watered.includes(member.name))
      this.app.say("No care charges left. They come back.");
  }

  findMe(t: number): void {
    const me = this.meId();
    const p = this.trees[me];
    if (!p) return;
    this.target = this.clearView(me) ?? p.x;
    this.vx = 0;
    this.cameraFree = true;
    this.meAt = t;
    this.pinned = { kind: "tree", id: me };
  }

  /**
   * Where to look so a tree stands clear of the near ferns and trunks: near the tree's own place,
   * where the near layer covers least of it, a little aside rather than far.
   */
  private clearView(id: number): number | null {
    const f = this.forest;
    const s = this.standing.find((x) => x.id === id);
    const near = f
      ? this.app.art.image(fill(f.layer, { layer: "near", season: this.seasonNow(f), ambiance: this.ambianceNow(f) }))
          .value
      : null;
    if (!f || !s || !near) return null;
    const centre = s.left + s.box.w / 2;
    // Never so far aside that the tree leaves the screen.
    const reach = Math.max(0, Math.floor((this.shown / 2 - s.box.w / 2 - 4) / 4));
    let best: { at: number; score: number } | null = null;
    for (let step = 0; step <= Math.min(10, reach); step++) {
      for (const dir of step === 0 ? [0] : [-1, 1]) {
        const at = centre + dir * step * 4;
        const l = look(at, this.shown, f.width, this.view);
        const off = layerOffset(l.cx, f.layers.near.depth, this.view);
        let covered = 0;
        for (let y = 0; y < s.box.h; y++)
          for (let x = 0; x < s.box.w; x++) {
            if ((s.atlas.data[(s.box.y + y) * s.atlas.w + s.box.x + x] ?? 0) >>> 24 < 128) continue;
            const nx = toPicture(s.left + x, l.cx, this.view) + off;
            if (nx < 0 || nx >= near.w) continue;
            const v = near.data[(s.top + y) * near.w + nx] ?? 0;
            if (v >>> 24 >= 128) covered++;
          }
        const score = covered + step * 4 * 0.3;
        if (!best || score < best.score) best = { at, score };
      }
    }
    return best?.at ?? null;
  }

  private debug(i: number, t: number): void {
    if (i === 0) this.startMoment("raid", t);
    else if (i === 1) this.startMoment("war", t);
    else if (i === 2) this.startMoment("levelup", t);
    else {
      this.rave = !this.rave;
      if (this.rave) {
        this.target = this.forest?.pond ?? this.at;
        this.feed = birthday(t);
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
      this.target = (this.target ?? this.at) + (k === "ArrowLeft" ? -1 : 1) * this.shown * 0.5;
      this.cameraFree = true;
    } else if (k === "Escape") this.pinned = null;
  }
}

// ---------------------------------------------------------------------------------------------
// The valley's places.

const PLACES = ["great", "hollow", "pond", "no8", "farm"] as const;
const isPlace = (s: string): s is PlaceId => PLACES.some((p) => p === s);

/** `?at=`: a named place (`heart`, `pond`, `gate`, `west`, `east`) or a ground x. */
export function placeX(name: string, f: ForestManifest): number | null {
  const named: Record<string, number> = { heart: f.heart, pond: f.pond, gate: f.gate, west: 0, east: f.width };
  if (name in named) return named[name] ?? null;
  const n = Number(name);
  return name !== "" && Number.isFinite(n) ? n : null;
}

/**
 * Where each place answers a tap, on the ground: the bundle's own boxes for the Great Sequoia, its
 * hollow, the pond and the sign, and No. 08 round where it stands.
 */
function placeRect(id: PlaceId, f: ForestManifest, crabs: readonly Crab[]): Rect {
  if (id !== "no8") return f.places[id];
  const c = crabs.find((k) => k.numbered) ?? { x: f.gate, foot: 132 };
  return { x0: c.x - 8, x1: c.x + 8, y0: c.foot - 14, y1: c.foot + 1 };
}

/** Where a pinned place's tooltip points: the top of its box (the Great Sequoia's, a third of the way down). */
function placeSpot(id: PlaceId, f: ForestManifest, crabs: readonly Crab[]): Point {
  const r = placeRect(id, f, crabs);
  return { x: (r.x0 + r.x1) / 2, y: id === "great" ? Math.round(r.y1 / 3) : r.y0 + 4 };
}

type Rgb = readonly [number, number, number];
const GOLD: Rgb = [242, 192, 68];
const CRABBY: Rgb = [238, 122, 68];

const PLACE_INFO: Record<PlaceId, { title: string; colour: Rgb; lines: { text: string; colour: Rgb }[] }> = {
  great: {
    title: "The Great Sequoia",
    colour: GOLD,
    lines: [
      { text: "The guild's tree · Level 250", colour: UI.text },
      { text: "Every lantern is a gift of Leaf.", colour: UI.lore },
    ],
  },
  hollow: {
    title: "The Hollow",
    colour: GOLD,
    lines: [
      { text: "An old fire scar. The guild", colour: UI.text },
      { text: "sits round the fire inside.", colour: UI.text },
    ],
  },
  pond: {
    title: "The Crab Pond",
    colour: CRABBY,
    lines: [
      { text: "Rule 1. Walk sideways.", colour: UI.text },
      { text: "Rule 2. No crabellions.", colour: UI.text },
      { text: "Roll call: 11 of 12 present.", colour: UI.lore },
    ],
  },
  no8: {
    title: "Crab No. 08",
    colour: CRABBY,
    lines: [
      { text: "Found! By the gate, of all places.", colour: UI.text },
      { text: "Whereabouts: now known.", colour: UI.lore },
    ],
  },
  farm: {
    title: "Do Not The Farm",
    colour: GOLD,
    lines: [{ text: "Guild policy.", colour: UI.lore }],
  },
};

/** A place's tooltip can take you somewhere. */
const PLACE_ACTION: Partial<Record<PlaceId, { text: string; route: string }>> = {
  great: { text: "Water the Great Sequoia", route: "great" },
  hollow: { text: "Sit by the fire", route: "campfire" },
};

const FEEDS: Record<EventKind, Omit<Feed, "at">> = {
  raid: { icon: "raid", text: "Party of 4 cleared TCC", short: "TCC cleared", detail: "Party of 4", ago: "now" },
  war: { icon: "war", text: "SEQ took a Fruma territory", short: "War won", detail: "Fruma", ago: "now" },
  levelup: { icon: "level", text: "Guild reached level 251", short: "Level 251!", detail: "GG", ago: "now" },
};

const birthday = (at: number): Feed => ({
  icon: "crab",
  text: "Happy 4th birthday, SEQ!",
  short: "Happy 4th, SEQ!",
  detail: "Crab rave",
  ago: "today",
  at,
});
