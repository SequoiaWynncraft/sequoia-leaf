/**
 * Main Street: the guild's home as one long street on the forest floor at dusk. The member walks
 * it as their own block-game character; every place is a door, a stall or a spot along it; and
 * guild-mates stroll it too. This file is the street alive: the camera, the walkers, what the guild
 * does, and what answers a touch.
 */
import { C, clamp, dice, glow, iconSprite, lerp, mix, pick, rect, rgba, type Sprite, sprite } from "./art.ts";
import {
  AWAY,
  CHEERS,
  CINFY_LINES,
  CINFY_NO,
  CINFY_THANKS,
  CRAB_NAMES,
  GREETINGS,
  HANDLES,
  HELLOS,
  LINES,
  me,
  PLACE_LINES,
  RAIDS,
  RANKS,
  TERRITORIES,
  type WareId,
  WARES,
} from "./data.ts";
import { type Moving, paintPlaces } from "./places.ts";
import {
  DEPTH,
  type Frame,
  frameFor,
  paintBack,
  paintCloud,
  paintFar,
  paintFern,
  paintFlower,
  paintFringe,
  paintFrontTrunk,
  paintMushroom,
  paintSky,
  paintStreetBase,
  paintSun,
  paintVignette,
} from "./scene.ts";
import {
  type Body,
  bodyForLook,
  bodyFrom,
  CINFY,
  drawBody,
  loadSkin,
  lookFor,
  portrait,
  type Pose,
  restPose,
} from "./skin.ts";
import { isMuted, setMuted, sfx, wake } from "./sound.ts";
import * as ui from "./ui.ts";
import {
  FIRE_X,
  hangings,
  LAMPS,
  type Place,
  place,
  type PlaceId,
  PLACES,
  POND_RX,
  POND_X,
  sagAt,
  SEATS,
  SPANS,
  STALLS,
  TRUNKS,
  WORKS_DOOR,
  WORKS_X,
  WW,
} from "./world.ts";

const canvasEl = document.querySelector<HTMLCanvasElement>("#view");
if (!canvasEl) throw new Error("the page has no canvas");
const canvas = canvasEl;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("this browser gives no 2d canvas");
const g = ctx;
const FONT = 'ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace';
const roll = Math.random;

// ---------- the view ----------

let S = 3;
let dpr = 1;
let F: Frame = frameFor(427, 253);
let fontPx = 13;

interface Painted {
  sky: Sprite;
  far: Sprite;
  mid: Sprite;
  near: Sprite;
  back: Sprite;
  street: Sprite;
  moving: Moving;
  fringe: { top: Sprite; foot: Sprite };
  fronts: { x: number; s: Sprite; fade: number }[];
}
let art: Painted | null = null;

const sun = paintSun();
const clouds = [0, 1, 2, 3, 4].map((i) => ({
  s: paintCloud(40 + i * 9, i % 2 ? mix(C.sky3, C.sky4, 0.5) : mix(C.sky2, C.sky3, 0.6), i % 2 ? C.sky5 : C.sky4),
  x: i * 190 + 30,
  y: 0.2 + ((i * 37) % 50) / 100,
  drift: 1.2 + (i % 3) * 0.7,
}));
const vignette = paintVignette();
const light = {
  lamp: glow(22, C.gold1, 0.3),
  pool: glow(26, C.gold0, 0.18, 4),
  small: glow(9, C.gold2, 0.34, 4),
  fire: glow(58, C.sky5, 0.34, 6),
  door: glow(30, C.gold1, 0.26),
  fly: glow(3, C.gold2, 0.5, 3),
  pink: glow(14, C.sky4, 0.3),
};

function fit(): void {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(200, Math.round(innerWidth * dpr));
  const h = Math.max(200, Math.round(innerHeight * dpr));
  canvas.width = w;
  canvas.height = h;
  S = Math.max(1, Math.min(Math.floor(w / 190), Math.floor(h / 225)));
  F = frameFor(Math.ceil(w / S), Math.ceil(h / S));
  fontPx = Math.round(Math.max(4.4 * S, 11 * dpr));
  const street = paintStreetBase(F);
  const moving = paintPlaces(street.g, F);
  // The strings between the trunks: fixed, so they are painted once.
  for (const span of SPANS) {
    for (let x = Math.ceil(span.x0); x <= span.x1; x++) rect(street.g, x, F.sy + sagAt(span, x), 1, 1, C.bark0);
    rect(street.g, span.x0 - 1, F.sy - 1, 3, 3, C.gold0);
    rect(street.g, span.x1 - 1, F.sy - 1, 3, 3, C.gold0);
  }
  // Dark trunks that pass in front, set between the places so none stands over a door.
  const frontAt = (worldX: number): number => worldX * DEPTH.front - (DEPTH.front - 1) * (F.vw / 2);
  const fronts = [-60, 426, 990, 1318, 1672, WW + 70].map((x, i) => ({
    x: frontAt(x),
    s: paintFrontTrunk(F, 70 + i, i % 2 ? 26 : 34),
    fade: 1,
  }));
  art = {
    sky: paintSky(F),
    far: paintFar(F, DEPTH.far, mix(C.sky4, C.sky5, 0.45), 24, 3, false),
    mid: paintFar(F, DEPTH.mid, mix(C.sky3, C.sky4, 0.3), 40, 7, false),
    near: paintFar(F, DEPTH.near, mix(C.sky1, C.sky2, 0.6), 78, 11, true),
    back: paintBack(F),
    street,
    moving,
    fringe: paintFringe(512),
    fronts,
  };
}

// ---------- people ----------

interface Walker {
  name: string;
  body: Body;
  x: number;
  /** How far in front of (or behind) the walking line they stand, in pixels. */
  z: number;
  lane: number;
  face: 1 | -1;
  vx: number;
  walk: number;
  stride: number;
  sit: number;
  cheer: number;
  wave: number;
  reach: number;
  hop: number;
  hopV: number;
  squash: number;
  blink: number;
  tall: boolean;
  say: Bubble | null;
  pitch: number;
}
interface Bubble {
  text: string;
  age: number;
  life: number;
  lines: string[] | null;
  width: number;
  font: number;
  icon: string | null;
}
interface Mate extends Walker {
  index: number;
  rank: string;
  level: number;
  stand: Sprite;
  head: Sprite;
  state: "walk" | "idle" | "sit";
  goal: number;
  at: PlaceId | null;
  wait: number;
  seat: number;
  speed: number;
  greeted: number;
  cheerIn: number;
  waveFor: number;
  cheerFor: number;
}

function headShot(b: Body): Sprite {
  const s = sprite(13, 12);
  s.g.drawImage(b.head.c, 1, 4, 13, 12, 0, 0, 13, 12);
  return s;
}

function walker(name: string, body: Body, x: number, lane: number, tall: boolean, pitch: number): Walker {
  return {
    name,
    body,
    x,
    z: lane,
    lane,
    face: 1,
    vx: 0,
    walk: 0,
    stride: 0,
    sit: 0,
    cheer: 0,
    wave: 0,
    reach: 0,
    hop: 0,
    hopV: 0,
    squash: 1,
    blink: 2 + roll() * 4,
    tall,
    say: null,
    pitch,
  };
}

const SPAWN = 640;
let playerBody: Body = bodyForLook(lookFor(991));
let playerSheet: HTMLImageElement | null = null;
const player = {
  ...walker(me.name, playerBody, SPAWN - 86, 1, false, 520),
  target: SPAWN as number | null,
  onArrive: null as (() => void) | null,
  seat: -1,
  waveFor: 0,
  cheerFor: 0,
  reachFor: 0,
  mallow: 0,
  stepSide: false,
};
let playerStand: Sprite = portrait(playerBody);
let playerHead: Sprite = headShot(playerBody);

const LANES = [-3, 3, -1, 5, -4, 2, 4, -2, 0];
const mates: Mate[] = HANDLES.map((name, i) => {
  const look = lookFor(i * 3 + 5);
  const body = bodyForLook(look);
  const lane = LANES[i % LANES.length] ?? 0;
  const tall = look.hat === "wizard" || look.hat === "feather" || look.hat === "sprout" || look.hat === "beanie";
  return {
    ...walker(name, body, 200 + ((i * 577) % (WW - 400)), lane, tall, 380 + i * 55),
    index: i,
    rank: RANKS[(i * 2 + 1) % RANKS.length] ?? "Ranger",
    level: 31 + ((i * 17) % 60),
    stand: portrait(body),
    head: headShot(body),
    state: "idle",
    goal: 0,
    at: null,
    wait: 1 + roll() * 4,
    seat: -1,
    speed: 24 + ((i * 7) % 12),
    greeted: 0,
    cheerIn: -1,
    waveFor: 0,
    cheerFor: 0,
  };
});
const seatOf: (Walker | null)[] = SEATS.map(() => null);

const cinfyBody = bodyForLook(CINFY);
const cinfyHead = (() => {
  const s = sprite(13, 12);
  s.g.drawImage(cinfyBody.front.head.c, 3, 4);
  return s;
})();
const cinfy = {
  wave: 0,
  toss: 0,
  blink: 3,
  say: null as Bubble | null,
  line: pick(CINFY_LINES, roll()),
  greeted: false,
};

function speak(
  who: { say: Bubble | null; pitch?: number; x?: number },
  text: string,
  icon: string | null = null,
  life = 3.4,
): void {
  who.say = { text, age: 0, life, lines: null, width: 0, font: 0, icon };
  if (who.pitch && who.x !== undefined && onScreen(who.x, 30)) sfx.speak(who.pitch, text.split(" ").length + 1);
}

// ---------- the street's own memory: lanterns, banners ----------

const { lanterns, banners } = hangings();
{
  const r = dice(2026);
  const party = (): string => `${pick(HANDLES, r())}, ${pick(HANDLES, r())} and ${pick(HANDLES, r())}`;
  for (const l of lanterns) {
    if (r() < 0.42) {
      l.lit = true;
      l.note = `Lit for ${pick(RAIDS, r())} — ${party()}`;
    }
  }
  [1, 4, 6, 9].forEach((slot, k) => {
    const b = banners[slot % banners.length];
    if (!b) return;
    b.name = TERRITORIES[k + 4] ?? "Owlwatch";
    b.note = `${b.name} — held since ${["Tuesday", "last week", "the first frost", "yesterday"][k] ?? "yesterday"}`;
    b.colour = k % 4;
  });
}
let nameLantern = { hung: false, age: 99 };

// ---------- small moving things ----------

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  pull: number;
  age: number;
  life: number;
  size: number;
  colour: string;
  /** 0: behind the walkers; 1: in front of them; 2: a light, added on top. */
  layer: 0 | 1 | 2;
  shrink: boolean;
  drag: number;
}
const bits: Bit[] = [];
function bit(b: Partial<Bit> & { x: number; y: number; colour: string }): void {
  if (bits.length > 520) bits.shift();
  bits.push({ vx: 0, vy: 0, pull: 0, age: 0, life: 1, size: 1, layer: 1, shrink: false, drag: 0, ...b });
}
function burst(x: number, y: number, colours: readonly string[], n: number, speed = 40, depth: 0 | 1 | 2 = 1): void {
  for (let i = 0; i < n; i++) {
    const a = roll() * Math.PI * 2;
    const v = speed * (0.4 + roll() * 0.6);
    bit({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - speed * 0.5,
      pull: 120,
      life: 0.5 + roll() * 0.6,
      size: roll() < 0.3 ? 2 : 1,
      colour: pick(colours, roll()),
      layer: depth,
    });
  }
}
const SPARK = [C.gold3, C.gold2, C.gold1, C.sky4];

/** A spark on its way somewhere: it flies an arc, sheds a trail, and does something on arriving. */
interface Courier {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  dur: number;
  x: number;
  y: number;
  done: () => void;
}
const couriers: Courier[] = [];
const CONFETTI = [C.gold1, C.sky4, C.sky5, C.green4, C.gold3, C.sky3];

interface Float {
  x: number;
  y: number;
  text: string;
  age: number;
  life: number;
  colour: string;
}
const floats: Float[] = [];
function float(x: number, y: number, text: string, colour: string = C.gold2, life = 1.6): void {
  floats.push({ x, y, text, age: 0, life, colour });
}

interface Tuft {
  x: number;
  y: number;
  s: Sprite;
  kick: number;
  phase: number;
  front: boolean;
  kind: "fern" | "shroom" | "flower";
}
const tufts: Tuft[] = [];
const bigFerns: { x: number; s: Sprite; kick: number; phase: number }[] = [];
{
  const r = dice(808);
  const green: [string, string, string] = [C.green1, C.green2, C.green3];
  const greenDim: [string, string, string] = [C.green0, C.green1, C.green2];
  const shade: [string, string, string] = [
    mix(C.green0, "#150b18", 0.7),
    mix(C.green0, "#150b18", 0.45),
    mix(C.green1, "#150b18", 0.4),
  ];
  const ferns = [0, 1, 2].map((i) => paintFern(11 + i, 8 + i * 2, green));
  const fernsFront = [0, 1, 2].map((i) => paintFern(21 + i, 9 + i * 2, greenDim));
  const flowers = [C.sky4, C.gold2, C.gold3, C.sky5].map((c) => paintFlower(c));
  const shrooms = [paintMushroom(false, 0), paintMushroom(true, 0)];
  const keepOut: (readonly [number, number])[] = [
    [96, 142],
    [300, 362],
    [468, 574],
    [690, 846],
    [1010, 1152],
    [1326, 1534],
    [1664, 1846],
    ...LAMPS.map((x) => [x - 4, x + 10] as const),
  ];
  const clear = (x: number): boolean => !keepOut.some(([a, b]) => x > a && x < b);
  let n = 0;
  for (let x = 70; x < WW - 60; x += 23) {
    const at = x + Math.floor(r() * 7) - 3;
    n++;
    if (!clear(at)) continue;
    if (n % 2 === 0)
      tufts.push({ x: at, y: -7, s: pick(ferns, r()), kick: 0, phase: r() * 6, front: false, kind: "fern" });
    else if (n % 4 === 1)
      tufts.push({ x: at, y: -7, s: pick(flowers, r()), kick: 0, phase: r() * 6, front: false, kind: "flower" });
    else tufts.push({ x: at, y: -7, s: pick(shrooms, r()), kick: 0, phase: r() * 6, front: false, kind: "shroom" });
  }
  for (let x = 30; x < WW; x += 31) {
    const at = x + Math.floor(r() * 9) - 4;
    n++;
    if (n % 5 === 0)
      tufts.push({ x: at, y: 17, s: pick(shrooms, r()), kick: 0, phase: r() * 6, front: true, kind: "shroom" });
    else if (n % 5 === 3)
      tufts.push({ x: at, y: 17, s: pick(flowers, r()), kick: 0, phase: r() * 6, front: true, kind: "flower" });
    else tufts.push({ x: at, y: 18, s: pick(fernsFront, r()), kick: 0, phase: r() * 6, front: true, kind: "fern" });
  }
  const big = [0, 1, 2].map((i) => paintFern(31 + i, 17 + i * 4, shade));
  for (let x = 20; x < WW * DEPTH.front + 200; x += 74)
    bigFerns.push({ x: x + Math.floor(r() * 20), s: pick(big, r()), kick: 0, phase: r() * 6 });
}

const fireflies = Array.from({ length: 34 }, (_, i) => ({
  x: (i * 61.8) % WW,
  h: 14 + ((i * 29) % 80),
  phase: i * 1.7,
  speed: 0.5 + (i % 5) * 0.14,
}));

// ---------- crabs ----------

interface Crab {
  n: number;
  x: number;
  z: number;
  vx: number;
  pause: number;
  hop: number;
  hopV: number;
  tag: number;
  /** Running home after being found, or wandering off to go missing. */
  errand: "none" | "home" | "away";
}
const crabs: Crab[] = [];
for (let n = 1; n <= CRAB_NAMES.length; n++) {
  if (n === me.missing) continue;
  crabs.push({
    n,
    x: POND_X - POND_RX + ((n * 53) % (POND_RX * 2)),
    z: -5 + ((n * 7) % 11),
    vx: 0,
    pause: roll() * 3,
    hop: 0,
    hopV: 0,
    tag: 0,
    errand: "none",
  });
}
/** Where a stray crab may be found: along the street, and how high above the building line. */
const HIDES: readonly { readonly x: number; readonly up: number; readonly where: string }[] = [
  { x: 313, up: 50, where: "on the quest board's roof" },
  { x: 534, up: 73, where: "on the Treasury's beam" },
  { x: STALLS[1] ?? 812, up: 56, where: "on a market awning" },
  { x: FIRE_X + 67, up: 9, where: "on the woodpile" },
  { x: WORKS_X + 20, up: 64, where: "on top of the Works" },
  { x: 118, up: 41, where: "on the signpost" },
  { x: STALLS[0] ?? 722, up: 56, where: "on a market awning" },
];
const stray = { n: me.missing, hide: 0, peek: 0, gone: false, back: 0 };
const rollCall = { on: false, i: 0, t: 0 };
const ripples: { x: number; age: number }[] = [];

// ---------- the camera ----------

const cam = { x: SPAWN - 213, look: 0, lookV: 0, held: 0, lift: 0, bias: 0, lead: 0 };
let now = 0;
let clock = 0;
let panelGeom = { bias: 0, lift: 0 };

const onScreen = (x: number, margin = 0): boolean => x > cam.x - margin && x < cam.x + F.vw + margin;
const cssScale = (): number => S / dpr;
/** A point of the street, as a point of the page. */
function toPage(x: number, y: number): { x: number; y: number } {
  return { x: (x - cam.x) * cssScale(), y: (y - cam.lift) * cssScale() };
}

function measurePanel(): void {
  const sheetBox = ui.panelBox();
  if (!sheetBox) {
    panelGeom = { bias: 0, lift: 0 };
    return;
  }
  const sheet = sheetBox.width > innerWidth * 0.8;
  panelGeom = sheet
    ? { bias: 0, lift: Math.max(0, F.wy + 18 - (sheetBox.top - 4) / cssScale()) }
    : { bias: (innerWidth - sheetBox.left) / 2 / cssScale(), lift: 0 };
}

// ---------- what the guild does ----------

const SCRIPT: readonly ("raid" | "land" | "level")[] = ["raid", "land", "level", "raid"];
let eventsDone = 0;
let nextEvent = 26;
let collected = false;
let chatter = 4;
let sunPulse = 0;
let gearBoost = 0;
let signKick = 0;
let fireFlare = 0;
let boardFlutter = 0;
let coinTick = 5;
let questMark = 0;
let lastInput: "key" | "mouse" | "touch" = matchMedia("(pointer: coarse)").matches ? "touch" : "mouse";
let marker: { x: number; age: number } | null = null;
let tip: { x: number; y: number; text: string; age: number } | null = null;
let rustled = 0;
let cricket = 3;

function cheerAll(spot: number): void {
  let said = false;
  for (const m of mates) {
    if (!onScreen(m.x, 80)) continue;
    m.cheerIn = roll() * 0.5;
    if (!said && m.state !== "walk") {
      said = true;
      setTimeout(() => speak(m, pick(CHEERS, roll())), 350);
    }
  }
  if (onScreen(spot, 40) && player.sit < 0.5) {
    player.cheerFor = 1.1;
    player.hopV = 70;
  }
}

function guildEvent(kind: "raid" | "land" | "level"): void {
  const mid = cam.x + F.vw / 2;
  if (kind === "raid") {
    const dark = lanterns.filter((l) => !l.lit);
    const pool = dark.length ? dark : lanterns;
    const l = pool.reduce((best, x) => (Math.abs(x.x - mid) < Math.abs(best.x - mid) ? x : best));
    const lead = pick(HANDLES, roll());
    const raid = pick(RAIDS, roll());
    const others = HANDLES.filter((h) => h !== lead);
    l.note = `Lit for ${raid} — ${lead}, ${pick(others, roll())} and ${pick(others, roll())}`;
    ui.news("lantern", `*${lead}'s party* cleared ${raid}. A lantern is lit.`);
    // A spark comes up off the street and carries the flame to it.
    couriers.push({
      x0: l.x + (roll() < 0.5 ? -1 : 1) * (26 + roll() * 30),
      y0: F.wy - 4,
      x1: l.x,
      y1: F.sy + l.drop + 6,
      t: 0,
      dur: 0.95,
      x: 0,
      y: 0,
      done() {
        l.lit = true;
        l.age = 0;
        l.swing = 1;
        sfx.chime();
        burst(l.x, F.sy + l.drop + 6, SPARK, 18, 46, 2);
        cheerAll(l.x);
      },
    });
    sfx.sparkle();
    const q = me.quests.find((quest) => quest.id === "lanterns");
    if (q && !q.claimed && q.have < q.need) {
      q.have++;
      if (q.have >= q.need) {
        ui.news("scroll", "Quest ready: *twelve lanterns* are lit. Claim it at the board.");
        questMark = 0;
      }
      ui.questDot();
      if (ui.openNow() === "quests") ui.refresh();
    }
  } else if (kind === "land") {
    const empty = banners.filter((b) => b.name === null);
    const pool = empty.length ? empty : banners;
    const b = pool.reduce((best, x) => (Math.abs(x.x - mid) < Math.abs(best.x - mid) ? x : best));
    const used = new Set(banners.map((x) => x.name));
    const fresh = TERRITORIES.filter((t) => !used.has(t));
    const name = pick(fresh.length ? fresh : TERRITORIES, roll());
    const lead = pick(HANDLES, roll());
    b.name = name;
    b.age = 0;
    b.flutter = 1;
    b.colour = Math.floor(roll() * 4);
    b.note = `${name} — won tonight, ${lead} leading`;
    ui.news("banner", `The guild holds *${name}*. A banner goes up.`);
    sfx.fanfare();
    burst(b.x, F.sy + b.drop + 10, CONFETTI, 30, 60);
    cheerAll(b.x);
  } else {
    const near = mates.filter((m) => onScreen(m.x, 20) && m.state !== "sit");
    const m = pick(near.length ? near : mates, roll());
    m.level++;
    m.cheerIn = 0;
    ui.news("star", `*${m.name}* reached level ${m.level}.`);
    if (onScreen(m.x, 40)) sfx.levelUp();
    float(m.x, F.wy + m.z - 56, `LEVEL ${m.level}`, C.gold2, 2.2);
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      bit({
        x: m.x + Math.cos(a) * 9,
        y: F.wy + m.z - 16 + Math.sin(a) * 4,
        vy: -34 - roll() * 20,
        life: 0.9,
        colour: pick(SPARK, roll()),
        layer: 2,
      });
    }
    for (const other of mates) {
      if (other !== m && Math.abs(other.x - m.x) < 90 && other.state !== "walk") {
        other.face = m.x > other.x ? 1 : -1;
        other.waveFor = 1.4;
      }
    }
  }
  eventsDone++;
}

// ---------- the member's doings ----------

/** Gives up a seat the member was on their way to, if they never sat. */
function releaseSeat(): void {
  if (me.seated) return;
  seatOf.forEach((who, i) => {
    if (who === player) seatOf[i] = null;
  });
}

function walkTo(x: number, onArrive: (() => void) | null = null): void {
  if (me.seated) standUp();
  releaseSeat();
  player.target = clamp(x, 44, WW - 50);
  player.onArrive = onArrive;
  cam.look = 0;
}

function standUp(): void {
  if (!me.seated) return;
  me.seated = false;
  if (player.seat >= 0) seatOf[player.seat] = null;
  player.seat = -1;
  player.hopV = 40;
  if (ui.openNow() === "fire") ui.refresh();
}

function sitDown(): void {
  if (me.seated) {
    standUp();
    return;
  }
  const free = SEATS.map((s, i) => ({ s, i })).filter(({ i }) => !seatOf[i]);
  // A full fire makes room: whoever has sat longest gets up.
  if (!free.length) {
    const m = mates.find((x) => x.state === "sit");
    if (m) leaveSeat(m);
  }
  const open = SEATS.map((s, i) => ({ s, i })).filter(({ i }) => !seatOf[i]);
  const best = open.reduce<{ s: (typeof SEATS)[number]; i: number } | null>(
    (b, c) => (!b || Math.abs(c.s.x - player.x) < Math.abs(b.s.x - player.x) ? c : b),
    null,
  );
  if (!best) return;
  seatOf[best.i] = player;
  walkTo(best.s.x, () => {
    me.seated = true;
    player.seat = best.i;
    player.face = best.s.face;
    sfx.sit();
    burst(player.x, F.by - 2, [C.earth2, C.earth1], 5, 18, 0);
    for (const m of mates)
      if (m.state === "sit" && roll() < 0.7)
        setTimeout(
          () => speak(m, pick(["Budge up.", "Evening!", "Pull up a log.", "Oh good, you're here."], roll())),
          300 + roll() * 900,
        );
    if (ui.openNow() === "fire") ui.refresh();
  });
  seatOf[best.i] = player;
}

function emote(kind: ui.Emote): void {
  const y = F.wy + player.z - 40;
  if (kind === "wave") {
    player.waveFor = 1.6;
    speak(player, "", "wave", 1.6);
    sfx.tap();
  } else if (kind === "laugh") {
    player.hopV = 46;
    speak(player, "", "laugh", 1.6);
    sfx.laugh();
    setTimeout(() => (player.hopV = 40), 260);
  } else if (kind === "cheer") {
    player.cheerFor = 1.3;
    if (!me.seated) player.hopV = 74;
    burst(player.x, y + 6, CONFETTI, 18, 50);
    sfx.cheer();
  } else if (kind === "sing") {
    speak(player, "", "note", 2.2);
    sfx.song();
    for (let i = 0; i < 5; i++)
      setTimeout(
        () =>
          bit({
            x: player.x + 4 + roll() * 6,
            y: F.wy + player.z - 34,
            vx: 6 + roll() * 8,
            vy: -16,
            life: 1.4,
            size: 2,
            colour: C.gold2,
            layer: 2,
          }),
        i * 180,
      );
  } else {
    player.reachFor = 5.2;
    player.mallow = 0.001;
    player.face = FIRE_X > player.x ? 1 : -1;
    sfx.tap();
  }
  // Whoever is round the fire joins in, a beat late.
  mates.forEach((m) => {
    if (Math.abs(m.x - player.x) > 110 || m.state === "walk" || roll() < 0.3) return;
    const wait = 450 + roll() * 700;
    setTimeout(() => {
      if (kind === "wave") m.waveFor = 1.3;
      else if (kind === "cheer") m.cheerFor = 1.1;
      else if (kind === "laugh") speak(m, pick(["Ha!", "Hee hee.", "Snrk."], roll()));
      else if (kind === "sing") speak(m, "", "note", 1.8);
      else speak(m, pick(["Golden brown, now.", "Don't let it…", "Share?"], roll()));
    }, wait);
  });
}

function rebuildPlayer(): void {
  const hat = me.owned.has("cap") ? "acorn" : "none";
  playerBody = playerSheet
    ? bodyFrom(playerSheet, playerSheet.naturalHeight, hat)
    : bodyForLook({ ...lookFor(991), hat });
  player.body = playerBody;
  player.tall = hat === "acorn";
  playerStand = portrait(playerBody);
  playerHead = headShot(playerBody);
}

/** Leaf icons from the purse to a point on the page: what paying looks like. */
function payFrom(to: { x: number; y: number }, n: number): void {
  const from = ui.purseAt("leaf");
  ui.bump("leaf");
  for (let i = 0; i < n; i++)
    ui.fly(
      iconSprite("leaf"),
      from,
      { x: to.x + (roll() - 0.5) * 16, y: to.y + (roll() - 0.5) * 10 },
      { ms: 420, delay: i * 55, arc: -30, size: 20 },
    );
}

function landOnPlayer(colours: readonly string[]): void {
  burst(player.x, F.wy + player.z - 18, colours, 26, 56, 2);
  if (!me.seated) player.hopV = 78;
  player.cheerFor = 0.9;
  player.squash = 0.82;
  sfx.sparkle();
}

function buy(id: WareId): boolean {
  const ware = WARES.find((w) => w.id === id);
  if (!ware || me.owned.has(id)) return false;
  const door = place("treasury");
  if (me.leaf < ware.price) {
    ui.bump("leaf", true);
    sfx.nope();
    cinfy.say = { text: pick(CINFY_NO, roll()), age: 0, life: 3, lines: null, width: 0, font: 0, icon: null };
    cinfy.line = cinfy.say.text;
    ui.refresh();
    return false;
  }
  me.leaf -= ware.price;
  me.owned.add(id);
  sfx.buy();
  const counter = toPage(door.x, F.by - 26);
  payFrom(counter, Math.min(8, Math.ceil(ware.price / 20)));
  cinfy.toss = 1;
  cinfy.wave = 1.4;
  const thanks = pick(CINFY_THANKS, roll());
  cinfy.line = thanks;
  setTimeout(() => {
    cinfy.say = { text: thanks, age: 0, life: 3, lines: null, width: 0, font: 0, icon: null };
    // Cinfy tosses it: to the member, or, for the lantern, up to the beam over the door.
    const to = id === "lantern" ? toPage(door.x + 14, F.by - 66) : toPage(player.x, F.wy + player.z - 22);
    ui.fly(iconSprite(ware.icon), toPage(door.x, F.by - 30), to, { ms: 620, arc: -70, size: 30 }, () => {
      if (id === "lantern") {
        nameLantern = { hung: true, age: 0 };
        burst(door.x + 14, F.by - 64, SPARK, 24, 50, 2);
        sfx.chime();
        ui.news("lantern", "*Your lantern* hangs over the Treasury door.");
      } else {
        if (id === "cap") rebuildPlayer();
        landOnPlayer(id === "jar" ? [C.gold2, C.gold3, C.green4] : [C.bark3, C.gold1, C.earth2]);
      }
    });
  }, 420);
  ui.refresh();
  return true;
}

function barter(index: number): boolean {
  const l = me.listings[index];
  if (!l || l.bought) return false;
  if (me.leaf < l.price) {
    ui.bump("leaf", true);
    sfx.nope();
    return false;
  }
  me.leaf -= l.price;
  l.bought = true;
  sfx.buy();
  const stall = STALLS[l.stall] ?? STALLS[0] ?? 722;
  payFrom(toPage(stall, F.by - 22), Math.min(6, Math.ceil(l.price / 8)));
  burst(stall, F.by - 22, SPARK, 10, 30, 2);
  setTimeout(() => {
    ui.fly(
      iconSprite(l.icon),
      toPage(stall, F.by - 24),
      toPage(player.x, F.wy + player.z - 22),
      { ms: 600, arc: -60, size: 30 },
      () => {
        landOnPlayer(SPARK);
        float(player.x, F.wy - 44, "sent to your camp", C.gold3, 1.8);
      },
    );
  }, 380);
  const seller = mates.find((m) => m.name === l.seller);
  if (seller)
    setTimeout(() => {
      seller.waveFor = 1.4;
      speak(seller, pick(["Sold! Thank you!", "Enjoy it!", "A pleasure!"], roll()));
    }, 900);
  ui.refresh();
  return true;
}

function claim(id: string, from: DOMRect): void {
  const q = me.quests.find((quest) => quest.id === id);
  if (!q || q.claimed || q.have < q.need) return;
  q.claimed = true;
  const n = Math.min(9, Math.max(4, Math.round(q.reward / 3)));
  const each = q.reward / n;
  const to = ui.purseAt("leaf");
  const start = { x: from.left + from.width / 2, y: from.top + from.height / 2 };
  for (let i = 0; i < n; i++) {
    ui.fly(
      iconSprite("leaf"),
      { x: start.x + (roll() - 0.5) * 30, y: start.y + (roll() - 0.5) * 12 },
      to,
      { ms: 640, delay: i * 70, arc: -80 },
      () => {
        me.leaf = Math.round((me.leaf + each) * 100) / 100;
        if (i === n - 1) me.leaf = Math.round(me.leaf);
        ui.bump("leaf");
        sfx.leaf(i);
      },
    );
  }
  const board = place("quests");
  boardFlutter = 1;
  burst(board.x, F.by - 34, [C.gold3, C.gold2, C.green4], 22, 54);
  player.cheerFor = 1.2;
  if (!me.seated) player.hopV = 76;
  sfx.cheer();
  ui.refresh();
}

function collect(from: DOMRect): void {
  if (collected) return;
  collected = true;
  const rows = ui.awayRows();
  const leafRow = rows[0] ?? from;
  const coinRow = rows[1] ?? from;
  const nLeaf = 8;
  for (let i = 0; i < nLeaf; i++) {
    ui.fly(
      iconSprite("leaf"),
      { x: leafRow.left + 16 + roll() * 40, y: leafRow.top + leafRow.height / 2 },
      ui.purseAt("leaf"),
      { ms: 600, delay: i * 80, arc: -50 },
      () => {
        me.leaf +=
          i === nLeaf - 1 ? AWAY.leaf - Math.floor(AWAY.leaf / nLeaf) * (nLeaf - 1) : Math.floor(AWAY.leaf / nLeaf);
        ui.bump("leaf");
        sfx.leaf(i);
      },
    );
  }
  for (let i = 0; i < 6; i++) {
    ui.fly(
      iconSprite("coin"),
      { x: coinRow.left + 16 + roll() * 40, y: coinRow.top + coinRow.height / 2 },
      ui.purseAt("coins"),
      { ms: 560, delay: 500 + i * 70, arc: -40 },
      () => {
        me.coins += i === 5 ? AWAY.coins - Math.floor(AWAY.coins / 6) * 5 : Math.floor(AWAY.coins / 6);
        ui.bump("coins");
        sfx.coin();
      },
    );
  }
  setTimeout(() => {
    ui.hideAway();
    sfx.whoosh();
    ui.hint(
      lastInput === "touch"
        ? "Tap to walk · drag to look along · tap a door"
        : "A/D or arrows to stroll · click to walk · E at a door",
      9,
    );
    nextEvent = clock + 9;
  }, 1250);
  player.cheerFor = 1;
  player.hopV = 70;
}

function go(id: ui.PanelId): void {
  wake();
  sfx.open();
  ui.openPanel(id);
  measurePanel();
  if (id === "profile") {
    player.waveFor = 1.2;
    return;
  }
  const p = place(id);
  if (id === "treasury") {
    cinfy.line = pick(CINFY_LINES, roll());
    ui.refresh();
  }
  if (id === "fire" && me.seated) return;
  if (Math.abs(player.x - p.stand) > 3) walkTo(p.stand, () => arriveAt(p));
  else arriveAt(p);
}

function arriveAt(p: Place): void {
  if (!me.seated) player.face = p.x >= player.x ? 1 : -1;
  if (p.id === "treasury") {
    sfx.bell();
    signKick = 1;
    cinfy.wave = 1.6;
  } else if (p.id === "works") {
    gearBoost = 1;
    sfx.clank();
  } else if (p.id === "quests") {
    boardFlutter = 1;
    sfx.rustle();
  } else if (p.id === "fire") {
    fireFlare = 1;
    sfx.flare();
  } else if (p.id === "pond") {
    sfx.plop();
    ripples.push({ x: POND_X - 30 + roll() * 60, age: 0 });
  } else if (p.id === "market") sfx.bell();
  else sfx.knock();
}

function shut(): void {
  if (!ui.openNow()) return;
  ui.closePanel();
  sfx.close();
  measurePanel();
}

function startRollCall(): void {
  if (rollCall.on) return;
  rollCall.on = true;
  rollCall.i = 0;
  rollCall.t = 0.2;
  CRAB_NAMES.forEach((_, i) => ui.markRoll(i, "wait"));
}

function foundStray(): void {
  const hide = HIDES[stray.hide];
  if (!hide || stray.gone) return;
  const y = F.by - hide.up;
  burst(hide.x, y, [C.sky5, C.gold2, C.sky4], 18, 50, 2);
  sfx.click();
  sfx.sparkle();
  float(hide.x, y - 8, `No. ${stray.n}!`, C.sky5, 2);
  me.found++;
  ui.news("crab", `You found *crab No. ${stray.n}* ${hide.where}. It has been walked home.`);
  // It runs home along the street; and, being crabs, another one slips away.
  crabs.push({ n: stray.n, x: hide.x, z: 3, vx: 0, pause: 0, hop: 0, hopV: 60, tag: 4, errand: "home" });
  stray.gone = true;
  stray.back = 5;
}

function loseOne(): void {
  const settled = crabs.filter((c) => c.errand === "none");
  const c = pick(settled, roll());
  c.errand = "away";
  me.missing = c.n;
  stray.n = c.n;
  const far = HIDES.map((h, i) => ({ h, i })).filter(({ h, i }) => i !== stray.hide && !onScreen(h.x, 60));
  stray.hide = pick(far.length ? far : HIDES.map((h, i) => ({ h, i })), roll()).i;
  if (ui.openNow() === "pond") ui.refresh();
}

ui.initUI(
  {
    go,
    shut,
    buy,
    barter,
    claim,
    collect,
    sit: sitDown,
    emote,
    rollCall: startRollCall,
    greet(index, how) {
      const m = mates[index];
      if (!m) return;
      player.face = m.x > player.x ? 1 : -1;
      if (how === "wave") player.waveFor = 1.4;
      else {
        player.cheerFor = 1.1;
        if (!me.seated) player.hopV = 70;
      }
      sfx.tap();
      setTimeout(() => {
        m.face = player.x > m.x ? 1 : -1;
        if (how === "wave") m.waveFor = 1.5;
        else m.cheerFor = 1.2;
        speak(m, pick(HELLOS, roll()), roll() < 0.4 ? "heart" : null);
        bit({ x: m.x, y: F.wy + m.z - 42, vy: -14, life: 1.2, size: 2, colour: C.sky4, layer: 2 });
      }, 380);
      setTimeout(() => ui.hideCard(), 1500);
    },
    mute() {
      wake();
      setMuted(!isMuted());
      if (!isMuted()) sfx.tap();
      return isMuted();
    },
    sitters: () => [
      ...(me.seated ? [{ name: me.name, head: playerHead }] : []),
      ...mates.filter((m) => m.state === "sit").map((m) => ({ name: m.name, head: m.head })),
    ],
    cinfy: () => ({ head: cinfyHead, line: cinfy.line }),
    visitors: () => AWAY.visitors.flatMap((i) => (mates[i] ? [{ name: mates[i].name, head: mates[i].head }] : [])),
    player: () => ({ head: playerHead, stand: playerStand }),
  },
  isMuted(),
);

// ---------- guild-mates' minds ----------

function leaveSeat(m: Mate): void {
  if (m.seat >= 0) seatOf[m.seat] = null;
  m.seat = -1;
  m.state = "idle";
  m.wait = 0.4;
  m.hopV = 36;
}

function choose(m: Mate): void {
  const r = roll();
  const freeSeats = SEATS.map((s, i) => ({ s, i })).filter(({ i }) => !seatOf[i]);
  if (r < 0.2 && freeSeats.length) {
    const seat = pick(freeSeats, roll());
    seatOf[seat.i] = m;
    m.seat = seat.i;
    m.goal = seat.s.x;
    m.at = "fire";
  } else if (r < 0.86) {
    // Mostly they go where the member is, so the street is never empty round them.
    const near = PLACES.filter((p) => Math.abs(p.x - player.x) < 430);
    const p = pick(roll() < 0.62 && near.length ? near : PLACES, roll());
    // Not where someone already is, if it can be helped.
    const free = p.spots.filter(
      (x) => !mates.some((o) => o !== m && Math.abs((o.state === "walk" ? o.goal : o.x) - x) < 10),
    );
    m.goal = pick(free.length ? free : p.spots, roll()) + Math.round((roll() - 0.5) * 6);
    m.at = p.id;
  } else {
    m.goal = clamp(player.x + (roll() - 0.5) * 520, 70, WW - 70);
    m.at = null;
  }
  m.state = "walk";
}

function doingOf(m: Mate): string {
  if (m.state === "sit") return "Sitting by the fire";
  if (m.state === "walk")
    return m.at
      ? `Off to ${m.at === "camp" ? "the signpost" : place(m.at).name.toLowerCase().replace("the works", "the Works")}`
      : "Out for a stroll";
  return m.at ? place(m.at).doing : "Taking in the evening";
}

function updateWalkerBody(w: Walker, dt: number): void {
  // Legs quicken with speed, but less than in step with it: a run is a longer stride, not a blur.
  w.walk += Math.abs(w.vx) ** 0.75 * dt * 0.49;
  w.stride += (Math.min(1.3, Math.abs(w.vx) / 30) - w.stride) * Math.min(1, dt * 12);
  if (w.hop > 0 || w.hopV > 0) {
    w.hop += w.hopV * dt;
    w.hopV -= 420 * dt;
    if (w.hop <= 0) {
      w.hop = 0;
      w.hopV = 0;
      w.squash = 0.84;
    }
  }
  w.squash += (1 - w.squash) * Math.min(1, dt * 14);
  w.blink -= dt;
  if (w.blink < -0.12) w.blink = 2.5 + roll() * 4;
  if (w.say) {
    w.say.age += dt;
    if (w.say.age > w.say.life) w.say = null;
  }
}

function updateMates(dt: number): void {
  for (const m of mates) {
    if (m.cheerIn >= 0) {
      m.cheerIn -= dt;
      if (m.cheerIn < 0) {
        m.cheerFor = 1 + roll() * 0.4;
        if (m.state !== "sit") m.hopV = 60 + roll() * 26;
        if (onScreen(m.x, 20)) burst(m.x, F.wy + m.z - 34, CONFETTI, 5, 34);
      }
    }
    m.cheerFor -= dt;
    m.waveFor -= dt;
    m.cheer += ((m.cheerFor > 0 ? 1 : 0) - m.cheer) * Math.min(1, dt * 14);
    m.wave += ((m.waveFor > 0 ? 1 : 0) - m.wave) * Math.min(1, dt * 14);
    m.greeted -= dt;

    if (m.state === "walk") {
      const dx = m.goal - m.x;
      if (Math.abs(dx) < 1.2) {
        m.vx = 0;
        if (m.seat >= 0) {
          m.state = "sit";
          m.face = SEATS[m.seat]?.face ?? 1;
          m.wait = 14 + roll() * 22;
        } else {
          m.state = "idle";
          m.wait = 4 + roll() * 8;
          if (m.at) m.face = place(m.at).x >= m.x ? 1 : -1;
        }
      } else {
        m.face = dx > 0 ? 1 : -1;
        m.vx += (m.face * m.speed - m.vx) * Math.min(1, dt * 8);
        m.x += m.vx * dt;
      }
    } else {
      m.vx = 0;
      m.wait -= dt;
      if (m.wait <= 0) {
        if (m.state === "sit") leaveSeat(m);
        else choose(m);
      }
    }
    const sitting = m.state === "sit";
    m.sit += ((sitting ? 1 : 0) - m.sit) * Math.min(1, dt * 9);
    m.z += ((sitting ? -7 : m.lane) - m.z) * Math.min(1, dt * 8);

    // A hello when the member comes close.
    if (m.greeted <= 0 && collected && Math.abs(m.x - player.x) < 22 && m.state !== "walk" && Math.abs(player.vx) > 8) {
      m.greeted = 40;
      if (m.state !== "sit") m.face = player.x > m.x ? 1 : -1;
      m.waveFor = 1.2;
      if (roll() < 0.6) speak(m, pick(HELLOS, roll()));
    }
    updateWalkerBody(m, dt);
  }

  chatter -= dt;
  if (chatter <= 0 && collected) {
    chatter = 4.5 + roll() * 4;
    const seen = mates.filter((m) => onScreen(m.x, -10) && !m.say && m.state !== "walk");
    if (seen.length) {
      const m = pick(seen, roll());
      speak(m, pick(m.at && roll() < 0.7 ? PLACE_LINES[m.at] : LINES, roll()));
    }
  }
}

// ---------- the member's body ----------

const keys = new Set<string>();
function steer(): number {
  const left = keys.has("a") || keys.has("arrowleft");
  const right = keys.has("d") || keys.has("arrowright");
  return (right ? 1 : 0) - (left ? 1 : 0);
}

function hereNow(): Place | null {
  for (const p of PLACES) if (Math.abs(player.x - p.stand) <= p.reach) return p;
  return null;
}

function updatePlayer(dt: number): void {
  const dir = steer();
  let want = 0;
  if (dir !== 0) {
    if (me.seated) standUp();
    releaseSeat();
    player.target = null;
    player.onArrive = null;
    want = dir * 64;
    cam.look *= Math.max(0, 1 - dt * 5);
  } else if (player.target !== null) {
    const dx = player.target - player.x;
    if (Math.abs(dx) < 1.6) {
      player.x = player.target;
      player.vx = 0;
      player.target = null;
      const arrived = player.onArrive;
      player.onArrive = null;
      arrived?.();
    } else {
      const far = Math.abs(dx);
      want = Math.sign(dx) * Math.min(far > 150 ? 132 : 70, 26 + far * 3);
    }
  }
  player.vx += (want - player.vx) * Math.min(1, dt * 11);
  if (Math.abs(player.vx) < 0.5 && want === 0) player.vx = 0;
  if (me.seated) player.vx = 0;
  const before = player.x;
  player.x = clamp(player.x + player.vx * dt, 44, WW - 50);
  if (Math.abs(player.vx) > 4) player.face = player.vx > 0 ? 1 : -1;

  // Feet: a soft step and a puff of dust each time one lands.
  const stepBefore = Math.floor(player.walk / Math.PI);
  updateWalkerBody(player, dt);
  if (Math.floor(player.walk / Math.PI) !== stepBefore && Math.abs(player.vx) > 12 && player.hop === 0) {
    player.stepSide = !player.stepSide;
    sfx.step(player.stepSide);
    bit({
      x: player.x - player.face * 2,
      y: F.wy + player.z,
      vx: -player.face * 8,
      vy: -6,
      life: 0.35,
      size: 2,
      colour: rgba(C.earth2, 0.7),
      layer: 0,
      shrink: true,
    });
  }
  player.sit += ((me.seated ? 1 : 0) - player.sit) * Math.min(1, dt * 9);
  player.z += ((me.seated ? -7 : player.lane) - player.z) * Math.min(1, dt * 8);
  player.cheerFor -= dt;
  player.waveFor -= dt;
  player.reachFor -= dt;
  player.cheer += ((player.cheerFor > 0 ? 1 : 0) - player.cheer) * Math.min(1, dt * 14);
  player.wave += ((player.waveFor > 0 ? 1 : 0) - player.wave) * Math.min(1, dt * 14);
  player.reach += ((player.reachFor > 0 ? 1 : 0) - player.reach) * Math.min(1, dt * 10);
  if (player.mallow > 0) {
    player.mallow += dt;
    if (player.reachFor <= 0) player.mallow = 0;
    // Left over the fire a moment too long, as they always are.
    if (player.mallow > 3.6 && player.mallow - dt <= 3.6) {
      sfx.flare();
      speak(player, pick(["Ah. Charcoal.", "It's FINE.", "Extra crispy."], roll()), null, 2.2);
    }
  }

  // Ferns and flowers lean as someone passes; crabs scatter.
  if (before !== player.x) {
    for (const t of tufts) {
      if (Math.abs(t.x - player.x) < 5 && t.kick < 0.3) {
        t.kick = 0.7;
        if (now - rustled > 0.5 && t.kind === "fern" && t.front) {
          rustled = now;
          sfx.rustle();
        }
      }
    }
  }
  ui.setHere(hereNow()?.id ?? null);
}

// ---------- the rest of the street ----------

function updateCrabs(dt: number): void {
  for (let i = crabs.length - 1; i >= 0; i--) {
    const c = crabs[i];
    if (!c) continue;
    c.tag -= dt;
    if (c.hop > 0 || c.hopV > 0) {
      c.hop += c.hopV * dt;
      c.hopV -= 300 * dt;
      if (c.hop < 0) {
        c.hop = 0;
        c.hopV = 0;
      }
    }
    if (c.errand === "home") {
      const dx = POND_X - c.x;
      c.vx = Math.sign(dx) * 150;
      if (roll() < dt * 20 && onScreen(c.x, 10))
        bit({ x: c.x, y: F.wy + c.z, vy: -8, life: 0.3, colour: rgba(C.earth2, 0.7), layer: 0, size: 2, shrink: true });
      if (Math.abs(dx) < 30) {
        c.errand = "none";
        c.hopV = 50;
        if (onScreen(c.x)) sfx.click();
      }
    } else if (c.errand === "away") {
      c.vx = -120;
      if (c.x < POND_X - 260 || !onScreen(c.x, 30)) {
        crabs.splice(i, 1);
        stray.gone = false;
        stray.peek = 0;
        continue;
      }
    } else {
      // Sideways, in fits and starts; and briskly away from big feet.
      const fear = player.x - c.x;
      if (Math.abs(fear) < 16 && Math.abs(player.vx) > 10) {
        c.vx = -Math.sign(fear || 1) * 58;
        c.pause = 0.5;
      } else {
        c.pause -= dt;
        if (c.pause <= 0) {
          c.vx = c.vx === 0 ? (roll() < 0.5 ? -1 : 1) * (10 + roll() * 16) : 0;
          c.pause = c.vx === 0 ? 0.6 + roll() * 2.5 : 0.4 + roll() * 1.4;
        }
      }
      const lo = POND_X - POND_RX - 14;
      const hi = POND_X + POND_RX + 26;
      if (c.x < lo) c.vx = Math.abs(c.vx) || 14;
      if (c.x > hi) c.vx = -Math.abs(c.vx) || -14;
    }
    c.x += c.vx * dt;
  }
  if (stray.gone) {
    stray.back -= dt;
    if (stray.back <= 0 && stray.back + dt > 0) loseOne();
  } else {
    stray.peek += dt;
  }

  if (rollCall.on) {
    rollCall.t -= dt;
    if (rollCall.t <= 0) {
      const i = rollCall.i;
      if (i > 0) {
        const prev = i - 1;
        const gone = prev + 1 === me.missing;
        ui.markRoll(prev, gone ? "gone" : "here");
      }
      if (i >= CRAB_NAMES.length) {
        rollCall.on = false;
        const sign = place("pond");
        float(sign.x0 + 11, F.by - 40, `${CRAB_NAMES.length - 1} of ${CRAB_NAMES.length}. Again.`, C.gold3, 2.6);
      } else {
        ui.markRoll(i, "call");
        const c = crabs.find((x) => x.n === i + 1 && x.errand === "none");
        if (c) {
          c.hopV = 62;
          c.tag = 0.7;
          sfx.click();
        } else {
          sfx.sad();
        }
        rollCall.i++;
        rollCall.t = c ? 0.24 : 0.9;
      }
    }
  }
}

function updateStreet(dt: number): void {
  for (const l of lanterns) {
    l.age += dt;
    l.swing *= Math.max(0, 1 - dt * 1.4);
  }
  for (const b of banners) {
    b.age += dt;
    b.flutter *= Math.max(0, 1 - dt * 1.1);
  }
  nameLantern.age += dt;
  for (const t of tufts) t.kick *= Math.max(0, 1 - dt * 3);
  for (const f of bigFerns) f.kick *= Math.max(0, 1 - dt * 2.4);
  sunPulse *= Math.max(0, 1 - dt * 3);
  gearBoost *= Math.max(0, 1 - dt * 0.9);
  signKick *= Math.max(0, 1 - dt * 0.9);
  fireFlare *= Math.max(0, 1 - dt * 1.6);
  boardFlutter *= Math.max(0, 1 - dt * 1.5);
  questMark += dt;
  if (marker) {
    marker.age += dt;
    if (marker.age > 0.7) marker = null;
  }
  if (tip) {
    tip.age += dt;
    if (tip.age > 3.2) tip = null;
  }
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    if (r && (r.age += dt) > 1.1) ripples.splice(i, 1);
  }
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i];
    if (f && (f.age += dt) > f.life) floats.splice(i, 1);
  }

  // The fire: tongues of flame, sparks, a thread of smoke.
  const fy = F.by - 5;
  if (onScreen(FIRE_X, 80)) {
    const heat = 1 + fireFlare * 2;
    for (let i = 0; i < 3 * heat; i++) {
      if (roll() < dt * 30) {
        const off = (roll() - 0.5) * 10;
        bit({
          x: FIRE_X + off,
          y: fy + 1,
          vx: -off * 1.1 + (roll() - 0.5) * 6,
          vy: -(22 + roll() * 20) * heat,
          life: 0.5 + roll() * 0.35,
          size: 5,
          colour: "fire",
          layer: 0,
          shrink: true,
        });
      }
    }
    if (roll() < dt * (5 + fireFlare * 40))
      bit({
        x: FIRE_X + (roll() - 0.5) * 8,
        y: fy - 6,
        vx: (roll() - 0.5) * 14,
        vy: -30 - roll() * 30,
        life: 1 + roll(),
        colour: C.gold2,
        layer: 2,
        drag: 0.6,
      });
    if (roll() < dt * 2.5)
      bit({
        x: FIRE_X + (roll() - 0.5) * 4,
        y: fy - 16,
        vx: 3,
        vy: -12,
        life: 2.4,
        size: 2,
        colour: "smoke",
        layer: 0,
      });
    if (roll() < dt * 7) sfx.crackle(0.02 * clamp(1 - Math.abs(player.x - FIRE_X) / 170, 0, 1));
  }
  // The Works: smoke from the chimney, and now and then a coin drops in the bucket.
  if (onScreen(WORKS_X, 120) && roll() < dt * (3 + gearBoost * 16)) {
    bit({
      x: WORKS_X + 56 + roll() * 3,
      y: F.by - 85,
      vx: 4 + roll() * 3,
      vy: -13 - roll() * 5,
      life: 3,
      size: 3,
      colour: "smoke",
      layer: 0,
    });
  }
  coinTick -= dt;
  if (coinTick <= 0 && collected) {
    coinTick = 3.5 + roll() * 3;
    me.coins += 3;
    const door = WORKS_DOOR;
    if (onScreen(door, 30)) {
      bit({ x: door + 30, y: F.by - 30, vy: 60, pull: 180, life: 0.34, size: 2, colour: C.gold1, layer: 1 });
      float(door + 30, F.by - 16, "+3", C.gold1, 1.1);
      if (Math.abs(player.x - door) < 120) sfx.coin(0.3);
    }
  }
  // A needle or two, coming down from the dark above.
  if (roll() < dt * 1.6) {
    bit({
      x: cam.x + roll() * F.vw,
      y: F.sy - 30 - roll() * 40,
      vx: -4 + roll() * 8,
      vy: 9 + roll() * 7,
      life: 7,
      colour: pick([C.green3, C.green2, C.bark3, C.gold0], roll()),
      layer: 1,
      drag: 0.4,
    });
  }
  // Crickets, somewhere off in the ferns.
  cricket -= dt;
  if (cricket <= 0) {
    cricket = 2.5 + roll() * 6;
    sfx.cricket();
  }
  // Cinfy looks up when the member comes by.
  const door = place("treasury");
  const close = Math.abs(player.x - door.x) < 44;
  if (close && !cinfy.greeted && collected) {
    cinfy.greeted = true;
    cinfy.wave = 1.6;
    cinfy.say = { text: pick(CINFY_LINES, roll()), age: 0, life: 3.2, lines: null, width: 0, font: 0, icon: null };
    cinfy.line = cinfy.say.text;
    if (onScreen(door.x)) sfx.speak(700, 4);
  }
  if (!close && Math.abs(player.x - door.x) > 140) cinfy.greeted = false;
  cinfy.wave = Math.max(0, cinfy.wave - dt);
  cinfy.toss = Math.max(0, cinfy.toss - dt * 2);
  cinfy.blink -= dt;
  if (cinfy.blink < -0.12) cinfy.blink = 2 + roll() * 4;
  if (cinfy.say && (cinfy.say.age += dt) > cinfy.say.life) cinfy.say = null;

  for (const q of me.quests) if (q.closes > 0) q.closes = Math.max(0, q.closes - dt);

  for (let i = couriers.length - 1; i >= 0; i--) {
    const c = couriers[i];
    if (!c) continue;
    c.t += dt;
    const k = Math.min(1, c.t / c.dur);
    const ease = k * k * (3 - 2 * k);
    c.x = lerp(c.x0, c.x1, ease) + Math.sin(k * Math.PI * 3) * 4 * (1 - k);
    c.y = lerp(c.y0, c.y1, ease) - Math.sin(k * Math.PI) * 10;
    bit({ x: c.x, y: c.y, vy: 8, life: 0.5, colour: pick(SPARK, roll()), layer: 2 });
    if (k >= 1) {
      couriers.splice(i, 1);
      c.done();
    }
  }
  for (let i = bits.length - 1; i >= 0; i--) {
    const b = bits[i];
    if (!b) continue;
    b.age += dt;
    if (b.age > b.life) {
      bits.splice(i, 1);
      continue;
    }
    b.vy += b.pull * dt;
    if (b.drag) {
      b.vx *= Math.max(0, 1 - dt * b.drag);
      b.vx += Math.sin(now * 5 + i) * dt * 20;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }
}

function updateCamera(dt: number): void {
  const moving = Math.abs(player.vx) > 6;
  cam.lead += ((moving ? player.face * 26 : 0) - cam.lead) * Math.min(1, dt * 1.6);
  cam.bias += (panelGeom.bias - cam.bias) * Math.min(1, dt * 5);
  cam.lift += (panelGeom.lift - cam.lift) * Math.min(1, dt * 6);
  if (!drag) {
    cam.look += cam.lookV * dt;
    cam.lookV *= Math.max(0, 1 - dt * 4);
    cam.held -= dt;
    // Left alone for a while, the view drifts back to the member.
    if (cam.held <= 0 || moving) cam.look *= Math.max(0, 1 - dt * (moving ? 5 : 1.6));
  }
  const max = Math.max(0, WW - F.vw);
  const follow = clamp(player.x + cam.lead + cam.bias - F.vw / 2, 0, max);
  cam.look = clamp(cam.look, -follow, max - follow);
  const want = follow + cam.look;
  cam.x += (want - cam.x) * Math.min(1, dt * (drag ? 30 : 5));
  cam.x = clamp(cam.x, 0, max);
}

function update(dt: number): void {
  now += dt;
  clock += dt;
  updatePlayer(dt);
  updateMates(dt);
  updateCrabs(dt);
  updateStreet(dt);
  updateCamera(dt);
  if (clock >= nextEvent) {
    nextEvent = clock + 17 + roll() * 7;
    guildEvent(SCRIPT[eventsDone] ?? pick(["raid", "land", "level", "raid"] as const, roll()));
  }
}

// ---------- drawing ----------

function layer(s: Sprite, depth: number): void {
  const off = cam.x * depth;
  const sx = Math.floor(off);
  const w = Math.min(s.w - sx, F.vw + 2);
  if (w <= 0) return;
  g.drawImage(s.c, sx, 0, w, s.h, -Math.round((off - sx) * S) / S, 0, w, s.h);
}

function poseOf(w: Walker): Pose {
  return {
    ...restPose(w.x, F.wy + w.z),
    face: w.face,
    walk: w.walk,
    stride: w.stride,
    sit: w.sit,
    cheer: w.cheer,
    wave: w.wave,
    hop: w.hop,
    t: now + w.pitch,
    blink: w.blink < 0,
    squash: w.squash,
    reach: w.reach,
  };
}

function drawWalker(w: Walker): void {
  // A shadow on the ground, smaller while they are in the air.
  const sh = Math.max(2, 5 - w.hop * 0.12);
  g.fillStyle = "rgba(26,15,30,0.34)";
  g.fillRect(Math.round(w.x - sh), F.wy + w.z, Math.round(sh * 2), 1);
  g.fillRect(Math.round(w.x - sh + 1), F.wy + w.z + 1, Math.round(sh * 2 - 2), 1);
  drawBody(g, w.body, poseOf(w));
}

function drawCrab(c: Crab, m: Moving): void {
  const pose = c.vx !== 0 && Math.floor(now * 9) % 2 ? m.crab[1] : m.crab[0];
  g.fillStyle = "rgba(26,15,30,0.3)";
  g.fillRect(Math.round(c.x - 4), F.wy + c.z, 8, 1);
  g.drawImage(pose.c, Math.round(c.x - 5), Math.round(F.wy + c.z - 7 - c.hop));
}

function drawBanner(m: Moving, x: number, y: number, age: number, flutter: number, colour: number): void {
  const s = m.banners[colour % m.banners.length];
  if (!s) return;
  // It unrolls over a moment, overshoots, and settles; then hangs and stirs.
  const t = clamp(age / 0.7, 0, 1);
  const shown = Math.round(s.h * (t < 1 ? 1 - (1 - t) * (1 - t) * (1 + 2.2 * (1 - t)) : 1));
  const rows = clamp(shown, 2, s.h);
  for (let row = 0; row < rows; row += 3) {
    const sway = row < 3 ? 0 : Math.sin(now * 1.9 + row * 0.24 + x) * (0.5 + flutter * 3.2) * (row / s.h);
    g.drawImage(
      s.c,
      0,
      row,
      s.w,
      Math.min(3, rows - row),
      x - 6 + Math.round(sway * S) / S,
      y + row,
      s.w,
      Math.min(3, rows - row),
    );
  }
}

function drawFire(b: Bit): void {
  const k = b.age / b.life;
  const size = Math.max(1, Math.round(b.size * (1 - k * 0.8)));
  g.fillStyle = k < 0.22 ? C.gold2 : k < 0.5 ? C.gold1 : k < 0.8 ? C.sky5 : mix(C.sky5, C.sky0, 0.55);
  g.fillRect(Math.round(b.x - size / 2), Math.round(b.y - size / 2), size, size);
}

function drawBits(which: 0 | 1 | 2): void {
  for (const b of bits) {
    if (b.layer !== which || !onScreen(b.x, 8)) continue;
    const k = b.age / b.life;
    if (b.colour === "fire") {
      drawFire(b);
      continue;
    }
    if (b.colour === "smoke") {
      const size = Math.round(b.size + k * 3);
      g.globalAlpha = 0.5 * (1 - k);
      g.fillStyle = C.sky3;
      g.fillRect(Math.round(b.x - size / 2), Math.round(b.y - size / 2), size, size);
      g.globalAlpha = 1;
      continue;
    }
    const size = b.shrink ? Math.max(1, Math.round(b.size * (1 - k))) : b.size;
    g.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
    g.fillStyle = b.colour;
    g.fillRect(Math.round(b.x * S) / S, Math.round(b.y * S) / S, size, size);
  }
  g.globalAlpha = 1;
}

function drawTuft(t: Tuft | { x: number; s: Sprite; kick: number; phase: number }, y: number): void {
  const lean = Math.sin(now * 1.1 + t.phase) * 0.035 + Math.sin(now * 17 + t.phase) * 0.22 * t.kick;
  g.save();
  g.translate(Math.round(t.x), y);
  g.rotate(lean);
  g.drawImage(t.s.c, -Math.floor(t.s.w / 2), -t.s.h);
  g.restore();
}

function lightAt(s: Sprite, x: number, y: number, scale = 1): void {
  const w = s.w * scale;
  g.drawImage(s.c, Math.round(x - w / 2), Math.round(y - w / 2), Math.round(w), Math.round(w));
}

function drawCinfy(m: Moving): void {
  const door = place("treasury");
  const by = F.by;
  const lean = clamp((player.x - door.x) / 30, -2, 2);
  const bob = Math.round(Math.sin(now * 2.1) * 0.6 - cinfy.toss * 2);
  const x = door.x + Math.round(lean);
  const top = by - 29 + bob;
  g.drawImage(cinfyBody.front.torso.c, x - 4, top);
  g.drawImage(cinfyBody.front.head.c, x - 4, top - 8);
  if (cinfy.blink < 0) {
    g.fillStyle = cinfyBody.lid;
    g.fillRect(x - 3, top - 4, 2, 1);
    g.fillRect(x + 1, top - 4, 2, 1);
  }
  g.drawImage(m.cinfyHat.c, x - 7, top - 14);
  // One hand on the counter; the other waves, or tosses what was bought.
  g.fillStyle = CINFY.skin;
  g.fillRect(x - 7, by - 24, 2, 2);
  if (cinfy.wave > 0 || cinfy.toss > 0) {
    g.save();
    g.translate(x + 6, top + 2);
    g.rotate(Math.PI + Math.sin(now * 13) * 0.4 - 0.3 - cinfy.toss);
    g.drawImage(cinfyBody.front.arm.c, -2, -1);
    g.restore();
  } else {
    g.fillRect(x + 5, by - 24, 2, 2);
  }
  g.drawImage(m.doorHalf.c, door.x - 23, by - 23);
}

function drawStreetLife(m: Moving): void {
  const by = F.by;
  // The Treasury: Cinfy at the door, the sun sign swinging over it.
  const door = place("treasury");
  if (onScreen(door.x, 80)) {
    drawCinfy(m);
    g.save();
    g.translate(door.x, by - 69);
    g.rotate(Math.sin(now * 1.3) * 0.05 + Math.sin(now * 9) * 0.3 * signKick);
    g.drawImage(m.sunSign.c, -10, 0);
    g.restore();
    if (Math.sin(now * 0.9) > 0.92 || signKick > 0.3) {
      g.fillStyle = C.gold3;
      g.fillRect(door.x - 5, by - 60, 3, 1);
      g.fillRect(door.x - 4, by - 61, 1, 3);
    }
    if (nameLantern.hung) {
      g.fillStyle = C.gold0;
      g.fillRect(door.x + 14, by - 69, 1, 3);
      g.drawImage(m.lanternGold.c, door.x + 12, by - 66);
    }
  }
  // The quest board: a mark over it when something can be claimed, and loose paper when it is touched.
  const board = place("quests");
  if (onScreen(board.x, 40)) {
    if (me.quests.some((q) => q.have >= q.need && !q.claimed)) {
      const y = by - 68 + Math.round(Math.sin(questMark * 3.4) * 1.5);
      g.fillStyle = C.ink;
      g.fillRect(board.x - 3, y - 1, 6, 11);
      g.fillStyle = C.gold1;
      g.fillRect(board.x - 2, y, 4, 6);
      g.fillRect(board.x - 2, y + 7, 4, 2);
      g.fillStyle = C.gold3;
      g.fillRect(board.x - 2, y, 1, 5);
    }
    if (boardFlutter > 0.04) {
      for (let i = 0; i < 5; i++) {
        const a = now * 7 + i * 1.9;
        g.drawImage(
          m.paper.c,
          Math.round(board.x - 18 + i * 9 + Math.sin(a) * 5 * boardFlutter),
          Math.round(by - 40 + ((i * 7) % 16) - (1 - boardFlutter) * 14 + Math.cos(a) * 3),
        );
      }
    }
  }
  // The Works: gears, the forge's breathing, things riding the belt.
  if (onScreen(WORKS_X, 130)) {
    const spin = now * 0.9 + gearTurn;
    g.save();
    g.translate(WORKS_X + 36.5, by - 41.5);
    g.rotate(spin);
    g.drawImage(m.gearBig.c, -13.5, -13.5);
    g.restore();
    g.save();
    g.translate(WORKS_X + 49.5, by - 29.5);
    g.rotate(-spin * 2 + 0.26);
    g.drawImage(m.gearSmall.c, -7.5, -7.5);
    g.restore();
    const dx = WORKS_DOOR;
    g.fillStyle = rgba(C.gold1, 0.12 + 0.1 * Math.sin(now * 6) + 0.06 * Math.sin(now * 17));
    g.fillRect(dx + 7, by - 9, 5, 6);
    const tones = [C.gold0, C.stone3, C.earth2, C.gold1];
    for (let i = 0; i < 4; i++) {
      const p = (now * 0.22 + i / 4) % 1;
      g.fillStyle = tones[i] ?? C.gold0;
      g.fillRect(Math.round((WORKS_X + 65 + p * 28) * S) / S, by - 18, 3, 3);
    }
  }
  // The fire's steady heart, under the loose flames.
  if (onScreen(FIRE_X, 40)) {
    const lick = Math.round(Math.sin(now * 11) + Math.sin(now * 17) * 0.6);
    g.fillStyle = C.sky5;
    g.fillRect(FIRE_X - 5, by - 9 - lick, 10, 6 + lick);
    g.fillRect(FIRE_X - 3, by - 12 - lick, 6, 4);
    g.fillStyle = C.gold1;
    g.fillRect(FIRE_X - 4, by - 8, 8, 5);
    g.fillRect(FIRE_X - 2, by - 11 - lick, 4, 4);
    g.fillStyle = C.gold2;
    g.fillRect(FIRE_X - 2, by - 7, 4, 4);
  }
  // The pond: light moving on it, and rings where something dropped.
  if (onScreen(POND_X, 90)) {
    for (let i = 0; i < 6; i++) {
      const p = (now * 0.12 + i / 6) % 1;
      const x = POND_X - 44 + ((i * 37) % 88) + Math.round(Math.sin(now * 0.8 + i) * 3);
      g.fillStyle = rgba(i % 2 ? C.sky5 : C.gold2, 0.5 * Math.sin(p * Math.PI));
      g.fillRect(x, by - 10 + (i % 3) * 3, 6 - (i % 3), 1);
    }
    for (const r of ripples) {
      const k = r.age / 1.1;
      g.fillStyle = rgba(C.gold3, 0.7 * (1 - k));
      const w = Math.round(3 + k * 16);
      g.fillRect(r.x - w, by - 6, 3, 1);
      g.fillRect(r.x + w - 3, by - 6, 3, 1);
      g.fillRect(r.x - Math.round(w * 0.6), by - 9, Math.round(w * 1.2), 1);
      g.fillRect(r.x - Math.round(w * 0.6), by - 3, Math.round(w * 1.2), 1);
    }
  }
  // Along the strings: lanterns and banners.
  for (const b of banners) {
    if (b.name === null || !onScreen(b.x, 12)) continue;
    drawBanner(m, Math.round(b.x), F.sy + Math.round(b.drop), b.age, b.flutter, b.colour);
  }
  for (const l of lanterns) {
    if (!onScreen(l.x, 8)) continue;
    const sway = Math.sin(now * 1.5 + l.x * 0.1) * 0.5 + Math.sin(now * 11) * 3 * l.swing;
    const x = Math.round((l.x - 2 + sway) * S) / S;
    const y = F.sy + Math.round(l.drop);
    g.fillStyle = C.bark0;
    g.fillRect(Math.round(l.x), y, 1, 2);
    g.drawImage((l.lit ? m.lanternLit : m.lanternDark).c, x, y + 2);
  }
  // The stray crab, wherever it has got to.
  const hide = HIDES[stray.hide];
  if (hide && !stray.gone && onScreen(hide.x, 12)) {
    const up = Math.min(1, stray.peek * 1.5) * (0.75 + 0.25 * Math.sin(now * 2.3));
    const pose = Math.floor(now * 2) % 5 === 0 ? m.crab[1] : m.crab[0];
    const h = Math.round(7 * up);
    if (h > 0) g.drawImage(pose.c, 0, 0, 11, h, hide.x - 5, by - hide.up - h, 11, h);
  }
}
let gearTurn = 0;

function drawLights(): void {
  const by = F.by;
  g.globalCompositeOperation = "lighter";
  for (const x of LAMPS) {
    if (!onScreen(x, 40)) continue;
    const flick = 1 + Math.sin(now * 7 + x) * 0.03;
    lightAt(light.lamp, x + 6, by - 26, flick);
    g.drawImage(light.pool.c, x + 6 - 26, F.wy - 5, 53, 14);
  }
  for (const l of lanterns) {
    if (!l.lit || !onScreen(l.x, 30)) continue;
    const flare = l.age < 1.2 ? 1 + (1 - l.age / 1.2) * 2.4 : 1;
    lightAt(
      flare > 1.05 ? light.lamp : light.small,
      l.x,
      F.sy + l.drop + 6,
      flare > 1.05 ? flare * 0.7 : 1 + Math.sin(now * 3 + l.x) * 0.06,
    );
  }
  const door = place("treasury");
  if (onScreen(door.x, 80)) {
    lightAt(light.door, door.x, by - 22, 1 + Math.sin(now * 2.2) * 0.03);
    lightAt(light.small, door.x - 37, by - 54);
    lightAt(light.small, door.x + 37, by - 54);
    lightAt(light.lamp, door.x + 32, by - 34, 0.8);
    if (nameLantern.hung)
      lightAt(
        light.lamp,
        door.x + 14,
        by - 62,
        0.9 + Math.max(0, 1 - nameLantern.age) * 1.6 + Math.sin(now * 4) * 0.04,
      );
  }
  for (const sx of STALLS) if (onScreen(sx, 60)) lightAt(light.lamp, sx - 28, by - 42, 0.8);
  if (onScreen(place("quests").x, 60)) lightAt(light.lamp, place("quests").x + 27, by - 41, 0.8);
  if (onScreen(FIRE_X, 120)) {
    const breathe = 1 + Math.sin(now * 9) * 0.04 + Math.sin(now * 23) * 0.03 + fireFlare * 0.5;
    lightAt(light.fire, FIRE_X, by - 8, breathe);
    lightAt(light.lamp, FIRE_X, by - 8, breathe * 1.2);
  }
  if (onScreen(WORKS_X, 130)) {
    const dx = WORKS_DOOR;
    lightAt(light.door, dx + 6, by - 8, 0.8 + Math.sin(now * 6) * 0.05);
    lightAt(light.small, WORKS_X - 53, by - 40, 1.4);
    lightAt(light.lamp, dx - 26, by - 42, 0.8);
  }
  if (onScreen(POND_X, 100)) lightAt(light.pink, POND_X + 6, by - 7, 1.6);
  // Fireflies: drifting everywhere; and, from a jar, three that keep the member company.
  for (const f of fireflies) {
    const x = f.x + Math.sin(now * f.speed + f.phase) * 16;
    if (!onScreen(x, 6)) continue;
    const on = Math.sin(now * 1.3 * f.speed + f.phase * 3);
    if (on < -0.2) continue;
    const y = F.wy - f.h + Math.cos(now * f.speed * 0.7 + f.phase) * 7;
    lightAt(light.fly, x, y);
    g.fillStyle = C.gold3;
    g.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  if (me.owned.has("jar")) {
    for (let i = 0; i < 3; i++) {
      const a = now * 1.6 + (i * Math.PI * 2) / 3;
      const x = player.x + Math.cos(a) * (11 + i * 2);
      const y = F.wy + player.z - 22 - player.hop + Math.sin(a * 1.3) * 9;
      lightAt(light.small, x, y, 0.8);
      g.fillStyle = C.gold3;
      g.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
  }
  for (const c of couriers) {
    lightAt(light.small, c.x, c.y, 1.2);
    g.fillStyle = C.gold3;
    g.fillRect(Math.round(c.x) - 1, Math.round(c.y) - 1, 2, 2);
  }
  drawBits(2);
  g.globalCompositeOperation = "source-over";
}

// ---------- words over the picture ----------

const widths = new Map<string, number>();
function widthOf(text: string): number {
  const key = `${fontPx}|${text}`;
  let w = widths.get(key);
  if (w === undefined) {
    w = g.measureText(text).width;
    widths.set(key, w);
  }
  return w;
}
const px = (x: number): number => Math.round(x * S) - Math.round(cam.x * S);
const py = (y: number): number => Math.round(y * S) - Math.round(cam.lift * S);

function box(x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function plate(text: string, x: number, y: number, gold: boolean): void {
  const w = widthOf(text) + fontPx * 0.8;
  const h = fontPx * 1.35;
  g.fillStyle = "rgba(26,15,30,0.7)";
  box(Math.round(x - w / 2), Math.round(y - h), Math.round(w), Math.round(h), 3 * dpr);
  g.fill();
  g.fillStyle = gold ? C.gold2 : C.gold3;
  g.fillText(text, x, y - h / 2 + dpr * 0.5);
}

function drawBubble(b: Bubble, x: number, y: number): void {
  const pad = fontPx * 0.55;
  const lh = Math.round(fontPx * 1.25);
  if (!b.lines || b.font !== fontPx) {
    const max = Math.min(F.vw * S * 0.72, fontPx * 15);
    const lines: string[] = [];
    let row = "";
    for (const word of b.text.split(" ")) {
      const tryRow = row ? `${row} ${word}` : word;
      if (row && widthOf(tryRow) > max) {
        lines.push(row);
        row = word;
      } else row = tryRow;
    }
    if (row) lines.push(row);
    b.lines = lines;
    b.width = Math.max(0, ...lines.map((l) => widthOf(l)));
    b.font = fontPx;
  }
  const iconSize = b.icon ? 12 * Math.max(1, Math.round(S * 0.67)) : 0;
  const w = Math.max(b.width, iconSize) + pad * 2 + (b.icon && b.lines.length ? iconSize + pad * 0.5 : 0);
  const h = Math.max(b.lines.length * lh, iconSize) + pad * 1.4;
  const pop =
    b.age < 0.16
      ? 1.12 * Math.sin((b.age / 0.16) * Math.PI * 0.62)
      : b.life - b.age < 0.18
        ? (b.life - b.age) / 0.18
        : 1;
  const left = clamp(x - w / 2, 4 * dpr, canvas.width - w - 4 * dpr);
  g.save();
  g.translate(x, y);
  g.scale(pop, pop);
  g.translate(-x, -y);
  const tail = 5 * dpr;
  g.fillStyle = C.ink;
  box(left - dpr, y - h - tail - dpr, w + dpr * 2, h + dpr * 2, 5 * dpr);
  g.fill();
  g.beginPath();
  g.moveTo(x - tail - dpr, y - tail);
  g.lineTo(x, y + dpr * 1.5);
  g.lineTo(x + tail + dpr, y - tail);
  g.fill();
  g.fillStyle = C.gold3;
  box(left, y - h - tail, w, h, 4 * dpr);
  g.fill();
  g.beginPath();
  g.moveTo(x - tail, y - tail - 1);
  g.lineTo(x, y);
  g.lineTo(x + tail, y - tail - 1);
  g.fill();
  let tx = left + pad;
  if (b.icon) {
    g.drawImage(iconSprite(b.icon).c, Math.round(tx), Math.round(y - tail - h / 2 - iconSize / 2), iconSize, iconSize);
    tx += iconSize + pad * 0.5;
  }
  g.fillStyle = C.ink;
  g.textAlign = "left";
  b.lines.forEach((l, i) => g.fillText(l, tx, y - tail - h + pad * 0.7 + lh * (i + 0.5)));
  g.textAlign = "center";
  g.restore();
}

let promptBox: { x: number; y: number; w: number; h: number; id: PlaceId } | null = null;

function drawWords(): void {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.font = `600 ${fontPx}px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const all: Walker[] = [...mates, player];
  // Name plates: where two would sit on each other, the later one is lifted clear.
  const plates: { w: Walker; x: number; y: number; half: number }[] = [];
  const high = fontPx * 1.45;
  for (const w of all.toSorted((a, b) => a.x - b.x)) {
    if (!onScreen(w.x, 40)) continue;
    const half = (widthOf(w.name) + fontPx * 0.8) / 2;
    const x = px(w.x);
    let y = py(F.wy + w.z - (w.tall ? 43 : 35) + w.sit * 5 - w.hop);
    for (let tries = 0; tries < 3; tries++) {
      if (!plates.some((o) => Math.abs(o.x - x) < o.half + half + 2 && Math.abs(o.y - y) < high)) break;
      y -= high;
    }
    plates.push({ w, x, y, half });
    plate(w.name, x, y, w === player);
  }
  for (const c of crabs) {
    if (c.tag > 0 && onScreen(c.x, 20)) plate(`No. ${c.n}`, px(c.x), py(F.wy + c.z - 10 - c.hop), false);
  }
  for (const p of plates) {
    if (p.w.say) drawBubble(p.w.say, p.x, p.y - fontPx * 1.6);
  }
  const door = place("treasury");
  if (cinfy.say && onScreen(door.x, 60)) drawBubble(cinfy.say, px(door.x), py(F.by - 78));

  for (const f of floats) {
    if (!onScreen(f.x, 60)) continue;
    const k = f.age / f.life;
    g.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
    g.font = `700 ${Math.round(fontPx * 1.1)}px ${FONT}`;
    g.lineWidth = 3 * dpr;
    g.strokeStyle = C.ink;
    const y = py(f.y - k * 16);
    g.strokeText(f.text, px(f.x), y);
    g.fillStyle = f.colour;
    g.fillText(f.text, px(f.x), y);
  }
  g.globalAlpha = 1;
  g.font = `600 ${fontPx}px ${FONT}`;

  if (tip) {
    const fade = tip.age > 2.7 ? (3.2 - tip.age) / 0.5 : Math.min(1, tip.age / 0.15);
    g.globalAlpha = fade;
    const w = widthOf(tip.text) + fontPx * 1.2;
    const x = clamp(px(tip.x), w / 2 + 4, canvas.width - w / 2 - 4);
    const y = py(tip.y);
    g.fillStyle = "rgba(26,15,30,0.9)";
    box(x - w / 2, y - fontPx * 0.9, w, fontPx * 1.8, 3 * dpr);
    g.fill();
    g.fillStyle = C.gold1;
    g.fillRect(x - w / 2, y - fontPx * 0.9, 3 * dpr, fontPx * 1.8);
    g.fillStyle = C.gold3;
    g.fillText(tip.text, x + dpr, y + dpr * 0.5);
    g.globalAlpha = 1;
  }

  // Under a mouse, a place says what it is.
  const here = hereNow();
  if (hover && !drag && collected) {
    const at = toStreet(hover.x, hover.y);
    const over = PLACES.find((p) => at.x >= p.x0 && at.x <= p.x1 && at.up >= -2 && at.up <= p.top);
    if (over && (over !== here || ui.openNow()))
      plate(over.name, px(over.x), py(F.by - over.prompt) + fontPx * 0.7, true);
  }
  // The soft prompt at a door.
  promptBox = null;
  if (here && !ui.openNow() && collected && !(here.id === "fire" && me.seated)) {
    const key = lastInput === "touch" ? "Tap" : "E";
    const kw = widthOf(key) + fontPx * 0.8;
    const w = kw + widthOf(here.name) + fontPx * 1.7;
    const h = fontPx * 1.9;
    const x = clamp(px(here.x), w / 2 + 6, canvas.width - w / 2 - 6);
    const y = py(F.by - here.prompt) + Math.round(Math.sin(now * 3) * 1.5 * dpr);
    g.fillStyle = C.ink;
    box(x - w / 2 - 2 * dpr, y - h / 2 - 2 * dpr, w + 4 * dpr, h + 4 * dpr, 6 * dpr);
    g.fill();
    g.fillStyle = C.sky0;
    box(x - w / 2, y - h / 2, w, h, 4 * dpr);
    g.fill();
    g.strokeStyle = C.gold1;
    g.lineWidth = 2 * dpr;
    g.stroke();
    g.fillStyle = C.gold1;
    box(x - w / 2 + fontPx * 0.35, y - fontPx * 0.65, kw, fontPx * 1.3, 3 * dpr);
    g.fill();
    g.fillStyle = C.ink;
    g.fillText(key, x - w / 2 + fontPx * 0.35 + kw / 2, y + dpr * 0.5);
    g.fillStyle = C.gold3;
    g.textAlign = "left";
    g.fillText(here.name, x - w / 2 + kw + fontPx * 0.8, y + dpr * 0.5);
    g.textAlign = "center";
    promptBox = { x: (x - w / 2) / dpr, y: (y - h / 2) / dpr, w: w / dpr, h: h / dpr, id: here.id };
  }
}

function render(): void {
  const a = art;
  if (!a) return;
  const liftPx = Math.round(cam.lift * S);
  g.setTransform(S, 0, 0, S, 0, -liftPx);
  g.imageSmoothingEnabled = false;
  g.drawImage(a.sky.c, 0, 0);
  if (liftPx > 0) {
    g.fillStyle = "#150b18";
    g.fillRect(0, F.h - 1, F.vw + 1, cam.lift + 2);
  }
  // The sun, low behind the far trees, and the clouds drifting.
  const sunX = F.vw * 0.62 - cam.x * DEPTH.sun;
  const sunGrow = 1 + sunPulse * 0.2;
  g.drawImage(
    sun.c,
    Math.round(sunX - (sun.w * sunGrow) / 2),
    Math.round(F.hz - 15 - (sun.h * sunGrow) / 2),
    Math.round(sun.w * sunGrow),
    Math.round(sun.h * sunGrow),
  );
  for (const c of clouds) {
    const span = F.vw + 260;
    const x = ((((c.x - cam.x * DEPTH.cloud + now * c.drift) % span) + span) % span) - 130;
    g.drawImage(c.s.c, Math.round(x * S) / S, Math.round(F.hz * c.y));
  }
  layer(a.far, DEPTH.far);
  layer(a.mid, DEPTH.mid);
  layer(a.near, DEPTH.near);
  layer(a.back, DEPTH.back);
  layer(a.street, 1);

  // From here on, in the street's own measure.
  g.setTransform(S, 0, 0, S, -Math.round(cam.x * S), -liftPx);
  drawStreetLife(a.moving);
  for (const t of tufts) if (!t.front && onScreen(t.x, 14)) drawTuft(t, F.wy + t.y);
  drawBits(0);
  if (marker) {
    const k = marker.age / 0.7;
    g.fillStyle = rgba(C.gold3, 0.8 * (1 - k));
    const w = Math.round(2 + k * 7);
    g.fillRect(marker.x - w, F.wy + 1, 2, 1);
    g.fillRect(marker.x + w - 1, F.wy + 1, 2, 1);
    g.fillRect(marker.x - 1, F.wy + 3, 3, 1);
    g.fillRect(marker.x - 1, F.wy - 1, 3, 1);
  }
  // Everyone on the street, the furthest back first.
  const cast: { z: number; draw: () => void }[] = [];
  for (const m of mates) if (onScreen(m.x, 20)) cast.push({ z: m.z, draw: () => drawWalker(m) });
  for (const c of crabs) if (onScreen(c.x, 12)) cast.push({ z: c.z - 0.5, draw: () => drawCrab(c, a.moving) });
  cast.push({ z: player.z + 0.1, draw: () => drawWalker(player) });
  cast.sort((p, q) => p.z - q.z);
  for (const c of cast) c.draw();
  // The marshmallow, on its stick, going from white to gold to a small disaster.
  if (player.reach > 0.5 && player.mallow > 0) {
    const hx = player.x + player.face * 11;
    const hy = F.wy + player.z - 19 + player.sit * 5;
    g.fillStyle = C.bark1;
    for (let i = 0; i < 9; i++) g.fillRect(hx + player.face * i, hy - Math.round(i * 0.3), 1, 1);
    const t = player.mallow;
    g.fillStyle = t > 3.6 ? C.ink : t > 2.2 ? C.gold0 : t > 1.2 ? C.gold2 : C.gold3;
    g.fillRect(hx + player.face * 8 - 1, hy - 5, 3, 3);
    if (t > 3.6 && t < 4.6 && roll() < 0.5)
      bit({
        x: hx + player.face * 8,
        y: hy - 6,
        vy: -22,
        vx: (roll() - 0.5) * 8,
        life: 0.4,
        size: 2,
        colour: "fire",
        layer: 1,
        shrink: true,
      });
  }
  for (const t of tufts) if (t.front && onScreen(t.x, 14)) drawTuft(t, F.wy + t.y);
  drawBits(1);
  drawLights();

  // What passes in front: dark trunks, big ferns, a fringe of needles above and growth below.
  g.setTransform(S, 0, 0, S, -Math.round(cam.x * DEPTH.front * S), -liftPx);
  const frontCam = cam.x * DEPTH.front;
  const meFront = player.x - cam.x + frontCam;
  for (const f of a.fronts) {
    if (f.x + f.s.w / 2 < frontCam - 10 || f.x - f.s.w / 2 > frontCam + F.vw + 10) continue;
    const near = Math.abs(f.x - meFront) < f.s.w / 2 + 6;
    f.fade += ((near ? 0.2 : 1) - f.fade) * 0.12;
    g.globalAlpha = f.fade;
    g.drawImage(f.s.c, Math.round(f.x - f.s.w / 2), 0);
  }
  g.globalAlpha = 1;
  const tile = a.fringe.top.w;
  for (let x = Math.floor(frontCam / tile) * tile; x < frontCam + F.vw; x += tile) {
    g.drawImage(a.fringe.top.c, x, 0);
    g.drawImage(a.fringe.foot.c, x, F.h - 26);
  }
  for (const f of bigFerns) {
    if (f.x < frontCam - 30 || f.x > frontCam + F.vw + 30) continue;
    drawTuft(f, F.h - 9);
  }

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(vignette.c, 0, 0, canvas.width, canvas.height);
  g.imageSmoothingEnabled = false;
  drawWords();
}

// ---------- touch, mouse and keys ----------

let drag: { id: number; x: number; y: number; moved: boolean; lastX: number; lastT: number } | null = null;
let hover: { x: number; y: number } | null = null;

/** A point of the page as a point of the street: along it, and up from the building line. */
function toStreet(pageX: number, pageY: number): { x: number; up: number; y: number } {
  const x = pageX / cssScale() + cam.x;
  const y = pageY / cssScale() + cam.lift;
  return { x, y, up: F.by - y };
}

function tapped(pageX: number, pageY: number): void {
  const at = toStreet(pageX, pageY);
  ui.hideCard();
  if (ui.awayShowing()) return;
  if (
    promptBox &&
    pageX >= promptBox.x &&
    pageX <= promptBox.x + promptBox.w &&
    pageY >= promptBox.y &&
    pageY <= promptBox.y + promptBox.h
  ) {
    go(promptBox.id);
    return;
  }
  // People first.
  const feet = at.y - F.wy;
  if (Math.abs(at.x - player.x) < 6 && feet - player.z < 2 && feet - player.z > -36) {
    player.hopV = 70;
    go("profile");
    return;
  }
  let hit: Mate | null = null;
  for (const mate of mates) {
    if (Math.abs(at.x - mate.x) < 7 && feet - mate.z < 3 && feet - mate.z > -42 && (!hit || mate.z > hit.z)) hit = mate;
  }
  if (hit) {
    const p = toPage(hit.x, F.wy + hit.z - 46);
    ui.showCard(
      { index: hit.index, name: hit.name, rank: hit.rank, level: hit.level, doing: doingOf(hit), stand: hit.stand },
      p.x,
      p.y,
    );
    hit.hopV = 44;
    sfx.tap();
    return;
  }
  // Crabs: the stray one, then the ones at the pond.
  const hide = HIDES[stray.hide];
  if (hide && !stray.gone && Math.abs(at.x - hide.x) < 9 && Math.abs(at.up - hide.up - 4) < 9) {
    foundStray();
    return;
  }
  for (const c of crabs) {
    if (Math.abs(at.x - c.x) < 7 && Math.abs(feet - c.z + 4) < 7) {
      c.hopV = 66;
      c.tag = 1.8;
      c.vx = (roll() < 0.5 ? -1 : 1) * 40;
      c.pause = 0.6;
      sfx.click();
      return;
    }
  }
  // Things hung on the strings: they swing, and say what they are for.
  for (const l of lanterns) {
    if (Math.abs(at.x - l.x) < 5 && Math.abs(at.y - (F.sy + l.drop + 6)) < 7) {
      l.swing = 1;
      sfx.bell();
      if (l.lit) burst(l.x, F.sy + l.drop + 7, SPARK, 6, 26, 2);
      tip = { x: l.x, y: F.sy + l.drop - 8, text: l.lit ? l.note : "Unlit. The next raid will see to that.", age: 0 };
      return;
    }
  }
  const tdoor = place("treasury");
  if (nameLantern.hung && Math.abs(at.x - tdoor.x - 14) < 5 && Math.abs(at.up - 62) < 7) {
    nameLantern.age = 0;
    sfx.bell();
    burst(tdoor.x + 14, F.by - 62, SPARK, 8, 28, 2);
    tip = { x: tdoor.x + 14, y: F.by - 80, text: "Yours. It does not go out.", age: 0 };
    return;
  }
  for (const b of banners) {
    if (b.name && Math.abs(at.x - b.x) < 8 && at.y > F.sy + b.drop && at.y < F.sy + b.drop + 29) {
      b.flutter = 1;
      sfx.whoosh();
      tip = { x: b.x, y: F.sy + b.drop - 8, text: b.note, age: 0 };
      return;
    }
  }
  // A place: go there, and in.
  for (const p of PLACES) {
    if (at.x >= p.x0 && at.x <= p.x1 && at.up >= -2 && at.up <= p.top) {
      if (Math.abs(player.x - p.stand) <= p.reach) go(p.id);
      else {
        shut();
        sfx.tap();
        walkTo(p.stand, () => go(p.id));
        marker = { x: p.stand, age: 0 };
      }
      return;
    }
  }
  // The sun.
  if (Math.hypot(pageX / cssScale() - (F.vw * 0.62 - cam.x * DEPTH.sun), at.y - (F.hz - 15)) < 16 && at.up > 30) {
    sunPulse = 1;
    sfx.chime();
    return;
  }
  // Water.
  if (Math.abs(at.x - POND_X) < POND_RX && at.up > -2 && at.up < 13) {
    ripples.push({ x: Math.round(at.x), age: 0 });
    sfx.plop();
    burst(at.x, F.by - 7, [C.gold3, C.sky4, "#9fd0e8"], 7, 30);
    return;
  }
  // Lamp posts.
  for (const x of LAMPS) {
    if (Math.abs(at.x - x - 5) < 6 && at.up > 18 && at.up < 36) {
      sfx.bell();
      burst(x + 6, F.by - 26, SPARK, 8, 28, 2);
      return;
    }
  }
  // Ferns, flowers and mushrooms.
  for (const t of tufts) {
    const top = F.wy + t.y - t.s.h;
    if (Math.abs(at.x - t.x) < t.s.w / 2 + 1 && at.y > top - 2 && at.y < F.wy + t.y + 2) {
      t.kick = 1;
      if (t.kind === "shroom") {
        sfx.boing();
        burst(t.x, top, [C.gold3, C.sky5], 6, 22);
      } else {
        sfx.rustle();
        burst(t.x, top + 3, [C.green3, C.green4, t.kind === "flower" ? C.gold2 : C.green2], 6, 24);
        if (t.kind === "fern" && roll() < 0.5)
          bit({ x: t.x, y: top, vx: (roll() - 0.5) * 20, vy: -30, life: 2.2, colour: C.gold2, layer: 2, drag: 0.8 });
      }
      return;
    }
  }
  // The big dark ferns in front.
  const frontX = pageX / cssScale() + cam.x * DEPTH.front;
  if (at.y > F.h - 34) {
    for (const f of bigFerns) {
      if (Math.abs(frontX - f.x) < f.s.w / 2) {
        f.kick = 1;
        sfx.rustle();
        return;
      }
    }
  }
  // A trunk: a knock, and needles shaken loose.
  for (const t of TRUNKS) {
    if (Math.abs(at.x - t.x) < t.w / 2 - 2 && at.up > 12) {
      sfx.knock();
      for (let i = 0; i < 9; i++)
        bit({
          x: t.x + (roll() - 0.5) * t.w * 1.5,
          y: at.y - 30 - roll() * 50,
          vx: (roll() - 0.5) * 8,
          vy: 14 + roll() * 16,
          life: 2.2,
          colour: pick([C.green2, C.green3, C.bark3], roll()),
          layer: 1,
          drag: 0.5,
        });
      burst(at.x, at.y, [C.bark3, C.bark4], 4, 18);
      return;
    }
  }
  // Otherwise: walk there.
  if (ui.openNow()) shut();
  walkTo(at.x);
  marker = { x: Math.round(clamp(at.x, 44, WW - 50)), age: 0 };
  sfx.tap();
}

canvas.addEventListener("pointerdown", (e) => {
  wake();
  lastInput = e.pointerType === "touch" ? "touch" : "mouse";
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, lastX: e.clientX, lastT: performance.now() };
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // Not every pointer can be held; the drag still works while it stays over the picture.
  }
});
canvas.addEventListener("pointermove", (e) => {
  hover = e.pointerType === "mouse" ? { x: e.clientX, y: e.clientY } : null;
  if (!drag || drag.id !== e.pointerId) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 9) drag.moved = true;
  if (drag.moved) {
    const dx = (e.clientX - drag.lastX) / cssScale();
    cam.look -= dx;
    const t = performance.now();
    cam.lookV = lerp(cam.lookV, (-dx / Math.max(1, t - drag.lastT)) * 1000, 0.5);
    drag.lastT = t;
    cam.held = 3.5;
    ui.hideCard();
  }
  drag.lastX = e.clientX;
});
function release(e: PointerEvent): void {
  if (!drag || drag.id !== e.pointerId) return;
  const was = drag;
  drag = null;
  if (!was.moved && e.type === "pointerup") tapped(e.clientX, e.clientY);
  else cam.lookV = clamp(cam.lookV, -900, 900);
}
canvas.addEventListener("pointerleave", () => {
  hover = null;
});
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener(
  "wheel",
  (e) => {
    cam.look += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / cssScale() / 2;
    cam.held = 2.5;
  },
  { passive: true },
);

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  wake();
  lastInput = "key";
  if (k === "a" || k === "d" || k === "arrowleft" || k === "arrowright") {
    keys.add(k);
    ui.hideCard();
    if (ui.openNow() && !e.repeat) shut();
    e.preventDefault();
  } else if (k === "e" || k === "enter") {
    if (e.repeat) return;
    if (ui.awayShowing()) {
      document.querySelector<HTMLButtonElement>("#away .btn")?.click();
      return;
    }
    if (ui.openNow()) shut();
    else {
      const here = hereNow();
      if (here) go(here.id);
      else if (player.hop === 0) player.hopV = 74;
    }
  } else if (k === " " || k === "w" || k === "arrowup") {
    if (player.hop === 0 && !me.seated) {
      player.hopV = 84;
      sfx.boing();
    }
    e.preventDefault();
  } else if (k === "escape") {
    shut();
    ui.hideCard();
  } else if (k === "m") {
    setMuted(!isMuted());
    ui.setMuteIcon(isMuted());
  } else if (k >= "1" && k <= "7" && !e.repeat) {
    const p = PLACES[Number(k) - 1];
    if (p) go(p.id);
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => keys.clear());

let refit = 0;
window.addEventListener("resize", () => {
  refit = performance.now() + 140;
});

// ---------- the clock ----------

let last = performance.now();
let pulseAt = 0;
function frame(t: number): void {
  const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
  last = t;
  if (refit && t > refit) {
    refit = 0;
    fit();
    measurePanel();
  }
  gearTurn += dt * gearBoost * 5;
  update(dt);
  ui.rollNumbers(dt);
  if (t > pulseAt) {
    pulseAt = t + 400;
    ui.pulse();
    measurePanel();
  }
  render();
  requestAnimationFrame(frame);
}

// ---------- arriving ----------

function arrive(): void {
  // Two guild-mates are close by to say hello; the rest are about the street.
  const greeters = AWAY.visitors.flatMap((i) => (mates[i] ? [mates[i]] : []));
  greeters.forEach((m, i) => {
    m.x = SPAWN + (i ? -52 : 38);
    m.state = "idle";
    m.wait = 7 + i * 2;
    m.face = i ? 1 : -1;
    m.at = "market";
    setTimeout(
      () => {
        m.waveFor = 1.8;
        speak(m, GREETINGS[i] ?? "Welcome back!");
      },
      900 + i * 650,
    );
  });
  const sitter = mates[4];
  const seat = SEATS[3];
  if (sitter && seat) {
    sitter.x = seat.x;
    sitter.seat = 3;
    sitter.state = "sit";
    sitter.face = seat.face;
    sitter.wait = 30;
    sitter.sit = 1;
    sitter.z = -7;
    seatOf[3] = sitter;
  }
  document.querySelector("#veil")?.classList.add("off");
  setTimeout(() => ui.showAway(), 1500);
}

try {
  const raw: unknown = JSON.parse(localStorage.getItem("works.save.v1") ?? "null");
  if (typeof raw === "object" && raw !== null && "coins" in raw && typeof raw.coins === "number")
    me.coins = Math.round(raw.coins);
} catch {
  // No factory saved here; the stand-in purse will do.
}

const asked = new URLSearchParams(location.search).get("name")?.trim().slice(0, 16);
if (asked) {
  me.name = asked;
  player.name = asked;
  const who = document.querySelector("#me .who b");
  if (who) who.textContent = asked;
}

fit();
cam.x = clamp(SPAWN - F.vw / 2 - 34, 0, WW - F.vw);
async function begin(): Promise<void> {
  const img = await loadSkin("skins/player.png");
  if (img) {
    playerSheet = img;
    rebuildPlayer();
    const face = document.querySelector("#me .face");
    if (face) {
      const pic = document.createElement("img");
      pic.src = playerHead.c.toDataURL();
      pic.className = "pix";
      pic.style.height = "24px";
      pic.style.width = "26px";
      face.replaceChildren(pic);
    }
  }
  arrive();
  requestAnimationFrame(frame);
}
void begin();

// A handle for looking at the street from outside: headless browsers run slowly, so a review can
// move the clock, the member and the camera by hand.
Object.assign(window, {
  hub: {
    /** Runs the street on by this many seconds without drawing. */
    jump(seconds: number): void {
      for (let i = 0; i < seconds * 30; i++) {
        gearTurn += (1 / 30) * gearBoost * 5;
        update(1 / 30);
      }
      ui.rollNumbers(1);
      measurePanel();
      render();
    },
    open: (id: ui.PanelId): void => go(id),
    close: shut,
    /** Puts the member somewhere at once, camera and all. */
    tp(x: number): void {
      standUp();
      player.x = x;
      player.target = null;
      player.onArrive = null;
      cam.look = 0;
      cam.x = clamp(x - F.vw / 2, 0, WW - F.vw);
    },
    event: guildEvent,
    collect(): void {
      document.querySelector<HTMLButtonElement>("#away .btn")?.click();
    },
    sit: sitDown,
    emote,
    roll: startRollCall,
    found: foundStray,
    /** A point of the street as a point of the page: along it, and up from the building line. */
    page: (x: number, up: number): { x: number; y: number } => toPage(x, F.by - up),
    look(dx: number): void {
      cam.look += dx;
      cam.held = 60;
    },
    card(i: number): void {
      const m = mates[i];
      if (!m) return;
      const p = toPage(m.x, F.wy + m.z - 46);
      ui.showCard(
        { index: m.index, name: m.name, rank: m.rank, level: m.level, doing: doingOf(m), stand: m.stand },
        p.x,
        p.y,
      );
    },
    say(i: number, text: string): void {
      const m = mates[i];
      if (m) speak(m, text);
    },
    /** How long drawing and stepping take, in milliseconds, averaged. */
    bench(): { draw: number; step: number; paint: number } {
      let t = performance.now();
      for (let i = 0; i < 60; i++) render();
      const draw = (performance.now() - t) / 60;
      t = performance.now();
      for (let i = 0; i < 300; i++) update(1 / 60);
      const step = (performance.now() - t) / 300;
      t = performance.now();
      fit();
      return { draw, step, paint: performance.now() - t };
    },
    get state() {
      return {
        x: Math.round(player.x),
        cam: Math.round(cam.x),
        leaf: me.leaf,
        coins: me.coins,
        scale: S,
        view: [F.vw, F.h],
        mates: mates.map((m) => [m.name, Math.round(m.x), m.state]),
        stray: [stray.n, HIDES[stray.hide]?.where],
        lit: lanterns.filter((l) => l.lit).length,
        banners: banners.filter((b) => b.name).length,
        bits: bits.length,
      };
    },
  },
});
