/**
 * The Campfire: the Discord Activity's view, played from the art bundle (grove/campfire.py): the
 * welcome's clearing with a fire on its stones, two fallen logs to sit on and the grove cat asleep
 * on its stump, a 160-frame loop by season and light. Each frame is composed as the glade's is: the
 * loop, then the friends and the cones over it, then the near layer put back in front.
 *
 * Friends in the call sit on the manifest's seats as their companion spirits, facing the fire, each
 * with a nametag in the HUD; now and then one hops for joy. Cones burn one at a time from the queue:
 * whoever is next throws theirs into the fire (the bundle's cone), where it opens as the glade's do
 * (`../glade/reveal.ts`) and the spirit lands by the fire. A tap on the cat wakes a dad joke; a
 * Leafle tile opens the daily word; a cheer counts as taking part, mic or no mic.
 *
 * Three layouts: `normal` (a window: the whole picture), `phone` (portrait: a crop centred on the
 * fire) and `pip` (Discord's 320 by 180: only the fire, whose cone is burning, and what came out).
 */

import type { Pixels } from "../../bundle/art.ts";
import type { CastFrame } from "../../bundle/cast.ts";
import { fitPicture } from "../../bundle/fit.ts";
import { type CampfireManifest, fill, type Manifest } from "../../bundle/manifest.ts";
import { type Ambiance, Ink, packHex } from "../../bundle/palette.ts";
import { edgeColour, Picture } from "../../bundle/picture.ts";
import { castFrame } from "../../bundle/vocabulary.ts";
import { hashString, Rng } from "../../engine/rng.ts";
import { between, type Grid, type Point } from "../../engine/view.ts";
import { FRIENDS } from "../../game/friends.ts";
import type { CampLayout } from "../../game/params.ts";
import { CONE_PRICE, openCone } from "../../game/rules.ts";
import { spirit, spiritForRank } from "../../game/spirits.ts";
import { warmCones } from "../../game/state.ts";
import { Canvas, drawText, hex, mix, type Rgb, textWidth, UI, wrap } from "../../ui/hud.ts";
import { playerHead } from "../forest/heads.ts";
import { drawAurora, drawReveal, drawRevealScreen } from "../glade/reveal.ts";
import type { Fx, Places, TreeShape } from "../glade/stage.ts";
import { drawConeCardAt } from "../reveal/card.ts";
import { beatOf, type ConeEvent, coneLook, rankColour } from "../reveal/cone.ts";
import { type App, lightOf, type PointerKind, type Scene, type Screen } from "../scene.ts";
import { overlaps, placeTags, type Rect, seatPeople, type Sitter, throwFrom } from "./seats.ts";

/** The last seat is yours. */
const YOU = "You";

const JOKES: readonly string[] = [
  "Why did the sequoia join the call? To branch out.",
  "What do crabs pay with? Sand dollars.",
  "Why was the cone so calm? It was pining for nothing.",
  "I tried to make a tree pun. It got stumped.",
  "What's a tree's favourite drink? Root beer.",
];

/** The picture's size and its places before the manifest is in (the bundle's own). */
const PICTURE = { w: 256, h: 144 };
const FIRE = { x: 128, y: 129 };
const CAT = { x: 78, y: 128 };
/** The page round the picture before its first frame: the HUD's dark. */
const DARK = "#150f0d";
/** Picture in picture shows this many rows round the fire. */
const PIP_ROWS = 60;
/** The Campfire has no tree to keep the aurora off. */
const NO_TREE: TreeShape = { level: 1, box: { x: 0, y: 0, w: 0, h: 0 }, foot: FIRE, mask: null };

interface Burn {
  who: string;
  ev: ConeEvent;
  mine: boolean;
}

interface Person {
  name: string;
  spirit: string;
}

/** How long after the burst a friend's card stays up before their spirit trots off. */
const FRIEND_CARD = 3.2;

export class Campfire implements Scene {
  readonly id = "campfire";
  cursor: "default" | "pointer" = "default";
  private readonly app: App;
  private pic = new Picture(PICTURE.w, PICTURE.h);
  private world: Grid = { W: 1, H: 1, scale: 1, offX: 0, offY: 0, dpr: 1 };
  private hud: Grid = { W: 1, H: 1, scale: 1, offX: 0, offY: 0, dpr: 1 };
  private kind: CampLayout = "normal";
  /** The picture's first column and row on screen. */
  private crop = { x: 0, y: 0 };
  private light: Ambiance;
  private ink: Ink;
  private lightCheckedAt = -99;
  private edge: { path: string; colour: string } | null = null;
  private readonly rng = new Rng(hashString("campfire:cones"));

  // The call.
  private queue: string[] = FRIENDS.map((f) => f.name);
  private burn: Burn | null = null;
  private nextAt = 1.2;
  private youQueued = false;
  private catAt = -99;
  private joke = 0;
  private cheers: number[] = [];
  private hits: { leafle: Rect | null; queue: Rect | null; cheer: Rect | null } = {
    leafle: null,
    queue: null,
    cheer: null,
  };
  private hudHover: Point | null = null;

  constructor(app: App) {
    this.app = app;
    const p = app.params;
    this.light = lightOf(p);
    this.ink = new Ink(this.light);
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
    if (p.joke) this.catAt = p.still ? p.t - 0.5 : 0.5;
  }

  private get manifest(): Manifest | null {
    return this.app.art.manifest.value;
  }

  private get camp(): CampfireManifest | null {
    return this.manifest?.campfire ?? null;
  }

  private get fire(): Point {
    return this.camp?.fire ?? FIRE;
  }

  // -------------------------------------------------------------------------------------------
  // Where it sits.

  grid(s: Screen): Grid {
    const { devW, devH, dpr } = s;
    const forced = this.app.params.camp;
    this.kind = forced ?? (devH <= 260 * dpr && devW <= 520 * dpr ? "pip" : s.phone ? "phone" : "normal");
    const picW = this.manifest?.width ?? PICTURE.w;
    const picH = this.manifest?.height ?? PICTURE.h;
    const fire = this.fire;
    if (this.kind === "pip") {
      // A close crop round the fire, its stones on the bottom edge.
      const scale = Math.max(1, Math.floor(devH / PIP_ROWS));
      const W = Math.min(picW, Math.ceil(devW / scale));
      const H = Math.min(picH, Math.ceil(devH / scale));
      this.crop = { x: Math.max(0, Math.min(picW - W, Math.round(fire.x - W / 2))), y: picH - H };
      return { W, H, scale, offX: Math.floor((devW - W * scale) / 2), offY: Math.floor((devH - H * scale) / 2), dpr };
    }
    const fit = fitPicture({
      devW,
      devH,
      picW,
      picH,
      phone: this.kind === "phone",
      hudScale: s.hud.scale,
      hud: this.kind === "phone" && !this.app.params.bare,
      focusX: fire.x,
      clearRow: picH,
    });
    this.crop = { x: fit.cropX, y: 0 };
    return { W: fit.W, H: fit.H, scale: fit.scale, offX: fit.offX, offY: fit.offY, dpr };
  }

  layoutKey(): string {
    const m = this.manifest;
    return m ? `${m.width}x${m.height}:${m.campfire ? "campfire" : ""}` : "";
  }

  pageColour(): string {
    return this.edge?.colour ?? DARK;
  }

  busy(): boolean {
    return this.burn?.mine === true;
  }

  resize(world: Grid, hud: Grid): void {
    this.world = world;
    this.hud = hud;
    const man = this.manifest;
    if (man && (this.pic.W !== man.width || this.pic.H !== man.height)) this.pic = new Picture(man.width, man.height);
  }

  /** A picture point in the HUD's grid. */
  private toHud(p: Point): Point {
    return between(this.world, this.hud, { x: p.x - this.crop.x, y: p.y - this.crop.y });
  }

  /** Everyone in the call, in seat order: the friends, then you. */
  private people(): Person[] {
    return [...FRIENDS, { name: YOU, spirit: this.app.store.state.companion ?? "glorp" }];
  }

  private sitters(): Sitter<Person>[] {
    return seatPeople(this.people(), this.camp?.seats ?? [], this.fire);
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
      this.burn = {
        who,
        mine: true,
        ev: { t0: t, rank: pull.rank, spirit: pull.spirit, verdant: pull.verdant, closedAt: null, bond: pull.count },
      };
      return;
    }
    // A friend's cone: they keep their own pity; the demo rolls it from the published odds.
    const pull = openCone(this.rng.int(0, 30), () => this.rng.next());
    this.burn = {
      who,
      mine: false,
      ev: { t0: t, rank: pull.rank, spirit: pull.spirit, verdant: this.rng.chance(0.04), closedAt: null },
    };
  }

  /** Where a burn plays: the fire, the burner's paws the cone leaves, and where the spirit lands. */
  private placesFor(b: Burn | null): Places {
    const fire = this.fire;
    const burner = b ? this.sitters().find((s) => s.person.name === b.who) : undefined;
    return {
      arc: burner ? 14 : 6,
      hearth: fire,
      cone: burner ? throwFrom(burner) : { x: fire.x - 18, y: fire.y + 4 },
      landing: this.camp?.landing ?? { x: fire.x, y: fire.y + 13 },
      companion: fire,
      heralds: [],
    };
  }

  // -------------------------------------------------------------------------------------------
  // The frame.

  render(t: number, out: Uint32Array, hudOut: Uint32Array, fonts: boolean): void {
    this.tick(t);
    if (t - this.lightCheckedAt > 10) {
      this.lightCheckedAt = t;
      const light = lightOf(this.app.params);
      if (light !== this.light) {
        this.light = light;
        this.ink = new Ink(light);
      }
    }
    const art = this.app.art;
    const man = this.manifest;
    const camp = man?.campfire ?? null;
    const pic = this.pic;
    const b = this.burn;
    const look = b ? coneLook(b.ev, t) : null;
    // Yggdrasil stops the world: the loop holds still while it opens.
    const tw = look ? look.worldT : t;
    const season = man?.glade.seasons.includes(this.app.params.season) ? this.app.params.season : "normal";
    const ambiance = this.light;
    const path = camp ? fill(camp.loop, { season, ambiance }) : "";
    if (camp) art.keep([path]);
    const loop = camp ? art.loop(path).value : null;
    let frameIndex = 0;
    if (loop) {
      frameIndex = loop.indexAt(tw * 1000);
      const frame = loop.frame(frameIndex, performance.now() + 4, () => performance.now());
      if (frame) {
        pic.begin(frame);
        if (this.edge?.path !== path) this.edge = { path, colour: edgeColour(frame, loop.width, loop.height) };
      }
    }
    if (!man || !camp || !pic.ready) {
      pic.blank(packHex(DARK));
      pic.blit(out, this.world.W, this.world.H, this.crop.x, 0, 0, this.crop.y);
      this.renderHud(t, hudOut, fonts);
      return;
    }

    const places = this.placesFor(b);
    const fx: Fx = {
      pic,
      ink: this.ink,
      season,
      ambiance,
      cast: art.cast.value,
      props: art.props.value,
      tree: NO_TREE,
      ground: places.landing.y,
      places,
      front: art.mask(camp.front).value,
    };
    const aurora = b && look ? this.aurora(man, season, b, t) : null;
    // The aurora behind the friends; the rest of the reveal in front of them.
    if (b && look && aurora && look.aurora > 0) {
      const beat = beatOf(b.ev.rank);
      drawAurora(fx, aurora, frameIndex, {
        strength: look.aurora,
        span: [0, 46, 84, 140][beat.aurora] ?? 140,
        gold: beat.freeze,
      });
    }
    if (this.kind !== "pip") for (const s of this.sitters()) this.drawSitter(fx, s, tw, b);
    if (b && look) drawReveal(fx, b.ev, look, t, null, frameIndex);
    // The near layer back in front of everything drawn in the world.
    pic.restore(art.mask(fill(camp.near, { season })).value);
    if (b && look) drawRevealScreen(pic, places, look, b.ev.rank);
    pic.blit(out, this.world.W, this.world.H, this.crop.x, look?.shake.x ?? 0, look?.shake.y ?? 0, this.crop.y);
    this.renderHud(t, hudOut, fonts);
    art.idle(performance.now() + 3);
  }

  /** The welcome's aurora for a rare cone, fetched while it burns and let go after. */
  private aurora(man: Manifest, season: string, b: Burn, t: number): Pixels | null {
    const fxm = man.effects;
    if (!fxm) return null;
    const path = fill(fxm.aurora, { season });
    if (beatOf(b.ev.rank).aurora === 0 || t < b.ev.t0) {
      this.app.art.drop(path);
      return null;
    }
    return this.app.art.image(path).value;
  }

  /** One friend on their seat as their companion, facing the fire, warmed by it; a hop for joy now and then. */
  private drawSitter(fx: Fx, s: Sitter<Person>, t: number, b: Burn | null): void {
    const i = s.seat;
    const throwing = !!b && b.who === s.person.name && t - b.ev.t0 >= -0.2 && t - b.ev.t0 < 0.5;
    const period = 6.5 + i * 0.9;
    const local = (t + i * 1.7) % period;
    const hop = (fx.cast?.length(s.person.spirit, "happy") ?? 0) / 1000;
    const happy = throwing || local < hop;
    const ms = throwing && b ? (t - b.ev.t0 + 0.2) * 1000 : happy ? local * 1000 : t * 1000 + i * 530;
    const f = castFrame(fx, [s.person.spirit], happy ? ["happy", "idle"] : ["idle"], ms);
    if (!f) return;
    fx.pic.sprite(f, s.x, s.y, s.flip);
    warm(fx, f, s.x, s.y, s.flip, this.fire);
  }

  // -------------------------------------------------------------------------------------------
  // The HUD.

  private renderHud(t: number, hudOut: Uint32Array, fonts: boolean): void {
    const c = new Canvas(hudOut, this.hud.W, this.hud.H);
    c.clear();
    this.hits = { leafle: null, queue: null, cheer: null };
    const p = this.app.params;
    if (p.bare || !fonts) return;
    const b = this.burn;
    const pip = this.kind === "pip";
    const fireHud = this.toHud(this.fire);
    const cast = this.app.art.cast.value;

    // The nametags, just over each friend's companion's head and on the screen.
    const tags: Rect[] = [];
    if (!pip)
      for (const tag of placeTags(
        this.sitters().map((s) => {
          const entry = cast?.entries.get(s.person.spirit);
          const top = cast?.top(s.person.spirit) ?? null;
          // The head's top in the picture: the frame's top row with a pixel, or a guess while it loads.
          const head = entry && top !== null ? s.y - entry.foot.y + top : s.y - 14;
          const at = this.toHud({ x: s.x, y: head });
          return { name: s.person.name, w: textWidth(s.person.name) + 4, x: at.x, y: at.y - 2, front: s.y };
        }),
        c.W,
      )) {
        tags.push(tag.box);
        const burning = b?.who === tag.name && b.ev.closedAt === null;
        nameplate(c, tag.name, tag.x, tag.y, burning ? UI.gold : UI.text);
        if (tag.name === YOU)
          for (const at0 of this.cheers) if (t - at0 < 1.2) flameAbove(c, tag.x, tag.y - 9, t - at0);
      }

    if (pip) {
      // No queue to read it from, so whose cone it is rides over the fire.
      if (b && b.ev.closedAt === null)
        nameplate(c, b.mine ? "Your cone" : `${b.who}'s cone`, fireHud.x, fireHud.y - 40, UI.gold);
      this.pipCard(c, t, b ? (cast?.portrait(b.ev.spirit) ?? null) : null);
      return;
    }

    const narrow = this.kind === "phone";
    // The call: who is here.
    const people = this.people();
    const call = `${people.length} in voice`;
    const chipW = 4 + 7 + 4 + textWidth("Campfire") + 8 + textWidth(call) + 5;
    c.panel(3, 3, chipW, 15, mix(UI.purple, UI.popup, 0.35), 0.92, UI.body);
    flameIcon(c, 7, 6);
    drawText(c, "Campfire", 18, 7, UI.gold, { shadow: true });
    drawText(c, call, 18 + textWidth("Campfire") + 8, 7, UI.muted, { shadow: true });
    c.rect(18 + textWidth("Campfire") + 3, 10, 2, 2, [88, 196, 122]);

    // The burn queue; on a phone it gives way to the reveal's card, which opens at the top.
    const cardUp = !!b && t - b.ev.t0 >= cardAt(b.ev) && (b.ev.closedAt === null || t - b.ev.closedAt < 0.25);
    if (!narrow || !cardUp) this.queuePanel(c, narrow);

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
    const cheerHot = !!this.hudHover && inside(cheer, this.hudHover);
    c.panel(cheer.x, cheer.y, cheer.w, cheer.h, cheerHot ? UI.purpleHover : mix(UI.gold, UI.popup, 0.4), 0.94, UI.body);
    flameIcon(c, cheer.x + 6, cheer.y + 5);
    this.hits.cheer = cheer;

    // The cat's joke, over its stump.
    const cat = this.toHud(this.camp?.cat ?? CAT);
    if (t - this.catAt < 5)
      bubble(c, cat.x, cat.y - 12, JOKES[this.joke % JOKES.length] ?? "", narrow ? c.W - 8 : 150, tags);

    // The reveal's card, beside the fire.
    if (b) this.card(c, fireHud, b, t, cast?.portrait(b.ev.spirit) ?? null);
  }

  private queuePanel(c: Canvas, narrow: boolean): void {
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
      drawHead(c, name === YOU ? "you" : name, x + 5, ry - 1);
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
  }

  private card(c: Canvas, fire: Point, b: Burn, t: number, portrait: CastFrame | null): void {
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
      portrait,
    );
  }

  /** Picture in picture: no room for the full card, so what came out in one line over the fire. */
  private pipCard(c: Canvas, t: number, portrait: CastFrame | null): void {
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
    const w = Math.max(textWidth(sp.name, true), textWidth(rank) + 9) + 10 + 26;
    const h = 30;
    const x = Math.floor((c.W - w) / 2);
    const y = 4;
    c.panel(x, y, w, h, colour, 0.95, [24, 18, 36]);
    if (portrait) c.frame(portrait, x + 4 + Math.floor((22 - portrait.w) / 2), y + Math.floor((h - portrait.h) / 2));
    drawText(c, sp.name, x + 30, y + 5, colour, { bold: true, shadow: true });
    c.icon(GEM, { x: mix(colour, UI.ink, 0.25), X: mix(colour, [255, 255, 255], 0.35) }, x + 30, y + 17);
    drawText(c, rank, x + 38, y + 17, colour, { shadow: true });
  }

  // -------------------------------------------------------------------------------------------
  // Taps and keys.

  /** A tap on the sleeping cat, in the picture. */
  private onCat(world: Point): boolean {
    if (this.kind === "pip") return false;
    const cat = this.camp?.cat ?? CAT;
    const x = world.x + this.crop.x;
    const y = world.y + this.crop.y;
    return Math.abs(x - cat.x) <= 9 && y >= cat.y - 12 && y <= cat.y + 3;
  }

  pointer(world: Point, hud: Point, kind: PointerKind, t: number, touch: boolean): void {
    if (kind === "leave") {
      this.hudHover = null;
      this.cursor = "default";
      return;
    }
    this.hudHover = touch ? null : hud;
    const h = this.hits;
    const over = [h.leafle, h.queue, h.cheer].some((r) => r && inside(r, hud)) || this.onCat(world);
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
      this.cheers = [...this.cheers.filter((at) => t - at < 1.2), t];
      return;
    }
    if (this.onCat(world)) {
      this.catAt = t;
      this.joke++;
    }
  }

  key(key: string, t: number): void {
    if (key === "j") {
      this.catAt = t;
      this.joke++;
    }
  }
}

// ---------------------------------------------------------------------------------------------

const inside = (r: Rect, p: Point): boolean => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

/** Seconds from the throw to the reveal's card. */
const cardAt = (ev: ConeEvent): number => beatOf(ev.rank).burst + beatOf(ev.rank).card;

/** The fire's warmth on a sitter: its light over their pixels, stronger nearer the fire and by night. */
function warm(fx: Fx, f: CastFrame, x: number, y: number, flip: boolean, fire: Point): void {
  const lit = fx.ink.c("lantern_light");
  const most = fx.ambiance === "night" ? 0.4 : 0.22;
  const ox = Math.round(x) - (flip ? f.w - 1 - f.foot.x : f.foot.x);
  const oy = Math.round(y) - f.foot.y;
  for (let yy = 0; yy < f.h; yy++)
    for (let xx = 0; xx < f.w; xx++) {
      const v = f.strip.data[yy * f.strip.w + f.index * f.w + xx] ?? 0;
      if (v >>> 24 < 128) continue;
      const px = ox + (flip ? f.w - 1 - xx : xx);
      const py = oy + yy;
      const k = most * Math.max(0, 1 - Math.hypot(px - fire.x, (py - fire.y + 6) * 1.3) / 70);
      if (k > 0.01) fx.pic.light(px, py, lit, k);
    }
}

/** A player head in the HUD (the queue's rows): the 8x8 face on a dark edge. */
function drawHead(c: Canvas, seed: string, x: number, y: number): void {
  const px = playerHead(seed);
  c.rect(x - 1, y - 1, 10, 10, [16, 10, 14]);
  px.forEach((col, i) => c.px(x + (i % 8), y + Math.floor(i / 8), mix(col, [255, 168, 84], 0.08)));
}

/** A Minecraft nametag: the name on a dark see-through plate, centred over `x`. */
function nameplate(c: Canvas, text: string, x: number, y: number, colour: Rgb): void {
  const w = textWidth(text) + 4;
  const left = Math.round(x - w / 2);
  c.rect(left, y - 1, w, 10, [0, 0, 0], 0.32);
  drawText(c, text, left + 2, y + 1, colour);
}

/**
 * The cat's joke in a speech bubble over it, its tail pointing down at the cat. It sits clear of the
 * nametags (`avoid`): to one side if that does it, otherwise lifted, its tail a stalk down to the cat.
 */
function bubble(c: Canvas, x: number, y: number, text: string, maxW: number, avoid: readonly Rect[]): void {
  const lines = wrap(text, maxW - 10);
  const w = Math.max(...lines.map((l) => textWidth(l))) + 10;
  const h = lines.length * 10 + 7;
  const clampLeft = (l: number): number => Math.max(2, Math.min(c.W - w - 2, Math.round(l)));
  const base = Math.max(22, Math.round(y - h - 4));
  const clear = (l: number, t: number): boolean =>
    !avoid.some((r) => overlaps(r, { x: l - 1, y: t - 1, w: w + 2, h: h + 4 }));
  let left = clampLeft(x - w / 2);
  let top = base;
  const sides = [x - w / 2, x - w + 12, x - 12];
  const side = sides.map(clampLeft).find((l) => clear(l, base));
  if (side !== undefined) left = side;
  else while (top > 22 && !clear(left, top)) top -= 2;
  const cream: Rgb = [242, 230, 212];
  const ink: Rgb = [40, 28, 24];
  c.rect(left + 1, top + 1, w - 2, h - 2, cream);
  c.border(left, top, w, h, ink);
  const tx = Math.max(left + 3, Math.min(left + w - 5, Math.round(x)));
  // A lifted bubble's stalk, down to where its tail would have been.
  for (let yy = top + h + 1; yy < base + h; yy++) {
    c.px(tx + 1, yy, cream);
    c.px(tx, yy, ink);
    c.px(tx + 2, yy, ink);
  }
  const tail = Math.max(top, base);
  c.rect(tx, tail + h - 1, 3, 1, cream);
  c.rect(tx + 1, tail + h, 2, 1, cream);
  c.px(tx - 1, tail + h - 1, ink);
  c.px(tx, tail + h, ink);
  c.px(tx + 1, tail + h + 1, ink);
  c.px(tx + 2, tail + h + 1, ink);
  c.px(tx + 3, tail + h, ink);
  c.px(tx + 3, tail + h - 1, ink);
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
