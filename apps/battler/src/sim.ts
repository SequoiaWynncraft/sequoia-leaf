/**
 * The Little Raid: an auto battler, as a simulation with no screen in it. A member takes a line of
 * up to five spirits on a short raid of their own: each round they shop for a turn (buy, feed,
 * sell, reorder; three of a kind become one stronger), and then the line fights a wave of forest
 * trouble by itself, front against front, until one side is gone.
 *
 * Everything here is plain data and plain functions, so it can be tested, saved, and later checked
 * by a server. A fight is worked out all at once, from the two lines and a seed, into a tape of
 * what happened; the screen only plays the tape back.
 */
import {
  HANDLES,
  type Kind,
  ROLE,
  SNACK,
  type SnackKind,
  SNACKS,
  type SpiritKind,
  SPIRITS,
  type TroubleKind,
  WAVES,
} from "./cast.ts";

/** Places in a line; rounds in a run; hearts to lose; acorns each turn; what a spirit and a new set of offers cost. */
export const SLOTS = 5;
export const ROUNDS = 8;
export const HEARTS = 3;
export const BUDGET = 8;
export const PRICE = 3;
export const RUSTLE = 1;
/** A fight that has not ended after this many clashes is a draw. */
const CLASH_CAP = 60;

export interface Spirit {
  kind: Kind;
  level: number;
  atk: number;
  hp: number;
  /** Hits it will take no harm from, at the start of every fight. */
  cushion: number;
  /** A crab's number. */
  tag: string;
}
/** What a spirit gains each time three become one: a Rock never attacks, so it only gets sturdier. */
const growth = (kind: Kind): readonly [number, number] => (kind === "rock" ? [0, 4] : [2, 2]);
/** A spirit as it comes from the stall, or as three (or nine) plain ones would have made it. */
export function spirit(kind: Kind, level = 1): Spirit {
  const [atk, hp] = growth(kind);
  return {
    kind,
    level,
    atk: ROLE[kind].atk + atk * (level - 1),
    hp: ROLE[kind].hp + hp * (level - 1),
    cushion: 0,
    tag: "",
  };
}
const present = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined;

// ---------- chance ----------

/** A small seeded generator (mulberry32): moves the state held in `o.rng` on, and gives a number from 0 up to 1. */
function chance(o: { rng: number }): number {
  o.rng = (o.rng + 0x6d2b79f5) >>> 0;
  let t = o.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function pick<T>(o: { rng: number }, list: readonly T[]): T {
  const v = list[Math.floor(chance(o) * list.length)];
  if (v === undefined) throw new Error("nothing to pick from");
  return v;
}
const mix = (seed: number, n: number): number => (seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;

// ---------- the fight ----------

/** Ours is 0, the trouble 1. */
export type Side = 0 | 1;
export interface Fighter extends Spirit {
  /** Its own number in this fight, which the tape names it by. */
  id: number;
  side: Side;
  /** How many more times a Worm will burrow instead of fainting. */
  burrows: number;
  /** Who hurt it last, for the credit when it faints; -1 for nobody. */
  by: number;
}
export interface Hit {
  id: number;
  amount: number;
  /** Its health after. */
  hp: number;
  /** What took the edge off: a cushion takes all of it, a Rock's shrug some. */
  soak: "none" | "cushion" | "shrug";
}
/** A fighter's numbers as they now stand. */
export interface Change {
  id: number;
  atk: number;
  hp: number;
  cushion: number;
}
export type Look = "spark" | "swoop" | "slime" | "thorn" | "stub" | "peck" | "gust";
export type Result = "win" | "loss" | "draw";
/** One thing that happened in a fight, in the order it happened. */
export type Ev =
  /** The two at the front hit each other at once. */
  | { t: "clash"; a: number; b: number; hits: Hit[] }
  /** An ability announces itself. */
  | { t: "say"; id: number; text: string }
  /** Something flies from one to another, with the ability's name. */
  | { t: "bolt"; from: number; to: number; look: Look; text: string }
  | { t: "hits"; hits: Hit[] }
  | { t: "stats"; changes: Change[] }
  /** One tumbles off; a Worm dives instead. */
  | { t: "faint"; id: number; dive: boolean }
  /** One joins its line at a place. */
  | { t: "join"; unit: Fighter; at: number }
  /** A line as it now stands, front first. */
  | { t: "order"; side: Side; ids: number[] }
  | { t: "end"; result: Result };
export interface Fight {
  /** Both lines as they walked in, front first. */
  start: [Fighter[], Fighter[]];
  tape: Ev[];
  result: Result;
  clashes: number;
}

interface Bout {
  rng: number;
  next: number;
  sides: [Fighter[], Fighter[]];
  tape: Ev[];
  /** Counts every blow that lands on something, so a fight where nothing can touch anything is noticed. */
  stir: number;
}
const other = (side: Side): Side => (side === 0 ? 1 : 0);
const stands = (u: Fighter): Change => ({ id: u.id, atk: u.atk, hp: u.hp, cushion: u.cushion });

/** Lands one blow, and says how it went; nothing if there was nothing to land. */
function strike(b: Bout, target: Fighter, amount: number, by: Fighter): Hit | null {
  if (target.hp <= 0 || amount <= 0) return null;
  b.stir++;
  if (target.cushion > 0) {
    target.cushion--;
    return { id: target.id, amount: 0, hp: target.hp, soak: "cushion" };
  }
  // A Rock shrugs some of every hit off, but something always gets through.
  const shrug = target.kind === "rock" ? Math.min(2 * target.level, amount - 1) : 0;
  target.hp = Math.max(0, target.hp - (amount - shrug));
  target.by = by.id;
  return { id: target.id, amount: amount - shrug, hp: target.hp, soak: shrug > 0 ? "shrug" : "none" };
}
/** Lands blows that happen at once, writes them down, and then lets those who were hurt answer. */
function harm(
  b: Bout,
  blows: readonly (readonly [target: Fighter, amount: number, by: Fighter])[],
  clash: readonly [number, number] | null = null,
): void {
  const landed: [Fighter, Fighter, Hit][] = [];
  for (const [target, amount, by] of blows) {
    const hit = strike(b, target, amount, by);
    if (hit) landed.push([target, by, hit]);
  }
  const hits = landed.map(([, , hit]) => hit);
  if (clash) b.tape.push({ t: "clash", a: clash[0], b: clash[1], hits });
  else if (hits.length) b.tape.push({ t: "hits", hits });
  for (const [target, by, hit] of landed) if (hit.amount > 0) felt(b, target, by);
}
/** What one does about being hurt, whether or not it is still standing. */
function felt(b: Bout, target: Fighter, by: Fighter): void {
  const line = b.sides[target.side];
  if (target.kind === "glorp") {
    if (line.filter((u) => u.hp > 0).length >= SLOTS) return;
    const bit: Fighter = {
      ...spirit("glorplet"),
      atk: target.level,
      hp: target.level,
      id: b.next++,
      side: target.side,
      burrows: 0,
      by: -1,
    };
    const at = line.indexOf(target) + 1;
    line.splice(at, 0, bit);
    b.tape.push({ t: "say", id: target.id, text: "A bit comes off" }, { t: "join", unit: { ...bit }, at });
  } else if (target.kind === "slug") {
    if (by.hp <= 0 || by.atk <= 1) return;
    by.atk = Math.max(1, by.atk - target.level);
    b.tape.push(
      { t: "bolt", from: target.id, to: by.id, look: "slime", text: "Slimed" },
      { t: "stats", changes: [stands(by)] },
    );
  } else if (target.kind === "bramble" || target.kind === "rock") {
    // A Rock does nothing about it. Hitting a rock is its own reward.
    if (by.hp <= 0) return;
    const thorny = target.kind === "bramble";
    b.tape.push({
      t: "bolt",
      from: target.id,
      to: by.id,
      look: thorny ? "thorn" : "stub",
      text: thorny ? "Thorns" : "It is a rock.",
    });
    harm(b, [[by, target.level, target]]);
  }
}
/** Takes everyone with no health left out of their lines, one at a time, with all that follows from each. */
function sweep(b: Bout): void {
  for (;;) {
    const out = b.sides[0].find((u) => u.hp <= 0) ?? b.sides[1].find((u) => u.hp <= 0);
    if (!out) return;
    const line = b.sides[out.side];
    const foes = b.sides[other(out.side)];
    const dive = out.kind === "worm" && out.burrows > 0;
    if (dive) b.tape.push({ t: "say", id: out.id, text: "Burrows" });
    if (out.kind === "toadstool") b.tape.push({ t: "say", id: out.id, text: "Spores" });
    line.splice(line.indexOf(out), 1);
    b.tape.push({ t: "faint", id: out.id, dive });
    if (dive) {
      // It has not fainted, so nobody mourns it and nobody gets the credit.
      const back: Fighter = { ...out, id: b.next++, hp: 1, burrows: out.burrows - 1, by: -1 };
      line.push(back);
      b.tape.push({ t: "join", unit: { ...back }, at: line.length - 1 });
      continue;
    }
    if (out.kind === "toadstool")
      harm(
        b,
        foes.map((u) => [u, out.level, out] as const),
      );
    // Moths are drawn to where a friend just was.
    const moths = line.filter((u) => u.kind === "moth" && u.hp > 0);
    for (const m of moths) {
      m.atk += m.level;
      m.hp += m.level;
      b.tape.push({ t: "say", id: m.id, text: "Flutters over" });
    }
    if (moths.length) b.tape.push({ t: "stats", changes: moths.map(stands) });
    // A Fox that did it rings its antlers for the rest of its line.
    const fox = foes.find((u) => u.id === out.by && u.kind === "fox" && u.hp > 0);
    const heard = fox ? foes.filter((u) => u !== fox && u.hp > 0) : [];
    if (fox && heard.length) {
      for (const u of heard) {
        // A Rock is glad of it, and still does nothing.
        if (u.kind !== "rock") u.atk += fox.level;
        u.hp += fox.level;
      }
      b.tape.push({ t: "say", id: fox.id, text: "Antlers ring" }, { t: "stats", changes: heard.map(stands) });
    }
  }
}
/** Start-of-fight abilities: our line front to back, then theirs. */
function opening(b: Bout): void {
  for (const side of [0, 1] as const) {
    const line = b.sides[side];
    const foes = b.sides[other(side)];
    for (const u of line.slice()) {
      const i = line.indexOf(u);
      if (i < 0) continue;
      if (u.kind === "mossmote") {
        const tucked = line.slice(Math.max(0, i - u.level), i);
        if (!tucked.length) continue;
        for (const friend of tucked) friend.cushion++;
        b.tape.push({ t: "say", id: u.id, text: "Cushions" }, { t: "stats", changes: tucked.map(stands) });
      } else if (u.kind === "owl") {
        const back = foes.at(-1);
        if (!back) continue;
        b.tape.push({ t: "bolt", from: u.id, to: back.id, look: "swoop", text: "Swoops" });
        harm(b, [[back, 4 * u.level, u]]);
        sweep(b);
      } else if (u.kind === "magpie") {
        if (!foes.length) continue;
        const shiny = pick(b, foes);
        b.tape.push({ t: "bolt", from: u.id, to: shiny.id, look: "peck", text: "Pecks" });
        harm(b, [[shiny, 2 * u.level, u]]);
        sweep(b);
      } else if (u.kind === "gust") {
        const front = foes[0];
        if (!front || foes.length < 2) continue;
        b.tape.push({ t: "bolt", from: u.id, to: front.id, look: "gust", text: "Whoosh" });
        if (front.kind === "rock") {
          b.tape.push({ t: "say", id: front.id, text: "It is a rock." });
          continue;
        }
        foes.push(...foes.splice(0, 1));
        b.tape.push({ t: "order", side: other(side), ids: foes.map((f) => f.id) });
      }
    }
  }
}
/** After-clash abilities: a spark from whoever sleeps at the very back, and a big crab's temper. */
function after(b: Bout, clashed: readonly Fighter[]): void {
  for (const side of [0, 1] as const) {
    const line = b.sides[side];
    const foes = b.sides[other(side)];
    for (const u of line.slice()) {
      if (!line.includes(u)) continue;
      const front = foes[0];
      if (u.kind === "emberkit" && line.length > 1 && line.at(-1) === u && front) {
        b.tape.push({ t: "bolt", from: u.id, to: front.id, look: "spark", text: "Spark" });
        harm(b, [[front, u.level, u]]);
        sweep(b);
      } else if (u.kind === "bigcrab" && clashed.includes(u)) {
        u.atk += 1;
        b.tape.push({ t: "say", id: u.id, text: "Crabbier" }, { t: "stats", changes: [stands(u)] });
      }
    }
  }
}

/** Works a whole fight out: our line against theirs, front first, with a seed for what is left to chance. */
export function fight(ours: readonly Spirit[], theirs: readonly Spirit[], seed: number): Fight {
  const b: Bout = { rng: seed >>> 0, next: 0, sides: [[], []], tape: [], stir: 0 };
  const enter = (s: Spirit, side: Side): Fighter => ({
    ...s,
    id: b.next++,
    side,
    burrows: s.kind === "worm" ? s.level : 0,
    by: -1,
  });
  b.sides[0] = ours.slice(0, SLOTS).map((s) => enter(s, 0));
  b.sides[1] = theirs.slice(0, SLOTS).map((s) => enter(s, 1));
  const walkedIn: [Fighter[], Fighter[]] = [structuredClone(b.sides[0]), structuredClone(b.sides[1])];
  opening(b);
  let clashes = 0;
  let quiet = 0;
  while (clashes < CLASH_CAP && quiet < 2) {
    const a = b.sides[0][0];
    const z = b.sides[1][0];
    if (!a || !z) break;
    clashes++;
    const before = b.stir;
    harm(
      b,
      [
        [a, z.atk, z],
        [z, a.atk, a],
      ],
      [a.id, z.id],
    );
    sweep(b);
    after(b, [a, z]);
    quiet = b.stir === before ? quiet + 1 : 0;
  }
  const left = b.sides[0].length;
  const right = b.sides[1].length;
  const result: Result = left > 0 && right === 0 ? "win" : right > 0 && left === 0 ? "loss" : "draw";
  b.tape.push({ t: "end", result });
  return { start: walkedIn, tape: b.tape, result, clashes };
}

// ---------- a run ----------

export type Mode = "forest" | "friendly";
export interface Wave {
  name: string;
  /** Whose it is: the forest, or a guild-mate whose saved party this is. */
  who: string;
  party: Spirit[];
}
export interface Run {
  seed: number;
  rng: number;
  /** Against the forest, with hearts to lose; or friendly bouts against guild-mates' saved parties, with nothing at stake. */
  mode: Mode;
  /** Counted from 1. */
  round: number;
  hearts: number;
  acorns: number;
  /** Acorns a Chickaree put away, which come back at the start of next turn. */
  buried: number;
  /** The line, front first; a place may stand empty. */
  line: (Spirit | null)[];
  stall: (SpiritKind | null)[];
  snacks: (SnackKind | null)[];
  /** Who the line meets at the end of this turn, so it can be planned for. */
  foe: Wave;
  phase: "shop" | "fight" | "over";
  /** How each round so far went. */
  record: Result[];
  /** The crab that never turns up for roll call, and the next number to hand out. */
  missing: number;
  crab: number;
}
/** Something that happened in the stall or the line because of what was just done, for the screen to show. */
export type Note =
  | { t: "advice"; from: number; to: number; atk: number }
  | { t: "merge"; into: number; from: number[]; level: number }
  | { t: "fed"; slot: number; meant: number; atk: number; hp: number; cushion: number }
  | { t: "seconds"; slot: number; atk: number; hp: number }
  | { t: "buried"; slot: number; comes: number }
  | { t: "dug"; acorns: number };
export type Done = { ok: true; notes: Note[] } | { ok: false; why: string };
const no = (why: string): { ok: false; why: string } => ({ ok: false, why });

/** The nearest spirit ahead of a place (toward the front) and behind it; -1 if there is none. */
export function ahead(line: readonly (Spirit | null)[], slot: number): number {
  for (let i = slot - 1; i >= 0; i--) if (line[i]) return i;
  return -1;
}
export function behind(line: readonly (Spirit | null)[], slot: number): number {
  for (let i = slot + 1; i < line.length; i++) if (line[i]) return i;
  return -1;
}
/** The line as it walks out: front first, no gaps. */
export const party = (run: Run): Spirit[] => run.line.filter(present);

/** Which spirits the stall may have this round. */
export const onSale = (round: number): SpiritKind[] =>
  SPIRITS.filter((k) => ROLE[k].tier <= (round >= 5 ? 3 : round >= 3 ? 2 : 1));
function restock(run: Run): void {
  const open = onSale(run.round);
  run.stall = Array.from({ length: run.round >= 5 ? 4 : 3 }, () => pick(run, open));
  run.snacks = Array.from({ length: 2 }, () => pick(run, SNACKS));
}
/** The forest's wave for this round. Crabs are numbered as they come, and one number is never called. */
function trouble(run: Run): Wave {
  const plan = pick(run, WAVES[run.round - 1] ?? []);
  const number = (): string => {
    if (run.crab === run.missing) run.crab++;
    return `#${run.crab++}`;
  };
  const shell: Partial<Record<TroubleKind, number>> = { crab: 1, bigcrab: 4 };
  return {
    name: plan.name,
    who: "The forest",
    party: plan.party.map(([kind, atk, hp, level = 1]) => ({
      kind,
      level,
      atk,
      hp,
      cushion: shell[kind] ?? 0,
      tag: kind === "crab" ? number() : kind === "bigcrab" ? `#${run.missing}` : "",
    })),
  };
}
/**
 * A guild-mate's saved party, as it stood after a number of turns. Until there are real ones, it is
 * what a plain, sensible shopper with tastes of its own would have put together from a seed.
 */
export function ghost(seed: number, round: number): Wave {
  const g = start(seed, "forest");
  const o = { rng: mix(seed, 77) };
  const taste: Taste = {};
  for (const k of SPIRITS) taste[k] = 0.4 + chance(o) * 1.6;
  for (let r = 1; r <= round; r++) {
    autoTurn(g, taste);
    bury(g, []);
    if (r < round) turn(g);
  }
  const who = pick(o, HANDLES);
  return { name: `${who}'s party`, who, party: structuredClone(party(g)) };
}
const oppose = (run: Run): Wave => (run.mode === "forest" ? trouble(run) : ghost(mix(run.seed, run.round), run.round));
/** Moves on to the next turn's shopping: fresh acorns, whatever was buried, and new offers. */
function turn(run: Run): Note[] {
  const dug = run.buried;
  run.round++;
  run.acorns = BUDGET + dug;
  run.buried = 0;
  restock(run);
  return dug > 0 ? [{ t: "dug", acorns: dug }] : [];
}

export function start(seed: number, mode: Mode = "forest"): Run {
  const run: Run = {
    seed: seed >>> 0,
    rng: seed >>> 0,
    mode,
    round: 1,
    hearts: HEARTS,
    acorns: BUDGET,
    buried: 0,
    line: Array.from({ length: SLOTS }, () => null),
    stall: [],
    snacks: [],
    foe: { name: "", who: "", party: [] },
    phase: "shop",
    record: [],
    missing: 0,
    crab: 1,
  };
  run.missing = 2 + Math.floor(chance(run) * 5);
  restock(run);
  run.foe = oppose(run);
  return run;
}

/** Three of a kind at the same level become one of the next, where the foremost of them stood. */
function gather(run: Run, kind: Kind, level: number, extra: Spirit | null, notes: Note[]): void {
  if (level >= 3) return;
  const from = run.line.flatMap((s, i) => (s?.kind === kind && s.level === level ? [i] : [])).slice(0, extra ? 2 : 3);
  const three = [...from.map((i) => run.line[i]), extra].filter(present);
  const into = from[0];
  if (three.length < 3 || into === undefined) return;
  const [atk, hp] = growth(kind);
  for (const i of from) run.line[i] = null;
  run.line[into] = {
    kind,
    level: level + 1,
    atk: Math.max(...three.map((s) => s.atk)) + atk,
    hp: Math.max(...three.map((s) => s.hp)) + hp,
    cushion: Math.max(...three.map((s) => s.cushion)),
    tag: "",
  };
  notes.push({ t: "merge", into, from, level: level + 1 });
  gather(run, kind, level + 1, null, notes);
}

/** Buys a spirit from the stall into a place in the line (the first free one, if none is named). */
export function buy(run: Run, offer: number, slot: number = run.line.indexOf(null)): Done {
  if (run.phase !== "shop") return no("The party is out");
  const kind = run.stall[offer];
  if (!kind) return no("Nothing left there");
  if (run.acorns < PRICE) return no("Not enough acorns");
  const free = slot >= 0 && slot < SLOTS && run.line[slot] === null;
  // With no place for it, it can still be bought if it is the third of its kind.
  const twins = run.line.filter((s) => s?.kind === kind && s.level === 1).length;
  if (!free && twins < 2)
    return no(run.line.includes(null) ? "Someone is standing there" : "The line is full: sell someone first");
  run.acorns -= PRICE;
  run.stall[offer] = null;
  const fresh = spirit(kind);
  if (free) run.line[slot] = fresh;
  const notes: Note[] = [];
  run.line.forEach((s, i) => {
    if (s?.kind !== "leafling" || s === fresh) return;
    const to = ahead(run.line, i);
    const friend = run.line[to];
    if (!friend) return;
    // A Rock was not listening.
    const atk = friend.kind === "rock" ? 0 : s.level;
    friend.atk += atk;
    notes.push({ t: "advice", from: i, to, atk });
  });
  gather(run, kind, 1, free ? null : fresh, notes);
  return { ok: true, notes };
}
/** Gives a snack from the stall to the spirit in a place; a snack for everyone needs no place. */
export function feed(run: Run, offer: number, slot = -1): Done {
  if (run.phase !== "shop") return no("The party is out");
  const kind = run.snacks[offer];
  if (!kind) return no("Nothing left there");
  const snack = SNACK[kind];
  if (run.acorns < snack.cost) return no("Not enough acorns");
  /** Who ends up eating what was meant for a place: a Greg, if he stands there or next to it. */
  const eater = (meant: number): number => {
    if (run.line[meant]?.kind === "greg") return meant;
    return [ahead(run.line, meant), behind(run.line, meant)].find((i) => run.line[i]?.kind === "greg") ?? meant;
  };
  const meant = snack.all ? run.line.flatMap((s, i) => (s ? [i] : [])) : run.line[slot] ? [slot] : [];
  if (!meant.length) return no(snack.all ? "Nobody to feed" : "Nobody is standing there");
  if (snack.cushion > 0 && meant.every((m) => (run.line[eater(m)]?.cushion ?? 0) >= snack.cushion))
    return no("As padded as can be already");
  run.acorns -= snack.cost;
  run.snacks[offer] = null;
  const notes: Note[] = [];
  const gregs = new Set<number>();
  for (const m of meant) {
    const to = eater(m);
    const s = run.line[to];
    if (!s) continue;
    const atk = s.kind === "rock" ? 0 : snack.atk;
    s.atk += atk;
    s.hp += snack.hp;
    s.cushion = Math.max(s.cushion, snack.cushion);
    if (s.kind === "greg") gregs.add(to);
    notes.push({ t: "fed", slot: to, meant: m, atk, hp: snack.hp, cushion: snack.cushion });
  }
  for (const g of gregs) {
    const s = run.line[g];
    if (!s) continue;
    s.atk += s.level;
    s.hp += s.level;
    notes.push({ t: "seconds", slot: g, atk: s.level, hp: s.level });
  }
  return { ok: true, notes };
}
/** Sends a spirit home, for an acorn a level. */
export function sell(run: Run, slot: number): Done {
  if (run.phase !== "shop") return no("The party is out");
  const s = run.line[slot];
  if (!s) return no("Nobody is standing there");
  run.acorns += s.level;
  run.line[slot] = null;
  return { ok: true, notes: [] };
}
/** Swaps two places in the line; either may be empty. A Rock stays where it was put. */
export function swap(run: Run, a: number, b: number): Done {
  if (run.phase !== "shop") return no("The party is out");
  const [x, y] = [run.line[a], run.line[b]];
  if (x === undefined || y === undefined || a === b) return no("Nowhere to go");
  if (!x && !y) return no("Nobody is standing there");
  if (x?.kind === "rock" || y?.kind === "rock") return no("It is a rock. It stays where it is.");
  run.line[a] = y;
  run.line[b] = x;
  return { ok: true, notes: [] };
}
/** Pays for a fresh set of offers. */
export function rustle(run: Run): Done {
  if (run.phase !== "shop") return no("The party is out");
  if (run.acorns < RUSTLE) return no("Not enough acorns");
  run.acorns -= RUSTLE;
  restock(run);
  return { ok: true, notes: [] };
}
/** End-of-turn abilities: each Chickaree puts one leftover acorn away. What is left after that is lost. */
function bury(run: Run, notes: Note[]): void {
  run.line.forEach((s, slot) => {
    if (s?.kind !== "chickaree" || run.acorns < 1) return;
    run.acorns--;
    const comes = 1 + s.level;
    run.buried += comes;
    notes.push({ t: "buried", slot, comes });
  });
}
/** Ends the turn and sends the line out: the fight is worked out here, for the screen to play back. */
export function ready(run: Run): { ok: true; notes: Note[]; fight: Fight } | { ok: false; why: string } {
  if (run.phase !== "shop") return no("The party is out");
  const line = party(run);
  if (!line.length) return no("Take at least one spirit along");
  const notes: Note[] = [];
  bury(run, notes);
  const bout = fight(line, run.foe.party, mix(run.seed, 100 + run.round));
  run.phase = "fight";
  run.record.push(bout.result);
  return { ok: true, notes, fight: bout };
}
/** After the fight: a loss to the forest costs a heart, and then it is the next turn, or the run is over. */
export function settle(run: Run): Note[] {
  if (run.phase !== "fight") return [];
  if (run.record.at(-1) === "loss" && run.mode === "forest") run.hearts--;
  if (run.round >= ROUNDS || run.hearts <= 0) {
    run.phase = "over";
    return [];
  }
  const notes = turn(run);
  run.foe = oppose(run);
  run.phase = "shop";
  return notes;
}
/** How a finished run went: the boss sent packing, the party sent home, or a set of friendly bouts played out. */
export function outcome(run: Run): "won" | "lost" | "played" | null {
  if (run.phase !== "over") return null;
  if (run.mode === "friendly") return "played";
  return run.record.length === ROUNDS && run.record.at(-1) === "win" ? "won" : "lost";
}

/** A run as text, and back. Text that is not a whole run, such as one kept by an older version, is no run. */
export const save = (run: Run): string => JSON.stringify(run);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isOneOf = (v: unknown, list: readonly string[]): boolean => typeof v === "string" && list.includes(v);
const isSomeone = (v: unknown): v is Spirit =>
  isRecord(v) &&
  typeof v.kind === "string" &&
  Object.hasOwn(ROLE, v.kind) &&
  [v.level, v.atk, v.hp, v.cushion].every(isCount) &&
  typeof v.tag === "string";
function isRun(v: unknown): v is Run {
  if (!isRecord(v) || !isRecord(v.foe)) return false;
  const { line, stall, snacks, record, foe } = v;
  return (
    [v.seed, v.rng, v.round, v.hearts, v.acorns, v.buried, v.missing, v.crab].every(isCount) &&
    isOneOf(v.mode, ["forest", "friendly"]) &&
    isOneOf(v.phase, ["shop", "fight", "over"]) &&
    Array.isArray(line) &&
    line.length === SLOTS &&
    line.every((s) => s === null || isSomeone(s)) &&
    Array.isArray(stall) &&
    stall.every((k) => k === null || isOneOf(k, SPIRITS)) &&
    Array.isArray(snacks) &&
    snacks.every((k) => k === null || isOneOf(k, SNACKS)) &&
    Array.isArray(record) &&
    record.every((r) => isOneOf(r, ["win", "loss", "draw"])) &&
    typeof foe.name === "string" &&
    typeof foe.who === "string" &&
    Array.isArray(foe.party) &&
    foe.party.every(isSomeone)
  );
}
export function load(text: string): Run | null {
  try {
    const raw: unknown = JSON.parse(text);
    return isRun(raw) ? raw : null;
  } catch {
    return null;
  }
}

// ---------- a plain shopper ----------

/** How much a shopper likes each spirit; 1 where it has no view, 0 for never. */
export type Taste = Partial<Record<SpiritKind, number>>;
/** Where each kind likes to stand: lower is further forward. */
export const STANDS: Record<SpiritKind, number> = {
  rock: 0,
  slug: 1,
  glorp: 1,
  fox: 2,
  greg: 2,
  worm: 2,
  leafling: 3,
  mossmote: 3,
  owl: 5,
  emberkit: 5,
  moth: 6,
  chickaree: 7,
};
const isSpirit = (k: Kind): k is SpiritKind => ROLE[k].tier > 0;
/**
 * Plays one turn at the stall the way a plain, sensible shopper would: buys what makes or starts a
 * set, else what it likes best; feeds whoever is at the front; rustles with what is left; and lines
 * everyone up. It makes the guild-mates' parties for friendly bouts, and tries builds out in review.
 */
export function autoTurn(run: Run, taste: Taste = {}, stand: Record<SpiritKind, number> = STANDS): void {
  const like = (k: Kind): number => (isSpirit(k) ? (taste[k] ?? 1) : 0);
  const twinsOf = (k: Kind): number => run.line.filter((s) => s?.kind === k && s.level === 1).length;
  for (let guard = 0; guard < 40 && run.acorns > 0; guard++) {
    // The offer worth most, and who would have to go home to make room for it.
    let best = -1;
    let bestScore = 0.5;
    let evict = -1;
    run.stall.forEach((k, i) => {
      if (!k || run.acorns < PRICE) return;
      let score = like(k) + twinsOf(k) * 1.5;
      let out = -1;
      if (!run.line.includes(null) && twinsOf(k) < 2) {
        let least = Infinity;
        run.line.forEach((s, slot) => {
          if (!s || s.level > 1 || twinsOf(s.kind) > 1 || s.kind === k) return;
          const worth = like(s.kind) + (s.atk + s.hp - ROLE[s.kind].atk - ROLE[s.kind].hp) * 0.25;
          if (worth < least) {
            least = worth;
            out = slot;
          }
        });
        if (out < 0 || score < least + 0.6) score = 0;
      }
      if (score > bestScore) {
        best = i;
        bestScore = score;
        evict = out;
      }
    });
    if (best >= 0) {
      if (evict >= 0) sell(run, evict);
      // A Rock goes to the front, since it will not move later.
      const front = run.line[0];
      const spare = run.line.indexOf(null);
      if (run.stall[best] === "rock" && front && front.kind !== "rock" && spare > 0) swap(run, 0, spare);
      if (buy(run, best).ok) continue;
    }
    // Leave a Chickaree its acorn.
    const keep = run.line.filter((s) => s?.kind === "chickaree").length;
    const spend = run.acorns - Math.min(keep, 1);
    const greg = run.line.findIndex((s) => s?.kind === "greg");
    const first = run.line.findIndex((s) => s && s.kind !== "rock" && s.kind !== "chickaree");
    const snack = run.snacks.findIndex((k) => k && SNACK[k].cost <= spend);
    const to = greg >= 0 ? greg : first >= 0 ? first : run.line.findIndex(present);
    if (snack >= 0 && to >= 0 && feed(run, snack, to).ok) continue;
    if (spend >= RUSTLE && rustle(run).ok) continue;
    break;
  }
  // Line up: everyone but a Rock, by where their kind likes to stand, sturdiest first among equals.
  const places = run.line.flatMap((s, i) => (s?.kind === "rock" ? [] : [i]));
  const movers = places
    .map((i) => run.line[i])
    .filter(present)
    .toSorted((a, b) => (isSpirit(a.kind) && isSpirit(b.kind) ? stand[a.kind] - stand[b.kind] : 0) || b.hp - a.hp);
  places.forEach((slot, n) => {
    const want = movers[n];
    const from = want ? run.line.indexOf(want) : -1;
    if (from >= 0 && from !== slot) swap(run, slot, from);
  });
}
