/**
 * The Works: a factory on a grid, as a simulation with no screen in it. Miners stand on deposits,
 * belts carry what they dig, machines turn it into goods, and the depot at the middle takes
 * everything in and pays for it. Machines need power, which reaches out from the depot and is
 * carried further by pylons.
 *
 * Everything here is plain data and plain functions moved on a tick at a time, so it can be tested,
 * saved, run ahead while the player is away, and later checked by a server.
 */
export type Dir = 0 | 1 | 2 | 3;
/** East, south, west, north. */
export const DX = [1, 0, -1, 0] as const;
export const DY = [0, 1, 0, -1] as const;

export const RAW = ["wood", "ore", "stone"] as const;
export type Item = (typeof RAW)[number] | "plank" | "ingot" | "brick" | "tool" | "gear" | "frame" | "engine";
/** What the depot pays for one of each. */
export const VALUE: Record<Item, number> = {
  wood: 1,
  ore: 1,
  stone: 1,
  plank: 3,
  ingot: 3,
  brick: 3,
  tool: 10,
  gear: 10,
  frame: 10,
  engine: 45,
};
/** What a refinery makes of each raw thing. */
export const REFINE: Partial<Record<Item, Item>> = { wood: "plank", ore: "ingot", stone: "brick" };
/** What an assembler makes of two different things. */
export const ASSEMBLE: readonly (readonly [Item, Item, Item])[] = [
  ["plank", "ingot", "tool"],
  ["ingot", "brick", "gear"],
  ["plank", "brick", "frame"],
  ["tool", "gear", "engine"],
];

export type Kind = "belt" | "miner" | "refinery" | "assembler" | "splitter" | "pylon" | "core";
export const COST: Record<Kind, number> = {
  belt: 1,
  miner: 10,
  refinery: 20,
  assembler: 40,
  splitter: 8,
  pylon: 6,
  core: 0,
};
/** Ticks to do one piece of work. Ten ticks are a second. */
export const TICKS = { miner: 10, refinery: 12, assembler: 20, belt: 4 } as const;
/** How far power reaches from the depot and from a pylon, and how far apart two pylons may stand. */
export const REACH = { core: 6.6, pylon: 4.6, link: 8.1 } as const;
const BUFFER = 4;

export interface Building {
  kind: Kind;
  /** Which way it sends things on. */
  dir: Dir;
  /** A belt's or a splitter's one item, and how far along it is, 0 to 1. */
  item: Item | null;
  prog: number;
  /** A machine's stock of what it works on, its finished piece waiting to leave, and its work so far in ticks. */
  buf: Partial<Record<Item, number>>;
  out: Item | null;
  work: number;
  /** A splitter's next way out, by turns. */
  turn: number;
}
export interface Order {
  readonly title: string;
  readonly from: string;
  readonly want: Partial<Record<Item, number>>;
  readonly pay: number;
  readonly unlocks: readonly Kind[];
}
export const ORDERS: readonly Order[] = [
  { title: "Planks for the Treasury", from: "Cinfy", want: { plank: 12 }, pay: 80, unlocks: [] },
  { title: "Ingots and bricks", from: "Cinfy", want: { ingot: 12, brick: 12 }, pay: 160, unlocks: ["assembler"] },
  {
    title: "Tools for the raid parties",
    from: "The Branchmasters",
    want: { tool: 10 },
    pay: 260,
    unlocks: ["splitter"],
  },
  { title: "Gears and frames", from: "The crab pond", want: { gear: 10, frame: 10 }, pay: 500, unlocks: [] },
  { title: "Engines for the Great Works", from: "The guild", want: { engine: 10 }, pay: 1500, unlocks: [] },
];
export interface World {
  readonly w: number;
  readonly h: number;
  /** What lies in the ground at each cell. */
  readonly deposit: (Item | null)[];
  readonly cells: (Building | null)[];
  /** Which cells have power; worked out again whenever something is built or removed. */
  power: Uint8Array;
  coins: number;
  tick: number;
  /** Everything the depot has ever taken in, and what it has taken toward the order in hand. */
  depot: Partial<Record<Item, number>>;
  order: number;
  filled: Partial<Record<Item, number>>;
  unlocked: Kind[];
}

const blank = (kind: Kind, dir: Dir): Building => ({
  kind,
  dir,
  item: null,
  prog: 0,
  buf: {},
  out: null,
  work: 0,
  turn: 0,
});
export const at = (w: World, x: number, y: number): number =>
  x < 0 || y < 0 || x >= w.w || y >= w.h ? -1 : y * w.w + x;
export const coreAt = (w: World): [number, number] => [Math.floor(w.w / 2), Math.floor(w.h / 2)];

/** A new plot: the depot in the middle, wood within its reach, ore and stone a walk away. */
export function create(w = 34, h = 22): World {
  const world: World = {
    w,
    h,
    deposit: Array.from({ length: w * h }, () => null),
    cells: Array.from({ length: w * h }, () => null),
    power: new Uint8Array(w * h),
    coins: 140,
    tick: 0,
    depot: {},
    order: 0,
    filled: {},
    unlocked: ["belt", "miner", "refinery", "pylon"],
  };
  const [cx, cy] = coreAt(world);
  const patch = (item: Item, px: number, py: number, r: number, seed: number): void => {
    for (let y = py - r; y <= py + r; y++)
      for (let x = px - r; x <= px + r; x++) {
        const i = at(world, x, y);
        const rough = ((x * 7 + y * 13 + seed) % 5) * 0.22;
        if (i >= 0 && Math.hypot(x - px, y - py) < r - rough) world.deposit[i] = item;
      }
  };
  patch("wood", cx - 6, cy - 3, 3, 1);
  patch("wood", cx + 12, cy + 6, 3, 2);
  patch("ore", cx + 9, cy - 6, 3, 3);
  patch("stone", cx - 4, cy + 7, 3, 4);
  patch("ore", cx - 13, cy + 5, 2, 5);
  patch("stone", cx + 13, cy - 1, 2, 6);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const i = at(world, cx + dx, cy + dy);
      world.deposit[i] = null;
      world.cells[i] = blank("core", 0);
    }
  repower(world);
  return world;
}

/** Works out where there is power: round the depot, and round every pylon joined to it through other pylons. */
export function repower(w: World): void {
  const [cx, cy] = coreAt(w);
  const pylons: [number, number, boolean][] = [];
  w.cells.forEach((b, i) => {
    if (b?.kind === "pylon") pylons.push([i % w.w, Math.floor(i / w.w), false]);
  });
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of pylons) {
      if (p[2]) continue;
      const live =
        Math.hypot(p[0] - cx, p[1] - cy) <= REACH.link ||
        pylons.some((q) => q[2] && Math.hypot(p[0] - q[0], p[1] - q[1]) <= REACH.link);
      if (live) {
        p[2] = true;
        grew = true;
      }
    }
  }
  w.power.fill(0);
  for (let y = 0; y < w.h; y++)
    for (let x = 0; x < w.w; x++)
      if (
        Math.hypot(x - cx, y - cy) <= REACH.core ||
        pylons.some((p) => p[2] && Math.hypot(x - p[0], y - p[1]) <= REACH.pylon)
      )
        w.power[y * w.w + x] = 1;
}

/** Why something cannot be built here, or nothing if it can. */
export function refusal(w: World, kind: Kind, x: number, y: number): string | null {
  const i = at(w, x, y);
  if (i < 0) return "Off the plot";
  if (!w.unlocked.includes(kind)) return "Not unlocked yet";
  const there = w.cells[i];
  if (there?.kind === "core") return "The depot stands here";
  if (there && !(there.kind === "belt" && kind === "belt")) return "Something is here already";
  if (kind === "miner" && !w.deposit[i]) return "A miner needs a deposit under it";
  if (w.coins < COST[kind] - (there ? COST[there.kind] : 0)) return "Not enough coins";
  return null;
}
/** Builds something, paying for it; a belt laid over a belt only turns it. Says whether it did. */
export function build(w: World, kind: Kind, x: number, y: number, dir: Dir): boolean {
  if (refusal(w, kind, x, y)) return false;
  const i = at(w, x, y);
  const there = w.cells[i];
  if (there) {
    there.dir = dir;
    return true;
  }
  w.cells[i] = blank(kind, dir);
  w.coins -= COST[kind];
  if (kind === "pylon") repower(w);
  return true;
}
/** Takes something away and gives its cost back. The depot stays. */
export function remove(w: World, x: number, y: number): boolean {
  const i = at(w, x, y);
  const there = i < 0 ? null : w.cells[i];
  if (!there || there.kind === "core") return false;
  w.cells[i] = null;
  w.coins += COST[there.kind];
  if (there.kind === "pylon") repower(w);
  return true;
}

const fits = (held: Partial<Record<Item, number>>, item: Item): boolean => {
  const kinds = new Set([...Object.keys(held).filter((k) => (held[k as Item] ?? 0) > 0), item]);
  return ASSEMBLE.some(([a, b]) => [...kinds].every((k) => k === a || k === b));
};
/** Whether a building will take an item handed to it from the cell at `from`. */
function accepts(w: World, i: number, item: Item, from: number): boolean {
  const b = w.cells[i];
  if (!b) return false;
  if (b.kind === "core") return true;
  if (b.kind === "belt" || b.kind === "splitter") {
    // Not from the cell it is itself sending to: two belts facing each other pass nothing.
    const ahead = at(w, (i % w.w) + DX[b.dir], Math.floor(i / w.w) + DY[b.dir]);
    return b.item === null && ahead !== from;
  }
  if (b.kind === "refinery") {
    if (!REFINE[item]) return false;
    const held = Object.keys(b.buf).find((k) => (b.buf[k as Item] ?? 0) > 0);
    return (held === undefined || held === item) && (b.buf[item] ?? 0) < BUFFER;
  }
  if (b.kind === "assembler") return fits(b.buf, item) && (b.buf[item] ?? 0) < BUFFER;
  return false;
}
function give(w: World, i: number, item: Item): void {
  const b = w.cells[i]!;
  if (b.kind === "core") {
    w.depot[item] = (w.depot[item] ?? 0) + 1;
    w.coins += VALUE[item];
    const order = ORDERS[w.order];
    if (order?.want[item] !== undefined) w.filled[item] = Math.min(order.want[item], (w.filled[item] ?? 0) + 1);
    if (order && Object.entries(order.want).every(([k, n]) => (w.filled[k as Item] ?? 0) >= n)) {
      w.coins += order.pay;
      for (const u of order.unlocks) if (!w.unlocked.includes(u)) w.unlocked.push(u);
      w.order++;
      w.filled = {};
    }
  } else if (b.kind === "belt" || b.kind === "splitter") {
    b.item = item;
    b.prog = 0;
  } else b.buf[item] = (b.buf[item] ?? 0) + 1;
}

/** Moves the whole factory on by one tick. */
export function step(w: World): void {
  w.tick++;
  const n = w.cells.length;
  // Work first: machines make, belts carry.
  for (let i = 0; i < n; i++) {
    const b = w.cells[i];
    if (!b) continue;
    if (b.kind === "belt" || b.kind === "splitter") {
      if (b.item) b.prog = Math.min(1, b.prog + 1 / TICKS.belt);
      continue;
    }
    if (b.kind === "pylon" || b.kind === "core" || !w.power[i] || b.out) continue;
    if (b.kind === "miner") {
      if (++b.work >= TICKS.miner) {
        b.work = 0;
        b.out = w.deposit[i] ?? null;
      }
    } else if (b.kind === "refinery") {
      const raw = Object.keys(b.buf).find((k) => (b.buf[k as Item] ?? 0) > 0) as Item | undefined;
      if (!raw) continue;
      if (++b.work >= TICKS.refinery) {
        b.work = 0;
        b.buf[raw] = b.buf[raw]! - 1;
        b.out = REFINE[raw]!;
      }
    } else if (b.kind === "assembler") {
      const recipe = ASSEMBLE.find(([p, q]) => (b.buf[p] ?? 0) > 0 && (b.buf[q] ?? 0) > 0);
      if (!recipe) continue;
      if (++b.work >= TICKS.assembler) {
        b.work = 0;
        b.buf[recipe[0]] = b.buf[recipe[0]]! - 1;
        b.buf[recipe[1]] = b.buf[recipe[1]]! - 1;
        b.out = recipe[2];
      }
    }
  }
  // Then hand things on, each cell after the one it hands to, so a full belt moves as one.
  const done = new Uint8Array(n);
  const pass = (i: number): void => {
    if (done[i]) return;
    done[i] = 1;
    const b = w.cells[i];
    if (!b || b.kind === "core" || b.kind === "pylon") return;
    const x = i % w.w;
    const y = Math.floor(i / w.w);
    const carrier = b.kind === "belt" || b.kind === "splitter";
    const item = carrier ? (b.prog >= 1 ? b.item : null) : b.out;
    // A splitter tries straight on, then left, then right, starting a turn further each time.
    const ways: Dir[] =
      b.kind === "splitter" ? [0, 3, 1].map((_, k, all) => ((b.dir + all[(k + b.turn) % 3]!) % 4) as Dir) : [b.dir];
    for (const d of ways) {
      const to = at(w, x + DX[d], y + DY[d]);
      if (to < 0) continue;
      pass(to);
      if (!item || !accepts(w, to, item, i)) continue;
      give(w, to, item);
      if (carrier) b.item = null;
      else b.out = null;
      if (b.kind === "splitter") b.turn = (b.turn + 1) % 3;
      return;
    }
  };
  for (let i = 0; i < n; i++) pass(i);
}

/** A world as text, and back. */
export const save = (w: World): string => JSON.stringify({ ...w, power: undefined });
export function load(text: string): World | null {
  try {
    const raw = JSON.parse(text) as World;
    if (!Array.isArray(raw.cells) || raw.cells.length !== raw.w * raw.h || typeof raw.coins !== "number") return null;
    const w: World = { ...raw, power: new Uint8Array(raw.w * raw.h) };
    repower(w);
    return w;
  } catch {
    return null;
  }
}
