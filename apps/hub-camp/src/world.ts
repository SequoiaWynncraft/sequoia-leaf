/**
 * The camp: one clearing, everything in it, and everyone who comes through. This file holds what
 * exists (things, people, pets, crabs, sparks), moves it on a little each frame, draws it, and
 * turns a touch into whatever that touch should do.
 */
import { buildFar, buildNear, buildOver, type Far, measure, type View } from "./backdrop.ts";
import {
  BYE,
  type CampSpec,
  CHAT,
  CHEERS,
  CINFY,
  CRAB_HIDES,
  type DecoKind,
  FIXED,
  type FixedId,
  GIFT_THANKS,
  HELLO,
  HOST_HI,
  type Kind,
  LANDS,
  MARKET,
  type Mate,
  MATES,
  MY_PETS,
  NAMES,
  type PetSpec,
  QUESTS,
  RAIDS,
  SHOP,
  SHOP_PET,
  SPARE_LOOK,
  SPOTS,
  type UV,
  WAVES,
  WELCOME,
} from "./content.ts";
import { drawFigure, type Face, type Figure, inventFigure, type Pose } from "./figure.ts";
import {
  canvas,
  clamp,
  type Cv,
  type G2,
  glow,
  INK as I,
  lerp,
  noise,
  outlined,
  pick,
  put,
  R,
  type Spr,
  TAU,
} from "./gfx.ts";
import {
  bannerArt,
  bench as benchArt,
  board as boardArt,
  fireArt,
  gears,
  type Home,
  home,
  pond,
  ROOFS,
  rug,
  shelf as shelfArt,
  signpost,
} from "./props.ts";
import { setMuted, sfx } from "./sfx.ts";
import {
  BANG,
  CAT,
  CAT_L,
  CHUTE,
  COIN_S,
  CRAB,
  CRAB_STATUE,
  CRATE,
  FERN,
  FLAG,
  FOX,
  FOX_R,
  GIFT,
  glorp,
  GNOME,
  HEART,
  LAMP,
  LEAF_S,
  MAIL,
  MARSH,
  NOTE,
  POT,
  SHROOM,
  SKY_LANTERN,
  SPROUT,
  STAR,
  STAR_S,
  STUMP,
  ZED,
} from "./sprites.ts";
import { awayMinutes, type Extra, keep, save, tidy } from "./state.ts";
import * as ui from "./ui.ts";

// ---------- the art, made once ----------

const BOARD = boardArt();
const BENCH = benchArt();
const GEARS = gears();
const SHELF = shelfArt();
const SIGN = signpost();
const POND = pond();
const FIRE = fireArt();
const RUG = rug();
const STUMP_O = outlined(STUMP);
const DECO: Record<DecoKind, Spr> = {
  lamp: outlined(LAMP),
  pot: outlined(POT),
  fern: outlined(FERN),
  gnome: outlined(GNOME),
  stump: STUMP_O,
  shroom: outlined(SHROOM),
  rug: RUG,
  statue: outlined(CRAB_STATUE),
  flag: outlined(FLAG),
};
const CAT_O = {
  walkA: outlined(CAT.walkA),
  walkB: outlined(CAT.walkB),
  sit: outlined(CAT.sit),
  sleep: outlined(CAT.sleep),
};
const CAT_LO = { walkA: outlined(CAT_L.walkA), walkB: outlined(CAT_L.walkB) };
const FOX_O = { sit: outlined(FOX.sit), walkA: outlined(FOX.walkA), walkB: outlined(FOX.walkB) };
const FOX_RO = { sit: outlined(FOX_R.sit), walkA: outlined(FOX_R.walkA), walkB: outlined(FOX_R.walkB) };
const CRAB_O = { a: outlined(CRAB.a), b: outlined(CRAB.b), up: outlined(CRAB.up), peek: outlined(CRAB.peek) };
const BANNERS = LANDS.map((l, n) => bannerArt(l.ink, l.dark, n));

/** How much ground a thing takes, how big it is to touch, and where to stand to use it. */
interface Info {
  foot: [number, number] | null;
  w: number;
  h: number;
  stand: [number, number];
  flat?: boolean;
}
const INFO: Record<Kind, Info> = {
  cabin: { foot: [40, 8], w: 84, h: 72, stand: [14, 13] },
  fire: { foot: [34, 24], w: 40, h: 38, stand: [0, 36], flat: true },
  mailbox: { foot: [4, 2], w: 18, h: 28, stand: [11, 4] },
  bench: { foot: [25, 6], w: 50, h: 42, stand: [0, 10] },
  board: { foot: [21, 4], w: 46, h: 50, stand: [0, 9] },
  shelf: { foot: [17, 5], w: 36, h: 48, stand: [0, 9] },
  sign: { foot: [3, 2], w: 30, h: 44, stand: [-12, 6] },
  pool: { foot: [31, 14], w: 62, h: 30, stand: [39, 5], flat: true },
  lamp: { foot: [3, 2], w: 14, h: 26, stand: [9, 4] },
  pot: { foot: [4, 2], w: 14, h: 14, stand: [0, 7] },
  fern: { foot: [4, 2], w: 14, h: 15, stand: [0, 7] },
  gnome: { foot: [3, 2], w: 14, h: 16, stand: [0, 7] },
  stump: { foot: [6, 3], w: 16, h: 12, stand: [0, 8] },
  shroom: { foot: [4, 2], w: 16, h: 10, stand: [0, 7] },
  rug: { foot: null, w: 30, h: 14, stand: [0, 0], flat: true },
  statue: { foot: [5, 3], w: 14, h: 13, stand: [0, 8] },
  flag: { foot: [2, 1], w: 14, h: 19, stand: [8, 4] },
};

// ---------- what exists ----------

interface Thing {
  id: string;
  kind: Kind;
  u: number;
  v: number;
  x: number;
  y: number;
  /** When it was last touched or set down: it hops. */
  bump: number;
  extra: Extra | null;
  /** A lantern post can be put out. */
  off: boolean;
}

type Step =
  | { do: "go"; x: number; y: number; v: number; age: number }
  | { do: "wait"; s: number }
  | { do: "say"; text: string }
  | { do: "face"; face: Face }
  | { do: "sit"; seat: number; v: number; age: number }
  | { do: "call"; fn: () => void }
  | { do: "leave" };

interface Actor {
  id: string;
  name: string;
  fig: Figure;
  x: number;
  y: number;
  face: Face;
  pose: Pose;
  poseT: number;
  walk: number;
  seat: number;
  plan: Step[];
  say: string;
  sayT: number;
  hop: number;
  idle: number;
  gone: boolean;
  /** Down on a seat (as against on the way to one). */
  sat: boolean;
}

interface Pet {
  spec: PetSpec;
  x: number;
  y: number;
  tx: number;
  ty: number;
  state: "idle" | "walk" | "sleep";
  t: number;
  dir: number;
  joy: number;
  phase: number;
  zed: number;
}

interface Crab {
  n: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  t: number;
  hop: number;
  /** "home" at the pond, "out" on its way to hide, "back" on its way home. */
  state: "home" | "out" | "back";
}

type PartKind =
  | "spark"
  | "smoke"
  | "needle"
  | "heart"
  | "note"
  | "zed"
  | "star"
  | "dust"
  | "loot"
  | "drop"
  | "paper"
  | "steam"
  | "marsh"
  | "gift"
  | "ring";
interface Part {
  k: PartKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  a: number;
  tx: number;
  ty: number;
  fn: (() => void) | null;
}

interface Lantern {
  x: number;
  y: number;
  ph: number;
  boost: number;
}

let view: View = measure();
let T = 0;
let far: Far;
let near: Cv;
let over: Cv;
const [world, wg] = canvas(4, 4);
const [light, lg] = canvas(4, 4);
let screen: Cv;
let sg: G2;

let things: Thing[] = [];
let actors: Actor[] = [];
let pets: Pet[] = [];
let crabs: Crab[] = [];
let parts: Part[] = [];
let lanterns: Lantern[] = [];
const flies: { x: number; y: number; ph: number }[] = [];
const skyStars: { x: number; y: number; t: number }[] = [];
let shoot: { x: number; y: number; t: number } | null = null;
const timers: { at: number; fn: () => void }[] = [];
const seats: (Actor | null)[] = [null, null, null, null, null, null];

const figs = new Map<string, Figure>();
let me: Actor;
let host: Mate | null = null;
let spec: CampSpec;
let homeArt: Home;

let letters: ui.Letter[] = [];
let firstMail = true;
let mailOpen = false;
let doorT = 0;
let flare = 0;
let stacks = 0;
let worksMade = 0;
let nextStack = 9;
let bannerAt = -99;
let lightsLit = 0;
let hide: { th: Thing; dx: number; dy: number } | null = null;
let tagsUntil = 0;
let hoverId = "";
let decor = false;
let held: Thing | null = null;
let heldDX = 0;
let heldDY = 0;
let wipe: { t: number; mid: (() => void) | null } | null = null;
let nextEvent = 12;
let eventN = 0;
let nextVisitor = 16;
let nextChat = 7;
let autoArrive = true;
let shown = { leaf: save.leaf, coins: save.coins };
let delivery: { id: string; x: number; y: number; z: number; t: number; landed: boolean } | null = null;
let ambient = 0;
let cricket = 5;
let toldToTouch = false;
/** The colour of dusk: everything the fire does not reach is multiplied by it. */
const AMBIENT = "#b3a2e0";

const after = (s: number, fn: () => void): void => {
  timers.push({ at: T + s, fn });
};
const css = (x: number, y: number): [number, number] => [x * view.k, y * view.k];
/** Opens a panel on the side of the screen the member is not standing on. */
const panel = (id: ui.PanelId): void => ui.openPanel(id, me.x > view.w * 0.56);
const figOf = (id: string): Figure => figs.get(id) ?? figs.get("me")!;
const atHome = (): boolean => host === null;
const thing = (id: string): Thing | undefined => things.find((t) => t.id === id);
const isFixed = (kind: Kind): kind is FixedId => FIXED.some((f) => f === kind);

// ---------- laying a camp out ----------

function infoOf(th: Thing): Info {
  if (th.kind === "cabin")
    return { foot: homeArt.foot, w: homeArt.shut.w - 4, h: homeArt.shut.h - 4, stand: [homeArt.door[0], 13] };
  return INFO[th.kind];
}
function place(th: Thing): void {
  const inf = infoOf(th);
  const x = view.gx0 + th.u * (view.gx1 - view.gx0);
  const y = view.gy0 + th.v * (view.gy1 - view.gy0);
  const half = inf.w / 2 - 8;
  th.x = Math.round(clamp(x, view.gx0 + half - 6, view.gx1 - half + 6));
  th.y = Math.round(clamp(y, view.gy0 + (inf.flat ? inf.h / 2 : 5), view.gy1 - (inf.flat ? inf.h / 2 - 4 : 0)));
}
function toUV(x: number, y: number): UV {
  return [clamp((x - view.gx0) / (view.gx1 - view.gx0), 0, 1), clamp((y - view.gy0) / (view.gy1 - view.gy0), 0, 1)];
}
const mode = (): "wide" | "tall" => (view.tall ? "tall" : "wide");

function makeThing(id: string, kind: Kind, uv: UV, extra: Extra | null): Thing {
  const th: Thing = { id, kind, u: uv[0], v: uv[1], x: 0, y: 0, bump: -9, extra, off: false };
  place(th);
  return th;
}

function mySpec(): CampSpec {
  return {
    home: "cabin",
    roof: "canvas",
    plan: 0,
    rose: save.roseOn,
    lights: save.owned.includes("lights"),
    pets: save.owned.includes("glorp") ? [...MY_PETS, SHOP_PET] : MY_PETS,
    extras: [],
    lacks: [],
    banner: save.banner,
  };
}

function rebuild(): void {
  const fire = thing("fire");
  const cabin = thing("cabin");
  near = buildNear(view, {
    fire: fire ? [fire.x, fire.y] : [view.w / 2, (view.gy0 + view.gy1) / 2],
    door: cabin ? [cabin.x + homeArt.door[0], cabin.y] : null,
  });
}

function makeActor(id: string, name: string, x: number, y: number): Actor {
  return {
    id,
    name,
    fig: figOf(id),
    x,
    y,
    face: "down",
    pose: "stand",
    poseT: 0,
    walk: 0,
    seat: -1,
    plan: [],
    say: "",
    sayT: 0,
    hop: 0,
    idle: 0,
    gone: false,
    sat: false,
  };
}

function spot(u: number, v: number): [number, number] {
  return [view.gx0 + u * (view.gx1 - view.gx0), view.gy0 + v * (view.gy1 - view.gy0)];
}

/** A place to stand that is not inside anything: pushed straight out of whatever it lands in. */
function freeSpot(u: number, v: number): [number, number] {
  let [x, y] = spot(u, v);
  for (let n = 0; n < 6; n++) {
    const hit = things.find((th) => inFoot(th, x, y, 1.2));
    const f = hit && footCentre(hit);
    if (!f) break;
    const dx = (x - f[0]) / (f[2] + 6) || 0.01;
    const dy = (y - f[1]) / (f[3] + 4) || 1;
    const d = Math.hypot(dx, dy);
    x = f[0] + (dx / d) * (f[2] + 6) * 1.35;
    y = f[1] + (dy / d) * (f[3] + 4) * 1.35;
    x = clamp(x, view.gx0 + 6, view.gx1 - 6);
    y = clamp(y, view.gy0 + 8, view.gy1 - 2);
  }
  return [x, y];
}

function enter(m: Mate | null): void {
  host = m;
  spec = m ? m.camp : mySpec();
  homeArt = home(spec.home, ROOFS[spec.roof] ?? ROOFS.canvas!);
  const plan = SPOTS[spec.plan % SPOTS.length]![mode()];
  things = [];
  for (const id of FIXED) {
    if (spec.lacks.includes(id)) continue;
    things.push(makeThing(id, id, (!m && save.spots[mode()][id]) || plan[id], null));
  }
  if (m) m.camp.extras.forEach(([kind, u, v], n) => things.push(makeThing(`x${n}`, kind, [u, v], null)));
  else for (const e of save.extras) things.push(makeThing(`x${e.id}`, e.kind, e[mode()], e));
  seats.fill(null);
  parts = [];
  lanterns = [];
  delivery = null;
  pets = spec.pets.map((p, n) => {
    const [x, y] = freeSpot(0.25 + 0.5 * ((n * 0.37) % 1), 0.45 + 0.4 * ((n * 0.61) % 1));
    return {
      spec: p,
      x,
      y,
      tx: x,
      ty: y,
      state: "idle",
      t: 1 + n,
      dir: n % 2 ? 1 : -1,
      joy: 0,
      phase: n * 1.7,
      zed: 0,
    };
  });
  crabs = [];
  hide = null;
  const pool = thing("pool");
  if (pool) {
    const count = m ? 4 : 9;
    for (let n = 1; n <= count; n++) {
      const a = (n / count) * TAU;
      const c: Crab = {
        n,
        x: pool.x + Math.cos(a) * 40,
        y: pool.y + Math.sin(a) * 19,
        tx: 0,
        ty: 0,
        t: n * 0.6,
        hop: 0,
        state: "home",
      };
      c.tx = c.x;
      c.ty = c.y;
      if (m || n !== save.missing) crabs.push(c);
    }
    if (!m) hideCrab();
  }
  bannerAt = spec.banner >= 0 ? -99 : -99;
  lightsLit = spec.lights ? 9 : 0;
  flies.length = 0;
  for (let n = 0; n < (view.tall ? 8 : 12); n++)
    flies.push({
      x: view.gx0 + Math.random() * (view.gx1 - view.gx0),
      y: view.gy0 - 10 + Math.random() * (view.gy1 - view.gy0),
      ph: Math.random() * 9,
    });
  // people
  const [tx, ty] = view.trail;
  me = makeActor("me", save.handle, tx, ty);
  actors = [me];
  if (m) {
    const h = makeActor(m.id, m.name, ...freeSpot(0.5, 0.45));
    actors.push(h);
    h.plan = [{ do: "wait", s: 1.6 }, { do: "say", text: pick(HOST_HI) }, { do: "wait", s: 2.5 }, sitStep(h, 0)];
    const other = MATES.filter((o) => o.id !== m.id)[(m.level + 3) % 7]!;
    const o = makeActor(other.id, other.name, 0, 0);
    actors.push(o);
    seatNow(o, 3);
  }
  rebuild();
  ui.setWhere(m ? `${m.name}'s camp` : null, !m);
  ui.setMates();
}

function hideCrab(): void {
  const spots: [FixedId, number, number][] = [
    ["cabin", -22, -62],
    ["shelf", 0, -46],
    ["board", 13, -44],
    ["bench", -16, -22],
    ["mailbox", 0, -22],
  ];
  const open = spots.filter(([id]) => thing(id) && (id !== "cabin" || spec.home === "cabin"));
  const [id, dx, dy] = open[(save.missing * 3 + save.crabsFound) % Math.max(1, open.length)] ?? ["shelf", 0, -46];
  const th = thing(id);
  hide = th ? { th, dx, dy } : null;
}

// ---------- seats by the fire ----------

const SEATS: readonly { dx: number; dy: number; face: Face }[] = [
  { dx: -13, dy: -9, face: "down" },
  { dx: 13, dy: -9, face: "down" },
  { dx: -29, dy: 4, face: "down" },
  { dx: 29, dy: 4, face: "down" },
  { dx: -15, dy: 21, face: "up" },
  { dx: 15, dy: 21, face: "up" },
];
function seatAt(n: number): { x: number; y: number; face: Face } {
  const f = thing("fire");
  const s = SEATS[n]!;
  return { x: (f?.x ?? 0) + s.dx, y: (f?.y ?? 0) + s.dy, face: s.face };
}
function freeSeat(want: number): number {
  if (!thing("fire")) return -1;
  if (want >= 0 && !seats[want]) return want;
  for (const n of [2, 3, 4, 5, 1, 0]) if (!seats[n]) return n;
  return -1;
}
function sitStep(a: Actor, want: number, fast = false): Step {
  const n = freeSeat(want);
  const p = seatAt(Math.max(0, n));
  return { do: "sit", seat: want, v: fast ? hurry(a, p.x, p.y) : 34, age: 0 };
}
function seatNow(a: Actor, want: number): void {
  const n = freeSeat(want);
  if (n < 0) {
    [a.x, a.y] = freeSpot(0.5, 0.8);
    return;
  }
  seats[n] = a;
  a.seat = n;
  const p = seatAt(n);
  a.x = p.x;
  a.y = p.y;
  a.face = p.face;
  a.pose = "stand";
  a.sat = true;
}
function unseat(a: Actor): void {
  if (a.seat < 0) return;
  const s = SEATS[a.seat]!;
  seats[a.seat] = null;
  a.seat = -1;
  a.sat = false;
  a.pose = "stand";
  a.x += Math.sign(s.dx) * 3;
  a.y += s.dy < 0 ? -9 : s.dy > 10 ? 6 : 8;
}
const sitters = (): Actor[] => actors.filter((a) => a.seat >= 0 && a.sat);

// ---------- people moving ----------

function hurry(a: Actor, x: number, y: number): number {
  return clamp(Math.hypot(x - a.x, y - a.y) / 0.62, 78, 240);
}
function footCentre(th: Thing): [number, number, number, number] | null {
  const f = infoOf(th).foot;
  if (!f) return null;
  return [th.x, infoOf(th).flat ? th.y : th.y - f[1] + 2, f[0], f[1]];
}
function inFoot(th: Thing, x: number, y: number, grow: number): boolean {
  const f = footCentre(th);
  if (!f) return false;
  return Math.hypot((x - f[0]) / ((f[2] + 6) * grow), (y - f[1]) / ((f[3] + 4) * grow)) < 1;
}

/** One step toward a place, going round what is in the way. True on arriving. */
function stepTo(a: Actor, gx: number, gy: number, v: number, dt: number): boolean {
  const dx = gx - a.x;
  const dy = gy - a.y;
  const d = Math.hypot(dx, dy);
  if (d <= v * dt + 0.6) {
    a.x = gx;
    a.y = gy;
    a.pose = a.pose === "walk" ? "stand" : a.pose;
    return true;
  }
  let ux = dx / d;
  let uy = dy / d;
  for (const th of things) {
    const f = footCentre(th);
    if (!f || th === held) continue;
    const rx = f[2] + 7;
    const ry = f[3] + 5;
    // anything the goal itself is tucked against is not in the way
    if (Math.hypot((gx - f[0]) / (rx * 1.12), (gy - f[1]) / (ry * 1.12)) < 1) continue;
    const nx = (a.x - f[0]) / rx;
    const ny = (a.y - f[1]) / ry;
    const nd = Math.hypot(nx, ny);
    if (nd >= 1.3) continue;
    let ox = nx / rx;
    let oy = ny / ry;
    const ol = Math.hypot(ox, oy) || 1;
    ox /= ol;
    oy /= ol;
    const into = ux * ox + uy * oy;
    if (into < 0) {
      const k = clamp((1.3 - nd) / 0.3, 0, 1);
      ux -= ox * into * k;
      uy -= oy * into * k;
      const l = Math.hypot(ux, uy);
      if (l < 0.4) {
        const side = -oy * dx + ox * dy >= 0 ? 1 : -1;
        ux = -oy * side;
        uy = ox * side;
      } else {
        ux /= l;
        uy /= l;
      }
    }
    if (nd < 1) {
      a.x += ox * (1 - nd) * rx * 0.4;
      a.y += oy * (1 - nd) * ry * 0.4;
    }
  }
  a.x += ux * v * dt;
  a.y += uy * v * dt;
  a.pose = "walk";
  const before = Math.floor(a.walk / Math.PI);
  a.walk += dt * (5 + v * 0.11);
  if (v > 60 && Math.floor(a.walk / Math.PI) !== before) {
    puff(a.x, a.y, 1);
    if (a === me) sfx.step();
  }
  a.face = Math.abs(ux) > Math.abs(uy) * 0.9 ? (ux > 0 ? "right" : "left") : uy > 0 ? "down" : "up";
  return false;
}

function speak(a: Actor, text: string, secs = 3.4): void {
  a.say = text;
  a.sayT = secs;
}
function strike(a: Actor, pose: "cheer" | "wave", secs: number): void {
  a.pose = pose;
  a.poseT = secs;
  if (a.face === "left" || a.face === "right") a.face = "down";
  if (pose === "cheer") a.hop = 0.45;
}

function tickActor(a: Actor, dt: number): void {
  if (a.sayT > 0) a.sayT -= dt;
  if (a.hop > 0) a.hop -= dt;
  if (a.poseT > 0) {
    a.poseT -= dt;
    if (a.pose === "cheer" && a.hop <= 0 && a.poseT > 0.3) a.hop = 0.45;
    if (a.poseT <= 0) a.pose = "stand";
    if (a.pose === "cheer" || a.pose === "wave") return;
  }
  const st = a.plan[0];
  if (!st) {
    if (a.pose === "walk") a.pose = "stand";
    a.idle += dt;
    return;
  }
  a.idle = 0;
  switch (st.do) {
    case "go":
      if (a.seat >= 0) unseat(a);
      st.age += dt;
      if (stepTo(a, st.x, st.y, st.v, dt) || st.age > 7) {
        if (st.age > 7) {
          a.x = st.x;
          a.y = st.y;
          a.pose = "stand";
        }
        a.plan.shift();
      }
      break;
    case "wait":
      st.s -= dt;
      if (a.pose === "walk") a.pose = "stand";
      if (st.s <= 0) a.plan.shift();
      break;
    case "say":
      speak(a, st.text);
      a.plan.shift();
      break;
    case "face":
      a.face = st.face;
      a.plan.shift();
      break;
    case "sit": {
      if (a.seat < 0) {
        const n = freeSeat(st.seat);
        if (n < 0) {
          a.plan.shift();
          break;
        }
        a.seat = n;
        seats[n] = a;
      }
      const p = seatAt(a.seat);
      st.age += dt;
      if (stepTo(a, p.x, p.y, st.v, dt) || st.age > 7) {
        a.x = p.x;
        a.y = p.y;
        a.face = p.face;
        a.pose = "stand";
        a.sat = true;
        a.plan.shift();
        puff(a.x, a.y + 2, 2);
        if (a === me) countSeats();
      }
      break;
    }
    case "call":
      a.plan.shift();
      st.fn();
      break;
    case "leave": {
      if (a.seat >= 0) unseat(a);
      const [tx, ty] = view.trail;
      if (stepTo(a, tx, ty, 40, dt)) {
        a.gone = true;
        a.plan.shift();
      }
      break;
    }
  }
}

function go(a: Actor, x: number, y: number, fast: boolean): Step {
  return { do: "go", x, y, v: fast ? hurry(a, x, y) : 32, age: 0 };
}
function standBy(th: Thing): [number, number] {
  const inf = infoOf(th);
  return [
    clamp(th.x + inf.stand[0], view.gx0 + 2, view.gx1 - 2),
    clamp(th.y + inf.stand[1], view.gy0 + 6, view.gy1 + 4),
  ];
}
function faceTo(a: Actor, th: Thing): Face {
  const dx = th.x - a.x;
  const dy = th.y - (infoOf(th).flat ? 0 : 8) - a.y;
  return Math.abs(dx) > Math.abs(dy) * 1.6 ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
}
/** Sends the member to a thing, quickly, and does something once they are there. */
function send(th: Thing, then: () => void): void {
  const [x, y] = standBy(th);
  me.plan = [go(me, x, y, true), { do: "call", fn: () => (me.face = faceTo(me, th)) }, { do: "call", fn: then }];
}

/** What the member does when left alone. */
function wander(): void {
  const r = Math.random();
  const usable = things.filter((t) => isFixed(t.kind) && t.kind !== "fire");
  if (r < 0.3 && thing("fire") && freeSeat(0) >= 0) {
    me.plan = [sitStep(me, 0), { do: "wait", s: 9 + Math.random() * 8 }];
  } else if (r < 0.8 && usable.length) {
    const th = pick(usable);
    const [x, y] = standBy(th);
    me.plan = [
      go(me, x, y, false),
      { do: "call", fn: () => (me.face = faceTo(me, th)) },
      { do: "wait", s: 2.5 + Math.random() * 3 },
    ];
  } else {
    const [x, y] = freeSpot(0.15 + Math.random() * 0.7, 0.35 + Math.random() * 0.6);
    me.plan = [go(me, x, y, false), { do: "face", face: "down" }, { do: "wait", s: 2 + Math.random() * 3 }];
  }
}

function countSeats(): void {
  if (!atHome() && !host) return;
  const n = sitters().filter((a) => a !== me).length;
  if (me.seat >= 0 && n > save.seats && !save.claimed.includes("seats")) {
    const was = save.seats;
    save.seats = Math.min(3, n);
    if (was < 3 && save.seats >= 3) ui.feed("Warm seats: three guild-mates by the fire. The board has Leaf for you.");
    ui.refresh();
    keep();
  }
}

// ---------- guild-mates coming and going ----------

function present(id: string): boolean {
  return actors.some((a) => a.id === id && !a.gone);
}

function arrive(m: Mate, quick = false): void {
  if (present(m.id) || !atHome()) return;
  const [tx, ty] = view.trail;
  const a = makeActor(m.id, m.name, tx, ty);
  actors.push(a);
  const fire = thing("fire");
  const [nx, ny] = fire ? [fire.x + 34, fire.y + 30] : freeSpot(0.6, 0.7);
  const stay = quick ? 30 : 45 + Math.random() * 35;
  const mailbox = thing("mailbox");
  a.plan = [
    go(a, nx, ny, false),
    { do: "say", text: pick(HELLO) },
    { do: "call", fn: () => strike(a, "wave", 1.1) },
    { do: "wait", s: 1.6 },
    sitStep(a, -1),
    { do: "call", fn: countSeats },
    { do: "wait", s: stay },
  ];
  if (mailbox) {
    const [mx, my] = standBy(mailbox);
    a.plan.push(
      go(a, mx, my, false),
      { do: "face", face: "left" },
      { do: "call", fn: () => leaveGift(m) },
      { do: "wait", s: 1.2 },
    );
  }
  a.plan.push({ do: "say", text: pick(BYE) }, { do: "wait", s: 1.2 }, { do: "leave" });
  ui.feed(`${m.name} wandered into your camp.`, true);
  ui.setMates();
}

const GIFTS: [DecoKind, string][] = [
  ["pot", "a flower pot"],
  ["shroom", "a clump of mushrooms"],
  ["stump", "a stump stool"],
  ["gnome", "a gnome (it was looking at them)"],
  ["flag", "a pennant"],
];
function leaveGift(m: Mate): void {
  const mailbox = thing("mailbox");
  if (!mailbox) return;
  const [kind, words] = pick(GIFTS);
  letters.push({
    icon: "gift",
    title: `From ${m.name}: ${words}`,
    detail: "It goes in your tray, for decorating.",
    deco: kind,
    faces: [m.id],
  });
  mailbox.bump = T;
  burst("gift", mailbox.x + 10, mailbox.y - 14, 1);
  sfx.mail();
  ui.feed(`${m.name} left something in your mailbox.`);
  ui.refresh();
}

// ---------- pets ----------

function tickPet(p: Pet, dt: number): void {
  p.t -= dt;
  p.phase += dt;
  if (p.joy > 0) p.joy -= dt;
  const kind = p.spec.kind;
  if (p.state === "sleep") {
    p.zed -= dt;
    if (p.zed <= 0) {
      p.zed = 1.7;
      add("zed", p.x + 6, p.y - 8, 3, -7, 1.6);
    }
    if (p.t <= 0) {
      p.state = "idle";
      p.t = 2;
    }
    return;
  }
  if (p.state === "idle") {
    if (p.t > 0) return;
    const r = Math.random();
    if (kind === "cat" && r < 0.3) {
      const fire = thing("fire");
      const rugTh = things.find((t) => t.kind === "rug");
      const at = rugTh ?? fire;
      if (at) {
        p.tx = at.x + (rugTh ? 0 : 22 * (Math.random() < 0.5 ? -1 : 1));
        p.ty = at.y + (rugTh ? 1 : 26);
        p.state = "walk";
        p.t = -1;
        return;
      }
    }
    if (r < 0.75) {
      // a wander, sometimes toward whoever is home
      const near =
        kind === "fox" && Math.random() < 0.5
          ? [me.x + (Math.random() - 0.5) * 30, me.y + 8 + Math.random() * 8]
          : [p.x + (Math.random() - 0.5) * 70, p.y + (Math.random() - 0.5) * 40];
      const [x, y] = [clamp(near[0]!, view.gx0 + 8, view.gx1 - 8), clamp(near[1]!, view.gy0 + 12, view.gy1 - 2)];
      if (!things.some((th) => inFoot(th, x, y, 1.2))) {
        p.tx = x;
        p.ty = y;
        p.state = "walk";
        p.t = 0;
        return;
      }
    }
    p.t = 1.5 + Math.random() * 3;
    return;
  }
  // walking
  const dx = p.tx - p.x;
  const dy = p.ty - p.y;
  const d = Math.hypot(dx, dy);
  const v = kind === "glorp" ? (Math.sin(p.phase * 7) > 0 ? 38 : 0) : kind === "cat" ? 26 : 36;
  if (d < 2 || things.some((th) => inFoot(th, p.x + (dx / (d || 1)) * 4, p.y + (dy / (d || 1)) * 4, 0.9))) {
    if (kind === "cat" && p.t < 0) {
      p.state = "sleep";
      p.t = 14 + Math.random() * 14;
      return;
    }
    p.state = "idle";
    p.t = 1.5 + Math.random() * 3.5;
    return;
  }
  p.x += (dx / d) * v * dt;
  p.y += (dy / d) * v * dt;
  if (Math.abs(dx) > 1) p.dir = dx > 0 ? 1 : -1;
}

function petPleased(p: Pet): void {
  p.joy = 1.1;
  if (p.state === "sleep") {
    p.state = "idle";
    p.t = 3;
  }
  burst("heart", p.x, p.y - 12, 2);
  const kind = p.spec.kind;
  if (kind === "cat") sfx.purr();
  else if (kind === "fox") sfx.yip();
  else sfx.blob();
  ui.feed(
    kind === "cat"
      ? `${p.spec.name} purrs.`
      : kind === "fox"
        ? `${p.spec.name} does a small happy spin.`
        : `${p.spec.name} wobbles, delighted.`,
    true,
  );
}

// ---------- crabs ----------

function tickCrab(c: Crab, dt: number): void {
  if (c.hop > 0) c.hop -= dt;
  const pool = thing("pool");
  if (!pool) return;
  const dx = c.tx - c.x;
  const dy = c.ty - c.y;
  const d = Math.hypot(dx, dy);
  if (d > 1) {
    const v = c.state === "home" ? 13 : 30;
    c.x += (dx / d) * v * dt;
    c.y += (dy / d) * v * dt;
    return;
  }
  if (c.state === "out") {
    // it has reached its hiding place
    crabs = crabs.filter((o) => o !== c);
    hideCrab();
    return;
  }
  c.state = "home";
  c.t -= dt;
  if (c.t <= 0) {
    c.t = 1 + Math.random() * 4;
    const a = Math.random() * TAU;
    c.tx = pool.x + Math.cos(a) * (35 + Math.random() * 13);
    c.ty = pool.y + Math.sin(a) * (16 + Math.random() * 8);
  }
}

function foundCrab(): void {
  if (!hide) return;
  const pool = thing("pool");
  const n = save.missing;
  const x = hide.th.x + hide.dx;
  const y = hide.th.y + hide.dy;
  hide.th.bump = T;
  hide = null;
  save.crabsFound++;
  burst("star", x, y, 5);
  sfx.crab();
  sfx.sparkle();
  if (pool) {
    crabs.push({ n, x, y: y + 20, tx: pool.x - 30, ty: pool.y + 14, t: 2, hop: 0.4, state: "back" });
    // and while everyone is looking at that one, another slips away
    const stay = crabs.filter((c) => c.n !== n && c.state === "home");
    const next = pick(stay);
    save.missing = next.n;
    after(2.2, () => {
      const spots = things.filter((th) => th.kind in CRAB_HIDES && (th.kind !== "cabin" || spec.home === "cabin"));
      const to = pick(spots.length ? spots : things);
      next.state = "out";
      next.tx = to.x;
      next.ty = to.y - 2;
    });
  }
  ui.feed(`crab${n} is accounted for! Everyone is here. Probably.`);
  keep();
  ui.refresh();
}

function rollCall(): void {
  const pool = thing("pool");
  if (!pool) return;
  crabs
    .filter((c) => c.state === "home")
    .sort((a, b) => a.n - b.n)
    .forEach((c, i) =>
      after(i * 0.16, () => {
        c.hop = 0.35;
        sfx.crab();
      }),
    );
  after(1.7, () => {
    if (hide) {
      hide.th.bump = T;
      sfx.knock();
    }
  });
}

// ---------- sparks, hearts and the rest ----------

function add(k: PartKind, x: number, y: number, vx: number, vy: number, life: number, a = 0): Part {
  const p: Part = { k, x, y, vx, vy, t: 0, life, a, tx: 0, ty: 0, fn: null };
  parts.push(p);
  return p;
}
function burst(k: PartKind, x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const s = 8 + Math.random() * 22;
    if (k === "heart" || k === "note" || k === "gift")
      add(k, x + (i - (n - 1) / 2) * 7, y, (Math.random() - 0.5) * 8, -16 - Math.random() * 6, 1.3, i * 0.12);
    else if (k === "star") add(k, x, y, Math.cos(a) * s, Math.sin(a) * s - 6, 0.6 + Math.random() * 0.4, Math.random());
    else if (k === "spark")
      add(
        k,
        x + (Math.random() - 0.5) * 10,
        y,
        (Math.random() - 0.5) * 22,
        -20 - Math.random() * 34,
        0.7 + Math.random() * 0.8,
        Math.random(),
      );
    else if (k === "drop")
      add(k, x, y, Math.cos(a) * s * 0.9, -22 - Math.random() * 26, 0.6 + Math.random() * 0.3, Math.random());
    else if (k === "paper")
      add(
        k,
        x + (Math.random() - 0.5) * 20,
        y,
        (Math.random() - 0.5) * 20,
        -10 - Math.random() * 14,
        1.4,
        Math.random() * 6,
      );
    else if (k === "needle")
      add(
        k,
        x + (Math.random() - 0.5) * 26,
        y + Math.random() * 6,
        (Math.random() - 0.5) * 6,
        9 + Math.random() * 10,
        2.6 + Math.random() * 1.6,
        Math.random() * 6,
      );
    else add(k, x, y, Math.cos(a) * s, Math.sin(a) * s * 0.5, 0.5, Math.random());
  }
}
function puff(x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++)
    add(
      "dust",
      x + (Math.random() - 0.5) * 6,
      y,
      (Math.random() - 0.5) * 16,
      -3 - Math.random() * 5,
      0.45 + Math.random() * 0.2,
    );
}

/** Leaf or coins fly from a place in the camp up to the purse, and count there as they land. */
function loot(which: "leaf" | "coins", amount: number, x: number, y: number): void {
  const n = Math.min(12, Math.max(1, amount));
  const [px, py] = ui.purseSpot(which);
  const each = amount / n;
  for (let i = 0; i < n; i++) {
    const p = add(
      "loot",
      x,
      y,
      (Math.random() - 0.5) * 70,
      -30 - Math.random() * 50,
      0.75 + i * 0.07,
      which === "leaf" ? 0 : 1,
    );
    p.tx = px / view.k;
    p.ty = py / view.k;
    p.fn = () => {
      shown[which] = Math.min(save[which], shown[which] + each);
      if (i === n - 1) shown[which] = save[which];
      ui.setPurse(shown.leaf, shown.coins);
      if (which === "leaf") sfx.leaf(i);
      else sfx.coin();
    };
  }
}

function tickParts(dt: number): void {
  for (const p of parts) {
    p.t += dt;
    if (p.t < 0) continue;
    if (p.k === "loot") {
      const f = clamp(p.t / p.life, 0, 1);
      if (f < 0.3) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 90 * dt;
      } else {
        const e = ((f - 0.3) / 0.7) ** 2;
        p.x = lerp(p.x, p.tx, e * 0.5 + 0.04);
        p.y = lerp(p.y, p.ty, e * 0.5 + 0.04);
      }
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.k === "drop") p.vy += 120 * dt;
    else if (p.k === "spark") {
      p.vx += (noise(p.a * 9, T * 2, 7) - 0.5) * 60 * dt;
      p.vy += 8 * dt;
    } else if (p.k === "needle") p.vx = Math.sin(T * 3 + p.a) * 9;
    else if (p.k === "paper") {
      p.vx = Math.sin(T * 3 + p.a) * 9;
      p.vy += 30 * dt;
    } else if (p.k === "smoke" || p.k === "steam") p.vx = Math.sin(T * 0.9 + p.a) * 3 + 2.5;
    else if (p.k === "dust") {
      p.vx *= 1 - 4 * dt;
    }
  }
  const before = parts.length;
  parts = parts.filter((p) => {
    if (p.t < p.life) return true;
    p.fn?.();
    return false;
  });
  if (before > 400) parts.splice(0, parts.length - 400);
}

// ---------- the guild, live ----------

function everyoneCheers(): void {
  actors.forEach((a, n) => {
    // nobody on their way somewhere stops for it, the member least of all
    if (a.pose === "walk" || (a === me && me.plan.some((s) => s.do === "go" || s.do === "sit"))) return;
    after(n * 0.09, () => {
      strike(a, "cheer", 1.5);
      if (a !== me && Math.random() < 0.6) speak(a, pick(CHEERS), 2);
    });
  });
  for (const p of pets) p.joy = 1.1;
  for (const c of crabs) c.hop = 0.35;
  sfx.cheer();
}

function liveEvent(kind?: "raid" | "land" | "level"): void {
  const k = kind ?? (["raid", "land", "level"] as const)[eventN % 3]!;
  eventN++;
  if (k === "raid") {
    const m = MATES[(eventN * 3) % MATES.length]!;
    const x = view.w * (0.3 + Math.random() * 0.4);
    lanterns.push({ x, y: view.gy0 - 16, ph: Math.random() * 9, boost: 0.6 });
    sfx.bell();
    after(0.5, everyoneCheers);
    ui.feed(`${m.name}'s party finished ${pick(RAIDS)}. A lantern goes up.`);
  } else if (k === "land") {
    const n = (Math.max(0, spec.banner) + 1 + Math.floor(Math.random() * 3)) % LANDS.length;
    spec.banner = n;
    if (atHome()) {
      save.banner = n;
      if (!save.claimed.includes("land") && save.lands < 2) save.lands++;
      keep();
    }
    bannerAt = T;
    sfx.horn();
    const cabin = thing("cabin");
    if (cabin) {
      cabin.bump = T;
      after(0.9, () => burst("star", cabin.x + homeArt.banner[0], cabin.y + homeArt.banner[1] + 12, 6));
    }
    after(0.7, everyoneCheers);
    ui.feed(`The guild took ${LANDS[n]!.name}! A banner for the ${spec.home}.`);
    ui.refresh();
  } else {
    const here = actors.filter((a) => a !== me && !a.gone);
    const who =
      here.length && Math.random() < 0.7
        ? MATES.find((m) => m.id === pick(here).id)!
        : MATES[(eventN * 5) % MATES.length]!;
    who.level++;
    const a = actors.find((o) => o.id === who.id);
    if (a) {
      for (let i = 0; i < 14; i++) {
        const p = add("star", a.x + Math.cos(i * 0.9) * 9, a.y - i * 2.6, 0, -9, 0.9 + i * 0.04, Math.random());
        p.t = -i * 0.04;
      }
      strike(a, "cheer", 1.6);
      speak(a, `level ${who.level}!`, 2.6);
      const friend = here.find((o) => o !== a);
      if (friend) after(0.8, () => speak(friend, pick(["gz!", "big.", "glory!", "nice one."]), 2));
    } else {
      shoot = { x: view.w * (0.2 + Math.random() * 0.3), y: view.gy0 * 0.12, t: 0 };
    }
    sfx.sparkle();
    ui.feed(`${who.name} reached level ${who.level}.`);
  }
}

// ---------- what touching things does ----------

function touch(th: Thing): void {
  th.bump = T;
  const k = th.kind;
  if (k === "fire") {
    flare = 0.7;
    burst("spark", th.x, th.y - 8, 10);
    sfx.whoosh();
  } else if (k === "pool") {
    burst("drop", th.x + (Math.random() - 0.5) * 20, th.y, 8);
    sfx.splash();
    for (const c of crabs) if (c.state === "home") c.hop = 0.3 + Math.random() * 0.15;
  } else if (k === "board") {
    burst("paper", th.x, th.y - 30, 3);
    sfx.page();
  } else if (k === "shelf") {
    for (let i = 0; i < 5; i++) {
      const p = add("star", th.x - 8 + (i % 2) * 14, th.y - 40 + i * 7, 0, -4, 0.5, Math.random());
      p.t = -i * 0.08;
    }
    sfx.sparkle();
  } else if (k === "bench") {
    for (let i = 0; i < 3; i++) add("steam", th.x + BENCH.steam[0], th.y + BENCH.steam[1], 0, -12 - i * 4, 1.2, i);
    sfx.gear();
  } else if (k === "cabin") {
    doorT = T + 1.6;
    for (let i = 0; i < 3; i++)
      if (homeArt.chimney) add("smoke", th.x + homeArt.chimney[0], th.y + homeArt.chimney[1], 0, -9 - i * 3, 2.6, i);
    sfx.knock();
  } else if (k === "mailbox") {
    sfx.mail();
  } else if (k === "sign") {
    sfx.knock();
  } else if (k === "lamp") {
    th.off = !th.off;
    sfx.pop();
  } else if (k === "gnome") {
    sfx.hop();
    ui.feed(
      pick([
        "The gnome says nothing. It never does.",
        "The gnome has moved since yesterday. Probably.",
        "You feel judged by a gnome.",
      ]),
      true,
    );
  } else if (k === "statue") {
    sfx.crab();
    ui.feed("A stone crab. It is accounted for.", true);
  } else if (k === "shroom") {
    burst("star", th.x, th.y - 6, 2);
    sfx.pop();
  } else sfx.hop();
}

function useAtHome(th: Thing): void {
  const k = th.kind;
  if (k === "fire") {
    me.plan = [sitStep(me, me.seat >= 0 ? me.seat : 0, true), { do: "call", fn: () => panel("fire") }];
    if (me.seat >= 0) panel("fire");
  } else if (k === "cabin")
    send(th, () => {
      doorT = T + 4;
      panel("cabin");
    });
  else if (k === "mailbox")
    send(th, () => {
      mailOpen = true;
      if (letters.length) burst("paper", th.x, th.y - 20, 2);
      panel("mail");
    });
  else if (k === "bench")
    send(th, () => {
      takeCoins(th);
      panel("works");
    });
  else if (k === "board") send(th, () => panel("quests"));
  else if (k === "shelf") send(th, () => panel("profile"));
  else if (k === "pool") send(th, () => panel("crabs"));
  else if (k === "sign")
    send(th, () => {
      const [x, y] = css(th.x, th.y - 44);
      ui.signCard(
        x,
        y,
        () => panel("treasury"),
        () => panel("market"),
      );
    });
  else if (k === "stump" || k === "rug") {
    const [x, y] = [th.x, th.y + (k === "rug" ? 1 : 3)];
    me.plan = [go(me, x, y, true), { do: "face", face: "down" }];
  } else {
    const [x, y] = standBy(th);
    me.plan = [go(me, x, y, true), { do: "call", fn: () => (me.face = faceTo(me, th)) }];
  }
}

function useAway(th: Thing, m: Mate): void {
  const k = th.kind;
  const h = actors.find((a) => a.id === m.id);
  const hostSays = (text: string): void => {
    if (h) speak(h, text);
  };
  if (k === "fire") {
    me.plan = [sitStep(me, 1, true), { do: "call", fn: () => panel("fire") }];
  } else if (k === "sign")
    send(th, () => {
      const [x, y] = css(th.x, th.y - 44);
      ui.showCard(
        x,
        y,
        ui.h("h3", "", "Where to?"),
        Object.assign(ui.h("button", "b arrow left", "Back to your camp"), {
          onclick: () => (ui.hideCard(), goHome()),
        }),
        Object.assign(ui.h("button", "b arrow", "Another camp"), { onclick: () => panel("visit") }),
      );
    });
  else if (k === "mailbox")
    send(th, () => {
      burst("gift", th.x, th.y - 22, 1);
      th.bump = T;
      sfx.mail();
      ui.feed(`You left a pinecone in ${m.name}'s mailbox.`, true);
      after(0.7, () => hostSays(pick(GIFT_THANKS)));
    });
  else if (k === "shelf")
    send(th, () => {
      const [x, y] = css(th.x, th.y - 50);
      ui.mateCard(m.id, x, y);
    });
  else if (k === "cabin")
    send(th, () => {
      doorT = T + 3;
      hostSays(spec.home === "tent" ? "it's bigger on the inside. (it is not.)" : "wipe your boots!");
    });
  else if (k === "pool")
    send(th, () => {
      hostSays("four crabs. all here. I counted.");
    });
  else if (k === "bench") send(th, () => hostSays("don't touch the dials."));
  else if (k === "board") send(th, () => hostSays("same quests as yours. suspicious."));
  else {
    const [x, y] = standBy(th);
    me.plan = [go(me, x, y, true)];
  }
}

function takeCoins(th: Thing): void {
  if (!stacks) return;
  const got = stacks * 7;
  save.coins += got;
  worksMade += got;
  stacks = 0;
  loot("coins", got, th.x + BENCH.tray[0], th.y + BENCH.tray[1]);
  keep();
}

function thingAt(x: number, y: number): Thing | null {
  let best: Thing | null = null;
  let bestY = -1e9;
  for (const th of things) {
    const inf = infoOf(th);
    const padX = Math.max(inf.w / 2, 10) + 2;
    const top = inf.flat
      ? th.y - Math.max(inf.h / 2, 9) - (th.kind === "fire" ? 14 : 0)
      : th.y - Math.max(inf.h, 18) - 2;
    const bot = inf.flat ? th.y + Math.max(inf.h / 2, 9) : th.y + 3;
    if (Math.abs(x - th.x) > padX || y < top || y > bot) continue;
    // flat things lose to whatever stands on them
    const rank = inf.flat ? th.y - 1000 : th.y;
    if (rank > bestY) {
      best = th;
      bestY = rank;
    }
  }
  return best;
}

function creatureAt(x: number, y: number): (() => void) | null {
  let best: (() => void) | null = null;
  let bd = 1e9;
  const offer = (d: number, fn: () => void): void => {
    if (d < bd) {
      bd = d;
      best = fn;
    }
  };
  if (hide) {
    const d = Math.hypot(hide.th.x + hide.dx - x, hide.th.y + hide.dy - 2 - y);
    if (d < 10) offer(d * 0.5, foundCrab);
  }
  for (const p of pets) {
    const d = Math.hypot(p.x - x, p.y - 6 - y);
    if (d < 12) offer(d, () => petPleased(p));
  }
  for (const c of crabs) {
    const d = Math.hypot(c.x - x, c.y - 3 - y);
    if (d < 8)
      offer(d, () => {
        c.hop = 0.4;
        sfx.crab();
        ui.feed(`crab${c.n}. Present.`, true);
      });
  }
  for (const a of actors) {
    if (a.gone) continue;
    if (Math.abs(x - a.x) < 9 && y > a.y - 36 && y < a.y + 3) offer(Math.abs(x - a.x) + 4, () => touchActor(a));
  }
  return best;
}

function touchActor(a: Actor): void {
  a.hop = 0.3;
  sfx.tap();
  if (a === me) {
    strike(me, "wave", 0.9);
    ui.feed("That's you. Looking sharp.", true);
    return;
  }
  const [x, y] = css(a.x, a.y - 40);
  ui.mateCard(a.id, x, y);
}

function canopyDepth(x: number): number {
  const f = x / view.w;
  const side = f < 0.5 ? 1 - f / 0.44 : (f - 0.56) / 0.44;
  return Math.max(0, side) ** 1.5 * view.h * (view.tall ? 0.15 : 0.27) + 2;
}

/** A touch on the scene, in scene pixels. */
export function tap(x: number, y: number): void {
  if (wipe) return;
  autoArrive = false;
  // a touch is an errand: the member drops whatever pose they were striking
  if (me.poseT > 0) {
    me.poseT = 0;
    me.pose = "stand";
  }
  const hadCard = ui.cardOpen();
  ui.hideCard();
  for (const l of lanterns) {
    if (Math.hypot(l.x - x, l.y - 4 - y) < 11) {
      l.boost = 1;
      burst("star", l.x, l.y - 4, 4);
      sfx.bell();
      return;
    }
  }
  const who = creatureAt(x, y);
  if (who) {
    who();
    return;
  }
  const th = thingAt(x, y);
  if (th) {
    touch(th);
    if (decor) return;
    if (ui.panelOpen()) ui.closePanel();
    if (host) useAway(th, host);
    else useAtHome(th);
    return;
  }
  if (ui.panelOpen()) {
    ui.closePanel();
    return;
  }
  if (hadCard) return;
  if (y < view.gy0 - 8) {
    if (y < canopyDepth(x) + 10 || y > view.gy0 * 0.52) {
      burst("needle", x, y, 7);
      sfx.rustle();
      if (Math.random() < 0.2) ui.feed("Something in the redwoods says hoo.", true);
    } else {
      skyStars.push({ x, y, t: 0 });
      burst("star", x, y, 3);
      sfx.star();
    }
    return;
  }
  // the ground: the grass gives, and the member walks over
  puff(x, y, 3);
  add("ring", x, y, 0, 0, 0.4);
  sfx.ground();
  if (!decor) {
    let gx = clamp(x, view.gx0 + 4, view.gx1 - 4);
    let gy = clamp(y, view.gy0 + 6, view.gy1 + 2);
    const hit = things.find((t) => inFoot(t, gx, gy, 1));
    if (hit) [gx, gy] = standBy(hit);
    me.plan = [go(me, gx, gy, true)];
  }
}

/** What is under the pointer, for the cursor and a name. */
export function hover(x: number, y: number): boolean {
  const th = creatureAt(x, y) ? null : thingAt(x, y);
  hoverId = th ? th.id : "";
  return th !== null || creatureAt(x, y) !== null;
}

// ---------- decorating ----------

function setDecor(on: boolean): void {
  decor = on;
  held = null;
  ui.hideCard();
  if (on && ui.panelOpen()) ui.closePanel();
  ui.showTray(on);
  ui.setDecorIcon(on);
  sfx.open();
  if (on) ui.feed("Decorating. Drag things about; tap the tray to set one out, drop it back to put it away.", true);
}

export function grab(x: number, y: number): boolean {
  if (!decor || host) return false;
  const th = thingAt(x, y);
  if (!th) return false;
  held = th;
  heldDX = th.x - x;
  heldDY = th.y - y;
  sfx.pop();
  return true;
}
export function drag(x: number, y: number, clientX: number, clientY: number): void {
  if (!held) return;
  const inf = infoOf(held);
  const half = inf.w / 2 - 8;
  held.x = Math.round(clamp(x + heldDX, view.gx0 + half - 6, view.gx1 - half + 6));
  held.y = Math.round(
    clamp(y + heldDY, view.gy0 + (inf.flat ? inf.h / 2 : 5), view.gy1 - (inf.flat ? inf.h / 2 - 4 : 0)),
  );
  const r = ui.trayRect();
  ui.trayHot(!!held.extra && !!r && clientX > r.left && clientX < r.right && clientY > r.top && clientY < r.bottom);
}
export function drop(clientX: number, clientY: number): void {
  const th = held;
  if (!th) return;
  held = null;
  ui.trayHot(false);
  const r = ui.trayRect();
  if (th.extra && r && clientX > r.left && clientX < r.right && clientY > r.top && clientY < r.bottom) {
    // back in the tray
    const e = th.extra;
    things = things.filter((t) => t !== th);
    save.extras = save.extras.filter((x) => x !== e);
    save.tray[e.kind] = (save.tray[e.kind] ?? 0) + 1;
    burst("star", th.x, th.y - 6, 4);
    sfx.pop();
    ui.showTray(true);
    keep();
    return;
  }
  // not set down inside the fire's circle, the pond, or another thing
  if (infoOf(th).foot) {
    for (let n = 0; n < 4; n++) {
      const hit = things.find((o) => o !== th && inFoot(o, th.x, th.y, 0.9));
      const f = hit && footCentre(hit);
      if (!f) break;
      const dx = (th.x - f[0]) / (f[2] + 6) || 0.01;
      const dy = (th.y - f[1]) / (f[3] + 4) || 1;
      const d = Math.hypot(dx, dy);
      th.x = Math.round(clamp(f[0] + (dx / d) * (f[2] + 6) * 1.05, view.gx0, view.gx1));
      th.y = Math.round(clamp(f[1] + (dy / d) * (f[3] + 4) * 1.05, view.gy0 + 5, view.gy1));
    }
  }
  [th.u, th.v] = toUV(th.x, th.y);
  th.bump = T;
  puff(th.x, th.y, 5);
  sfx.thump();
  if (th.extra) th.extra[mode()] = [th.u, th.v];
  else if (isFixed(th.kind)) save.spots[mode()][th.kind] = [th.u, th.v];
  if (th.kind === "fire" || th.kind === "cabin") rebuild();
  // nobody is left standing inside it
  for (const a of actors) {
    if (a.seat >= 0) {
      const p = seatAt(a.seat);
      a.x = p.x;
      a.y = p.y;
    } else if (inFoot(th, a.x, a.y, 1)) [a.x, a.y] = standBy(th);
  }
  keep();
}

function trayAdd(kind: DecoKind): void {
  if ((save.tray[kind] ?? 0) <= 0) {
    sfx.deny();
    return;
  }
  save.tray[kind]--;
  const [x, y] = freeSpot(0.3 + Math.random() * 0.4, view.tall ? 0.2 + Math.random() * 0.2 : 0.4 + Math.random() * 0.3);
  const uv = toUV(x, y);
  const e: Extra = { id: save.nextId++, kind, wide: uv, tall: uv };
  save.extras.push(e);
  const th = makeThing(`x${e.id}`, kind, uv, e);
  th.bump = T;
  things.push(th);
  burst("star", th.x, th.y - 8, 4);
  puff(th.x, th.y, 4);
  sfx.thump();
  ui.showTray(true);
  keep();
}

// ---------- buying, and what arrives ----------

function buy(id: string): boolean {
  const item = SHOP.find((s) => s.id === id);
  if (!item || save.leaf < item.price || save.owned.includes(id)) return false;
  save.leaf -= item.price;
  save.owned.push(id);
  shown.leaf = save.leaf;
  ui.setPurse(shown.leaf, shown.coins);
  sfx.buy();
  keep();
  // It comes down in the open, on whichever side the shop's panel is not: on a phone the panel
  // steps aside first.
  const panelOnLeft = me.x > view.w * 0.56;
  const [x, y] = view.tall ? freeSpot(0.5, 0.3) : freeSpot(panelOnLeft ? 0.6 : 0.36, 0.4);
  after(view.tall ? 0.9 : 0.3, () => {
    if (view.tall) ui.closePanel();
    delivery = { id, x, y, z: y + 30, t: 0, landed: false };
    sfx.whoosh();
  });
  return true;
}

function unpack(d: { id: string; x: number; y: number }): void {
  burst("star", d.x, d.y - 6, 9);
  sfx.sparkle();
  if (d.id === "glorp") {
    pets.push({
      spec: SHOP_PET,
      x: d.x,
      y: d.y,
      tx: d.x + 14,
      ty: d.y + 10,
      state: "walk",
      t: 0,
      dir: 1,
      joy: 1.6,
      phase: 0,
      zed: 0,
    });
    spec.pets = [...spec.pets, SHOP_PET];
    burst("heart", d.x, d.y - 14, 3);
    sfx.blob();
    ui.feed("Glorpe has arrived, and approves of the place.");
  } else if (d.id === "lights") {
    spec.lights = true;
    lightsLit = 0;
    for (let i = 1; i <= 9; i++)
      after(i * 0.16, () => {
        lightsLit = i;
        sfx.leaf(i);
      });
    ui.feed("Lanterns along the eave, one after another.");
  } else {
    save.roseOn = true;
    spec.rose = true;
    flare = 1.2;
    const fire = thing("fire");
    if (fire) burst("spark", fire.x, fire.y - 8, 16);
    sfx.whoosh();
    ui.feed("Rosewood on the fire. It burns pink and smells of jam.");
    keep();
  }
  ui.refresh();
  everyoneLooks();
}
function everyoneLooks(): void {
  for (const a of actors)
    if (a !== me && a.pose !== "walk" && Math.random() < 0.5)
      after(0.4 + Math.random(), () => speak(a, pick(["ooh.", "fancy!", "Cinfy delivers.", "erm. I want one."]), 2.2));
}

// ---------- going visiting ----------

function travel(mid: () => void): void {
  if (wipe) return;
  ui.closePanel();
  ui.hideCard();
  if (decor) setDecor(false);
  const [tx, ty] = view.trail;
  me.plan = [go(me, tx - 20, ty, true)];
  after(0.25, () => {
    wipe = { t: 0, mid };
    sfx.wipe();
  });
}
function walkIn(): void {
  const [x, y] = freeSpot(view.tall ? 0.62 : 0.66, 0.72);
  me.plan = [go(me, x, y, false), { do: "face", face: "down" }];
  me.plan[0] = { do: "go", x, y, v: 70, age: 0 };
}
function visit(id: string): void {
  const m = MATES.find((mm) => mm.id === id);
  if (!m) return;
  travel(() => {
    enter(m);
    walkIn();
    ui.feed(
      `${m.name}'s camp. ${m.camp.home === "tent" ? "A tent, and proud of it." : "Smoke from the chimney."}`,
      true,
    );
  });
}
function goHome(): void {
  if (atHome()) return;
  travel(() => {
    enter(null);
    walkIn();
    populate();
    ui.feed("Home again.", true);
  });
}

/** The mates who are already by the fire when the member gets in. */
function populate(): void {
  const first = [MATES[2]!, MATES[3]!];
  first.forEach((m, n) => {
    const a = makeActor(m.id, m.name, 0, 0);
    actors.push(a);
    seatNow(a, n === 0 ? 2 : 5);
    const mailbox = thing("mailbox");
    a.plan = [{ do: "wait", s: 50 + n * 40 + Math.random() * 20 }];
    if (mailbox) {
      const [mx, my] = standBy(mailbox);
      a.plan.push(go(a, mx, my, false), { do: "call", fn: () => leaveGift(m) }, { do: "wait", s: 1 });
    }
    a.plan.push({ do: "say", text: pick(BYE) }, { do: "wait", s: 1 }, { do: "leave" });
  });
  ui.setMates();
}

// ---------- the interface's side of things ----------

const camp: ui.Camp = {
  face: (id, scale = 2) => ui.pic(figOf(id).portrait, scale),
  body: () => {
    const [c, g] = canvas(22, 38);
    drawFigure(g, figOf("me"), 11, 36, "down", "stand", 0, 0);
    return c;
  },
  deco: (kind) => DECO[kind].c,
  shopArt: (id) => {
    if (id === "glorp") return glorp("pink").idle.c;
    if (id === "lights") {
      const [c, g] = canvas(13, 9);
      R(g, 0, 1, 13, 1, I.m);
      [1, 5, 9].forEach((x, n) => {
        R(g, x + 1, 2, 1, 1, I.k);
        R(g, x, 3, 3, 4, [I.g, I.M, I.G][n]!);
        R(g, x + 1, 4, 1, 2, I.j);
      });
      return c;
    }
    const [c, g] = canvas(13, 16);
    flame(g, 6, 15, 1.3, true, 1);
    return c;
  },
  letters: () => letters,
  firstMail: () => firstMail,
  collect: () => {
    const mailbox = thing("mailbox");
    const [x, y] = mailbox ? [mailbox.x, mailbox.y - 18] : [me.x, me.y - 20];
    let leaf = 0;
    let coins = 0;
    for (const l of letters) {
      leaf += l.leaf ?? 0;
      coins += l.coins ?? 0;
      if (l.deco) {
        save.tray[l.deco] = (save.tray[l.deco] ?? 0) + 1;
        burst("gift", x, y, 1);
      }
    }
    save.leaf += leaf;
    save.coins += coins;
    if (leaf) loot("leaf", leaf, x, y);
    if (coins) after(0.25, () => loot("coins", coins, x, y));
    if (!leaf && !coins) sfx.sparkle();
    letters = [];
    firstMail = false;
    strike(me, "cheer", 1);
    for (const p of pets) p.joy = 1.1;
    keep();
    ui.refresh();
    after(1.3, () => {
      if (ui.panelOpen() === "mail") ui.closePanel();
      if (!toldToTouch) ui.feed("It is all yours. Everything here answers a touch.", true);
      toldToTouch = true;
    });
  },
  progress: (id) => (id === "raids" ? 3 : id === "seats" ? save.seats : save.lands),
  claim: (id) => {
    const q = QUESTS.find((qq) => qq.id === id);
    if (!q || save.claimed.includes(id)) return;
    save.claimed.push(id);
    save.leaf += q.leaf;
    const b = thing("board");
    loot("leaf", q.leaf, b ? b.x : me.x, b ? b.y - 28 : me.y - 20);
    if (b) {
      b.bump = T;
      burst("paper", b.x, b.y - 30, 4);
    }
    strike(me, "cheer", 1.2);
    sfx.sparkle();
    keep();
    ui.refresh();
  },
  buy,
  offer: (n) => {
    const l = MARKET[n];
    if (!l || save.offered.includes(n)) return;
    save.offered.push(n);
    sfx.page();
    const m = MATES.find((mm) => mm.id === l.by)!;
    ui.feed(`Offer sent to ${m.name}. They will write back.`, true);
    keep();
    after(13, () => {
      letters.push({
        icon: "note",
        title: `${m.name} wrote back`,
        detail: `"${l.reply}" Leaf changes hands when it is done.`,
        faces: [m.id],
      });
      const mailbox = thing("mailbox");
      if (mailbox) mailbox.bump = T;
      sfx.mail();
      ui.feed(`A letter from ${m.name}.`);
      ui.refresh();
    });
  },
  sitters: () => sitters().map((a) => ({ id: a.id, name: a.name })),
  seated: () => me.seat >= 0,
  sit: () => {
    me.plan = [sitStep(me, 0, true), { do: "call", fn: () => ui.refresh() }];
  },
  stand: () => {
    unseat(me);
    me.plan = [];
    ui.refresh();
  },
  emote: (kind) => {
    sfx.emote();
    const others = actors.filter((a) => a !== me && !a.gone && a.pose !== "walk");
    const answer = (fn: (a: Actor) => void): void => {
      others.forEach((a, n) => after(0.5 + n * 0.25, () => fn(a)));
    };
    if (kind === "wave") {
      strike(me, "wave", 1.4);
      answer((a) => {
        strike(a, "wave", 1.1);
        if (Math.random() < 0.5) speak(a, pick(WAVES), 2);
      });
    } else if (kind === "cheer") {
      strike(me, "cheer", 1.5);
      sfx.cheer();
      answer((a) => strike(a, "cheer", 1.3));
    } else if (kind === "laugh") {
      speak(me, "ha!", 1.6);
      me.hop = 0.3;
      burst("note", me.x, me.y - 36, 2);
      answer((a) => {
        a.hop = 0.3;
        if (Math.random() < 0.6) speak(a, pick(["hah!", "pfft.", "heh.", "LOL"]), 1.8);
      });
    } else if (kind === "heart") {
      burst("heart", me.x, me.y - 36, 3);
      answer((a) => burst("heart", a.x, a.y - 36, 1));
    } else if (kind === "toast") {
      const p = add("marsh", me.x + (me.face === "left" ? -9 : 9), me.y - 14, 0, 0, 3.2);
      p.fn = () => {
        speak(me, "golden. perfect.", 2);
        burst("star", p.x, p.y - 4, 3);
      };
      flare = 0.4;
      answer((a) => {
        if (Math.random() < 0.4) speak(a, pick(["save me one!", "it's on fire. it's ON FIRE.", "chef."]), 2.2);
      });
    } else {
      speak(me, "erm.", 1.8);
      answer((a) => {
        if (Math.random() < 0.7) speak(a, "erm.", 1.6);
      });
    }
  },
  addLog: () => {
    const fire = thing("fire");
    if (!fire) return;
    flare = 1.1;
    fire.bump = T;
    burst("spark", fire.x, fire.y - 8, 18);
    sfx.thump();
    sfx.whoosh();
    for (const a of sitters())
      if (a !== me && Math.random() < 0.4)
        after(0.5, () => speak(a, pick(["toasty.", "now THAT is a fire.", "mind the sparks!"]), 2));
  },
  roll: () => Array.from({ length: 9 }, (_, i) => ({ n: i + 1, here: i + 1 !== save.missing })),
  rollCall,
  hideout: () =>
    hide
      ? ((isFixed(hide.th.kind) ? CRAB_HIDES[hide.th.kind] : undefined) ?? "somewhere it should not be")
      : "sneaking off as we speak",
  here: (id) => present(id),
  visiting: () => host?.id ?? null,
  visit,
  goHome,
  wave: (id) => {
    const a = actors.find((o) => o.id === id);
    strike(me, "wave", 1.2);
    sfx.emote();
    if (a)
      after(0.5, () => {
        strike(a, "wave", 1.2);
        speak(a, pick(WAVES), 2.2);
      });
  },
  decorate: setDecor,
  trayAdd,
  tidyUp: () => {
    tidy();
    const hold = { x: me.x, y: me.y };
    const others = actors.filter((a) => a !== me);
    enter(null);
    actors.push(...others);
    for (const a of others) if (a.seat >= 0) seats[a.seat] = a;
    me.x = hold.x;
    me.y = hold.y;
    for (const th of things) th.bump = T + Math.random() * 0.2;
    sfx.thump();
    ui.showTray(true);
    for (const a of actors) {
      if (a.seat >= 0) {
        const p = seatAt(a.seat);
        a.x = p.x;
        a.y = p.y;
      }
    }
  },
  banner: () => (spec.banner >= 0 ? LANDS[spec.banner]!.name : null),
  toggleRose: () => {
    save.roseOn = !save.roseOn;
    if (atHome()) spec.rose = save.roseOn;
    flare = 0.8;
    sfx.whoosh();
    keep();
  },
  worksMade: () => worksMade,
  closed: () => {
    mailOpen = false;
  },
};

// ---------- drawing ----------

function flame(g: G2, x: number, y: number, t: number, rose: boolean, size: number): void {
  const c1 = rose ? I.e : I.f;
  const c2 = rose ? I.M : I.g;
  const c3 = rose ? I.N : I.i;
  for (let cx = -6; cx <= 6; cx++) {
    const env = 1 - (cx / 7) ** 2;
    const n = noise(cx * 0.55 + 10, t * 3.4, 3) * 0.55 + noise(cx * 1.4, t * 6.3, 4) * 0.45;
    const h = Math.round(env * (8 + n * 12) * size);
    if (h <= 0) continue;
    R(g, x + cx, y - h, 1, h, c1);
    const h2 = Math.round(h * 0.62) - (Math.abs(cx) > 4 ? 2 : 0);
    if (h2 > 0) R(g, x + cx, y - h2, 1, h2, c2);
    const h3 = Math.round(h * 0.34);
    if (Math.abs(cx) <= 3 && h3 > 0) R(g, x + cx, y - h3, 1, h3, c3);
    if (Math.abs(cx) <= 1 && h3 > 3) R(g, x + cx, y - h3 + 2, 1, h3 - 2, I.j);
  }
  // a tongue that has come loose
  const loose = noise(t * 2.2, 5, 9);
  if (loose > 0.55) R(g, x + Math.round((loose - 0.75) * 14), y - Math.round((17 + loose * 8) * size), 1, 2, c2);
}

function hopOf(th: Thing): number {
  const b = T - th.bump;
  if (b < 0 || b > 0.36) return 0;
  const big =
    th.kind === "cabin" || th.kind === "bench" || th.kind === "board" || th.kind === "shelf" || th.kind === "pool";
  return -Math.round(Math.sin((b / 0.36) * Math.PI) * (big ? 2 : 4));
}

function drawThing(g: G2, th: Thing): void {
  const y = th.y + hopOf(th) + (th === held ? -5 : 0);
  const x = th.x;
  switch (th.kind) {
    case "cabin": {
      put(g, doorT > T ? homeArt.open : homeArt.shut, x, y);
      if (spec.banner >= 0) {
        const art = BANNERS[spec.banner]!;
        // a tent has no wall to hang it on: it flies from a pole beside the door
        if (spec.home === "tent") R(g, x + homeArt.banner[0] + 6, y + homeArt.banner[1], 1, -homeArt.banner[1], I.m);
        const f = clamp((T - bannerAt) / 1.1, 0, 1);
        const eased = f < 1 ? 1 - (1 - f) ** 3 + Math.sin(f * 9) * 0.06 * (1 - f) : 1;
        const len = Math.max(3, Math.round(art.height * eased));
        g.drawImage(art, 0, 0, art.width, 2, x + homeArt.banner[0] - 5, y + homeArt.banner[1], art.width, 2);
        g.drawImage(
          art,
          0,
          art.height - len + 2,
          art.width,
          len - 2,
          x + homeArt.banner[0] - 5,
          y + homeArt.banner[1] + 2,
          art.width,
          len - 2,
        );
      }
      if (lightsLit > 0) {
        const [x0, x1, ey] = homeArt.eave;
        for (let i = 0; i < 9; i++) {
          const lx = Math.round(x + lerp(x0 + 4, x1 - 6, i / 8));
          const ly = y + ey + (spec.home === "tent" ? Math.abs(i - 4) * 6 : 2) + Math.round(Math.sin(i * 1.3) * 1);
          R(g, lx + 1, ly, 1, 1, I.k);
          const on = i < lightsLit;
          R(g, lx, ly + 1, 3, 3, on ? [I.g, I.M, I.G][i % 3]! : I.c);
          if (on) R(g, lx + 1, ly + 2, 1, 1, I.j);
        }
      }
      break;
    }
    case "mailbox": {
      put(g, mailOpen ? MAIL.open : MAIL.shut, x, y);
      if (letters.length) put(g, MAIL.flagUp, x + 6, y - 17 + Math.round(Math.sin(T * 9) * 0.6));
      else put(g, MAIL.flagDown, x + 6, y - 18);
      break;
    }
    case "bench": {
      put(g, BENCH.body, x, y);
      const fast = T - th.bump < 1.2;
      put(g, GEARS[Math.floor(T * (fast ? 14 : 4)) % 2]!, x + BENCH.gear[0], y + BENCH.gear[1]);
      for (let i = 0; i < (atHome() ? stacks : 0); i++) {
        R(g, x + BENCH.tray[0] - 3 + i * 2, y + BENCH.tray[1] - 2 - (i % 2), 2, 2, I.g);
        R(g, x + BENCH.tray[0] - 3 + i * 2, y + BENCH.tray[1] - 2 - (i % 2), 1, 1, I.j);
      }
      if (Math.sin(T * 3) > 0.2) R(g, x + BENCH.dome[0] - 1, y + BENCH.dome[1] + 1, 2, 2, I.G);
      break;
    }
    case "board":
      put(g, BOARD, x, y);
      break;
    case "shelf":
      put(g, SHELF, x, y);
      break;
    case "sign":
      put(g, SIGN, x, y);
      break;
    case "fire": {
      flame(g, x, y - 1 + hopOf(th), T, spec.rose, 1.2 + flare * 0.7);
      put(g, FIRE.front, x, th.y);
      break;
    }
    case "pool":
    case "rug":
      break;
    default: {
      put(g, DECO[th.kind], x, y);
      if (th.kind === "lamp" && th.off) R(g, x + 3, y - 21, 3, 3, I.c);
    }
  }
  if (hide && hide.th === th) {
    const up = Math.sin(T * 0.8) > -0.5 ? 0 : 2;
    put(g, CRAB_O.peek, x + hide.dx, y + hide.dy + up);
  }
}

function drawFlat(g: G2, th: Thing): void {
  const y = th.y + hopOf(th) + (th === held ? -4 : 0);
  if (th.kind === "rug") put(g, RUG, th.x, y + 7);
  else if (th.kind === "pool") {
    put(g, POND, th.x, y);
    // the sunset on the water, moving
    for (let i = 0; i < 7; i++) {
      const px = th.x - 18 + ((i * 7 + Math.floor(T * 3 + i * 1.7)) % 36);
      const py = y - 5 + ((i * 3) % 11);
      if (Math.hypot((px - th.x) / 22, (py - y) / 8) > 1) continue;
      R(g, px, py, 2 + (i % 2), 1, i % 3 === 0 ? I.g : i % 3 === 1 ? I.e : I.M);
    }
  } else if (th.kind === "fire") {
    put(g, FIRE.back, th.x, th.y);
    // embers under the logs
    for (let i = 0; i < 5; i++)
      if (noise(i * 3, T * 4, 2) > 0.5) R(g, th.x - 6 + i * 3, th.y + (i % 2), 1, 1, spec.rose ? I.M : I.f);
  }
}

function drawPet(g: G2, p: Pet): void {
  const joy = p.joy > 0 ? Math.abs(Math.sin(p.joy * 9)) * 5 : 0;
  R(g, p.x - 5, p.y - 1, 10, 2, "rgba(26,15,30,0.28)");
  if (p.spec.kind === "glorp") {
    const set = glorp(p.spec.hue);
    const moving = p.state === "walk";
    const cyc = Math.sin(p.phase * 7);
    const z = moving && cyc > 0 ? Math.sin(cyc * Math.PI * 0.5) * 5 : 0;
    const s =
      joy > 2 || z > 3
        ? set.stretch
        : (moving && cyc <= 0 && cyc > -0.5) || (joy > 0 && joy <= 1)
          ? set.squash
          : Math.sin(p.phase * 0.9) > 0.985
            ? set.blink
            : set.idle;
    const breathe = !moving && joy === 0 && Math.sin(p.phase * 2.2) > 0.6 ? 1 : 0;
    put(g, s, p.x, p.y - z - joy + breathe);
    if (p.spec.sprout) put(g, SPROUT, p.x, p.y - z - joy + breathe - s.h + 1);
    return;
  }
  const step = Math.floor(p.phase * 7) % 2 === 0;
  if (p.spec.kind === "cat") {
    if (p.state === "sleep") put(g, CAT_O.sleep, p.x, p.y + 1);
    else if (p.state === "walk")
      put(g, p.dir > 0 ? (step ? CAT_O.walkA : CAT_O.walkB) : step ? CAT_LO.walkA : CAT_LO.walkB, p.x, p.y + 1 - joy);
    else put(g, CAT_O.sit, p.x, p.y + 1 - joy);
    return;
  }
  const set = p.dir > 0 ? FOX_RO : FOX_O;
  if (p.state === "walk") put(g, step ? set.walkA : set.walkB, p.x, p.y + 1 - joy);
  else put(g, set.sit, p.x, p.y + 1 - joy);
}

function drawActor(g: G2, a: Actor): void {
  const jump = a.hop > 0 ? Math.round(Math.sin((a.hop / 0.45) * Math.PI) * 5) : 0;
  if (!a.sat) R(g, a.x - 6, a.y - 1, 12, 2, "rgba(26,15,30,0.3)");
  drawFigure(g, a.fig, a.x, a.y - jump, a.face, a.pose, a.walk, T, a.seat >= 0 && a.sat);
}

/** One thing to draw in the back-to-front pass, and how far forward it stands. */
type Item = { y: number } & (
  | { is: "thing"; th: Thing }
  | { is: "actor"; a: Actor }
  | { is: "pet"; p: Pet }
  | { is: "crab"; c: Crab }
  | { is: "log"; dy: number }
  | { is: "seat"; dx: number }
  | { is: "crate" }
);

function drawParts(g: G2, glowing: boolean): void {
  for (const p of parts) {
    if (p.t < 0) continue;
    const f = p.t / p.life;
    const bright =
      p.k === "spark" ||
      p.k === "heart" ||
      p.k === "note" ||
      p.k === "zed" ||
      p.k === "star" ||
      p.k === "loot" ||
      p.k === "gift" ||
      p.k === "marsh";
    if (bright !== glowing) continue;
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    switch (p.k) {
      case "spark":
        R(g, x, y, f < 0.5 ? 2 : 1, f < 0.5 ? 2 : 1, f < 0.3 ? I.j : f < 0.65 ? (spec.rose ? I.M : I.g) : I.f);
        break;
      case "smoke":
      case "steam": {
        const s = 2 + Math.floor(f * 3);
        g.globalAlpha = (1 - f) * (p.k === "steam" ? 0.75 : 0.55);
        R(g, x - s / 2, y - s / 2, s, s, p.k === "steam" ? I.j : "#9a88ad");
        R(g, x - s / 2 + 1, y - s / 2 - 1, Math.max(1, s - 2), 1, p.k === "steam" ? I.j : "#9a88ad");
        g.globalAlpha = 1;
        break;
      }
      case "needle":
        R(g, x, y, 2, 1, Math.floor(p.a) % 2 ? I.s : I.r);
        break;
      case "paper":
        R(g, x, y, 2, 2, I.j);
        break;
      case "dust":
        g.globalAlpha = 0.6 * (1 - f);
        R(g, x - 1, y - 1, 2 + Math.floor(f * 2), 2, I.w);
        g.globalAlpha = 1;
        break;
      case "drop":
        R(g, x, y, 1, 2, p.a < 0.5 ? I.F : I.M);
        break;
      case "ring": {
        const r = 2 + f * 7;
        g.globalAlpha = 0.5 * (1 - f);
        for (let i = 0; i < 8; i++)
          R(g, x + Math.cos((i / 8) * TAU) * r, y + Math.sin((i / 8) * TAU) * r * 0.5, 1, 1, I.t);
        g.globalAlpha = 1;
        break;
      }
      case "heart":
      case "note":
      case "zed":
      case "gift": {
        g.globalAlpha = f > 0.7 ? (1 - f) / 0.3 : 1;
        put(g, p.k === "heart" ? HEART : p.k === "note" ? NOTE : p.k === "zed" ? ZED : GIFT, x, y);
        g.globalAlpha = 1;
        break;
      }
      case "star":
        put(g, f < 0.5 ? STAR : STAR_S, x, y);
        break;
      case "loot":
        put(g, p.a === 0 ? LEAF_S : COIN_S, x, y);
        break;
      case "marsh":
        put(g, MARSH, x, y);
        if (f > 0.6) R(g, x - 1, y - 6, 3, 1, I.h);
        break;
    }
  }
}

function lightAt(x: number, y: number, r: number, colour: string, strength: number): void {
  const gl = glow(r, colour);
  lg.globalAlpha = strength;
  lg.drawImage(gl, Math.round(x - gl.width / 2), Math.round(y - gl.height / 2));
}

function draw(): void {
  const g = wg;
  g.globalCompositeOperation = "source-over";
  g.clearRect(0, 0, view.w, view.h);
  g.drawImage(near, 0, 0);
  // ---- what lies flat
  for (const th of things) if (th.kind === "rug") drawFlat(g, th);
  for (const th of things) if (th.kind === "pool" || th.kind === "fire") drawFlat(g, th);
  for (const th of things) {
    const f = infoOf(th).foot;
    if (!f || infoOf(th).flat) continue;
    R(g, th.x - f[0] - 1, th.y - 1, f[0] * 2 + 2, 3, "rgba(26,15,30,0.26)");
    if (th === held) R(g, th.x - f[0] + 2, th.y + 1, f[0] * 2 - 4, 2, "rgba(26,15,30,0.3)");
  }
  // ---- everything that stands, back to front
  const items: Item[] = [];
  for (const th of things) {
    if (th.kind === "rug" || th.kind === "pool") continue;
    items.push({ y: th.kind === "fire" ? th.y + 2 : th.y, is: "thing", th });
  }
  const fire = thing("fire");
  if (fire) {
    items.push({ y: fire.y - 12, is: "log", dy: -12 }, { y: fire.y + 20, is: "log", dy: 20 });
    items.push({ y: fire.y + 3, is: "seat", dx: -29 }, { y: fire.y + 3.1, is: "seat", dx: 29 });
  }
  for (const a of actors) if (!a.gone) items.push({ y: a.y, is: "actor", a });
  for (const p of pets) items.push({ y: p.y, is: "pet", p });
  for (const c of crabs) items.push({ y: c.y, is: "crab", c });
  if (delivery) items.push({ y: delivery.y, is: "crate" });
  items.sort((a, b) => a.y - b.y);
  for (const it of items) {
    if (it.is === "thing") drawThing(g, it.th);
    else if (it.is === "actor") drawActor(g, it.a);
    else if (it.is === "pet") drawPet(g, it.p);
    else if (it.is === "crab") {
      const c = it.c;
      const hop = c.hop > 0 ? Math.round(Math.sin((c.hop / 0.4) * Math.PI) * 4) : 0;
      const moving = Math.hypot(c.tx - c.x, c.ty - c.y) > 1;
      put(g, hop ? CRAB_O.up : moving && Math.floor(T * 8 + c.n) % 2 ? CRAB_O.b : CRAB_O.a, c.x, c.y - hop);
    } else if (it.is === "log" && fire) put(g, FIRE.logN, fire.x, fire.y + it.dy);
    else if (it.is === "seat" && fire) put(g, STUMP_O, fire.x + it.dx, fire.y + 4);
    else if (it.is === "crate" && delivery) {
      const d = delivery;
      R(g, d.x - 6, d.y - 1, 12, 2, "rgba(26,15,30,0.3)");
      const squash = d.landed && d.t < 0.18 ? 2 : 0;
      put(g, CRATE, d.x, d.y - d.z + squash);
      if (!d.landed) put(g, CHUTE, d.x + Math.round(Math.sin(T * 4) * 1), d.y - d.z - 12);
    }
  }
  drawParts(g, false);
  g.drawImage(over, 0, 0);

  // ---- light: dusk everywhere, warm where there is fire
  lg.globalCompositeOperation = "source-over";
  lg.globalAlpha = 1;
  lg.fillStyle = AMBIENT;
  lg.fillRect(0, 0, view.w, view.h);
  lg.globalCompositeOperation = "lighter";
  if (fire) {
    const flick = noise(T * 5, 1, 6) * 8 + flare * 26;
    const reach = (view.tall ? 92 : 112) + flick;
    lightAt(fire.x, fire.y - 6, reach, spec.rose ? "#ff8ad0" : "#ffb030", 0.95);
    lightAt(fire.x, fire.y - 8, reach * 0.5, spec.rose ? "#ffc0e0" : "#ffe090", 0.5);
  }
  const cabin = thing("cabin");
  if (cabin) {
    lightAt(cabin.x + homeArt.lamp[0], cabin.y + homeArt.lamp[1], 34, "#ffb030", 0.7);
    if (homeArt.win) lightAt(cabin.x + homeArt.win[0], cabin.y + homeArt.win[1] + 6, 24, "#ffb030", 0.45);
    if (doorT > T) lightAt(cabin.x + homeArt.door[0], cabin.y + 2, 30, "#ffc860", 0.7);
    if (lightsLit > 0) {
      const [x0, x1, ey] = homeArt.eave;
      for (let i = 0; i < Math.min(lightsLit, 9); i += 2)
        lightAt(cabin.x + lerp(x0 + 4, x1 - 6, i / 8), cabin.y + ey + 5, 16, "#ffb890", 0.5);
    }
  }
  for (const th of things) {
    if (th.kind === "lamp" && !th.off) lightAt(th.x + 4, th.y - 19, 34, "#ffb030", 0.8);
    else if (th.kind === "bench")
      lightAt(th.x + BENCH.dome[0], th.y + BENCH.dome[1] + 3, 16, "#60e080", 0.4 + Math.sin(T * 3) * 0.12);
    else if (th.kind === "mailbox" && letters.length)
      lightAt(th.x, th.y - 18, 20, "#ffc040", 0.55 + Math.sin(T * 5) * 0.2);
  }
  for (const f of flies) lightAt(f.x, f.y, 7, "#d0ff80", 0.35 + Math.sin(T * 2 + f.ph) * 0.25);
  if (delivery) lightAt(delivery.x, delivery.y - delivery.z - 6, 18, "#ffe0a0", 0.4);
  lg.globalAlpha = 1;
  lg.globalCompositeOperation = "destination-in";
  lg.drawImage(world, 0, 0);
  g.globalCompositeOperation = "multiply";
  g.drawImage(light, 0, 0);
  g.globalCompositeOperation = "source-over";

  // ---- what shines by itself
  if (fire) {
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.16 + flare * 0.1;
    const halo = glow(30, spec.rose ? "#ff8ad0" : "#ffb030");
    g.drawImage(halo, fire.x - 30, fire.y - 40);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  for (const f of flies) {
    const on = Math.sin(T * 2 + f.ph);
    if (on > -0.2) R(g, f.x, f.y, 1, 1, on > 0.5 ? I.j : I.G);
  }
  drawParts(g, true);
  for (const th of things) {
    const mark =
      (th.kind === "mailbox" && letters.length > 0 && !mailOpen) ||
      (th.kind === "board" &&
        atHome() &&
        QUESTS.some((q) => !save.claimed.includes(q.id) && camp.progress(q.id) >= q.need)) ||
      (th.kind === "bench" && atHome() && stacks >= 3);
    if (mark) put(g, BANG, th.x, th.y - infoOf(th).h - 3 + Math.round(Math.sin(T * 4) * 1.5));
  }

  // ---- onto the screen: the far sky, what is in it, then the camp
  sg.drawImage(far.c, 0, 0);
  for (const [x, y, ph] of far.stars) {
    const tw = Math.sin(T * 1.4 + ph);
    if (tw > -0.3) R(sg, x, y, 1, 1, tw > 0.6 ? I.j : I.e);
  }
  for (const s of skyStars) {
    const tw = Math.sin(T * 3 + s.x);
    put(sg, tw > 0.3 ? STAR : STAR_S, s.x, s.y);
  }
  if (shoot) {
    for (let i = 0; i < 9; i++) R(sg, shoot.x - i * 3, shoot.y - i * 1.2, 2, 1, i < 2 ? I.j : i < 5 ? I.i : I.e);
  }
  for (const l of lanterns) {
    const sway = Math.sin(T * 0.9 + l.ph) * 3;
    sg.globalCompositeOperation = "lighter";
    sg.globalAlpha = 0.35 + l.boost * 0.4 + Math.sin(T * 6 + l.ph) * 0.05;
    const gl = glow(16 + l.boost * 8, "#ffb040");
    sg.drawImage(gl, Math.round(l.x + sway - gl.width / 2), Math.round(l.y - 5 - gl.height / 2));
    sg.globalAlpha = 1;
    sg.globalCompositeOperation = "source-over";
    put(sg, SKY_LANTERN, l.x + sway, l.y);
  }
  sg.drawImage(world, 0, 0);
  if (wipe) {
    const cover = wipe.t < 1 ? wipe.t : 2 - wipe.t;
    const cell = 14;
    const cols = Math.ceil(view.w / cell) + 1;
    const rows = Math.ceil(view.h / cell) + 1;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const delay = (i + j) / (cols + rows);
        const r = Math.round(clamp(cover * 1.9 - delay * 0.9, 0, 1) * 16);
        if (r <= 0) continue;
        const cx = i * cell;
        const cy = j * cell;
        for (let dy = -r; dy <= r; dy++) {
          const hw = r - Math.abs(dy);
          R(sg, cx - hw, cy + dy, hw * 2 + 1, 1, (i + j) % 2 ? "#1c3524" : "#213f29");
        }
        if (r > 6 && (i * 7 + j * 3) % 4 === 0)
          put(sg, LEAF_S, cx + ((i * 5) % 7) - 3, cy + ((j * 3) % 5) - 2 + Math.round(Math.sin(T * 6 + i) * 1));
        else if (r > 6) R(sg, cx - 1, cy, 3, 1, I.p);
      }
    }
  }
}

// ---------- the clock ----------

function update(dt: number): void {
  T += dt;
  for (let i = timers.length - 1; i >= 0; i--) {
    const tm = timers[i]!;
    if (tm.at <= T) {
      timers.splice(i, 1);
      tm.fn();
    }
  }
  if (flare > 0) flare = Math.max(0, flare - dt * 1.2);
  for (const a of actors) tickActor(a, dt);
  if (actors.some((a) => a.gone)) {
    actors = actors.filter((a) => !a.gone);
    ui.setMates();
    ui.refresh();
  }
  for (const p of pets) tickPet(p, dt);
  for (const c of [...crabs]) tickCrab(c, dt);
  tickParts(dt);
  // ---- the member, left to themselves
  if (!me.plan.length && me.idle > (me.seat >= 0 ? 16 : 5) && !ui.panelOpen() && !ui.cardOpen() && !decor && !wipe)
    wander();
  // ---- the fire, the chimney, the machine
  const fire = thing("fire");
  if (fire && Math.random() < dt * (3 + flare * 30))
    add(
      "spark",
      fire.x + (Math.random() - 0.5) * 8,
      fire.y - 10,
      (Math.random() - 0.5) * 10,
      -16 - Math.random() * 22,
      0.8 + Math.random() * 0.9,
      Math.random(),
    );
  const cabin = thing("cabin");
  if (cabin && homeArt.chimney && Math.random() < dt * 1.3)
    add(
      "smoke",
      cabin.x + homeArt.chimney[0],
      cabin.y + homeArt.chimney[1],
      0,
      -7 - Math.random() * 3,
      3.2,
      Math.random() * 6,
    );
  const bench = thing("bench");
  if (bench) {
    if (Math.random() < dt * 0.55)
      add("steam", bench.x + BENCH.steam[0], bench.y + BENCH.steam[1], 0, -9, 1.3, Math.random() * 6);
    if (atHome() && T > nextStack && stacks < 4) {
      stacks++;
      nextStack = T + 11;
      bench.bump = T;
      burst("star", bench.x + BENCH.tray[0], bench.y + BENCH.tray[1] - 2, 2);
    }
  }
  if (Math.random() < dt * 0.35) burst("needle", Math.random() * view.w, canopyDepth(Math.random() * view.w), 1);
  for (const f of flies) {
    f.x += Math.sin(T * 0.6 + f.ph) * 5 * dt;
    f.y += Math.cos(T * 0.45 + f.ph * 2) * 4 * dt;
  }
  // ---- the sky
  for (const l of lanterns) {
    l.y -= dt * (8 + l.boost * 14);
    if (l.boost > 0) l.boost = Math.max(0, l.boost - dt * 0.8);
  }
  lanterns = lanterns.filter((l) => l.y > -14);
  for (const s of skyStars) s.t += dt;
  while (skyStars.length && (skyStars[0]!.t > 9 || skyStars.length > 12)) skyStars.shift();
  if (shoot) {
    shoot.t += dt;
    shoot.x += dt * 150;
    shoot.y += dt * 60;
    if (shoot.t > 1.1) shoot = null;
  }
  // ---- a crate coming down
  if (delivery) {
    const d = delivery;
    d.t += dt;
    if (!d.landed) {
      d.z = Math.max(0, d.z - dt * 62);
      if (d.z <= 0) {
        d.landed = true;
        d.t = 0;
        puff(d.x, d.y, 7);
        sfx.thump();
      }
    } else if (d.t > 0.75) {
      delivery = null;
      unpack(d);
    }
  }
  // ---- the guild
  if (T > nextEvent && !wipe) {
    nextEvent = T + 18 + Math.random() * 7;
    liveEvent();
  }
  if (atHome() && T > nextVisitor && !wipe) {
    nextVisitor = T + 32 + Math.random() * 16;
    const away = MATES.filter((m) => !present(m.id));
    if (actors.length < 5 && away.length)
      arrive(nextVisitor < 80 ? (away.find((m) => m.id === "ember") ?? pick(away)) : pick(away));
  }
  if (T > nextChat) {
    nextChat = T + 6 + Math.random() * 5;
    const quiet = actors.filter((a) => a !== me && !a.gone && a.pose !== "walk" && a.sayT <= 0);
    if (quiet.length && !actors.some((a) => a !== me && a.sayT > 0)) {
      const a = pick(quiet);
      const m = MATES.find((mm) => mm.id === a.id);
      speak(a, m && Math.random() < 0.3 ? pick(m.own) : pick(CHAT));
    }
  }
  if (wipe) {
    wipe.t += dt / 0.5;
    if (wipe.t >= 1 && wipe.mid) {
      const mid = wipe.mid;
      wipe.mid = null;
      mid();
    }
    if (wipe.t >= 2) wipe = null;
  }
  // ---- small sounds of the place
  ambient -= dt;
  if (ambient <= 0 && fire) {
    ambient = 0.08 + Math.random() * 0.35;
    sfx.crackle();
  }
  cricket -= dt;
  if (cricket <= 0) {
    cricket = 3 + Math.random() * 6;
    sfx.cricket();
  }
}

function overlays(): void {
  const said: ui.Said[] = [];
  // on a phone the open panel covers the lower camp: nobody speaks from under it
  const panelTop = view.tall && ui.panelOpen() ? ui.panelTop() : 1e9;
  for (const a of actors) {
    if (a.sayT <= 0 || a.gone) continue;
    const [x, y] = css(a.x, a.y - (a.sat ? 30 : 36) - (a.fig.hat ? a.fig.hat.h : 0));
    if (y > panelTop) continue;
    said.push({ id: a.id, name: a === me ? "" : a.name, text: a.say, x, y });
  }
  ui.syncBubbles(wipe ? [] : said);
  const tags: ui.Tag[] = [];
  if (!wipe && !ui.panelOpen()) {
    for (const th of things) {
      const fixed = isFixed(th.kind);
      if (!(th.id === hoverId || (fixed && (T < tagsUntil || decor)))) continue;
      const inf = infoOf(th);
      const [x, y] = css(th.x, th.y - (inf.flat ? inf.h / 2 + (th.kind === "fire" ? 20 : 2) : inf.h) - 2);
      tags.push({
        id: th.id,
        text:
          th.kind === "cabin" && host
            ? `${host.name}'s ${spec.home}`
            : th.kind === "cabin" && spec.home === "tent"
              ? "Tent"
              : NAMES[th.kind],
        x,
        y,
      });
    }
  }
  ui.syncTags(tags);
}

/** One frame: move everything on by `dt` seconds and draw it. */
export function frame(dt: number): void {
  update(clamp(dt, 0, 0.05));
  draw();
  overlays();
}

// ---------- starting, and when the window changes ----------

function sizeCanvases(): void {
  for (const c of [world, light, screen]) {
    c.width = view.w;
    c.height = view.h;
  }
  wg.imageSmoothingEnabled = false;
  lg.imageSmoothingEnabled = false;
  sg.imageSmoothingEnabled = false;
  screen.style.width = `${view.w * view.k}px`;
  screen.style.height = `${view.h * view.k}px`;
  far = buildFar(view);
  over = buildOver(view);
}

export function resize(): void {
  const old = view;
  const next = measure();
  if (next.w === old.w && next.h === old.h && next.k === old.k) return;
  const uv = (x: number, y: number): UV => [(x - old.gx0) / (old.gx1 - old.gx0), (y - old.gy0) / (old.gy1 - old.gy0)];
  const movers: { x: number; y: number }[] = [...actors, ...pets, ...crabs, ...flies];
  const kept = movers.map((m) => uv(m.x, m.y));
  const changed = next.tall !== old.tall;
  view = next;
  sizeCanvases();
  if (changed) {
    // the other way up has its own arrangement
    const plan = SPOTS[spec.plan % SPOTS.length]![mode()];
    for (const th of things) {
      if (isFixed(th.kind)) [th.u, th.v] = (!host && save.spots[mode()][th.kind]) || plan[th.kind];
      else if (th.extra) [th.u, th.v] = th.extra[mode()];
    }
  }
  for (const th of things) place(th);
  movers.forEach((m, n) => {
    const [u, v] = kept[n]!;
    m.x = view.gx0 + u * (view.gx1 - view.gx0);
    m.y = view.gy0 + v * (view.gy1 - view.gy0);
  });
  for (const a of actors) {
    if (a.seat >= 0 && a.sat) {
      const p = seatAt(a.seat);
      a.x = p.x;
      a.y = p.y;
    }
    for (const st of a.plan) {
      if (st.do !== "go") continue;
      const [u, v] = uv(st.x, st.y);
      st.x = view.gx0 + u * (view.gx1 - view.gx0);
      st.y = view.gy0 + v * (view.gy1 - view.gy0);
    }
  }
  for (const p of pets) {
    p.tx = p.x;
    p.ty = p.y;
  }
  for (const c of crabs) {
    c.tx = c.x;
    c.ty = c.y;
    c.t = 0;
  }
  parts = [];
  rebuild();
  if (decor) ui.showTray(true);
}

function awayLetters(): void {
  const mins = awayMinutes;
  const leaf = mins >= 30 ? Math.round(mins * 0.28) : mins >= 1 ? 6 : 0;
  const coins = Math.round(mins * 0.93) + 3;
  const hrs = Math.floor(mins / 60);
  const span = hrs ? `${hrs}h ${Math.round(mins % 60)}m` : `${Math.max(1, Math.round(mins))}m`;
  if (leaf) {
    const raids = mins >= 30 ? 3 : 1;
    letters.push({
      icon: "leaf",
      title: raids > 1 ? "3 raids with the guild" : "A raid with the guild",
      detail: raids > 1 ? "The Sunken Vault twice, the Thornwarden once." : "The Sunken Vault. Nobody fell in.",
      leaf,
    });
  }
  letters.push({ icon: "coin", title: "The Works kept running", detail: `${span} of belts and gears.`, coins });
  worksMade = coins;
  if (mins >= 20) {
    letters.push({
      icon: "visit",
      title: "Thistlewick and Emberlyn dropped by",
      detail: "They sat a while and fed the fire.",
      faces: ["thistle", "ember"],
    });
    letters.push({
      icon: "gift",
      title: "From Thistlewick: a potted fern",
      detail: "It goes in your tray, for decorating.",
      deco: "fern",
      faces: ["thistle"],
    });
  } else {
    letters.push({
      icon: "visit",
      title: "Pipkin looked in",
      detail: "Counted the crabs. Got eight. Left quietly.",
      faces: ["pipkin"],
    });
  }
}

export interface Debug {
  skip(seconds: number): void;
  open(id: ui.PanelId): void;
  use(id: string): void;
  event(kind: "raid" | "land" | "level"): void;
  visit(id: string): void;
  home(): void;
  decorate(on: boolean): void;
  arrive(id: string): void;
  at(id: string): { x: number; y: number } | null;
  emote(kind: string): void;
  buy(id: string): void;
  /** Where the missing crab is hiding, in CSS pixels. */
  crab(): { x: number; y: number } | null;
  pet(n: number): { x: number; y: number } | null;
  /** Milliseconds one whole frame takes, averaged over `n` of them. */
  cost(n: number): number;
  state(): unknown;
}

export function boot(el: Cv, mine: Figure | null): Debug {
  screen = el;
  sg = el.getContext("2d")!;
  figs.set("me", mine ?? inventFigure(SPARE_LOOK));
  figs.set("cinfy", inventFigure(CINFY));
  for (const m of MATES) figs.set(m.id, inventFigure(m.look));
  view = measure();
  sizeCanvases();
  awayLetters();
  enter(null);
  populate();
  ui.initUI(camp, {
    mute: () => {
      save.muted = !save.muted;
      setMutedAll();
    },
    labels: () => {
      tagsUntil = T < tagsUntil ? 0 : T + 7;
      sfx.tap();
    },
    decorate: () => {
      if (host) {
        ui.feed("This is not your camp to rearrange. Tempting, though.", true);
        sfx.deny();
        return;
      }
      setDecor(!decor);
    },
    mate: (id, at) => {
      const r = at.getBoundingClientRect();
      sfx.tap();
      ui.mateCard(id, r.left + r.width / 2, r.bottom + 120);
    },
  });
  ui.setPurse(shown.leaf, shown.coins);
  ui.setMates();
  setMutedAll();
  // ---- coming home
  tagsUntil = 9;
  const fire = thing("fire");
  const mailbox = thing("mailbox");
  const [hx, hy] = fire ? [fire.x + 4, fire.y + 34] : spot(0.5, 0.7);
  me.plan = [
    { do: "go", x: hx, y: hy, v: 86, age: 0 },
    { do: "face", face: "up" },
    {
      do: "call",
      fn: () => {
        strike(me, "wave", 1);
        const s = sitters();
        if (s[0]) {
          strike(s[0], "wave", 1.2);
          speak(s[0], pick(WELCOME), 2.6);
        }
        if (s[1]) after(0.5, () => strike(s[1]!, "wave", 1));
        for (const p of pets) {
          p.joy = 1.3;
          burst("heart", p.x, p.y - 12, 1);
        }
        ui.feed(`Welcome home, ${save.handle}.`, true);
      },
    },
    { do: "wait", s: 1.3 },
  ];
  if (mailbox) {
    const [mx, my] = standBy(mailbox);
    me.plan.push(
      { do: "call", fn: () => (autoArrive ? undefined : (me.plan = [])) },
      { do: "go", x: mx, y: my, v: 110, age: 0 },
      { do: "face", face: "left" },
      {
        do: "call",
        fn: () => {
          mailOpen = true;
          mailbox.bump = T;
          burst("paper", mailbox.x, mailbox.y - 20, 3);
          panel("mail");
        },
      },
    );
  }
  for (const p of pets) {
    p.tx = hx + (Math.random() - 0.5) * 50;
    p.ty = hy + 6 + Math.random() * 12;
    p.state = "walk";
    p.t = 0;
  }
  window.addEventListener("pagehide", keep);
  return {
    skip: (seconds) => {
      for (let i = 0; i < seconds * 30; i++) update(1 / 30);
      draw();
      overlays();
    },
    open: (id) => panel(id),
    use: (id) => {
      const th = thing(id);
      if (th) tap(th.x, th.y - (infoOf(th).flat ? 0 : 6));
    },
    event: (kind) => liveEvent(kind),
    visit,
    home: goHome,
    decorate: setDecor,
    arrive: (id) => {
      const m = MATES.find((mm) => mm.id === id);
      if (m) arrive(m, true);
    },
    at: (id) => {
      const th = thing(id);
      return th ? { x: th.x * view.k, y: (th.y - (infoOf(th).flat ? 0 : 6)) * view.k } : null;
    },
    emote: (kind) => camp.emote(kind),
    buy: (id) => void buy(id),
    crab: () => (hide ? { x: (hide.th.x + hide.dx) * view.k, y: (hide.th.y + hide.dy - 2) * view.k } : null),
    cost: (n) => {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) frame(1 / 60);
      return (performance.now() - t0) / n;
    },
    pet: (n) => (pets[n] ? { x: pets[n].x * view.k, y: (pets[n].y - 5) * view.k } : null),
    state: () => ({
      T,
      view,
      me: { x: me.x, y: me.y, seat: me.seat },
      actors: actors.map((a) => a.id),
      things: things.length,
      parts: parts.length,
      letters: letters.length,
      host: host?.id ?? null,
      save,
    }),
  };
}

function setMutedAll(): void {
  setMuted(save.muted);
  ui.setMuteIcon(save.muted);
  keep();
}

export const scenePoint = (clientX: number, clientY: number): [number, number] => [clientX / view.k, clientY / view.k];
export const decorating = (): boolean => decor;
