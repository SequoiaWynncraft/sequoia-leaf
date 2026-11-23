/**
 * One careful, ordinary player, playing the real yard by the real rules: every change is a command
 * off the wire, given with `play` at the yard's tick, and the yard runs on, tick by tick, while the
 * player works. The player keeps what it builds, and for the goal in hand builds only the lines its
 * planner says are missing (`needs.ts`), laid out first on a copy (`builder.ts`).
 *
 * What it believes the standing lines bring the depot is what it reads off the yard once its new
 * lines have filled (`measure.ts`), as a player reads the pace on the page: a split above another,
 * a joined belt, a machine short of a part are all in it. While that is short of the pace the goal in
 * hand wants, it builds again. Where a line will not fit at that pace, it builds the most of it that
 * does, at half the pace and half again, and waits the longer.
 *
 * Coins are real: the yard keeps no purse, so the player keeps one, as Leaf's ledger does. It pays
 * for each piece as it sets it down, and when it cannot, it waits with the yard running. Once a
 * minute, as the page does, it collects the till, hands over filled orders, swaps an order nothing
 * it has built could fill, and keeps the line of research full.
 *
 * A person's time is real too: each thing done costs seconds (`Hands`), during which the yard runs
 * on. Every tick of the yard's clock is marked as building (thinking and reading included), waiting
 * for Coins, or waiting for deliveries or folios, so any stretch of it can be split in three.
 */
import * as F from "../src/index.ts";
import { Builder, piecesStanding, type Planned, powerOf, type Rec, type Source } from "./builder.ts";
import { measure } from "./measure.ts";
import { capacity, type Delivers, type Grades, shortfall, size, type Unit } from "./needs.ts";

/** Seconds of a person's time for each thing done. */
export interface Hands {
  readonly piece: number;
  readonly set: number;
  readonly run: number;
  readonly tile: number;
  readonly plot: number;
  readonly think: number;
  readonly read: number;
  readonly order: number;
}

export interface Settings {
  readonly seed: number;
  /** The nodes, in the order the player turns to them. */
  readonly nodes: readonly string[];
  /** The research, in the order the player puts it in the line, each as soon as it may be. */
  readonly research: readonly string[];
  /** For each tier, the minutes of waiting a goal's lines are built for. */
  readonly minutes: readonly number[];
  /** Folios a minute the Studies and their lines are built for. */
  readonly folios: number;
  readonly hands: Hands;
  /** The highest grade the player builds each kind at, once it is unlocked. */
  readonly grades: Partial<Record<F.KindName, number>>;
  /** When a swap is free, the player swaps an order that would take longer than this many minutes to fill at what its lines bring the depot; with null, never. */
  readonly swap: number | null;
  /** Coins in the purse at the start. */
  readonly purse: number;
}

/** What the player was doing with a stretch of the yard's clock. */
export type Doing = "build" | "coins" | "wait";

/** One goal as the player played it, in ticks of the yard's clock. */
export interface Played {
  readonly goal: F.Goal;
  /** When the player turned to it (a node), or it began to be studied (research); when it was done. */
  readonly came: number;
  readonly done: number;
  readonly pieces: number;
  readonly purse: number;
  readonly power: { readonly gives: number; readonly draws: number };
  /** What was bought for it, by kind (and grade above 1) or plot. */
  readonly bought: ReadonlyMap<string, number>;
}

/** Coins that came in or went out, and when: an order handed over, a goal paid, the depot's share, or a purchase. */
export interface Coins {
  readonly tick: number;
  readonly what: "order" | "goal" | "depot" | "spent";
  readonly coins: number;
}

export interface Game {
  readonly goals: readonly Played[];
  readonly coins: readonly Coins[];
  /** How many orders were swapped. */
  readonly swaps: number;
  /** The tick each tier opened, and the tick the slice ended. */
  readonly tiers: readonly number[];
  /** For each tier, the folios its research and that of the tiers below still wanted when it opened. */
  readonly left: readonly number[];
  readonly end: number;
  readonly spans: readonly { readonly from: number; readonly to: number; readonly doing: Doing }[];
  /** Why the player stopped short of the end, if it did. */
  readonly stuck: string | null;
}

/** The longest the player waits for anything before it gives up and says so: twelve hours of the yard's clock. */
const STUCK = 12 * 36_000;
/** How many times the player builds for a goal: once, and twice more while what its lines really bring is short of what the goal wants. */
const ROUNDS = 3;
/** The slowest line the player builds when a faster one does not fit, things a minute. */
const SLOWEST = 1;
const MINUTE = F.MINUTE;

export class Player {
  readonly y: F.Yard;
  purse: number;
  /** The lines standing, as the builder may join or split them. */
  readonly lines: Source[] = [];
  /** What reached the depot of each thing a minute, as last read off the yard. */
  private read: Float64Array | null = null;
  private readonly s: Settings;
  private readonly spans: { from: number; to: number; doing: Doing }[] = [];
  private marked = 0;
  private nextTend = 0;
  private tending = false;
  private seen = 0;
  private readonly doneAt = new Map<F.Goal, Played>();
  private readonly cameAt = new Map<F.Goal, number>();
  private readonly bought = new Map<F.Goal, Map<string, number>>();
  private readonly tierAt: number[] = [0];
  private readonly leftAt: number[] = [0];
  private readonly coins: Coins[] = [];
  private swaps = 0;
  /** What the depot had paid when the till was last collected, in thousandths. */
  private sold = 0;
  /** The goal what is bought now is bought for. */
  private current: F.Goal | null = null;
  private studies = false;

  constructor(s: Settings) {
    this.s = s;
    this.y = F.create({ seed: s.seed });
    this.purse = s.purse;
  }

  /** The grade the player builds a kind at now: its policy's, or the highest unlocked if that is lower. */
  readonly grades: Grades = (k) => Math.max(1, Math.min(this.s.grades[F.kindName(k)] ?? 1, F.highest(this.y.open, k)));

  /** Plays every node in its order, and then waits for every piece of research to be known. */
  play(): Game {
    let stuck: string | null = null;
    try {
      this.tend();
      for (const id of this.s.nodes) this.node(F.goal(id));
      this.research();
      this.run("wait", () => !this.s.research.every((id) => this.isDone(F.goal(id))));
    } catch (e) {
      stuck = e instanceof Error ? e.message : String(e);
    }
    this.mark("wait");
    const goals = [...this.doneAt.values()].toSorted((a, b) => a.done - b.done || a.goal - b.goal);
    const { tick } = this.y;
    return {
      goals,
      coins: [...this.coins],
      swaps: this.swaps,
      tiers: [...this.tierAt],
      left: [...this.leftAt],
      end: tick,
      spans: [...this.spans],
      stuck,
    };
  }

  /** Turns to a node once it may be taken up, builds what it needs, and waits for it to be done. */
  private node(g: F.Goal): void {
    this.research();
    this.run("wait", () => !F.ready(this.y.open, g) && !this.isDone(g));
    if (this.isDone(g)) return;
    this.cameAt.set(g, this.y.tick);
    this.current = g;
    if (this.y.hand !== g) this.give({ do: "take", node: F.GOALS[g]?.id });
    this.busy(this.s.hands.read);
    const tier = F.GOALS[g]?.tier ?? 0;
    const want = F.GOALS[g]?.want ?? F.counts();
    // What the standing lines really bring is read once new lines have filled; while it is short of the pace the goal wants, the player builds again.
    for (let round = 0; round < ROUNDS && !this.isDone(g); round++) {
      const units = shortfall(want, this.y.got[g] ?? null, this.s.minutes[tier] ?? 10, this.depotLines(), this.grades);
      if (units.length === 0 || !this.build(units, [], g)) break;
    }
    this.run("wait", () => !this.isDone(g));
  }

  /** Once the Study is unlocked: the line of research filled, and Studies with folio lines built to the pace asked for. */
  private research(): void {
    if (this.studies || F.highest(this.y.open, F.STUDY) === 0) return;
    this.studies = true;
    this.queue();
    const first = this.y.line[0];
    if (first !== undefined) this.current = first;
    const wanted = new Map<F.Item, number>();
    for (const id of this.s.research) {
      const want = F.GOALS[F.goal(id)]?.want;
      for (const f of F.FOLIOS) wanted.set(f, (wanted.get(f) ?? 0) + (want?.[f] ?? 0));
    }
    const all = [...wanted.values()].reduce((a, b) => a + b, 0);
    const studies: Unit[] = [];
    for (const [folio, n] of wanted) {
      if (n === 0 || F.locked(this.y.open, { make: folio }) !== null) continue;
      const pace = (this.s.folios * n) / all;
      const each = F.makes(F.STUDY, this.grades(F.STUDY), null);
      const count = Math.max(1, Math.ceil(pace / each - 1e-9));
      for (let k = 0; k < count; k++) studies.push(size(folio, pace / count, this.grades));
    }
    this.build([], studies, null);
  }

  /**
   * Works lines out on a copy and builds them, then whatever power the yard would draw beyond what
   * it gives, even with no line to build. A line not yet begun is dropped once `g` is done.
   */
  private build(depot: readonly Unit[], studies: readonly Unit[], g: F.Goal | null): boolean {
    const makesPower = F.highest(this.y.open, F.BOILER) > 0 || F.highest(this.y.open, F.WHEEL) > 0;
    const now = powerOf(this.y);
    if (depot.length + studies.length === 0 && (now.draws <= now.gives || !makesPower)) return false;
    const b = new Builder(this.y, this.grades, this.lines);
    const plans: Planned[] = [];
    for (const u of depot) {
      const p = b.depotLine(u);
      // With no room for another line of a thing that standing lines bring, the player waits on those.
      if (p) plans.push(p);
      else if (this.depotLines().some((l) => l.item === u.item && l.rate > 0))
        this.note(g, `no room for more ${many(u.item)}`);
      else {
        // Else it builds the most of the line that fits, at half the pace and half again, and waits the longer.
        let less: Planned | null = null;
        for (let pace = u.perMinute / 2; !less && pace >= SLOWEST; pace /= 2)
          less = b.depotLine(size(u.item, pace, this.grades));
        if (!less) throw this.cannot(u, b);
        plans.push(less);
        this.note(g, `only ${less.rate.toFixed(1)} ${many(u.item)} a minute fitted`);
      }
    }
    for (const u of studies) plans.push(b.studyLine(u) ?? this.fail(u, b));
    const then = powerOf(b.y);
    plans.push(...b.power(then.draws - then.gives));
    let built = false;
    for (const p of plans) {
      if (g !== null && this.isDone(g)) break;
      built = built || p.into !== "power";
      if (p.into !== "power") this.busy(this.s.hands.think);
      for (const c of p.cmds) this.buy(c);
      this.lines.push(...p.lines);
      for (const t of p.taps) {
        const line = this.lines[t.source];
        if (line) this.lines[t.source] = { ...line, tapped: line.tapped + t.rate };
      }
      for (const [k, line] of this.lines.entries()) {
        const at = line.run.filter((j) => p.joined.includes(j));
        if (line.into === "depot" && at.length > 0) this.lines[k] = { ...line, joinedAt: [...line.joinedAt, ...at] };
      }
    }
    if (built) this.read = measure(this.y);
    return built;
  }

  private cannot(u: Unit, b: Builder): Error {
    return new Error(
      `no way was found to lay out a line of ${many(u.item)} at ${capacity(u).toFixed(1)} a minute (${b.why}; ${b.tried} tries)\n${map(b.gaveUp ?? b.y)}`,
    );
  }
  private fail(u: Unit, b: Builder): never {
    throw this.cannot(u, b);
  }

  /** Something the player could not do for a goal, to say on its row. */
  private note(g: F.Goal | null, what: string): void {
    if (g === null) return;
    const got = this.bought.get(g) ?? new Map<string, number>();
    this.bought.set(g, got);
    got.set(`(${what})`, 0);
  }

  /**
   * What the standing lines bring the depot, each thing a minute, as the player believes it: what it
   * read off the yard once its last lines had filled (`measure.ts`). What the builder books for a
   * line, less what it books split off it, is only its estimate, and is not believed.
   */
  depotLines(): Delivers[] {
    const read = this.read;
    if (read) return F.ALL_ITEMS.filter((n) => (read[n] ?? 0) > 0).map((n) => ({ item: n, rate: read[n] ?? 0 }));
    return this.lines.filter((l) => l.into === "depot").map((l) => ({ item: l.item, rate: l.rate - l.tapped }));
  }

  // ---------- commands, Coins and time ----------

  /** Gives the yard a command at its tick, and takes the Coins it moves into the purse. */
  private give(c: Rec): void {
    const read = F.readCommand({ tick: this.y.tick, ...c });
    if (!read) throw new Error(`${JSON.stringify(c)} does not read`);
    const did = F.play(this.y, read);
    if ("refused" in did) throw new Error(`${JSON.stringify(c)} was refused: ${did.why}`);
    for (const change of did.coins ?? []) {
      this.purse += change.amount;
      if (this.purse < 0) throw new Error(`${JSON.stringify(c)} took the purse below nothing`);
    }
    this.watch();
  }

  /** What a command costs the purse just now. */
  private priceOf(c: Rec): number {
    const read = F.readCommand({ tick: this.y.tick, ...c });
    if (!read) return 0;
    if (read.do === "build") return F.priceAt(this.y, read.kind, read.x, read.y, read.grade);
    if (read.do === "lay") return F.priceOf(this.y, read.legs);
    if (read.do === "buyPlot") return this.y.land.plots.find((p) => p.plot === read.plot)?.price ?? 0;
    return 0;
  }

  /** The seconds a person takes over a command. */
  private secondsOf(c: Rec): number {
    const h = this.s.hands;
    if (c.do === "lay") return h.run + h.tile * (Array.isArray(c.legs) ? c.legs.length : 0);
    if (c.do === "buyPlot") return h.plot;
    if (c.do === "recipe") return h.set;
    return h.piece;
  }

  /** Whether the purse, with the whole Coins in the till that a command pays in first, covers a price. */
  private affords(price: number): boolean {
    return this.purse + Math.floor(this.y.till / F.MILLI) >= price;
  }

  /** Waits for the Coins if it must, takes the time a person takes, and gives the command; what it bought is kept against the goal. */
  private buy(c: Rec): void {
    const price = this.priceOf(c);
    if (!this.affords(price)) this.run("coins", () => !this.affords(price));
    this.busy(this.secondsOf(c));
    this.give(c);
    if (price !== 0) this.coins.push({ tick: this.y.tick, what: "spent", coins: price });
    const read = F.readCommand({ tick: this.y.tick, ...c });
    if (this.current === null || !read) return;
    const got = this.bought.get(this.current) ?? new Map<string, number>();
    this.bought.set(this.current, got);
    const add = (what: string): void => void got.set(what, (got.get(what) ?? 0) + 1);
    if (read.do === "build") add(named(read.kind, read.grade));
    if (read.do === "lay") for (const leg of read.legs) add(named(leg.kind, leg.grade));
    if (read.do === "buyPlot") add(`plot ${F.plotName(read.plot)}`);
  }

  /** A person busy for some seconds, the yard running on meanwhile. Tending the yard on the way takes its own time, on top. */
  private busy(seconds: number): void {
    let to = this.y.tick + Math.round(seconds * 10);
    this.run(
      "build",
      () => this.y.tick < to,
      (tended) => {
        to += tended;
      },
    );
  }

  /**
   * Runs the yard on, a tick at a time, while `more` says; the person is `doing` meanwhile. Once a
   * minute the player tends the yard, and `tended` hears how many ticks that took.
   */
  private run(doing: Doing, more: () => boolean, tended?: (ticks: number) => void): void {
    const from = this.y.tick;
    while (more()) {
      if (this.y.tick - from > STUCK) {
        this.mark(doing);
        throw new Error(`stuck ${doing === "coins" ? "waiting for Coins" : "waiting"} for 12 hours`);
      }
      const was = this.y.tick;
      F.stepTo(this.y, was + 1);
      if (this.y.tick === was) throw new Error("the yard stood still: nobody had been by for too long");
      this.watch();
      if (!this.tending && this.y.tick >= this.nextTend) {
        this.mark(doing);
        const began = this.y.tick;
        this.tend();
        tended?.(this.y.tick - began);
      }
    }
    this.mark(doing);
  }

  /** Marks the ticks since the last mark as spent `doing`. */
  private mark(doing: Doing): void {
    const to = this.y.tick;
    if (to <= this.marked) return;
    const last = this.spans.at(-1);
    if (last && last.doing === doing && last.to === this.marked) last.to = to;
    else this.spans.push({ from: this.marked, to, doing });
    this.marked = to;
  }

  /** Once a minute: the till collected, filled orders handed over, an order nothing could fill swapped, the line of research kept full. */
  private tend(): void {
    this.tending = true;
    this.nextTend = (Math.floor(this.y.tick / MINUTE) + 1) * MINUTE;
    this.give({ do: "collect" });
    const depot = Math.floor((this.y.sold - this.sold) / F.MILLI);
    if (depot > 0) {
      this.coins.push({ tick: this.y.tick, what: "depot", coins: depot });
      this.sold += depot * F.MILLI;
    }
    // A copy: each order handed over takes its place on the board.
    for (const o of this.y.board.slice())
      if (F.counting(o, this.y.tick) && F.isFilled(o.want, o.filled)) {
        this.busy(this.s.hands.order);
        this.give({ do: "handOver", order: o.id });
        this.coins.push({ tick: this.y.tick, what: "order", coins: o.pay });
      }
    const slow = this.s.swap === null ? undefined : this.slowest(this.s.swap);
    if (slow && F.swapRefusal(this.y, slow.id) === null) {
      this.busy(this.s.hands.order);
      // The yard ran on while the person reached for it: an order that filled meanwhile is let be.
      if (F.swapRefusal(this.y, slow.id) === null) {
        this.give({ do: "swap", order: slow.id });
        this.swaps++;
      }
    }
    this.queue();
    this.tending = false;
  }

  /** The order on the board that would take longest to fill at what the standing lines bring the depot, if that is longer than `minutes`. */
  private slowest(minutes: number): F.Standing | undefined {
    const brings = this.depotLines();
    let worst: F.Standing | undefined;
    let most = minutes;
    for (const o of this.y.board) {
      if (F.isFilled(o.want, o.filled)) continue;
      let takes = 0;
      for (const k of F.ALL_ITEMS) {
        const left = (o.want[k] ?? 0) - (o.filled[k] ?? 0);
        if (left <= 0) continue;
        const pace = brings.reduce((sum, l) => sum + (l.item === k ? l.rate : 0), 0);
        takes = Math.max(takes, pace > 0 ? left / pace : Infinity);
      }
      if (takes > most) {
        worst = o;
        most = takes;
      }
    }
    return worst;
  }

  /** Puts research in the line, in its order, each as soon as it may be studied, until the line is full. */
  private queue(): void {
    const was = this.tending;
    this.tending = true;
    for (const id of this.s.research) {
      if (this.y.line.length >= F.LINE) break;
      if (F.studyRefusal(this.y, F.goal(id)) !== null) continue;
      this.busy(this.s.hands.read);
      this.give({ do: "study", research: id });
    }
    this.tending = was;
  }

  // ---------- what happened ----------

  /** The folios the research in the player's list of a tier or below still wants. */
  private folios(tier: number): number {
    let n = 0;
    for (const id of this.s.research) {
      const g = F.goal(id);
      const info = F.GOALS[g];
      if (!info || info.tier > tier || this.isDone(g)) continue;
      for (const f of F.FOLIOS) n += (info.want[f] ?? 0) - (this.y.got[g]?.[f] ?? 0);
    }
    return n;
  }

  private isDone(g: F.Goal): boolean {
    return this.y.open.done[g] === 1;
  }

  /** Notes goals done, research begun and tiers opened, as they happen. */
  private watch(): void {
    const y = this.y;
    while (this.seen < y.done.length) {
      const g = y.done[this.seen++];
      if (g === undefined) continue;
      const power = powerOf(y);
      const pay = F.GOALS[g]?.pay ?? 0;
      if (pay > 0) this.coins.push({ tick: y.tick, what: "goal", coins: pay });
      this.doneAt.set(g, {
        goal: g,
        came: this.cameAt.get(g) ?? y.tick,
        done: y.tick,
        pieces: piecesStanding(y),
        purse: this.purse + Math.floor(y.till / F.MILLI),
        power,
        bought: this.bought.get(g) ?? new Map(),
      });
    }
    const first = y.line[0];
    if (first !== undefined && !this.cameAt.has(first)) this.cameAt.set(first, y.tick);
    while (this.tierAt.length <= y.open.tier) {
      this.leftAt.push(this.folios(this.tierAt.length - 1));
      this.tierAt.push(y.tick);
    }
  }
}

const many = (n: F.Item): string => F.ITEM_INFO[n]?.many ?? "things";
/** A kind of piece as what was bought is listed: with its grade, above 1. */
const named = (k: F.Kind, g = 1): string => (g > 1 ? `${F.kindName(k)} ${g}` : F.kindName(k));

/** The yard's land the player owns, drawn a letter a tile: for saying where a line could not be laid. */
export function map(y: F.Yard): string {
  const K = "-GMBWSJUCPHFDYXR";
  const L: Record<string, string> = { deadfall: "d", stone: "s", ore: "o", clay: "c", sand: "a", resin: "r" };
  const owned = y.land.plots.filter((p) => y.plots.includes(p.plot));
  const x0 = Math.min(...owned.map((p) => p.x));
  const x1 = Math.max(...owned.map((p) => p.x + p.w));
  const y0 = Math.min(...owned.map((p) => p.y));
  const y1 = Math.max(...owned.map((p) => p.y + p.h));
  const lit = F.litOf(y);
  const rows: string[] = [];
  for (let z = y0; z < y1; z++) {
    let row = `${String(z).padStart(3)} `;
    for (let x = x0; x < x1; x++) {
      const i = F.at(y, x, z);
      const k = y.kind[i] ?? F.NONE;
      const dep = y.land.deposit[i] ?? F.NONE;
      if (k === F.BELT) row += ">v<^"[y.dir[i] ?? 0] ?? "?";
      else if (k !== F.NONE) row += K[k] ?? "?";
      else if (y.land.water[i] === 1) row += "~";
      else if (y.land.trunk[i] === 1) row += "T";
      else if (F.isItem(dep)) row += L[F.itemName(dep)] ?? "?";
      else row += lit[i] === 1 ? "." : " ";
    }
    rows.push(row);
  }
  return rows.join("\n");
}
