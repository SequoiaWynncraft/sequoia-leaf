/**
 * The Little Raid, as a grey-box: the stall, the line and the fight drawn plainly on a canvas, with
 * the words and the buttons beside it. It is here to find out whether shopping for a party and
 * watching it fight is good to do. The art comes after that is known.
 *
 * The simulation works a whole fight out at once and hands over a tape of what happened; this
 * plays the tape back, one thing at a time, on a clock of its own that can be sped up, stopped, or
 * stepped by hand.
 */
import { type Kind, ROLE, SNACK } from "./cast.ts";
import { acorn, HUE, INK, type Mood, nibble, sketch } from "./draw.ts";
import {
  autoTurn,
  buy,
  type Ev,
  feed,
  type Fight,
  HEARTS,
  type Hit,
  load,
  type Mode,
  type Note,
  outcome,
  PRICE,
  ready,
  type Result,
  ROUNDS,
  type Run,
  RUSTLE,
  rustle,
  save,
  sell,
  settle,
  type Side,
  SLOTS,
  type Spirit,
  spirit,
  start,
  swap,
} from "./sim.ts";

function need<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`no ${what}`);
  return v;
}
const canvas = need(document.querySelector("canvas"), "canvas");
const g = need(canvas.getContext("2d"), "drawing");
const $ = (id: string): HTMLElement => need(document.getElementById(id), id);
const present = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined;
const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v));

type Pt = readonly [number, number];
const FONT = 'ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace';
const GOLD = "#f5b95e";
const PALE = "#fff3cf";
const CORAL = "#ff8f7d";
const GREEN = "#a6e07f";
const MAUVE = "#c79bf0";
const TAU = Math.PI * 2;

// ---------- the run, as it was left ----------

const KEY = "battler.run.v1";
const recall = (key: string): string => {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};
const note = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not kept this time.
  }
};
const newSeed = (): number => Math.floor(Math.random() * 0x7fffffff);

const kept = load(recall(KEY));
let run: Run = kept ?? start(newSeed());
// A fight has no half-way: one that was under way when the page closed has already been decided.
if (run.phase === "fight") settle(run);
let veil: "title" | "over" | null = run.phase === "over" ? "over" : kept ? null : "title";

type Sel =
  | { t: "line"; i: number }
  | { t: "stall"; i: number }
  | { t: "snack"; i: number }
  | { t: "foe"; i: number }
  | { t: "cast"; p: Puppet };
let sel: Sel | null = null;

/** The fight's own clock, in milliseconds: everything that moves is worked out from it. */
let clock = 0;
let speed = Number(recall(`${KEY}.speed`)) || 1;
let paused = false;
/** Set when the clock is being stepped by hand, for review: frames then draw without moving it on. */
let manual = false;

// ---------- where things stand ----------

const lay = {
  w: 0,
  h: 0,
  cell: 80,
  tall: false,
  fx: 0,
  oy: 0,
  tx: 0,
  ty: 0,
  sx: 0,
  sy: 0,
  nx: 0,
  ny: 0,
  top: 0,
  low: 0,
  /** How far down the two lines move for a fight, to stand in the middle of the room the stall leaves. */
  drop: 0,
};
/** When the last fight began or ended, for the lines' walk to the middle and back. */
let turned = -1e9;
function sunk(): number {
  const k = clamp((clock - turned) / 420);
  const e = k * k * (3 - 2 * k);
  return lay.drop * (show ? e : 1 - e);
}
/** The middle of a place in our line (0 is the front), in theirs, and of an offer at the stall. */
const oursAt = (i: number): Pt => [lay.fx - lay.cell * i, lay.oy];
const theirsAt = (i: number): Pt => (lay.tall ? [lay.tx - lay.cell * i, lay.ty] : [lay.tx + lay.cell * i, lay.ty]);
const stallAt = (i: number): Pt => [lay.sx + lay.cell * i, lay.sy];
const snackAt = (i: number): Pt => [lay.nx + lay.cell * i, lay.ny];
const placeOf = (side: Side, i: number): Pt => (side === 0 ? oursAt(i) : theirsAt(i));

// ---------- puppets: what is drawn for each spirit and each piece of trouble ----------

interface Puppet {
  kind: Kind;
  level: number;
  atk: number;
  hp: number;
  cushion: number;
  tag: string;
  side: Side;
  /** Where it stands, and where it is gliding there from. */
  x: number;
  y: number;
  from: { x: number; y: number; t: number; dur: number } | null;
  /** When it popped in, last lunged, was last shaken, last hopped, and went off. */
  born: number;
  lunge: { t: number; dx: number; dy: number } | null;
  shake: number;
  hop: number;
  out: { t: number; dive: boolean } | null;
  /** When each number last changed, and which way. */
  atkT: number;
  atkUp: boolean;
  hpT: number;
  hpUp: boolean;
  say: { text: string; t: number } | null;
  bob: number;
}
const LONG_AGO = -1e9;
let bobs = 0;
function puppet(s: Spirit, side: Side, at: Pt): Puppet {
  return {
    kind: s.kind,
    level: s.level,
    atk: s.atk,
    hp: s.hp,
    cushion: s.cushion,
    tag: s.tag,
    side,
    x: at[0],
    y: at[1],
    from: null,
    born: LONG_AGO,
    lunge: null,
    shake: LONG_AGO,
    hop: LONG_AGO,
    out: null,
    atkT: LONG_AGO,
    atkUp: true,
    hpT: LONG_AGO,
    hpUp: true,
    say: null,
    bob: bobs++ * 1.7,
  };
}
/** Where a puppet is on its way to its place, before anything it is doing is added. */
function spot(p: Puppet): Pt {
  if (!p.from) return [p.x, p.y];
  const k = clamp((clock - p.from.t) / p.from.dur);
  const e = 1 - (1 - k) ** 3;
  return [p.from.x + (p.x - p.from.x) * e, p.from.y + (p.y - p.from.y) * e];
}
function glide(p: Puppet, to: Pt, dur: number, t = clock): void {
  if (Math.abs(p.x - to[0]) < 0.5 && Math.abs(p.y - to[1]) < 0.5) return;
  const [x, y] = spot(p);
  p.from = { x, y, t, dur };
  p.x = to[0];
  p.y = to[1];
}

/** Our line at the stall, by place; the trouble waiting; and which puppet belongs to which spirit. */
let home: (Puppet | null)[] = [];
let foes: Puppet[] = [];
const known = new WeakMap<Spirit, Puppet>();

/** Brings the puppets in line with the run: new spirits pop in, moved ones glide, changed numbers flash. */
function sync(fresh = false): void {
  home = run.line.map((s, i) => {
    if (!s) return null;
    const at = oursAt(i);
    let p = known.get(s);
    if (!p) {
      p = puppet(s, 0, at);
      p.born = clock;
      known.set(s, p);
    } else if (fresh) {
      // Back from a fight: everyone is set right again, and those who tumbled off pop back in.
      if (p.out) p.born = clock;
      Object.assign(p, { out: null, lunge: null, say: null, shake: LONG_AGO });
      glide(p, at, 320);
    } else {
      glide(p, at, 240);
      if (p.atk !== s.atk) Object.assign(p, { atkT: clock, atkUp: s.atk > p.atk });
      if (p.hp !== s.hp) Object.assign(p, { hpT: clock, hpUp: s.hp > p.hp });
    }
    Object.assign(p, { kind: s.kind, level: s.level, atk: s.atk, hp: s.hp, cushion: s.cushion, tag: s.tag });
    return p;
  });
}
/** A guild-mate's party is a surprise until the line sets out; the forest's trouble can be planned for. */
const unseen = (): boolean => !show && run.mode === "friendly";
/** The next wave walks up, one after another. */
function arrive(): void {
  foes = run.foe.party.map((s, i) => {
    const p = puppet(s, 1, theirsAt(i));
    p.born = clock + 120 + i * 90;
    return p;
  });
}

// ---------- things that fly, pop and puff ----------

interface Float {
  x: number;
  y: number;
  text: string;
  colour: string;
  size: number;
  t: number;
}
interface Bolt {
  from: Pt;
  to: Pt;
  colour: string;
  t: number;
  dur: number;
}
interface Burst {
  x: number;
  y: number;
  colour: string;
  t: number;
  n: number;
  turn: number;
}
let floats: Float[] = [];
let bolts: Bolt[] = [];
let bursts: Burst[] = [];
const FLOAT_LIFE = 950;
const BURST_LIFE = 420;
const SAY_LIFE = 1000;
/** A word or a number rising off a puppet. Several at once stack up instead of covering each other. */
function pop(p: Puppet, text: string, colour: string, size = 1, t = clock): void {
  const [dx, dy] = lean(p, t);
  const [x, y] = [p.x + dx, p.y + dy];
  const stacked = floats.filter((f) => Math.abs(f.x - x) < 4 && Math.abs(f.t - t) < 500).length;
  floats.push({ x, y: y - lay.cell * (0.1 + stacked * 0.23), text, colour, size, t });
}
/** A change to the two numbers, written the way they stand under everyone: attack, then health. */
const gain = (atk: number, hp: number): string => `${atk < 0 ? "" : "+"}${atk}/${hp < 0 ? "" : "+"}${hp}`;
function puff(at: Pt, colour: string, t = clock, n = 7): void {
  bursts.push({ x: at[0], y: at[1], colour, t, n, turn: bursts.length * 1.3 });
}
function speak(p: Puppet, text: string, t = clock): void {
  p.say = { text, t };
  p.hop = t;
}
const BOLT: Record<string, string> = {
  spark: "#ffb347",
  swoop: "#c5d2de",
  slime: "#b6d94e",
  thorn: "#62a658",
  stub: "#a6a6a6",
  peck: GOLD,
  gust: "#bfd3d9",
  advice: "#8bd06a",
};
function fling(from: Puppet, to: Puppet, look: string, t = clock, dur = 300): void {
  bolts.push({
    from: [from.x, from.y - lay.cell * 0.1],
    to: [to.x, to.y - lay.cell * 0.1],
    colour: BOLT[look] ?? PALE,
    t,
    dur,
  });
}

/** Things set to happen at a moment on the fight's clock, soonest first. */
const cues: { t: number; fn: (t: number) => void }[] = [];
function cue(t: number, fn: (t: number) => void): void {
  let i = cues.length;
  while (i > 0 && (cues[i - 1]?.t ?? 0) > t) i--;
  cues.splice(i, 0, { t, fn });
}

// ---------- the fight, played back ----------

interface Show {
  fight: Fight;
  cursor: number;
  nextAt: number;
  /** Who is who on the tape, and each line as it now stands, front first. */
  cast: Map<number, Puppet>;
  lines: [number[], number[]];
  /** Those on their way off. */
  gone: Puppet[];
  result: Result | null;
  doneAt: number;
}
let show: Show | null = null;
const LUNGE = 460;
const IMPACT = LUNGE * 0.46;
/** How far along a lunge is, from 0 to 1 at the hit and back: a step back, a dash in, and a walk back. */
const reach = (k: number): number =>
  k < 0 || k >= 1
    ? 0
    : k < 0.16
      ? -0.14 * (k / 0.16)
      : k < 0.46
        ? -0.14 + 1.14 * ((k - 0.16) / 0.3) ** 2
        : 1 - ((k - 0.46) / 0.54) ** 0.7;
/** Where a lunge has carried a puppet from its place at a moment. */
function lean(p: Puppet, t: number): Pt {
  if (!p.lunge) return [0, 0];
  const r = reach((t - p.lunge.t) / LUNGE);
  return [p.lunge.dx * r, p.lunge.dy * r];
}
/** How long each kind of thing holds the stage, at ordinary speed. */
const PACE: Record<Ev["t"], number> = {
  clash: 640,
  say: 470,
  bolt: 430,
  hits: 320,
  stats: 340,
  faint: 360,
  join: 340,
  order: 480,
  end: 200,
};

function arrange(s: Show, side: Side, t: number, dur = 300): void {
  s.lines[side].forEach((id, k) => {
    const p = s.cast.get(id);
    if (p) glide(p, placeOf(side, k), dur, t);
  });
}
function land(s: Show, hit: Hit, t: number): void {
  const p = s.cast.get(hit.id);
  if (!p) return;
  if (hit.soak === "cushion") {
    p.cushion = Math.max(0, p.cushion - 1);
    pop(p, p.side === 0 ? "cushion!" : "shell!", PALE, 0.8, t);
    puff([p.x, p.y], PALE, t, 9);
    p.hop = t;
    return;
  }
  Object.assign(p, { hp: hit.hp, hpT: t, hpUp: false, shake: t });
  pop(p, `-${hit.amount}`, CORAL, 1.25, t);
  if (hit.soak === "shrug") pop(p, "shrug", "#c9c9c9", 0.7, t);
  puff([p.x, p.y - lay.cell * 0.1], CORAL, t, 5);
}
/** Puts one thing from the tape on the stage at a moment, and says how long it holds it. */
function stage(s: Show, ev: Ev, t: number): number {
  switch (ev.t) {
    case "clash": {
      const a = s.cast.get(ev.a);
      const b = s.cast.get(ev.b);
      if (a && b) {
        // Each comes far enough that the two just touch.
        const apart = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const share = Math.max(0.08, (apart - lay.cell * (lay.tall ? 1.22 : 0.62)) / 2 / apart);
        const [dx, dy] = [(b.x - a.x) * share, (b.y - a.y) * share];
        a.lunge = { t, dx, dy };
        b.lunge = { t, dx: -dx, dy: -dy };
        cue(t + IMPACT, (at) => {
          puff([(a.x + b.x) / 2, (a.y + b.y) / 2 - lay.cell * 0.1], PALE, at, 6);
          for (const hit of ev.hits) land(s, hit, at);
        });
      }
      break;
    }
    case "say": {
      const p = s.cast.get(ev.id);
      if (p) speak(p, ev.text, t);
      break;
    }
    case "bolt": {
      const from = s.cast.get(ev.from);
      const to = s.cast.get(ev.to);
      if (!from || !to) break;
      speak(from, ev.text, t);
      // An owl goes itself; everything else sends something.
      if (ev.look === "swoop") from.lunge = { t: t + 60, dx: (to.x - from.x) * 0.9, dy: (to.y - from.y) * 0.9 };
      else fling(from, to, ev.look, t + 110);
      break;
    }
    case "hits":
      for (const hit of ev.hits) land(s, hit, t);
      break;
    case "stats":
      for (const c of ev.changes) {
        const p = s.cast.get(c.id);
        if (!p) continue;
        const [da, dh, dc] = [c.atk - p.atk, c.hp - p.hp, c.cushion - p.cushion];
        if (da !== 0) Object.assign(p, { atkT: t, atkUp: da > 0 });
        if (dh !== 0) Object.assign(p, { hpT: t, hpUp: dh > 0 });
        Object.assign(p, { atk: c.atk, hp: c.hp, cushion: c.cushion });
        if (dc > 0) {
          pop(p, "cushion", PALE, 0.8, t);
          puff([p.x, p.y], PALE, t, 8);
        } else if (da !== 0 || dh !== 0) pop(p, gain(da, dh), da < 0 ? MAUVE : GREEN, 1, t);
      }
      break;
    case "faint": {
      const p = s.cast.get(ev.id);
      if (!p) break;
      p.out = { t, dive: ev.dive };
      p.hp = 0;
      s.lines[p.side] = s.lines[p.side].filter((id) => id !== ev.id);
      s.gone.push(p);
      puff([p.x, p.y + lay.cell * 0.15], ev.dive ? "#966c4a" : "#b9a3c4", t, 8);
      arrange(s, p.side, t + 120);
      break;
    }
    case "join": {
      const side = ev.unit.side;
      const at = placeOf(side, ev.at);
      const p = puppet(ev.unit, side, at);
      p.born = t;
      // A bit that comes off a Glorp starts where the Glorp is.
      const parent = s.cast.get(s.lines[side][ev.at - 1] ?? -1);
      if (ev.unit.kind === "glorplet" && parent) p.from = { x: parent.x, y: parent.y, t, dur: 300 };
      else puff([at[0], at[1] + lay.cell * 0.15], "#966c4a", t, 8);
      s.cast.set(ev.unit.id, p);
      s.lines[side].splice(ev.at, 0, ev.unit.id);
      arrange(s, side, t);
      break;
    }
    case "order":
      s.lines[ev.side] = [...ev.ids];
      arrange(s, ev.side, t + 100, 400);
      break;
    case "end":
      s.result = ev.result;
      s.doneAt = t;
      if (ev.result === "win")
        for (const id of s.lines[0])
          cue(t + 150, (at) => {
            const winner = s.cast.get(id);
            if (winner) winner.hop = at;
          });
      cue(t + 1, dom);
      break;
  }
  return PACE[ev.t];
}

/** Moves the clock on, and lets everything due by then happen, in order. */
function advance(dt: number): void {
  clock += dt;
  for (;;) {
    const s = show;
    const first = cues[0];
    const evAt = s && s.result === null && s.cursor < s.fight.tape.length ? s.nextAt : Infinity;
    const cueAt = first ? first.t : Infinity;
    if (Math.min(cueAt, evAt) > clock) break;
    if (first && cueAt <= evAt) {
      cues.shift();
      first.fn(first.t);
    } else if (s) {
      const ev = s.fight.tape[s.cursor++];
      if (ev) s.nextAt = evAt + stage(s, ev, evAt);
    }
  }
  floats = floats.filter((f) => clock - f.t < FLOAT_LIFE);
  bolts = bolts.filter((b) => clock - b.t < b.dur);
  bursts = bursts.filter((b) => clock - b.t < BURST_LIFE);
  if (show) show.gone = show.gone.filter((p) => !p.out || clock - p.out.t < 700);
}
/** Whether a fight is still being played back. */
const playing = (): boolean => show !== null && show.result === null;
/** Runs a fight on to its end at once. */
function skip(): void {
  for (let guard = 0; playing() && guard < 2000; guard++) advance(400);
  advance(1500);
}

// ---------- doing things at the stall ----------

let toastTimer = 0;
function toast(text: string): void {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("up");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("up"), 1900);
}
function keep(): void {
  if (run.phase === "over") {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Nothing was kept.
    }
  } else note(KEY, save(run));
}
/** Shows what followed from something done at the stall. */
function tell(notes: readonly Note[]): void {
  notes.forEach((n, k) => {
    const t = clock + k * 140;
    if (n.t === "advice") {
      const [from, to] = [home[n.from], home[n.to]];
      if (!from || !to) return;
      speak(from, "Advice", t);
      fling(from, to, "advice", t + 80, 260);
      if (n.atk > 0) pop(to, gain(n.atk, 0), GREEN, 1, t + 300);
      else pop(to, "not listening", "#c9c9c9", 0.75, t + 300);
    } else if (n.t === "merge") {
      const p = home[n.into];
      if (!p) return;
      p.born = t;
      pop(p, `Level ${n.level}!`, GOLD, 1.2, t);
      puff([p.x, p.y], GOLD, t, 12);
    } else if (n.t === "fed") {
      const p = home[n.slot];
      if (!p) return;
      p.hop = t;
      pop(p, n.cushion > 0 ? "cushion" : gain(n.atk, n.hp), n.cushion > 0 ? PALE : GREEN, 1, t);
      const meant = home[n.meant];
      if (n.slot !== n.meant && meant) {
        speak(p, "Mine now", t);
        meant.shake = t;
        pop(meant, "hey!", "#c9c9c9", 0.75, t);
      }
    } else if (n.t === "seconds") {
      const p = home[n.slot];
      if (p) pop(p, `and ${gain(n.atk, n.hp)}`, MAUVE, 0.9, t + 200);
    } else if (n.t === "buried") {
      const p = home[n.slot];
      if (!p) return;
      speak(p, "Buries one", t);
      pop(p, `back as ${n.comes}`, GOLD, 0.85, t + 150);
      puff([p.x, p.y + lay.cell * 0.2], "#966c4a", t, 6);
    } else {
      const diggers = home.filter((p) => p?.kind === "chickaree").filter(present);
      for (const p of diggers) speak(p, "Found them!", t + 300);
      const at = diggers[0];
      if (at) pop(at, `+${n.acorns} acorns`, GOLD, 1.05, t + 400);
      else toast(`The buried acorns turned up: +${n.acorns}`);
    }
  });
}
/** Takes what the simulation said about something tried, shows it, and says whether it was done. */
function did(done: { ok: true; notes: Note[] } | { ok: false; why: string }, grumbler: Puppet | null = null): boolean {
  if (!done.ok) {
    toast(done.why);
    if (grumbler) grumbler.shake = clock;
    return false;
  }
  sync();
  tell(done.notes);
  keep();
  dom();
  return true;
}
function doBuy(offer: number, slot?: number): void {
  if (did(slot === undefined ? buy(run, offer) : buy(run, offer, slot))) sel = null;
  dom();
}
function doFeed(offer: number, slot: number): void {
  if (did(feed(run, offer, slot), home[slot] ?? null)) sel = null;
  dom();
}
function doSwap(a: number, b: number): void {
  const rock = [home[a], home[b]].find((p) => p?.kind === "rock") ?? null;
  if (did(swap(run, a, b), rock) && sel?.t === "line") sel = { t: "line", i: b };
  dom();
}
function doSell(slot: number): void {
  const p = home[slot];
  if (did(sell(run, slot)) && p) {
    puff([p.x, p.y], GOLD, clock, 8);
    sel = null;
  }
  dom();
}
function doRustle(): void {
  if (did(rustle(run))) {
    if (sel?.t === "stall" || sel?.t === "snack") sel = null;
    rustled = clock;
  }
  dom();
}
let rustled = LONG_AGO;
/** Sends the line out: the fight is decided there and then, and what is left is to watch it. */
function go(): void {
  if (show || run.phase !== "shop") return;
  const out = ready(run);
  if (!out.ok) return toast(out.why);
  sel = null;
  const hidden = run.mode === "friendly";
  tell(out.notes);
  const cast = new Map<number, Puppet>();
  const ours = home.filter(present);
  out.fight.start[0].forEach((u, k) => {
    const p = ours[k];
    if (!p) return;
    cast.set(u.id, p);
    glide(p, oursAt(k), 340);
  });
  out.fight.start[1].forEach((u, k) => {
    const p = foes[k];
    if (p) cast.set(u.id, Object.assign(p, { born: hidden ? clock + 200 + k * 110 : Math.min(p.born, clock) }));
  });
  show = {
    fight: out.fight,
    cursor: 0,
    nextAt: clock + (out.notes.length ? 1100 : 600) + (hidden ? 700 : 0),
    cast,
    lines: [out.fight.start[0].map((u) => u.id), out.fight.start[1].map((u) => u.id)],
    gone: [],
    result: null,
    doneAt: 0,
  };
  paused = false;
  turned = clock;
  keep();
  dom();
}
/** After a fight: back to the stall for the next turn, or the run is over. */
function onward(): void {
  if (!show || show.result === null) return;
  const notes = settle(run);
  show = null;
  turned = clock;
  cues.length = 0;
  sel = null;
  sync(true);
  if (run.phase === "over") {
    veil = "over";
    foes = [];
  } else {
    arrive();
    tell(notes);
  }
  keep();
  dom();
}
function begin(mode: Mode, seed = newSeed()): void {
  run = start(seed, mode);
  show = null;
  cues.length = 0;
  floats = [];
  sel = null;
  veil = null;
  sync();
  arrive();
  keep();
  dom();
}

// ---------- the words and the buttons ----------

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const nut = (n: number | string): string => `<span class="nut"></span>${n}`;
/** What a card says about someone: a spirit at the stall or in the line, or anyone in a fight. */
function unitCard(u: Spirit & { side?: Side }): string {
  const role = ROLE[u.kind];
  const name = u.kind === "crab" ? `Crab ${u.tag}` : role.name;
  const does = role.does(u.level);
  return (
    `<div class="who"><i style="background:${HUE[u.kind]}"></i><b>${esc(name)}</b>` +
    (u.level > 1 ? `<span class="lv">level ${u.level}</span>` : "") +
    `<span class="atk">attack ${u.atk}</span><span class="hp">health ${u.hp}</span>` +
    (u.cushion > 0 ? `<span class="pad">${u.side === 1 ? "shell" : "cushion"} ${u.cushion}</span>` : "") +
    `</div>` +
    (does ? `<p><b>${esc(role.when)}:</b> ${esc(does)}</p>` : "") +
    `<p class="quip">${esc(role.quip)}</p>`
  );
}
function card(): string {
  if (sel?.t === "cast") return unitCard(sel.p);
  if (sel?.t === "foe") {
    const s = run.foe.party[sel.i];
    if (s) return unitCard({ ...s, side: 1 });
  }
  if (sel?.t === "line") {
    const s = run.line[sel.i];
    if (s) {
      const fixed = s.kind === "rock";
      return (
        unitCard(s) +
        `<div class="acts">` +
        (fixed
          ? ""
          : `<button data-do="back"${sel.i >= SLOTS - 1 ? ' class="off"' : ""}>&larr; Back</button>` +
            `<button data-do="fwd"${sel.i <= 0 ? ' class="off"' : ""}>Forward &rarr;</button>`) +
        `<button data-do="sell">Send home &middot; +${nut(s.level)}</button></div>`
      );
    }
  }
  if (sel?.t === "stall") {
    const k = run.stall[sel.i];
    if (k)
      return (
        unitCard(spirit(k)) +
        `<div class="acts"><button data-do="buy" class="${run.acorns >= PRICE ? "main" : "off"}">Take along &middot; ${nut(PRICE)}</button></div>`
      );
  }
  if (sel?.t === "snack") {
    const k = run.snacks[sel.i];
    if (k) {
      const snack = SNACK[k];
      return (
        `<div class="who"><b>${esc(snack.name)}</b><span class="lv">${nut(snack.cost)}</span></div><p>${esc(snack.does)}</p>` +
        (snack.all
          ? `<div class="acts"><button data-do="serve" class="${run.acorns >= snack.cost ? "main" : "off"}">Serve it &middot; ${nut(snack.cost)}</button></div>`
          : `<p class="quip">Tap a spirit in your line to hand it over.</p>`)
      );
    }
  }
  const boss = run.round === ROUNDS && run.mode === "forest";
  const wave = `<div class="who"><b>${esc(run.foe.name)}</b><span class="lv">${boss ? "the last round" : run.mode === "forest" ? "the forest" : "a friendly bout"}</span></div>`;
  if (show)
    return (
      wave +
      (show.result === null
        ? `<p class="quip">It plays out by itself. Tap anyone to see what they do.</p>`
        : `<p>${esc(verdict(show.result)[1])}</p>`)
    );
  return (
    wave +
    (run.round === 1 && !run.line.some(present)
      ? `<p>Take spirits along from the stall: tap one, or drag it into your line. The front of the line fights first. Three of a kind become one stronger.</p>`
      : run.mode === "friendly"
        ? `<p>Who ${esc(run.foe.who)} brought is a surprise until you set out. Tap your own to see what they do; drag to reorder your line.</p>`
        : `<p>Tap anyone, yours or theirs, to see what they do. Drag to reorder your line. Acorns you do not spend are gone next turn.</p>`)
  );
}
/** What to call how a fight went. */
function verdict(result: Result): [string, string] {
  const boss = run.round === ROUNDS && run.mode === "forest";
  if (result === "win")
    return boss
      ? ["Counted!", `Crab #${run.missing} has been found, counted, and sent home.`]
      : [
          "Sent packing!",
          run.mode === "forest" ? "The path is clear. Back to the stall." : `${run.foe.who} tips a hat.`,
        ];
  if (result === "draw")
    return show && show.lines[0].length > 0
      ? ["Nobody budged", "Neither side could shift the other. A draw; nothing lost."]
      : ["A draw", "The last of each went down together. Nothing lost."];
  return run.mode === "forest"
    ? ["Tumbled home", boss ? "The crab stays uncounted." : "That cost a heart. Everyone is fine; they always are."]
    : ["Bested, kindly", `${run.foe.who}'s party had the better of it. Nothing at stake.`];
}
function bar(): string {
  if (show) {
    if (show.result !== null) return `<button data-do="onward" class="main">Carry on &rarr;</button>`;
    return (
      `<div class="row"><button data-do="pause" class="${paused ? "on" : ""}">${paused ? "Play" : "Pause"}</button>` +
      `<button data-do="skip">Skip</button></div><div class="row">` +
      [1, 2, 4]
        .map((n) => `<button data-do="speed" data-n="${n}" class="${speed === n ? "on" : ""}">${n}&times;</button>`)
        .join("") +
      `</div>`
    );
  }
  return (
    `<button data-do="rustle" class="${run.acorns >= RUSTLE ? "" : "off"}">Rustle &middot; ${nut(RUSTLE)}<small>new offers</small></button>` +
    `<button data-do="go" class="${run.line.some(present) ? "main" : "off"}">Set out &rarr;</button>`
  );
}
function veilHtml(): string {
  const ways =
    `<div class="ways"><button data-do="forest" class="main">Into the forest<small>eight rounds, three hearts, and something at the end</small></button>` +
    `<button data-do="friendly">Friendly bouts<small>against guild-mates' saved parties, with nothing at stake</small></button>`;
  if (veil === "title")
    return (
      `<div class="sheet"><div class="label">A party of spirits, a small raid of their own</div><h1>The Little Raid</h1>` +
      `<p>Take a few spirits along from the stall and line them up. Then they sort out the forest's trouble by themselves, front of the line first. Three of a kind become one stronger.</p>` +
      ways +
      (kept || run.record.length || run.line.some(present)
        ? `<button data-do="resume">Carry on with this one</button>`
        : "") +
      `</div></div>`
    );
  const how = outcome(run);
  const n = (r: Result): number => run.record.filter((x) => x === r).length;
  const [title, text] =
    how === "won"
      ? [
          "Roll call complete",
          `Crab #${run.missing}, the one nobody counted, has been counted. Every crab is accounted for, for now.`,
        ]
      : how === "played"
        ? [
            "Good bouts",
            `${n("win")} won, ${n("loss")} lost, ${n("draw")} drawn against guild-mates' parties. Nobody is keeping score.`,
          ]
        : run.hearts <= 0
          ? ["Home for tea", `The party tumbled home in round ${run.round}. Nothing lost but a little dignity.`]
          : ["The crab got away", `Roll call is still one short: #${run.missing} remains unaccounted for.`];
  const tint = { win: "#62a658", loss: "#e67967", draw: "#888788" };
  return (
    `<div class="sheet"><div class="label">${run.mode === "forest" ? "The raid is over" : "The bouts are over"}</div><h1>${title}</h1>` +
    `<div class="tally">${run.record.map((r) => `<i style="background:${tint[r]}"></i>`).join("")}</div><p>${esc(text)}</p>` +
    ways +
    `</div></div>`
  );
}
/** Writes everything outside the canvas again, after anything changed. */
function dom(): void {
  const fighting = run.phase === "fight";
  $("round").textContent = `Round ${run.round} of ${ROUNDS}`;
  // How the fight under way will end is already known, and is not told until it has been watched.
  const told = playing() ? run.record.slice(0, -1) : run.record;
  $("pips").innerHTML = Array.from({ length: ROUNDS }, (_, i) => {
    const r = told[i];
    return `<i class="${r ?? (i === run.round - 1 ? "now" : "")}"></i>`;
  }).join("");
  const hearts = $("hearts");
  hearts.classList.toggle("kind", run.mode === "friendly");
  hearts.innerHTML =
    run.mode === "friendly"
      ? "friendly bouts"
      : "&#9829;".repeat(Math.max(0, run.hearts)) + `<s>${"&#9829;".repeat(HEARTS - Math.max(0, run.hearts))}</s>`;
  $("acorns").textContent = String(run.acorns);
  $("buried").textContent = run.buried > 0 ? `+${run.buried} buried` : fighting ? "" : "to spend";
  $("card").innerHTML = card();
  $("bar").innerHTML = bar();
  const v = $("veil");
  v.classList.toggle("up", veil !== null);
  v.innerHTML = veil ? veilHtml() : "";
}
document.addEventListener("click", (e) => {
  const el = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-do]") : null;
  const what = el?.dataset.do;
  if (!el || what === undefined) return;
  switch (what) {
    case "buy":
      if (sel?.t === "stall") doBuy(sel.i);
      break;
    case "sell":
      if (sel?.t === "line") doSell(sel.i);
      break;
    case "back":
      if (sel?.t === "line" && sel.i < SLOTS - 1) doSwap(sel.i, sel.i + 1);
      break;
    case "fwd":
      if (sel?.t === "line" && sel.i > 0) doSwap(sel.i, sel.i - 1);
      break;
    case "serve":
      if (sel?.t === "snack") doFeed(sel.i, -1);
      break;
    case "rustle":
      doRustle();
      break;
    case "go":
      go();
      break;
    case "pause":
      paused = !paused;
      break;
    case "skip":
      skip();
      break;
    case "speed":
      speed = Number(el.dataset.n) || 1;
      note(`${KEY}.speed`, String(speed));
      break;
    case "onward":
      onward();
      break;
    case "forest":
      begin("forest");
      break;
    case "friendly":
      begin("friendly");
      break;
    case "resume":
      veil = run.phase === "over" ? "over" : null;
      break;
    case "menu":
      veil = veil === "title" && run.phase !== "over" ? null : "title";
      break;
    default:
      break;
  }
  dom();
});
window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (veil) return;
  if (e.key === " " || e.key === "Enter") {
    if (!show) go();
    else if (show.result !== null) onward();
    else paused = !paused;
  } else if (e.key === "r" || e.key === "R") {
    if (!show) doRustle();
  } else if (e.key === "1" || e.key === "2" || e.key === "4") speed = Number(e.key);
  else if (e.key === "Escape") sel = null;
  else return;
  e.preventDefault();
  dom();
});

// ---------- picking things up ----------

type Thing = { t: "line"; i: number } | { t: "stall"; i: number } | { t: "snack"; i: number } | { t: "foe"; i: number };
const within = (at: Pt, x: number, y: number, up = 0.56, down = 0.72): boolean =>
  Math.abs(x - at[0]) <= lay.cell / 2 && y >= at[1] - lay.cell * up && y <= at[1] + lay.cell * down;
function thingAt(x: number, y: number): Thing | null {
  for (let i = 0; i < SLOTS; i++) if (within(oursAt(i), x, y)) return { t: "line", i };
  for (let i = 0; i < run.stall.length; i++) if (within(stallAt(i), x, y, 0.56, 0.95)) return { t: "stall", i };
  for (let i = 0; i < run.snacks.length; i++) if (within(snackAt(i), x, y, 0.45, 0.72)) return { t: "snack", i };
  if (!unseen()) for (let i = 0; i < foes.length; i++) if (within(theirsAt(i), x, y)) return { t: "foe", i };
  return null;
}
const holds = (th: Thing): boolean =>
  th.t === "line"
    ? present(run.line[th.i])
    : th.t === "stall"
      ? present(run.stall[th.i])
      : th.t === "snack"
        ? present(run.snacks[th.i])
        : true;

let drag: { what: Thing; x0: number; y0: number; x: number; y: number; live: boolean } | null = null;
function tap(th: Thing | null): void {
  if (!th) {
    sel = null;
    return;
  }
  if (th.t === "line") {
    // Something in hand goes to the place tapped; otherwise the place's spirit is looked at.
    if (sel?.t === "snack") return doFeed(sel.i, th.i);
    if (sel?.t === "stall" && !run.line[th.i]) return doBuy(sel.i, th.i);
    if (sel?.t === "line" && !run.line[th.i]) return doSwap(sel.i, th.i);
  }
  const same = sel !== null && sel.t === th.t && sel.i === th.i;
  sel = same || !holds(th) ? null : th;
}
function drop(what: Thing, on: Thing | null): void {
  if (on?.t !== "line") return;
  if (what.t === "stall") {
    // Dropped on its own kind, it goes wherever makes the set.
    const there = run.line[on.i];
    if (there && there.kind === run.stall[what.i]) doBuy(what.i);
    else doBuy(what.i, on.i);
  } else if (what.t === "snack") doFeed(what.i, on.i);
  else if (what.t === "line" && what.i !== on.i) doSwap(what.i, on.i);
}
canvas.addEventListener("pointerdown", (e) => {
  if (veil) return;
  if (show) {
    const all = [...show.cast.values()].filter((p) => !p.out);
    const p = all.find((q) => within([q.x, q.y + sunk()], e.clientX, e.clientY));
    sel = p ? { t: "cast", p } : null;
    dom();
    return;
  }
  const th = thingAt(e.clientX, e.clientY);
  drag =
    th && holds(th) && th.t !== "foe"
      ? { what: th, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, live: false }
      : null;
  if (!drag) {
    tap(th);
    dom();
  }
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // A pointer that cannot be held is still followed while it stays over the canvas.
  }
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  drag.x = e.clientX;
  drag.y = e.clientY;
  if (drag.live || Math.hypot(drag.x - drag.x0, drag.y - drag.y0) < 10) return;
  const rock = drag.what.t === "line" ? home[drag.what.i] : null;
  if (rock?.kind === "rock") {
    rock.shake = clock;
    speak(rock, "It is a rock.");
    toast("It is a rock. It stays where it is.");
    drag = null;
    return;
  }
  drag.live = true;
});
canvas.addEventListener("pointerup", (e) => {
  const d = drag;
  drag = null;
  if (!d) return;
  if (d.live) drop(d.what, thingAt(e.clientX, e.clientY));
  else tap(d.what);
  dom();
});
canvas.addEventListener("pointercancel", () => (drag = null));

// ---------- drawing ----------

function fit(): void {
  const ratio = Math.min(devicePixelRatio, 2);
  const [w, h] = [innerWidth, innerHeight];
  canvas.width = Math.round(w * ratio);
  canvas.height = Math.round(h * ratio);
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  const top = $("hud").offsetHeight;
  const low = h - $("panel").offsetHeight;
  const room = low - top;
  const tall = w < 720;
  Object.assign(lay, { w, h, tall, top, low });
  if (tall) {
    // Two rows, theirs above ours, both with the front at the right; the stall in two rows below.
    const cell = Math.min((w - 12) / SLOTS, (room - 62) / 4.75, 104);
    const gap = Math.max(0, room - 62 - cell * 4.75) / 5;
    const ty = top + gap + 18 + cell * 0.52;
    const oy = ty + cell * 1.2 + gap + 18;
    const sy = oy + cell * 1.2 + gap + 18;
    const ny = sy + cell * 1.42 + gap * 0.6;
    const fx = w / 2 + cell * 2;
    const sink = top + room * 0.46 - (ty + oy) / 2 - cell * 0.07;
    Object.assign(lay, {
      cell,
      fx,
      oy,
      tx: fx,
      ty,
      sx: w / 2 - cell * 1.5,
      sy,
      nx: w / 2 - cell * 0.5,
      ny,
      drop: sink,
    });
  } else {
    // One row, ours on the left and theirs on the right, fronts meeting in the middle; the stall below.
    const cell = Math.min((w - 40) / 10.9, room * 0.3, 116);
    const oy = top + room * 0.31;
    Object.assign(lay, {
      cell,
      fx: w / 2 - cell * 0.75,
      oy,
      tx: w / 2 + cell * 0.75,
      ty: oy,
      sx: w / 2 - cell * 2.85,
      sy: top + room * 0.75,
      nx: w / 2 + cell * 1.85,
      ny: top + room * 0.75,
      drop: room * 0.15,
    });
  }
  // Everyone stands where the new layout puts them, at once.
  home.forEach((p, i) => p && Object.assign(p, { x: oursAt(i)[0], y: oursAt(i)[1], from: null }));
  const s = show;
  if (s) {
    for (const side of [0, 1] as const)
      s.lines[side].forEach((id, k) => {
        const p = s.cast.get(id);
        if (p) Object.assign(p, { x: placeOf(side, k)[0], y: placeOf(side, k)[1], from: null });
      });
  } else foes.forEach((p, i) => Object.assign(p, { x: theirsAt(i)[0], y: theirsAt(i)[1], from: null }));
}
addEventListener("resize", fit);

function words(text: string, x: number, y: number, size: number, colour: string, weight = 700, edge = 0): void {
  g.font = `${weight} ${Math.round(size)}px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  if (edge > 0) {
    g.lineJoin = "round";
    g.lineWidth = edge;
    g.strokeStyle = INK;
    g.strokeText(text, x, y);
  }
  g.fillStyle = colour;
  g.fillText(text, x, y);
}
function plate(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  edge: string | null = null,
  dash = false,
): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fillStyle = fill;
  g.fill();
  if (!edge) return;
  g.setLineDash(dash ? [5, 5] : []);
  g.lineWidth = 2;
  g.strokeStyle = edge;
  g.stroke();
  g.setLineDash([]);
}
/** The two numbers under everyone: attack on the left, health on the right. */
function badges(
  x: number,
  y: number,
  c: number,
  atk: number,
  hp: number,
  atkK = 1,
  hpK = 1,
  atkUp = true,
  hpUp = true,
): void {
  for (const [dx, n, k, base, up] of [
    [-0.17, atk, atkK, GOLD, atkUp],
    [0.17, hp, hpK, "#f0705f", hpUp],
  ] as const) {
    const s = 1 + 0.42 * (1 - k);
    const [w, h] = [c * 0.29 * s, c * 0.23 * s];
    plate(x + c * dx - w / 2, y - h / 2, w, h, c * 0.05, INK);
    plate(
      x + c * dx - w / 2 + 1.5,
      y - h / 2 + 1.5,
      w - 3,
      h - 3,
      c * 0.04,
      k < 1 ? (up ? "#c9f29b" : "#ffffff") : base,
    );
    words(String(n), x + c * dx, y + 1, c * 0.19 * s, INK);
  }
}
function tag(x: number, y: number, c: number, text: string, colour = "#d7c6de"): void {
  words(text, x, y, Math.max(9, c * 0.118), colour, 600);
}
function pips(x: number, y: number, c: number, level: number): void {
  for (let i = 0; i < level; i++) {
    const px = x + (i - (level - 1) / 2) * c * 0.12;
    g.beginPath();
    g.moveTo(px, y - c * 0.05);
    g.lineTo(px + c * 0.045, y);
    g.lineTo(px, y + c * 0.05);
    g.lineTo(px - c * 0.045, y);
    g.closePath();
    g.fillStyle = "#ffd98a";
    g.fill();
    g.lineWidth = 1.2;
    g.strokeStyle = INK;
    g.stroke();
  }
}
/** A body at a place, with whatever it is doing to it already worked out. */
function body(
  kind: Kind,
  x: number,
  y: number,
  c: number,
  o: { face?: number; mood?: Mood; rot?: number; sx?: number; sy?: number; tag?: string } = {},
): void {
  const k = (c * 0.62) / 40;
  const face = o.face ?? 1;
  g.save();
  g.translate(x, y + c * 0.21);
  g.rotate(o.rot ?? 0);
  g.scale(k * face * (o.sx ?? 1), k * (o.sy ?? 1));
  g.translate(0, -20);
  sketch(g, kind, o.mood ?? "calm", o.tag ?? "", face);
  g.restore();
}
const nameOf = (kind: Kind, t: string): string =>
  kind === "crab" || kind === "bigcrab" ? `Crab ${t}` : ROLE[kind].name;

function drawPuppet(p: Puppet, real: number): void {
  const c = lay.cell;
  if (clock < p.born) return;
  let [x, y] = spot(p);
  let [rot, sx, sy, alpha] = [0, 1, 1, 1];
  let mood: Mood = "calm";
  const grow = (clock - p.born) / 280;
  if (grow < 1) sx = sy = (0.3 + 0.7 * grow) * (1 + 0.3 * Math.sin(grow * Math.PI));
  const [lx, ly] = lean(p, clock);
  x += lx;
  y += ly;
  const hurt = (clock - p.shake) / 380;
  if (hurt >= 0 && hurt < 1) {
    x += Math.sin(hurt * 38) * (1 - hurt) * c * 0.08;
    sx *= 1 + 0.12 * (1 - hurt);
    sy *= 1 - 0.12 * (1 - hurt);
    mood = "hurt";
  }
  const hop = (clock - p.hop) / 360;
  if (hop >= 0 && hop < 1) y -= Math.sin(hop * Math.PI) * c * 0.16;
  if (p.out) {
    const k = clamp((clock - p.out.t) / 560);
    mood = "out";
    if (p.out.dive) {
      sy *= 1 - k;
      alpha = k < 0.9 ? 1 : 0;
    } else {
      // Off it tumbles: up, over, and away from the fight.
      const away = p.side === 0 || lay.tall ? -1 : 1;
      x += away * k * c * 0.9;
      y += -Math.sin(k * Math.PI) * c * 0.5 + k * k * c * 0.7;
      rot = away * k * 5;
      alpha = 1 - k * k;
    }
  } else {
    y += Math.sin(real / 430 + p.bob) * c * 0.012;
    sy *= 1 + Math.sin(real / 610 + p.bob) * 0.015;
  }
  const chosen = sel?.t === "cast" && sel.p === p;
  if (chosen) plate(x - c * 0.47, y - c * 0.54, c * 0.94, c * 1.22, c * 0.1, "#f5b95e14", GOLD);
  g.globalAlpha = alpha;
  // A shadow, so it stands on something.
  g.beginPath();
  g.ellipse(x, y + c * 0.21, c * 0.24 * sx, c * 0.05, 0, 0, TAU);
  g.fillStyle = "#00000040";
  g.fill();
  if (p.cushion > 0 && !p.out) {
    // A cushion or a shell: a pale ring that takes the next hit.
    g.beginPath();
    g.arc(x, y - c * 0.1, c * 0.36, 0, TAU);
    g.lineWidth = c * 0.035;
    g.strokeStyle = p.side === 0 ? "#fff3cfcc" : "#ffd98acc";
    g.setLineDash([c * 0.09, c * 0.05]);
    g.stroke();
    g.setLineDash([]);
    if (p.cushion > 1) words(`×${p.cushion}`, x + c * 0.34, y - c * 0.38, c * 0.14, PALE, 700, 3);
  }
  const face = p.side === 0 || lay.tall ? 1 : -1;
  body(p.kind, x, y, c, { face, mood, rot, sx, sy, tag: p.tag });
  if (p.out) {
    g.globalAlpha = 1;
    return;
  }
  if (p.level > 1) pips(x, y - c * 0.5, c, p.level);
  badges(x, y + c * 0.36, c, p.atk, p.hp, clamp((clock - p.atkT) / 420), clamp((clock - p.hpT) / 420), p.atkUp, p.hpUp);
  tag(x, y + c * 0.58, c, nameOf(p.kind, p.tag));
  g.globalAlpha = 1;
}
function drawSay(p: Puppet): void {
  if (!p.say || p.out?.dive === false) return;
  const k = (clock - p.say.t) / SAY_LIFE;
  if (k < 0 || k >= 1) return;
  const c = lay.cell;
  const size = Math.max(11, c * 0.15);
  g.font = `700 ${Math.round(size)}px ${FONT}`;
  const w = g.measureText(p.say.text).width + size * 1.1;
  const h = size * 1.7;
  const s = k < 0.12 ? 0.5 + (k / 0.12) * 0.5 : 1;
  const x = clamp(p.x, w / 2 + 4, lay.w - w / 2 - 4);
  const y = p.y - c * 0.6 - h / 2 - Math.min(1, k * 6) * 4;
  g.save();
  g.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
  g.translate(x, y);
  g.scale(s, s);
  plate(-w / 2, -h / 2, w, h, h / 2, PALE, INK);
  g.beginPath();
  g.moveTo(-5, h / 2 - 1);
  g.lineTo(0, h / 2 + 6);
  g.lineTo(5, h / 2 - 1);
  g.fillStyle = PALE;
  g.fill();
  words(p.say.text, 0, 1, size, INK);
  g.restore();
}
function mat(a: Pt, b: Pt, fill: string, edge: string): void {
  const c = lay.cell;
  const x = Math.min(a[0], b[0]) - c / 2 - 4;
  plate(x, a[1] - c * 0.58, Math.abs(a[0] - b[0]) + c + 8, c * 1.3, c * 0.12, fill, edge);
}
function price(x: number, y: number, c: number, cost: number): void {
  const can = run.acorns >= cost;
  g.save();
  g.globalAlpha = can ? 1 : 0.45;
  g.translate(x - c * 0.09, y);
  g.scale(c / 62, c / 62);
  acorn(g);
  g.restore();
  g.globalAlpha = can ? 1 : 0.45;
  words(String(cost), x + c * 0.07, y + 1, Math.max(10, c * 0.15), GOLD);
  g.globalAlpha = 1;
}
function draw(real: number): void {
  const c = lay.cell;
  g.fillStyle = "#1b1220";
  g.fillRect(0, 0, lay.w, lay.h);
  const label = (text: string, at: Pt, colour = "#d49045"): void => {
    g.font = `600 10px ${FONT}`;
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.fillStyle = colour;
    g.fillText(text.toUpperCase(), at[0], at[1]);
  };
  const leftOf = (a: Pt, b: Pt): number => Math.min(a[0], b[0]) - c / 2;
  // The two lines and all that happens to them move down to the middle of the room for a fight.
  const down = sunk();
  g.save();
  g.translate(0, down);
  // The two mats, and the ring round the two fronts where the clashing is done.
  mat(oursAt(0), oursAt(SLOTS - 1), "#2a1733", "#3d2050");
  mat(theirsAt(0), theirsAt(SLOTS - 1), "#251424", "#4a2440");
  const [of, tf] = [oursAt(0), theirsAt(0)];
  const ring = {
    x: Math.min(of[0], tf[0]) - c / 2,
    y: Math.min(of[1], tf[1]) - c * 0.58,
    w: Math.abs(of[0] - tf[0]) + c,
    h: Math.abs(of[1] - tf[1]) + c * 1.3,
  };
  plate(ring.x, ring.y, ring.w, ring.h, c * 0.12, "#f5b95e0d", "#f5b95e55", true);
  label("your line", [leftOf(oursAt(0), oursAt(SLOTS - 1)), oursAt(0)[1] - c * 0.58 - 6]);
  const versus = show ? `round ${run.round}: ${run.foe.name}` : `next: ${run.foe.name}`;
  label(versus, [leftOf(theirsAt(0), theirsAt(SLOTS - 1)), theirsAt(0)[1] - c * 0.58 - 6], "#e67967");
  g.fillStyle = "#f5b95eaa";
  g.textAlign = lay.tall ? "right" : "center";
  if (lay.tall) g.fillText("FRONT", ring.x + ring.w - 2, ring.y - 6);
  else g.fillText("FRONT", ring.x + ring.w / 2, ring.y + ring.h + 14);

  const s = show;
  const dragging = drag?.live ? drag.what : null;
  if (!s) {
    // Places in the line, lit when something in hand could go there.
    for (let i = 0; i < SLOTS; i++) {
      const [x, y] = oursAt(i);
      const empty = !run.line[i];
      const holding = dragging ?? sel;
      const wanted =
        (holding?.t === "stall" && empty) ||
        (holding?.t === "snack" && !empty && !SNACK[run.snacks[holding.i] ?? "berry"].all) ||
        (holding?.t === "line" && holding.i !== i && (empty || dragging !== null));
      const chosen = sel?.t === "line" && sel.i === i;
      if (chosen) plate(x - c * 0.47, y - c * 0.54, c * 0.94, c * 1.22, c * 0.1, "#f5b95e14", GOLD);
      else if (wanted)
        plate(
          x - c * 0.45,
          y - c * 0.52,
          c * 0.9,
          c * 1.18,
          c * 0.1,
          "#f5b95e10",
          `rgba(245,185,94,${0.55 + 0.3 * Math.sin(real / 180)})`,
          true,
        );
      else if (empty) plate(x - c * 0.4, y - c * 0.36, c * 0.8, c * 0.8, c * 0.1, "#00000000", "#4a2a5c", true);
    }
    if (sel?.t === "foe") {
      const [x, y] = theirsAt(sel.i);
      plate(x - c * 0.47, y - c * 0.54, c * 0.94, c * 1.22, c * 0.1, "#f5b95e14", GOLD);
    }
  }
  g.restore();
  // The stall, once the lines are back up out of its way.
  if (!s && down < 2) {
    label("the stall", [stallAt(0)[0] - c / 2, stallAt(0)[1] - c * 0.58 - 6]);
    label("snacks", [snackAt(0)[0] - c / 2, snackAt(0)[1] - c * 0.5 - 6]);
    const fresh = clamp((clock - rustled) / 260);
    run.stall.forEach((k, i) => {
      const [x, y] = stallAt(i);
      const chosen = sel?.t === "stall" && sel.i === i;
      plate(
        x - c * 0.46,
        y - c * 0.54,
        c * 0.92,
        c * 1.5,
        c * 0.1,
        chosen ? "#f5b95e14" : "#231329",
        chosen ? GOLD : "#3d2050",
      );
      if (!k) return tag(x, y + c * 0.1, c, "gone", "#6b5878");
      if (dragging?.t === "stall" && dragging.i === i) g.globalAlpha = 0.3;
      const pulse = fresh < 1 ? 0.7 + 0.3 * fresh : 1;
      body(k, x, y - c * 0.02, c, { sx: pulse, sy: pulse });
      badges(x, y + c * 0.36, c, ROLE[k].atk, ROLE[k].hp);
      tag(x, y + c * 0.58, c, ROLE[k].name);
      g.globalAlpha = 1;
      price(x, y + c * 0.8, c, PRICE);
    });
    run.snacks.forEach((k, i) => {
      const [x, y] = snackAt(i);
      const chosen = sel?.t === "snack" && sel.i === i;
      plate(
        x - c * 0.46,
        y - c * 0.46,
        c * 0.92,
        c * 1.2,
        c * 0.1,
        chosen ? "#f5b95e14" : "#231329",
        chosen ? GOLD : "#3d2050",
      );
      if (!k) return tag(x, y + c * 0.1, c, "gone", "#6b5878");
      if (dragging?.t === "snack" && dragging.i === i) g.globalAlpha = 0.3;
      g.save();
      g.translate(x, y - c * 0.14);
      g.scale(c / 52, c / 52);
      nibble(g, k);
      g.restore();
      tag(x, y + c * 0.22, c, SNACK[k].name);
      g.globalAlpha = 1;
      price(x, y + c * 0.5, c, SNACK[k].cost);
    });
  }

  g.save();
  g.translate(0, down);
  // Everyone: those who have gone off first, then each line from the back, so the front is on top.
  const standing: Puppet[] = s
    ? [
        ...s.gone,
        ...s.lines[1].toReversed().map((id) => s.cast.get(id)),
        ...s.lines[0].toReversed().map((id) => s.cast.get(id)),
      ].filter(present)
    : [...(unseen() ? [] : foes), ...home.filter(present)];
  if (unseen()) {
    const [a, b] = [theirsAt(0), theirsAt(SLOTS - 1)];
    words("?", (a[0] + b[0]) / 2, a[1] - c * 0.02, c * 0.5, "#6b4a63", 800);
    tag((a[0] + b[0]) / 2, a[1] + c * 0.42, c, "you will see when you get there", "#8a6a84");
  }
  for (const p of standing) {
    const held = dragging?.t === "line" && home[dragging.i] === p;
    if (held) g.globalAlpha = 0.3;
    drawPuppet(p, real);
    g.globalAlpha = 1;
  }

  for (const b of bolts) {
    const k = (clock - b.t) / b.dur;
    if (k < 0) continue;
    for (const [lag, r, a] of [
      [0.16, 0.035, 0.35],
      [0.08, 0.05, 0.6],
      [0, 0.07, 1],
    ] as const) {
      const q = clamp(k - lag);
      const x = b.from[0] + (b.to[0] - b.from[0]) * q;
      const y = b.from[1] + (b.to[1] - b.from[1]) * q - Math.sin(q * Math.PI) * c * 0.32;
      g.globalAlpha = a;
      g.beginPath();
      g.arc(x, y, c * r, 0, TAU);
      g.fillStyle = b.colour;
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = INK;
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  for (const b of bursts) {
    const k = (clock - b.t) / BURST_LIFE;
    if (k < 0) continue;
    g.fillStyle = b.colour;
    g.globalAlpha = 1 - k;
    for (let i = 0; i < b.n; i++) {
      const a = b.turn + (i / b.n) * TAU;
      const d = c * (0.12 + 0.42 * (1 - (1 - k) ** 2));
      g.beginPath();
      g.arc(b.x + Math.cos(a) * d, b.y + Math.sin(a) * d * 0.8, c * 0.035 * (1 - k * 0.6), 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  }
  for (const p of standing) drawSay(p);
  for (const f of floats) {
    const k = (clock - f.t) / FLOAT_LIFE;
    if (k < 0) continue;
    const size = c * 0.19 * f.size * (k < 0.12 ? 0.6 + (k / 0.12) * 0.55 : 1.15 - Math.min(0.15, (k - 0.12) * 0.6));
    g.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
    words(
      f.text,
      clamp(f.x, 30, lay.w - 30),
      f.y - c * 0.34 * (1 - (1 - k) ** 2),
      Math.max(11, size),
      f.colour,
      800,
      4,
    );
    g.globalAlpha = 1;
  }
  g.restore();

  // How the fight went, large, where the stall was.
  if (s && s.result !== null) {
    const k = clamp((clock - s.doneAt) / 300);
    const [title] = verdict(s.result);
    const y = (oursAt(0)[1] + down + c * 0.75 + lay.low) / 2;
    g.globalAlpha = k;
    words(
      title,
      lay.w / 2,
      y - (1 - k) * 14,
      Math.min(46, lay.w * 0.085),
      s.result === "win" ? "#ffd98a" : s.result === "loss" ? CORAL : "#d7c6de",
      800,
      6,
    );
    g.globalAlpha = 1;
  } else if (s && paused)
    words("paused", lay.w / 2, (oursAt(0)[1] + down + c * 0.75 + lay.low) / 2, 18, "#b9a3c4", 700, 4);

  // Whatever is being carried, under the finger.
  if (drag?.live) {
    const d = drag;
    if (d.what.t === "snack") {
      const k = run.snacks[d.what.i];
      if (k) {
        g.save();
        g.translate(d.x, d.y - c * 0.2);
        g.scale(c / 44, c / 44);
        nibble(g, k);
        g.restore();
      }
    } else {
      const k = d.what.t === "stall" ? run.stall[d.what.i] : run.line[d.what.i]?.kind;
      if (k) body(k, d.x, d.y - c * 0.3, c * 1.12, { rot: Math.sin(real / 90) * 0.06 });
    }
  }
}

// ---------- the clock ----------

let before = performance.now();
function frame(now: number): void {
  const dt = Math.min(100, now - before);
  before = now;
  if (!manual) advance(dt * (playing() ? (paused ? 0 : speed) : 1));
  draw(now);
  requestAnimationFrame(frame);
}
addEventListener("pagehide", keep);
fit();
sync();
arrive();
dom();
requestAnimationFrame(frame);

/** A handle for review: headless browsers draw about a frame a second, so the clock is stepped by hand. */
Object.assign(window, {
  battler: {
    get run() {
      return run;
    },
    /** A new run from a seed, past the title. */
    start: (seed: number, mode: Mode = "forest"): void => begin(mode, seed),
    /** Sets the line (and the acorns) outright: `[["rock"], ["emberkit", 2], null, ...]`, front first. */
    line(spec: readonly (readonly [Kind, number?] | null)[], acorns = run.acorns): void {
      run.line = Array.from({ length: SLOTS }, (_, i) => {
        const s = spec[i];
        return s ? spirit(s[0], s[1] ?? 1) : null;
      });
      run.acorns = acorns;
      sync();
      dom();
    },
    /** Shows the run as it now stands, after it has been changed from outside. */
    sync(): void {
      sync();
      dom();
    },
    buy: doBuy,
    feed: doFeed,
    swap: doSwap,
    sell: doSell,
    rustle: doRustle,
    /** Plays the stall the way the plain shopper would. */
    auto(): void {
      autoTurn(run);
      sync();
      dom();
    },
    select(t: Thing["t"], i: number): void {
      sel = { t, i };
      dom();
    },
    go,
    /** Moves the clock on by hand and draws; from then on only this moves it. */
    tick(ms: number): void {
      manual = true;
      advance(ms);
      draw(performance.now());
    },
    /** Plays the fight on until an ability with these words, or a kind of event, comes up on the tape; then a moment more. */
    until(text: string, more = 260): boolean {
      manual = true;
      const s = show;
      if (!s) return false;
      const from = s.cursor;
      let found = false;
      for (let guard = 0; !found && playing() && guard < 4000; guard++) {
        advance(20);
        const ev = s.cursor > from ? s.fight.tape[s.cursor - 1] : undefined;
        found = ev !== undefined && (ev.t === text || ((ev.t === "say" || ev.t === "bolt") && ev.text === text));
      }
      if (found) advance(more);
      draw(performance.now());
      return found;
    },
    skip,
    onward,
    veil(v: "title" | "over" | null): void {
      veil = v;
      dom();
    },
    /** Where something is on the page, for a tap: a place in the line, an offer, a snack. */
    at(t: Thing["t"], i: number): { x: number; y: number } {
      const [x, y] = t === "line" ? oursAt(i) : t === "stall" ? stallAt(i) : t === "snack" ? snackAt(i) : theirsAt(i);
      return { x, y };
    },
    /** What stands where, in words, for checking a screenshot against. */
    state: (): unknown => ({
      round: run.round,
      phase: run.phase,
      hearts: run.hearts,
      acorns: run.acorns,
      line: run.line.map((s) => (s ? `${s.kind} ${s.atk}/${s.hp}` : null)),
      foe: run.foe.party.map((s) => `${s.kind} ${s.atk}/${s.hp}`),
      stall: run.stall,
      snacks: run.snacks,
      record: run.record,
      result: show?.result ?? null,
    }),
  },
});
