/**
 * Drawing a frame of a place: the town, or a camp. It is drawn small, one art pixel to a pixel,
 * with dusk laid over it and the lights cut out of the dusk; then it is blown up to the screen, and
 * the words (name plates, speech, the prompt by a door) are written over it in the guild's font, a
 * whole number of screen pixels to each of the font's.
 */

import { emotePicture } from "@sequoia-leaf/kit/emotes.ts";
import { acornPicture, acornScale, FOLK_COLOUR } from "@sequoia-leaf/kit/mark.ts";
import { CREAM, GOLD, INK, SKY } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { bubble, bubbleSize, prompt, promptSize, wrap } from "@sequoia-leaf/kit/signs.ts";
import { FOOT_X, FOOT_Y, SIT, WALK } from "@sequoia-leaf/kit/skin.ts";
import { widthOf, write } from "@sequoia-leaf/kit/text.ts";
import { clamp, type Ctx, dist, lerp, makeCanvas, type Pt } from "@sequoia-leaf/kit/util.ts";

import { headOf, HOP, onScreen } from "./actors.ts";
import { bits, emoted, floaters, rings } from "./fx.ts";
import { type Actor, G, show } from "./game.ts";
import type { Light, Prop, Standing } from "./props.ts";
import type { Sprites } from "./sprites.ts";

/**
 * A place as it is drawn: its painted pieces and where each goes in the world, what stands in it,
 * who is there, and the parts of it that are its own to draw.
 */
export interface Picture {
  sprites: Sprites;
  /** The sunset behind the far trees: its picture, and where its top-left corner goes. */
  sky: HTMLCanvasElement;
  skyAt: Pt;
  ground: HTMLCanvasElement;
  groundAt: Pt;
  /** The dark ferns along the near edge, drawn over everything that walks. */
  near: HTMLCanvasElement;
  nearAt: Pt;
  props: readonly Prop[];
  /** Whatever else stands among the people: crabs, pets, a thing in the air. */
  others(): readonly Standing[];
  people(): readonly Actor[];
  lights(): Light[];
  /** Beyond the far trees: drawn over the sky and under the ground. */
  beyond(g: Ctx, cx: number, cy: number): void;
  /** On the ground, under everything that stands. */
  under(g: Ctx, cx: number, cy: number): void;
  /** Over everything that stands, before dusk falls. */
  over(g: Ctx, cx: number, cy: number): void;
  /** After dusk has fallen: whatever gives its own light. */
  glows(g: Ctx, cx: number, cy: number, spark: HTMLCanvasElement): void;
}

const buf = makeCanvas(320, 190, true);
const dusk = makeCanvas(320, 190, true);

function radial(stops: readonly (readonly [number, string])[]): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [at, col] of stops) gr.addColorStop(at, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return c;
}
/** A light's reach, as a hole to cut out of the dusk; and its warmth, to add after. */
const HOLE = radial([
  [0, "rgba(0,0,0,1)"],
  [0.35, "rgba(0,0,0,0.85)"],
  [0.7, "rgba(0,0,0,0.32)"],
  [1, "rgba(0,0,0,0)"],
]);
const WARM = radial([
  [0, "rgba(255,196,120,1)"],
  [0.4, "rgba(255,160,90,0.5)"],
  [1, "rgba(255,140,80,0)"],
]);
const SPARK = radial([
  [0, "rgba(255,236,170,1)"],
  [0.5, "rgba(255,200,110,0.35)"],
  [1, "rgba(255,180,90,0)"],
]);

export function sizeBuffers(w: number, h: number): void {
  for (const b of [buf, dusk]) {
    b.c.width = w;
    b.c.height = h;
    b.g.imageSmoothingEnabled = false;
  }
}

interface Item {
  z: number;
  prop: Prop | null;
  actor: Actor | null;
  other: Standing | null;
}
const order: Item[] = [];

/** A thing where it stands, shivering or hopping for a moment if it has just been touched. */
export function drawProp(g: Ctx, p: Prop, cx: number, cy: number): void {
  const since = G.t - p.bumpAt;
  let dx = 0;
  let dy = 0;
  if (since < 0.4) {
    const k = 1 - since / 0.4;
    if (p.hops) dy = -Math.round(Math.abs(Math.sin(since * 16)) * 4 * k);
    else dx = Math.round(Math.sin(since * 50) * 1.7 * k);
  }
  const sx = Math.round(p.x) - cx + dx;
  const sy = Math.round(p.y) - cy + dy;
  if (p.sprite) g.drawImage(p.sprite.c, sx - p.sprite.ax, sy - p.sprite.ay);
  p.extra?.(g, sx, sy);
}

/** Where someone is drawn this moment: on their feet, or part-way into a seat. */
function standing(a: Actor): Pt {
  if (!a.seat) return { x: a.x, y: a.y };
  const k = clamp((G.t - a.sat) / 0.22, 0, 1);
  return { x: lerp(a.seat.from.x, a.seat.x, k), y: lerp(a.seat.from.y, a.seat.y, k) - Math.sin(k * Math.PI) * 5 };
}

function hopOf(a: Actor): number {
  return a.hop > 0 ? Math.abs(Math.sin((1 - a.hop / HOP) * Math.PI)) * 5 : 0;
}

/** One of the town's own, in the picture for what it is doing: walking, asleep, counting, pleased. */
function drawFolk(g: Ctx, a: Actor, cx: number, cy: number, s: Sprites): void {
  const f = a.folk;
  if (!f) return;
  const art = f.art;
  const at = standing(a);
  const glad = a.hop > 0 || a.hops > 0;
  let pic = art.sit[0];
  let flip = false;
  if (a.moving) {
    const step = Math.floor(a.walked / 4) % 2;
    pic = (a.side > 0 ? art.walkR : art.walk)[step] ?? pic;
  } else if (a.doing === "asleep" || a.doing === "home") pic = art.sleep ?? pic;
  else if (glad && art.glad) pic = art.glad;
  else if (a.doing === "crabs" && art.bend) pic = art.bend;
  else if (a.doing === "board" && art.lean) pic = art.lean;
  else if (f.t.kind === "glorp" && Math.sin(G.t * 0.9 + a.x) > 0.985) pic = art.sit[1] ?? pic;
  // Sitting still, a cat and the fox look the way they last went (their pictures face left).
  if (!a.moving && (f.t.kind === "cat" || f.t.kind === "fox") && a.side > 0) flip = true;
  if (!pic) return;
  const x = Math.round(at.x) - cx;
  const y = Math.round(at.y - hopOf(a) - a.lift) - cy;
  g.globalAlpha = a.alpha;
  if (flip) {
    g.save();
    g.translate(x * 2, 0);
    g.scale(-1, 1);
    g.drawImage(pic.c, x - (pic.c.width - pic.ax), y - pic.ay + 1);
    g.restore();
  } else g.drawImage(pic.c, x - pic.ax, y - pic.ay + 1);
  if (a.mug > 0) g.drawImage(s.mug, x + (a.side > 0 ? 3 : -6), y - 6);
  g.globalAlpha = 1;
}

function drawActor(g: Ctx, a: Actor, cx: number, cy: number, s: Sprites): void {
  if (a.folk) {
    drawFolk(g, a, cx, cy, s);
    return;
  }
  const at = standing(a);
  const pose = a.seat ? SIT : a.moving ? (WALK[Math.floor(a.walked / 5) % 4] ?? 0) : 0;
  const frame = a.body?.frames[a.dir]?.[pose];
  if (!frame) return;
  const x = Math.round(at.x) - cx;
  const y = Math.round(at.y - hopOf(a)) - cy;
  g.globalAlpha = a.alpha;
  g.drawImage(frame, x - FOOT_X, y - FOOT_Y);
  const sunk = pose === SIT ? (a.dir === 0 ? 2 : 5) : 0;
  if (a.mug > 0 && a.dir !== 3) g.drawImage(s.mug, x + (a.dir === 1 ? -6 : 3), y - 9 + sunk);
  g.globalAlpha = 1;
}

export function pixelRing(g: Ctx, x: number, y: number, rx: number, ry: number, col: string): void {
  const n = Math.max(8, Math.round(rx * 3));
  g.fillStyle = col;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    g.fillRect(Math.round(x + Math.cos(a) * rx), Math.round(y + Math.sin(a) * ry), 1, 1);
  }
}

/** Half a ring of whole pixels, close together: the half towards the viewer (`front`), or the half away. */
function halfRing(g: Ctx, x: number, y: number, rx: number, ry: number, col: string, front: boolean): void {
  const n = Math.ceil(rx * 10);
  g.fillStyle = col;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    if (Math.sin(a) >= 0 !== front) continue;
    g.fillRect(Math.round(x + Math.cos(a) * rx), Math.round(y + Math.sin(a) * ry), 1, 1);
  }
}

/** The ring round the feet of somebody chosen in "Who is about", gently pulsing, gold round cream; one half of it. */
function foundRing(g: Ctx, cx: number, cy: number, front: boolean): void {
  const found = show.found;
  if (!found || G.t >= found.until) return;
  const at = found.a.seat ?? found.a;
  const r = 9 + Math.sin(G.t * 6);
  halfRing(g, at.x - cx, at.y - cy, r + 1, (r + 1) * 0.45, GOLD[2], front);
  halfRing(g, at.x - cx, at.y - cy, r, r * 0.45, GOLD[2], front);
  halfRing(g, at.x - cx, at.y - cy, r - 1, (r - 1) * 0.45, CREAM, front);
}

const smooth = (a: number, b: number, v: number): number => {
  const k = clamp((v - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

/** A whole place as it is this moment, small. */
export function drawPicture(pic: Picture): HTMLCanvasElement {
  const g = buf.g;
  const w = buf.c.width;
  const h = buf.c.height;
  const cx = Math.round(G.cam.x);
  const cy = Math.round(G.cam.y);
  const s = pic.sprites;
  const people = pic.people();

  // The sunset behind the far trees.
  g.fillStyle = "#141f1c";
  g.fillRect(0, 0, w, h);
  const skyY = pic.skyAt.y - cy;
  if (skyY < h) {
    if (skyY > 0) {
      g.fillStyle = SKY[0];
      g.fillRect(0, 0, w, skyY);
    }
    g.drawImage(pic.sky, pic.skyAt.x - cx, skyY);
  }
  pic.beyond(g, cx, cy);
  g.drawImage(pic.ground, pic.groundAt.x - cx, pic.groundAt.y - cy);
  pic.under(g, cx, cy);

  for (const r of rings) {
    const k = r.life / r.ttl;
    g.globalAlpha = 1 - k;
    pixelRing(g, r.x - cx, r.y - cy, 2 + r.r * k, (2 + r.r * k) * (r.flat ? 0.45 : 0.55), r.col);
  }
  g.globalAlpha = 1;
  if (show.dest) {
    const pulse = 3 + Math.sin(G.t * 9) * 1;
    pixelRing(g, show.dest.x - cx, show.dest.y - cy, pulse, pulse * 0.55, GOLD[2]);
    R(g, Math.round(show.dest.x) - cx, Math.round(show.dest.y) - cy, 1, 1, CREAM);
  }
  // Somebody chosen in "Who is about": the back of the ring round their feet, on the ground.
  foundRing(g, cx, cy, false);

  // Everything that stands up, far to near.
  order.length = 0;
  for (const p of pic.props) {
    const hit = p.hit;
    if (hit && (hit.x - cx > w + 8 || hit.x + hit.w - cx < -8 || hit.y - cy > h + 8 || hit.y + hit.h - cy < -30))
      continue;
    order.push({ z: p.z, prop: p, actor: null, other: null });
  }
  for (const a of people) {
    if (a.away || a.alpha <= 0.02) continue;
    order.push({ z: a.seat ? a.seat.y + 9 : a.y, prop: null, actor: a, other: null });
    if (!a.seat && a.lift === 0) {
      g.fillStyle = "rgba(20,10,28,0.34)";
      const lift = hopOf(a) > 2 ? 1 : 0;
      g.fillRect(Math.round(a.x) - 4 + lift - cx, Math.round(a.y) - 1 - cy, 8 - lift * 2, 2);
      g.fillRect(Math.round(a.x) - 3 + lift - cx, Math.round(a.y) - 2 - cy, 6 - lift * 2, 4);
    }
  }
  for (const o of pic.others()) order.push({ z: o.z, prop: null, actor: null, other: o });
  order.sort((a, b) => a.z - b.z);
  for (const it of order) {
    if (it.prop) drawProp(g, it.prop, cx, cy);
    else if (it.actor) drawActor(g, it.actor, cx, cy, s);
    else it.other?.paint(g, cx, cy);
  }

  // And its front, over anything in front of them, a log they sit on or a post, so it is always seen.
  foundRing(g, cx, cy, true);

  for (const b of bits) {
    if (b.glow) continue;
    g.globalAlpha = clamp((b.ttl - b.life) / (b.ttl * 0.4), 0, 1);
    R(g, Math.round(b.x) - cx, Math.round(b.y) - cy, b.size, b.size, b.col);
  }
  g.globalAlpha = 1;
  pic.over(g, cx, cy);
  g.drawImage(pic.near, pic.nearAt.x - cx, pic.nearAt.y - cy);

  // Dusk: lightest where the sunset comes in over the far hedge, deepest at the near edge; and
  // every lamp and fire cuts a soft hole in it. On the walk between two places night closes in
  // (`G.dark`): first everything the lamps do not reach, and then the lamps.
  const night = smooth(0, 0.75, G.dark);
  const out = smooth(0.55, 1, G.dark);
  const d = dusk.g;
  d.globalCompositeOperation = "source-over";
  d.globalAlpha = 1;
  d.clearRect(0, 0, w, h);
  const fall = d.createLinearGradient(0, 40 - cy, 0, 190 - cy);
  fall.addColorStop(
    0,
    `rgba(${lerp(32, 20, night)},${lerp(14, 10, night)},${lerp(50, 26, night)},${lerp(0.06, 0.96, night)})`,
  );
  fall.addColorStop(
    1,
    `rgba(${lerp(32, 20, night)},${lerp(14, 10, night)},${lerp(50, 26, night)},${lerp(0.46, 0.98, night)})`,
  );
  d.fillStyle = fall;
  d.fillRect(0, 0, w, h);
  d.globalCompositeOperation = "destination-out";
  const lamps = pic.lights();
  for (const l of lamps) {
    const r = l.r * (1 + l.boost * 0.3) * (1 - out * 0.6);
    if (l.x - cx + r < 0 || l.x - cx - r > w || l.y - cy + r < 0 || l.y - cy - r > h) continue;
    d.globalAlpha = clamp(l.power * (0.93 + 0.07 * Math.sin(G.t * 6 + l.phase)) + l.boost * 0.3, 0, 1) * (1 - out);
    d.drawImage(HOLE, l.x - cx - r, l.y - cy - r, r * 2, r * 2);
  }
  d.globalAlpha = 1;
  g.drawImage(dusk.c, 0, 0);
  g.globalCompositeOperation = "lighter";
  for (const l of lamps) {
    const r = l.r * (1 + l.boost * 0.3) * 0.9;
    if (l.x - cx + r < 0 || l.x - cx - r > w || l.y - cy + r < 0 || l.y - cy - r > h) continue;
    g.globalAlpha = clamp(0.13 * l.power + l.boost * 0.14, 0, 0.5) * (1 - out);
    g.drawImage(WARM, l.x - cx - r, l.y - cy - r, r * 2, r * 2);
  }
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;

  // Things that shine of themselves.
  pic.glows(g, cx, cy, SPARK);
  for (const b of bits) {
    if (!b.glow) continue;
    const a = clamp((b.ttl - b.life) / (b.ttl * 0.5), 0, 1);
    g.globalAlpha = a * 0.3;
    g.drawImage(SPARK, Math.round(b.x) - cx - 3, Math.round(b.y) - cy - 3, 7, 7);
    g.globalAlpha = a;
    R(g, Math.round(b.x) - cx, Math.round(b.y) - cy, b.size, b.size, b.col);
  }
  g.globalAlpha = 1;

  // Gold corners round whatever the mouse is resting on: it knows it is being looked at.
  if (show.hover) {
    const r = show.hover;
    const breathe = Math.sin(G.t * 6) > 0 ? 1 : 0;
    const x0 = Math.round(r.x) - cx - 2 + breathe;
    const y0 = Math.round(r.y) - cy - 2 + breathe;
    const x1 = Math.round(r.x + r.w) - cx + 1 - breathe;
    const y1 = Math.round(r.y + r.h) - cy + 1 - breathe;
    for (const [x, y, dx, dy] of [
      [x0, y0, 1, 1],
      [x1, y0, -1, 1],
      [x0, y1, 1, -1],
      [x1, y1, -1, -1],
    ] as const) {
      R(g, dx > 0 ? x : x - 2, y, 3, 1, GOLD[2]);
      R(g, x, dy > 0 ? y : y - 2, 1, 3, GOLD[2]);
    }
  }
  // The last of the walk: nothing left but the dark between the trees.
  if (out > 0) {
    g.globalAlpha = out;
    g.fillStyle = INK;
    g.fillRect(0, 0, w, h);
    g.globalAlpha = 1;
  }
  return buf.c;
}

// ---------- words, in the guild's font ----------

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const touching = (a: Box, b: Box, pad: number): boolean =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/** How far from the member somebody's name shows, in the town's pixels. */
const NAME_REACH = 44;
/** A sentence is broken into lines about this many font pixels wide. */
const SAY_WIDTH = 100;

/** How far each name plate has faded in, and the lines of what each person is saying. */
const plates = new WeakMap<Actor, number>();
/** Where above each person's head the words end this frame, on the canvas: the top of their plate, if it shows. */
const tops = new Map<Actor, number>();
const sayings = new WeakMap<Actor, { text: string; px: number; lines: string[] }>();
let wordsAt = 0;

function linesOf(ctx: Ctx, a: Actor, px: number): string[] {
  const had = sayings.get(a);
  if (had && had.text === a.say && had.px === px) return had.lines;
  const lines = wrap(ctx, a.say, SAY_WIDTH * px, px);
  sayings.set(a, { text: a.say, px, lines });
  return lines;
}

/**
 * Names and speech. A name shows only for whoever is near the member, pointed at, speaking, or
 * just arrived, and no two plates ever overlap: they are placed most wanted first, and one that would cover
 * another is left out.
 */
function drawPeople(ctx: Ctx, px: number, taken: readonly Box[], people: readonly Actor[]): void {
  const z = G.view.z;
  const cx = Math.round(G.cam.x);
  const cy = Math.round(G.cam.y);
  const wide = ctx.canvas.width;
  const dt = clamp(G.t - wordsAt, 0, 1);
  wordsAt = G.t;
  const p = G.player;
  const me = p ? (p.seat ?? p) : null;

  const wanted: { a: Actor; rank: number }[] = [];
  for (const a of people) {
    const at = a.seat ?? a;
    if (a.away || a.alpha < 0.5 || !onScreen(at.x, at.y, 4)) {
      plates.set(a, 0);
      continue;
    }
    const far = me ? dist(at.x, at.y, me.x, me.y) : 999;
    // Lower is more wanted; 9 and over is not wanted at all, and only fades out if there is room.
    const rank =
      a === show.pointed || a === show.found?.a
        ? 0
        : a.say
          ? 1
          : a.you
            ? 2
            : a === show.card
              ? 3
              : G.t < a.named
                ? 3.5
                : far < NAME_REACH && G.home
                  ? 4 + far / 100
                  : 9;
    wanted.push({ a, rank });
  }
  wanted.sort((m, n) => m.rank - n.rank);

  const placed: Box[] = [...taken];
  const pad = 2 * px;
  tops.clear();
  for (const { a, rank } of wanted) {
    const at = a.seat ?? a;
    const hx = Math.round((at.x - cx) * z);
    const hy = Math.round((at.y - cy - headOf(a)) * z);
    const name = a.who.name;
    // One of the town's own has the acorn before its name.
    const mark = a.folk ? acornScale(px) : 0;
    const acorn = mark > 0 ? acornPicture() : null;
    const markW = acorn ? acorn.width * mark + 2 * px : 0;
    const tw = widthOf(ctx, name, px) + markW;
    const plate: Box = {
      x: clamp(hx - Math.round(tw / 2) - 3 * px, pad, Math.max(pad, wide - tw - 6 * px - pad)),
      y: hy - 14 * px,
      w: tw + 6 * px,
      h: 12 * px,
    };
    const room = !placed.some((b) => touching(plate, b, pad));
    const now = room ? clamp((plates.get(a) ?? 0) + (rank < 9 ? dt : -dt) * 7, 0, 1) : 0;
    plates.set(a, now);
    let top = hy - 2 * px;
    if (now > 0.02) {
      placed.push(plate);
      top = plate.y - 2 * px;
      tops.set(a, top);
      ctx.globalAlpha = now * a.alpha * 0.62;
      ctx.fillStyle = INK;
      ctx.fillRect(plate.x, plate.y, plate.w, plate.h);
      ctx.globalAlpha = now * a.alpha;
      if (acorn) {
        const ah = acorn.height * mark;
        ctx.drawImage(acorn, plate.x + 2 * px, plate.y + Math.round((plate.h - ah) / 2), acorn.width * mark, ah);
      }
      write(ctx, name, plate.x + 3 * px + markW, plate.y + 2 * px, {
        px,
        colour: a.folk ? FOLK_COLOUR : a.you ? GOLD[2] : CREAM,
        shadow: false,
      });
    }
    if (!a.say) continue;
    const lines = linesOf(ctx, a, px);
    const size = bubbleSize(ctx, lines, px);
    const box: Box = {
      x: clamp(hx - Math.round(size.w / 2), pad, Math.max(pad, wide - size.w - pad)),
      y: top - size.h - 3 * px,
      w: size.w,
      h: size.h + 3 * px,
    };
    // Up out of the way of anything already said or named, as far as it will go.
    for (let tries = 0; tries < 4 && placed.some((b) => touching(box, b, pad)); tries++) box.y -= size.h + 5 * px;
    box.y = Math.max(pad, box.y);
    placed.push(box);
    ctx.globalAlpha = clamp(a.sayFor / 0.25, 0, 1);
    bubble(ctx, lines, box.x, box.y, px, hx);
  }
  ctx.globalAlpha = 1;
}

export function drawWords(ctx: Ctx, px: number, people: readonly Actor[]): void {
  show.sign = null;
  // Nothing is said in the dark between two places.
  if (G.dark > 0.5) return;
  const z = G.view.z;
  const cx = Math.round(G.cam.x);
  const cy = Math.round(G.cam.y);
  const wide = ctx.canvas.width;

  // The soft prompt by a place the member is standing at. Names and speech keep clear of it.
  const pl = show.promptT > 0.02 ? show.prompt : null;
  const key = show.touch ? "Tap" : "E";
  const sign: Box | null = pl
    ? (() => {
        const size = promptSize(ctx, key, pl.name, px);
        const x = clamp(
          Math.round((pl.prompt.x - cx) * z - size.w / 2),
          3 * px,
          Math.max(3 * px, wide - size.w - 3 * px),
        );
        return { x, y: Math.max(30 * px, Math.round((pl.prompt.y - cy) * z)), w: size.w, h: size.h };
      })()
    : null;
  if (sign) show.sign = { x: cx + sign.x / z, y: cy + sign.y / z, w: sign.w / z, h: sign.h / z };
  drawPeople(ctx, px, sign ? [sign] : [], people);

  // Emotes, floating up from whoever made them, over their name if it shows, and fading as they go:
  // drawn a scene pixel to each of theirs, in the light.
  ctx.imageSmoothingEnabled = false;
  for (const e of emoted) {
    if (e.a.away || e.a.alpha < 0.05) continue;
    const at = standing(e.a);
    const k = e.life / e.ttl;
    const icon = emotePicture(e.kind);
    const hx = Math.round((at.x - cx) * z);
    const head = Math.round((at.y - cy - hopOf(e.a) - headOf(e.a) - 3) * z);
    const y = Math.min(head, (tops.get(e.a) ?? head) - z) - (icon.height + Math.round(10 * k)) * z;
    ctx.globalAlpha = e.a.alpha * clamp((1 - k) / 0.3, 0, 1) * clamp(k / 0.08, 0, 1);
    ctx.drawImage(icon, hx - Math.floor(icon.width / 2) * z, y, icon.width * z, icon.height * z);
  }
  ctx.globalAlpha = 1;

  // Words that rise and fade.
  for (const f of floaters) {
    const lines = wrap(ctx, f.text, wide - 12 * px, px, true);
    ctx.globalAlpha = clamp((f.ttl - f.life) / 0.4, 0, 1);
    lines.forEach((line, i) => {
      const half = Math.round(widthOf(ctx, line, px, true) / 2) + 2 * px;
      const x = clamp(Math.round((f.x - cx) * z), half, Math.max(half, wide - half));
      const y = Math.round((f.y - cy) * z) + (i - lines.length) * 11 * px;
      write(ctx, line, x, y, { px, bold: true, colour: f.col, align: "center", edge: INK });
    });
  }
  ctx.globalAlpha = 1;

  if (pl && sign) {
    const bob = Math.round(Math.sin(G.t * 3)) * px;
    ctx.globalAlpha = show.promptT;
    prompt(ctx, key, pl.name, sign.x, sign.y + bob - Math.round((1 - show.promptT) * 3) * px, px);
    ctx.globalAlpha = 1;
  }
}

/**
 * The view closing in on a point, as a round hole in the dark with hard, blocky edges. `r` is the
 * hole's radius in canvas pixels and `block` the size of one of the scene's pixels.
 */
export function drawIris(ctx: Ctx, x: number, y: number, r: number, block: number): void {
  const wide = ctx.canvas.width;
  const tall = ctx.canvas.height;
  for (let y0 = 0; y0 < tall; y0 += block) {
    const dy = y0 + block / 2 - y;
    const half = Math.abs(dy) < r ? Math.sqrt(r * r - dy * dy) : 0;
    if (half <= 0) {
      ctx.fillStyle = INK;
      ctx.fillRect(0, y0, wide, block);
      continue;
    }
    const left = Math.floor((x - half) / block) * block;
    const right = Math.ceil((x + half) / block) * block;
    ctx.fillStyle = INK;
    ctx.fillRect(0, y0, left, block);
    ctx.fillRect(right, y0, wide - right, block);
    // A rim, like the edge of a doorway.
    ctx.fillStyle = SKY[1];
    ctx.fillRect(left, y0, block, block);
    ctx.fillRect(right - block, y0, block, block);
  }
}
