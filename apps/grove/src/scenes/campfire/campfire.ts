/**
 * The Campfire: the Discord Activity's view. Friends in the voice call sit round the fire on log
 * benches, each a small nameplated player head with their companion spirit beside them. Cones burn
 * one at a time from the queue: whoever is next sets theirs in the fire and everyone watches the
 * glade's own reveal. A Leafle tile opens the daily word; the grove cat tells a dad joke when
 * tapped; the White Fox sleeps by the fire.
 *
 * Three layouts: `normal` (a window), `phone` (portrait) and `pip` (320 by 180, picture in
 * picture: just the fire, whose cone is burning, and what came out).
 */

import type { Frame } from "../../art/cast/cast.ts";
import { frameAt, WHITE_FOX } from "../../art/cast/cast.ts";
import { CAT } from "../../art/cast/grove.ts";
import {
  drawEmbers,
  drawFireBack,
  drawFireflies,
  drawFireFront,
  drawFlames,
  drawSmoke,
  drawSnow,
  drawStars,
  fireLight,
  type Mote,
  placeFireflies,
} from "../../art/life.ts";
import { buildLut, C, ix, type Lut, R } from "../../engine/palette.ts";
import { compose, Light, type Sprite, sprite, Surface } from "../../engine/raster.ts";
import { hashString, Rng } from "../../engine/rng.ts";
import { between, type Grid, type Point, worldGrid } from "../../engine/view.ts";
import { FRIENDS } from "../../game/friends.ts";
import type { CampLayout } from "../../game/params.ts";
import { CONE_PRICE, openCone } from "../../game/rules.ts";
import { spirit, spiritForRank } from "../../game/spirits.ts";
import { warmCones } from "../../game/state.ts";
import { Canvas, drawText, hex, mix, type Rgb, textWidth, UI, wrap } from "../../ui/hud.ts";
import { playerHead } from "../forest/heads.ts";
import { blitFrame, spiritFrame } from "../glade/actors.ts";
import { type Backdrop, drawBackdrop } from "../glade/backdrop.ts";
import { buildGlade, type Glade, type Placed } from "../glade/ground.ts";
import { type Layout, layout } from "../glade/layout.ts";
import { drawAurora } from "../reveal/aurora.ts";
import { drawConeCardAt } from "../reveal/card.ts";
import { beatOf, type ConeEvent, coneLook, coneScreen, drawConeWorld, rankColour, shakeFrame } from "../reveal/cone.ts";
import type { App, PointerKind, Scene, Screen } from "../scene.ts";

/** The last seat is yours. */
const YOU = "You";

const JOKES: readonly string[] = [
  "Why did the sequoia join the call? To branch out.",
  "What do crabs pay with? Sand dollars.",
  "Why was the cone so calm? It was pining for nothing.",
  "I tried to make a tree pun. It got stumped.",
  "What's a tree's favourite drink? Root beer.",
];

/** Where each seat is, from the fire, in world pixels; `side` is where the companion sits. */
interface Seat {
  dx: number;
  dy: number;
  side: -1 | 1;
}

const SEATS: Record<"wide" | "narrow", readonly Seat[]> = {
  wide: [
    { dx: -66, dy: 4, side: -1 },
    { dx: -34, dy: -15, side: -1 },
    { dx: 36, dy: -15, side: 1 },
    { dx: 68, dy: 4, side: 1 },
    { dx: -38, dy: 22, side: -1 },
  ],
  narrow: [
    { dx: -21, dy: -17, side: -1 },
    { dx: 22, dy: -17, side: 1 },
    { dx: -31, dy: 5, side: -1 },
    { dx: 32, dy: 5, side: 1 },
    { dx: -17, dy: 25, side: -1 },
  ],
};

interface Burn {
  who: string;
  ev: ConeEvent;
  mine: boolean;
}

/** How long after the burst a friend's card stays up before their spirit trots off. */
const FRIEND_CARD = 3.2;

export class Campfire implements Scene {
  readonly id = "campfire";
  cursor: "default" | "pointer" = "default";
  private readonly app: App;
  private world: Grid = { W: 1, H: 1, scale: 1, offX: 0, offY: 0, dpr: 1 };
  private hud: Grid = { W: 1, H: 1, scale: 1, offX: 0, offY: 0, dpr: 1 };
  private kind: CampLayout = "normal";
  private L: Layout = layout(160, 120);
  private base = new Surface(1, 1);
  private surface = new Surface(1, 1);
  private light = new Light(1, 1);
  /** The fire's wide, still glow over the clearing, worked out once per size. */
  private glow = new Light(1, 1);
  private rare = new Light(1, 1);
  private lut: Lut;
  private backdrop: Backdrop | null = null;
  private glade: Glade | null = null;
  private fireflies: Mote[] = [];
  private readonly seed = hashString("campfire");
  private readonly rng = new Rng(hashString("campfire:cones"));

  // The call.
  private queue: string[] = FRIENDS.map((f) => f.name);
  private burn: Burn | null = null;
  private nextAt = 1.2;
  private youQueued = false;
  private catAt = -99;
  private joke = 0;
  private cheers: { who: number; t0: number }[] = [];
  private hits: { leafle: Rect | null; queue: Rect | null; cat: Rect | null; cheer: Rect | null } = {
    leafle: null,
    queue: null,
    cat: null,
    cheer: null,
  };
  private hudHover: Point | null = null;

  constructor(app: App) {
    this.app = app;
    const p = app.params;
    this.lut = buildLut(p.time, p.season, rankColour(p.rank));
    if (p.burn !== null) {
      const who = this.queue.shift() ?? FRIENDS[0]?.name ?? "Moss";
      this.burn = {
        who,
        mine: false,
        ev: {
          t0: (p.still ? p.t : 0.6) - p.burn,
          rank: p.rank,
          spirit: spiritForRank(p.rank).id,
          verdant: p.verdant,
          closedAt: null,
        },
      };
    }
    if (p.joke) {
      this.catAt = p.still ? p.t - 0.5 : 0.5;
    }
  }

  private layoutKind(): CampLayout {
    const forced = this.app.params.camp;
    if (forced) return forced;
    const dev = { w: this.world.W * this.world.scale, h: this.world.H * this.world.scale };
    if (dev.h <= 260 * this.world.dpr && dev.w <= 520 * this.world.dpr) return "pip";
    return dev.w < dev.h * 0.75 ? "phone" : "normal";
  }

  grid({ devW, devH, dpr }: Screen): Grid {
    const pip = this.app.params.camp === "pip" || (devH <= 260 * dpr && devW <= 520 * dpr);
    // Closer in than the glade: the fire and the people round it are the picture.
    return worldGrid(devW, devH, pip ? 84 : devW < devH * 0.75 ? 240 : 216, dpr);
  }

  busy(): boolean {
    return this.burn?.mine === true;
  }

  resize(world: Grid, hud: Grid): void {
    this.world = world;
    this.hud = hud;
    this.kind = this.layoutKind();
    const { W, H } = world;
    const narrow = this.kind === "phone";
    const pip = this.kind === "pip";
    const base = layout(W, H, 0);
    const fx = Math.round(W / 2);
    const fy = pip ? H - 22 : narrow ? Math.round(H * 0.66) : H - Math.max(44, Math.round(H * 0.24));
    // The clearing is centred on the fire: no tree of its own, the path coming in from below.
    this.L = {
      ...base,
      narrow,
      treeX: fx,
      ground: fy - 6,
      fire: { x: fx, y: fy },
      cone: { x: fx + 12, y: fy + 1 },
      lantern: { x: -40, y: fy },
      squirrel: { x: -40, y: fy },
      crab: { x: W + 40, y: fy },
      sign: null,
      great: { x: Math.round(W * (narrow ? 0.82 : 0.76)), y: base.horizon + 6 },
    };
    this.base = new Surface(W, H);
    this.surface = new Surface(W, H);
    this.light = new Light(W, H);
    this.glow = new Light(W, H);
    this.glow.pool(fx, fy - 4, pip ? 50 : 70, 1.6, 1.6);
    this.rare = new Light(W, H);
    const p = this.app.params;
    this.backdrop = drawBackdrop(this.base, this.L, p.time, this.seed);
    this.glade = buildGlade(this.base, this.L, p.time, p.season, this.seed);
    if (!pip) this.benches(this.base);
    this.fireflies = placeFireflies(this.L, p.time, this.seed);
  }

  /** A log bench under each pair of seats, and a short one for the front seat. */
  private benches(s: Surface): void {
    const { x, y } = this.L.fire;
    const winter = this.app.params.season === "winter";
    for (const st of this.seats()) {
      const len = st.dy < 0 ? 15 : 17;
      bench(s, x + st.dx, y + st.dy + 1, len, winter);
    }
  }

  private seats(): readonly Seat[] {
    return SEATS[this.kind === "phone" ? "narrow" : "wide"];
  }

  /** Everyone in the call, in seat order: the friends, then you. */
  private people(): { name: string; spirit: string }[] {
    return [...FRIENDS, { name: YOU, spirit: this.app.store.state.companion ?? "glorp" }];
  }

  // -------------------------------------------------------------------------------------------
  // The queue.

  private tick(t: number): void {
    const b = this.burn;
    if (b) {
      const look = coneLook(b.ev, t);
      const beat = cardAt(b.ev);
      if (!b.mine && b.ev.closedAt === null && t - b.ev.t0 > beat + FRIEND_CARD) b.ev.closedAt = t;
      if (b.mine && b.ev.closedAt === null && t - b.ev.t0 > beat + 9) b.ev.closedAt = t;
      if (look.done) {
        // A friend has more cones: back to the end of the queue.
        if (!b.mine) this.queue.push(b.who);
        this.burn = null;
        this.nextAt = t + 2.2;
        this.lut = buildLut(this.app.params.time, this.app.params.season, rankColour(this.app.params.rank));
      }
      return;
    }
    if (this.app.params.still || t < this.nextAt) return;
    const who = this.queue.shift();
    if (!who) return;
    if (who === YOU) {
      this.youQueued = false;
      const opened = warmCones(this.app.store.state, 1, Math.random);
      const pull = opened?.pulls[0];
      if (!opened || !pull) {
        this.app.say("Treasury@seqwawa regrets to inform you: more Leaf needed.");
        this.nextAt = t + 0.5;
        return;
      }
      this.app.store.set(opened.state);
      this.start({
        who,
        mine: true,
        ev: { t0: t, rank: pull.rank, spirit: pull.spirit, verdant: pull.verdant, closedAt: null, bond: pull.count },
      });
      return;
    }
    // A friend's cone: they keep their own pity; the demo rolls it from the published odds.
    const pull = openCone(this.rng.int(0, 30), () => this.rng.next());
    this.start({
      who,
      mine: false,
      ev: { t0: t, rank: pull.rank, spirit: pull.spirit, verdant: this.rng.chance(0.04), closedAt: null },
    });
  }

  private start(b: Burn): void {
    this.burn = b;
    this.lut = buildLut(this.app.params.time, this.app.params.season, rankColour(b.ev.rank));
  }

  /** The burner's seat, where their cone waits before it hops into the fire. */
  private stageFor(b: Burn): Layout {
    const i = this.people().findIndex((p) => p.name === b.who);
    const seat = this.seats()[i];
    const { x, y } = this.L.fire;
    if (!seat || this.kind === "pip") return this.L;
    return {
      ...this.L,
      cone: { x: x + Math.round(seat.dx * 0.55), y: y + Math.min(4, Math.round(seat.dy * 0.4)) + 2 },
    };
  }

  // -------------------------------------------------------------------------------------------
  // The frame.

  render(t: number, out: Uint32Array, hudOut: Uint32Array, fonts: boolean): void {
    this.tick(t);
    const s = this.surface;
    const L = this.L;
    const p = this.app.params;
    const glade = this.glade;
    const backdrop = this.backdrop;
    if (!glade || !backdrop) return;
    s.copyFrom(this.base);
    this.light.data.set(this.glow.data);
    this.rare.clear();
    const b = this.burn;
    const look = b ? coneLook(b.ev, t) : null;
    const tw = look ? look.worldT : t;
    const fire = { flare: look?.flare ?? 0 };

    drawStars(s, backdrop.stars, tw);
    if (look && b && look.aurora > 0) drawAurora(s, L, look.aurora, tw, this.seed, look.curtains);
    for (const f of glade.ferns) drawSway(s, f, tw);
    drawFireBack(s, L);
    const pip = this.kind === "pip";
    // The friends' companions, then the fire, then the front seats' companions.
    const people = this.people();
    const seats = this.seats();
    if (!pip) {
      people.forEach((person, i) => {
        const seat = seats[i];
        if (!seat || seat.dy >= 0) return;
        this.drawSeat(s, person, seat, tw, i);
      });
    }
    drawFlames(s, L, tw, fire);
    if (b) drawConeWorld(s, this.light, this.rare, this.stageFor(b), b.ev, t);
    drawFireFront(s, L);
    drawSmoke(s, L, tw);
    drawEmbers(s, L, tw, look?.embers ?? 0);
    if (!pip) {
      people.forEach((person, i) => {
        const seat = seats[i];
        if (!seat || seat.dy < 0) return;
        this.drawSeat(s, person, seat, tw, i);
      });
      // The White Fox, asleep by the fire; the cat, loafing at the edge of the light.
      const fox = WHITE_FOX.poses["sleep"] ?? WHITE_FOX.idle;
      blitFrame(s, frameAt(fox, tw * 1000), L.fire.x + (this.kind === "phone" ? 8 : 16), L.fire.y + 17, true);
      const cat = this.catSpot();
      const blink = t - this.catAt < 0.3 || (Math.floor(t / 4.3) % 3 === 2 && t % 4.3 < 0.15);
      s.blit(blink ? CAT.blink : CAT.loaf, cat.x - 5, cat.y - 7);
    }
    s.overlay(glade.front);
    for (const f of glade.frontFerns) drawSway(s, f, tw);
    for (const c of glade.canopy) drawSway(s, c, tw);
    drawFireflies(s, this.light, this.fireflies, tw);
    if (p.season === "winter") drawSnow(s, L, tw, this.seed);
    fireLight(this.light, L, tw, p.time, fire);
    compose(s, this.light, this.lut, out, this.rare, hex(rankColour(b?.ev.rank ?? p.rank)));
    if (look && b) {
      coneScreen(out, this.world.W, this.world.H, L, look, rankColour(b.ev.rank));
      shakeFrame(out, this.world.W, this.world.H, look.shake.x, look.shake.y);
    }
    this.renderHud(t, hudOut, fonts);
  }

  /** A friend on their bench, their companion on the ground beside them. */
  private drawSeat(s: Surface, person: { name: string; spirit: string }, seat: Seat, t: number, i: number): void {
    const { x, y } = this.L.fire;
    const f: Frame = spiritFrame(person.spirit, t * 1000 + i * 530);
    blitFrame(s, f, x + seat.dx + seat.side * 15, y + seat.dy + 4, seat.side > 0);
    // A nod now and then, as people in a call do.
    const nod = Math.floor(t * 0.7 + i * 1.3) % 5 === 0 && (t * 0.7 + i * 1.3) % 1 < 0.25 ? 1 : 0;
    s.blit(headSprite(person.name === YOU ? "you" : person.name), x + seat.dx - 4, y + seat.dy - 10 + nod);
  }

  private catSpot(): Point {
    const { x, y } = this.L.fire;
    return this.kind === "phone" ? { x: x + 30, y: y + 27 } : { x: x + 52, y: y + 22 };
  }

  private renderHud(t: number, hudOut: Uint32Array, fonts: boolean): void {
    const c = new Canvas(hudOut, this.hud.W, this.hud.H);
    c.clear();
    this.hits = { leafle: null, queue: null, cat: null, cheer: null };
    const p = this.app.params;
    if (p.bare || !fonts) return;
    const toHud = (q: Point): Point => between(this.world, this.hud, q);
    const L = this.L;
    const b = this.burn;
    const pip = this.kind === "pip";
    const people = this.people();
    const seats = this.seats();

    // Heads with nameplates, on the benches.
    if (!pip) {
      people.forEach((person, i) => {
        const seat = seats[i];
        if (!seat) return;
        const at = toHud({ x: L.fire.x + seat.dx, y: L.fire.y + seat.dy - 11 });
        const burning = b?.who === person.name && b.ev.closedAt === null;
        nameplate(c, person.name, at.x, at.y - 11, burning ? UI.gold : UI.text);
        const cheer = this.cheers.find((ch) => ch.who === i && t - ch.t0 < 1.2);
        if (cheer) flameAbove(c, at.x, at.y - 20, t - cheer.t0);
      });
    }

    // The burning cone's owner, over the fire.
    const fireHud = toHud(L.fire);
    // In picture in picture there is no queue to read it from, so it rides over the fire.
    if (pip && b && b.ev.closedAt === null)
      nameplate(c, b.mine ? "Your cone" : `${b.who}'s cone`, fireHud.x, fireHud.y - 36, UI.gold);

    if (pip) {
      this.pipCard(c, t);
      return;
    }

    const narrow = this.kind === "phone";
    // The call: who is here.
    const call = `${people.length} in voice`;
    const chipW = 4 + 7 + 4 + textWidth("Campfire") + 8 + textWidth(call) + 5;
    c.panel(3, 3, chipW, 15, mix(UI.purple, UI.popup, 0.35), 0.92, UI.body);
    flameIcon(c, 7, 6);
    drawText(c, "Campfire", 18, 7, UI.gold, { shadow: true });
    drawText(c, call, 18 + textWidth("Campfire") + 8, 7, UI.muted, { shadow: true });
    c.rect(18 + textWidth("Campfire") + 3, 10, 2, 2, [88, 196, 122]);

    // The burn queue; on a phone it gives way to the reveal's card, which opens at the top.
    const cardUp = !!b && t - b.ev.t0 >= cardAt(b.ev) && (b.ev.closedAt === null || t - b.ev.closedAt < 0.25);
    if (!narrow || !cardUp) this.queuePanel(c, narrow, t);

    // The Leafle tile.
    const tile = narrow ? { x: 3, y: c.H - 32, w: 84, h: 29 } : { x: c.W - 92, y: c.H - 34, w: 89, h: 31 };
    const hot = !!this.hudHover && inside(tile, this.hudHover);
    c.panel(tile.x, tile.y, tile.w, tile.h, hot ? UI.purpleHover : mix([88, 196, 122], UI.popup, 0.3), 0.94, UI.body);
    const tiles: Rgb[] = [
      [94, 155, 90],
      [201, 162, 60],
      [74, 72, 88],
    ];
    "WYN".split("").forEach((ch, i) => {
      const tx = tile.x + 5 + i * 10;
      const col = tiles[i] ?? UI.ink;
      c.rect(tx, tile.y + 5, 9, 9, col);
      c.border(tx, tile.y + 5, 9, 9, mix(col, UI.ink, 0.5));
      drawText(c, ch, tx + 2, tile.y + 6, UI.text);
    });
    drawText(c, "Leafle", tile.x + 37, tile.y + 6, UI.text, { shadow: true });
    drawText(c, "Daily word", tile.x + 5, tile.y + 18, UI.muted, { shadow: true });
    this.hits.leafle = tile;

    // A cheer: a reaction counts as taking part, mic or no mic.
    const cheer = narrow
      ? { x: tile.x + tile.w + 3, y: tile.y + 7, w: 18, h: 18 }
      : { x: tile.x - 21, y: tile.y + 13, w: 18, h: 18 };
    c.panel(
      cheer.x,
      cheer.y,
      cheer.w,
      cheer.h,
      this.hudHover && inside(cheer, this.hudHover) ? UI.purpleHover : mix(UI.gold, UI.popup, 0.4),
      0.94,
      UI.body,
    );
    flameIcon(c, cheer.x + 6, cheer.y + 5);
    this.hits.cheer = cheer;

    // The cat's joke.
    const cat = toHud(this.catSpot());
    this.hits.cat = { x: cat.x - 8, y: cat.y - 12, w: 16, h: 14 };
    if (t - this.catAt < 5) bubble(c, cat.x, cat.y - 10, JOKES[this.joke % JOKES.length] ?? "", narrow ? c.W - 8 : 150);

    // The reveal's card, beside the fire.
    if (b) this.card(c, fireHud, b, t);
  }

  private queuePanel(c: Canvas, narrow: boolean, t: number): void {
    const b = this.burn;
    const order = [...(b && b.ev.closedAt === null ? [b.who] : []), ...this.queue];
    const rows = narrow ? order.slice(0, 2) : order.slice(0, 5);
    const w = narrow ? c.W - 6 : 112;
    const rowH = 11;
    const h = 16 + rows.length * rowH + 20;
    const x = narrow ? 3 : c.W - w - 3;
    const y = narrow ? 21 : 3;
    c.panel(x, y, w, h, mix(UI.gold, UI.popup, 0.4), 0.92, UI.body);
    drawText(c, "Burn queue", x + 5, y + 5, UI.gold, { shadow: true });
    const waiting = `${order.length} cones`;
    drawText(c, waiting, x + w - 5 - textWidth(waiting), y + 5, UI.muted, { shadow: true });
    rows.forEach((name, i) => {
      const ry = y + 17 + i * rowH;
      drawHead(c, name === YOU ? "you" : name, x + 5, ry - 1, false);
      const now = i === 0 && b && b.ev.closedAt === null;
      drawText(c, name, x + 16, ry, now ? UI.text : UI.textSecondary, { shadow: true });
      const tag = now ? "burning" : i === (b && b.ev.closedAt === null ? 1 : 0) ? "next" : "";
      if (tag) drawText(c, tag, x + w - 5 - textWidth(tag), ry, now ? UI.gold : UI.muted, { shadow: true });
      if (now) c.rect(x + 3, ry + 2, 1, 4, UI.gold);
    });
    const can = this.app.store.state.freeCones > 0 || this.app.store.state.leaf >= CONE_PRICE;
    const queued = this.youQueued || this.queue.includes(YOU) || b?.mine === true;
    const btn = { x: x + 4, y: y + h - 18, w: w - 8, h: 14 };
    const hot = !!this.hudHover && inside(btn, this.hudHover) && !queued && can;
    c.panel(
      btn.x,
      btn.y,
      btn.w,
      btn.h,
      queued ? mix(UI.muted, UI.popup, 0.5) : hot ? UI.purpleHover : mix(UI.gold, UI.popup, 0.15),
      0.95,
      hot ? mix(UI.popup, UI.purpleDark, 0.5) : UI.popup,
    );
    const label = queued ? "Your cone is queued" : can ? "Queue my cone" : "More Leaf needed";
    drawText(c, label, btn.x + Math.floor((btn.w - textWidth(label)) / 2), btn.y + 4, queued ? UI.muted : UI.text, {
      shadow: true,
    });
    this.hits.queue = queued || !can ? null : btn;
    void t;
  }

  private card(c: Canvas, fire: Point, b: Burn, t: number): void {
    const tau = t - b.ev.t0;
    const at = cardAt(b.ev);
    if (tau < at) return;
    const closing = b.ev.closedAt === null ? 0 : (t - b.ev.closedAt) / 0.25;
    if (closing >= 1) return;
    const sp = spirit(b.ev.spirit);
    drawConeCardAt(
      c,
      fire,
      {
        rank: b.ev.rank,
        verdant: b.ev.verdant,
        colour: hex(rankColour(b.ev.rank)),
        name: sp.name,
        lore: sp.note,
        number: sp.number,
        bond: b.ev.bond ?? 1,
        footer: b.mine ? "Tap to keep" : `${b.who}'s cone`,
      },
      Math.min(1, (tau - at) / 0.15),
      closing,
      this.app.art.cast.value?.portrait(sp.id) ?? null,
    );
  }

  /** Picture in picture: no room for the full card, so what came out in one line under the fire. */
  private pipCard(c: Canvas, t: number): void {
    const b = this.burn;
    if (!b) {
      const next = this.queue[0];
      if (next)
        nameplate(c, `Next: ${next === YOU ? "your cone" : `${next}'s cone`}`, Math.floor(c.W / 2), c.H - 14, UI.muted);
      return;
    }
    const tau = t - b.ev.t0;
    if (tau < cardAt(b.ev) || (b.ev.closedAt !== null && t - b.ev.closedAt > 0.25)) return;
    const sp = spirit(b.ev.spirit);
    const colour = hex(rankColour(b.ev.rank));
    const rank = b.ev.rank;
    const w = Math.max(textWidth(sp.name, true), textWidth(rank) + 9) + 10 + 18;
    const h = 26;
    const x = Math.floor((c.W - w) / 2);
    const y = 4;
    c.panel(x, y, w, h, colour, 0.95, [24, 18, 36]);
    const fig = this.app.art.cast.value?.portrait(sp.id);
    if (fig) c.frame(fig, x + 4 + Math.floor((16 - fig.w) / 2), y + Math.floor((h - fig.h) / 2));
    drawText(c, sp.name, x + 24, y + 4, colour, { bold: true, shadow: true });
    c.icon(GEM, { x: mix(colour, UI.ink, 0.25), X: mix(colour, [255, 255, 255], 0.35) }, x + 24, y + 15);
    drawText(c, rank, x + 32, y + 15, colour, { shadow: true });
  }

  pointer(world: Point, hud: Point, kind: PointerKind, t: number, touch: boolean): void {
    if (kind === "leave") {
      this.hudHover = null;
      this.cursor = "default";
      return;
    }
    this.hudHover = touch ? null : hud;
    const h = this.hits;
    const over = [h.leafle, h.queue, h.cat, h.cheer].some((r) => r && inside(r, hud));
    this.cursor = over ? "pointer" : "default";
    if (kind !== "up") return;
    const b = this.burn;
    if (b?.mine && b.ev.closedAt === null && coneLook(b.ev, t).cardOpen) {
      b.ev.closedAt = t;
      return;
    }
    if (h.leafle && inside(h.leafle, hud)) return this.app.go("leafle");
    if (h.queue && inside(h.queue, hud)) {
      this.youQueued = true;
      this.queue.splice(Math.min(1, this.queue.length), 0, YOU);
      this.app.say("Your cone is in the queue. Everyone will watch it open.");
      return;
    }
    if (h.cheer && inside(h.cheer, hud)) {
      this.cheers.push({ who: FRIENDS.length, t0: t });
      return;
    }
    if (h.cat && inside(h.cat, hud)) {
      this.catAt = t;
      this.joke++;
    }
    void world;
  }

  key(key: string, t: number): void {
    if (key === "j") {
      this.catAt = t;
      this.joke++;
    }
  }
}

// ---------------------------------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const inside = (r: Rect, p: Point): boolean => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

/** Seconds from the tap to the reveal's card. */
const cardAt = (ev: ConeEvent): number => beatOf(ev.rank).burst + beatOf(ev.rank).card;

function bench(s: Surface, x: number, y: number, len: number, winter: boolean): void {
  const x0 = Math.round(x - len / 2);
  for (let k = 0; k < len; k++) {
    s.set(x0 + k, y - 3, winter ? ix(R.SNOW, 6) : ix(R.WOOD, 6));
    s.set(x0 + k, y - 2, ix(R.WOOD, 4));
    s.set(x0 + k, y - 1, ix(R.WOOD, 3));
    s.set(x0 + k, y, ix(R.WOOD, 1));
  }
  // The cut ends, with rings.
  for (const ex of [x0 - 1, x0 + len]) {
    s.set(ex, y - 2, ix(R.WOOD, 7));
    s.set(ex, y - 1, ix(R.WOOD, 5));
  }
}

/**
 * A member's player head as a world sprite: their made-up 8x8 face matched to the nearest of the
 * cast's character colours, so it is lit by the fire like everyone else and drawn on the same
 * pixel grid, with an inked edge so it reads against the night.
 */
const heads = new Map<string, Sprite>();
const DUSK = buildLut("dusk", "normal", "#fdd36f");
const CHARACTER_INDICES = Array.from({ length: 256 }, (_, j) => 256 + j).filter((i) => {
  const ramp = i >> 3;
  return (i & 7) > 0 && ![C.FIRE, C.GLOW, C.STAR, C.LIGHTS, C.RARITY].some((r) => r === ramp);
});

function nearest(c: Rgb): number {
  let best = CHARACTER_INDICES[0] ?? 256;
  let bestD = Infinity;
  for (const i of CHARACTER_INDICES) {
    const [r, g, b] = DUSK.rgb(i);
    const d = (r - c[0]) ** 2 * 0.3 + (g - c[1]) ** 2 * 0.59 + (b - c[2]) ** 2 * 0.11;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function headSprite(seed: string): Sprite {
  const hit = heads.get(seed);
  if (hit) return hit;
  const sp = sprite(10, 10);
  const ink = ix(C.INK, 1);
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 10; x++) if (x === 0 || y === 0 || x === 9 || y === 9) sp.data[y * 10 + x] = ink;
  sp.data[0] = 0;
  sp.data[9] = 0;
  sp.data[90] = 0;
  sp.data[99] = 0;
  playerHead(seed).forEach((col, i) => {
    sp.data[(1 + Math.floor(i / 8)) * 10 + 1 + (i % 8)] = nearest(col);
  });
  heads.set(seed, sp);
  return sp;
}

/** A player head in the HUD (the queue's rows): the 8x8 face on a dark edge. */
function drawHead(c: Canvas, seed: string, x: number, y: number, lit: boolean): void {
  const px = playerHead(seed);
  c.rect(x - 1, y - 1, 10, 10, [16, 10, 14]);
  px.forEach((col, i) => c.px(x + (i % 8), y + Math.floor(i / 8), mix(col, [255, 168, 84], lit ? 0.18 : 0.08)));
}

/** A Minecraft nametag: the name on a dark see-through plate, centred over `x`. */
function nameplate(c: Canvas, text: string, x: number, y: number, colour: Rgb): void {
  const w = textWidth(text) + 4;
  const left = Math.round(x - w / 2);
  c.rect(left, y - 1, w, 10, [0, 0, 0], 0.32);
  drawText(c, text, left + 2, y + 1, colour);
}

/** The cat's joke in a speech bubble, its tail pointing down at the cat. */
function bubble(c: Canvas, x: number, y: number, text: string, maxW: number): void {
  const lines = wrap(text, maxW - 10);
  const w = Math.max(...lines.map((l) => textWidth(l))) + 10;
  const h = lines.length * 10 + 7;
  const left = Math.max(2, Math.min(c.W - w - 2, Math.round(x - w / 2)));
  const top = Math.max(22, Math.round(y - h - 4));
  const cream: Rgb = [242, 230, 212];
  const ink: Rgb = [40, 28, 24];
  c.rect(left + 1, top + 1, w - 2, h - 2, cream);
  c.border(left, top, w, h, ink);
  const tx = Math.max(left + 3, Math.min(left + w - 5, Math.round(x)));
  c.rect(tx, top + h - 1, 3, 1, cream);
  c.rect(tx + 1, top + h, 2, 1, cream);
  c.px(tx - 1, top + h - 1, ink);
  c.px(tx, top + h, ink);
  c.px(tx + 1, top + h + 1, ink);
  c.px(tx + 2, top + h + 1, ink);
  c.px(tx + 3, top + h, ink);
  c.px(tx + 3, top + h - 1, ink);
  lines.forEach((l, i) => drawText(c, l, left + 5, top + 4 + i * 10, ink));
}

const FLAME = ["..o..", ".oOo.", ".OyO.", "oOyOo", ".ooo."];
const FLAME_LEGEND: Record<string, Rgb> = { o: hex("#d9542a"), O: hex("#f7b84a"), y: hex("#fff6d2") };
const GEM = ["..x..", ".xXx.", "xXXXx", ".xXx.", "..x.."];

function flameIcon(c: Canvas, x: number, y: number): void {
  c.icon(FLAME, FLAME_LEGEND, x, y);
}

/** A cheer: a little flame pops up over a head and drifts. */
function flameAbove(c: Canvas, x: number, y: number, age: number): void {
  const up = Math.round(age * 10);
  c.icon(FLAME, FLAME_LEGEND, x - 2, y - up, Math.max(0, 1 - age / 1.2));
}

/** A stepped sway, as the glade draws its ferns. */
function drawSway(s: Surface, p: Placed, t: number): void {
  const u = ((((t + p.phase) / p.period) % 1) + 1) % 1;
  const i =
    p.frames.length === 3
      ? u < 0.25
        ? 0
        : u < 0.5
          ? 1
          : u < 0.75
            ? 0
            : 2
      : Math.floor(u * p.frames.length) % p.frames.length;
  const frame = p.frames[i] ?? p.frames[0];
  if (frame) s.blit(frame, p.x, p.y);
}
