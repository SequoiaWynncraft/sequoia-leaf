/**
 * Working a line out on a copy of the yard, as a player does before building it: where each machine
 * stands, which side each of its parts comes in by, gatherers on the ground, belts laid by the
 * router, pylons until everything is lit, boilers and waterwheels until there is power enough, and
 * a plot bought when the land has too little of what a line needs, or no room for it.
 *
 * A goal's lines end in the depot. Once the splitter is unlocked, a machine's part is split off a
 * standing line of it into the depot where one has enough to spare: a splitter in a straight stretch
 * of that line's belt, its free side run to the machine, its other side shut, so that half of what
 * passes goes the new way while the machine takes it. Otherwise the part has a line of its own
 * straight into the machine, and failing that, a new line of it into the depot that is then split.
 *
 * Where that greedy placing runs out of room, the line is planned as a block (`block`): its last
 * machine where belts from free deposits of everything it needs are shortest, measured as a belt
 * goes (round what stands, under it by tunnel), each machine standing against the side of the one it
 * feeds and handing its things straight in, and only the gatherers' belts laid by the router. A
 * Study stands against the block's last machine; a line into the depot goes home by one belt, or
 * into a cart stop where one may stand.
 *
 * Every step is a command off the wire, played on the copy with the real rules. The commands are
 * kept line by line, for the player to give the real yard, paying for each as it goes; nothing
 * here spends Coins or time. A step that does not work is taken back by going back to a copy made
 * before it, and the next place is tried.
 */
import * as F from "../src/index.ts";
import { squared } from "../src/power.ts";
import { takes } from "../src/wire.ts";
import { capacity, gatherersOf, type Grades, one, size, type Unit } from "./needs.ts";

/** A command as it goes on the wire, without its tick. */
export type Rec = Record<string, unknown>;

/** A standing line, as a new one may join or split it. */
export interface Source {
  readonly item: F.Item;
  readonly rate: number;
  readonly into: Planned["into"];
  /** What splitters on its belt take off it already, a minute. */
  readonly tapped: number;
  /** Its belt into the depot, from its machine down. */
  readonly run: readonly number[];
  /** Tiles of that belt where another line's belt joins it: below them it carries more than its own thing. */
  readonly joinedAt: readonly number[];
}

/** A line worked out: what it makes and how fast, where it ends, and the commands that build it. */
export interface Planned {
  /** What it makes, and a minute, flat out; nothing for a line that gives power. */
  readonly item: F.Item | null;
  readonly rate: number;
  readonly into: "depot" | "study" | "power";
  readonly cmds: readonly Rec[];
  /** The lines it stands, in the order they were laid: those built for its parts, then itself. */
  readonly lines: readonly Source[];
  /** What it splits off lines: each one's place among the sources (those before it, then its own), and a minute. */
  readonly taps: readonly { readonly source: number; readonly rate: number }[];
  /** Tiles of lines' belts that its own belts join. */
  readonly joined: readonly number[];
  /** Tiles of pieces that stood before it that its belts and gatherers run onto: what it needs left standing. */
  readonly onto: readonly number[];
  /** Old lines it took up to make room (`Old.id`), and their places among the sources. */
  readonly taken: readonly number[];
  readonly gone: readonly number[];
}

/**
 * A line the player built for a goal now finished, that nothing still in use draws from: what may be
 * taken up when a line the player cannot do without will fit nowhere else. Its pieces but its pylons,
 * the belts of other lines it set splitters on (to be laid again), and its places among the sources.
 */
export interface Old {
  readonly id: number;
  readonly tiles: readonly number[];
  readonly restores: readonly Restore[];
  readonly sources: readonly number[];
}

/** A belt a splitter was set on, as it was, and the line it was a belt of (`Old.id`), if the player built it. */
export interface Restore {
  readonly tile: number;
  readonly dir: F.Dir;
  readonly grade: number;
  readonly owner: number;
}

/** Where a line's things go: a piece that takes them, and belts already leading into it that a feeder may join instead. */
interface Target {
  readonly tile: number;
  readonly joins: number[];
  /** For the depot: the thing that goes in, which may join a belt of its own kind anywhere. */
  readonly item?: F.Item;
}

/** Where a builder's copy stood, and how much it had worked out (`Builder.save`). */
export interface Mark {
  readonly y: F.Yard;
  readonly cmds: number;
  readonly taps: number;
  readonly joined: number;
  readonly onto: number;
  readonly sources: readonly Source[];
}

/** A mill in a planned block, and the gatherers it is to be fed by. */
interface Mill {
  readonly tile: number;
  readonly feed: Unit;
}

const DIRS: readonly F.Dir[] = [0, 1, 2, 3];
const BACK: readonly F.Dir[] = [2, 3, 0, 1];
/** The most places tried for one machine, and the most steps tried for one line, before it is given up. */
const SPOTS = 16;
const TRIES = 3000;
/** For a planned block: the most places tried for it, how far apart they stand, and the most steps tried in all. */
const SITES = 24;
const APART = 3;
const BLOCK_TRIES = 6000;
/** How far a belt would go to a tile it cannot reach; and what a block counts for a thing with no free ground in reach. */
const FAR = 1_000_000;
const NO_GROUND = 100;
/** What a tile old lines stood on counts for, against one tile of open ground, while a block keeps off them. */
const AVOID = 8;
/** What a tunnel costs a belt beyond the tiles it passes under, as the router counts it. */
const DIG = 4;

/** The power a yard gives with every boiler fed, and the power it draws, in whole powers. */
export function powerOf(y: F.Yard): { gives: number; draws: number } {
  const lit = F.litOf(y);
  let gives = y.open.depot;
  let draws = 0;
  for (let i = 0; i < y.kind.length; i++) {
    const k = y.kind[i] ?? F.NONE;
    if (lit[i] !== 1) continue;
    if (k === F.WHEEL && F.besideWater(y.land, i)) gives += F.GIVES[F.WHEEL] ?? 0;
    else if (k === F.BOILER) gives += F.GIVES[F.BOILER] ?? 0;
    else if (k === F.GATHERER || k === F.STUDY || F.isMaker(k))
      draws += ((F.DRAW[k] ?? 0) * (F.DRAWN[y.grade[i] ?? 0] ?? F.HALF)) / F.HALF;
  }
  return { gives, draws };
}

/** The pieces standing, a tunnel counted once, the depot not at all. */
export function piecesStanding(y: F.Yard): number {
  let n = 0;
  for (let i = 0; i < y.kind.length; i++) {
    const k = y.kind[i] ?? F.NONE;
    if (k !== F.NONE && k !== F.DEPOT && (y.span[i] ?? 0) >= 0) n++;
  }
  return n;
}

export class Builder {
  /** The copy everything is tried on. It is replaced whole when a step is taken back. */
  y: F.Yard;
  /** What went wrong last, for saying why a line could not be laid, and the copy as it stood when the line was given up. */
  why = "";
  gaveUp: F.Yard | null = null;
  /** Every reason a step was given up, when set: for finding out why a line will not fit. */
  trace: string[] | null = null;
  private readonly cmds: Rec[] = [];
  private readonly taps: { source: number; rate: number }[] = [];
  private readonly joined: number[] = [];
  private readonly onto: number[] = [];
  private readonly old: readonly Old[];
  private readonly grades: Grades;
  /** The lines standing, and those laid on the copy since, in order. */
  private readonly sources: Source[];
  /** The tiles beside the depot, kept for belts going in, and the depot's own. */
  private readonly ring = new Set<number>();
  private readonly depotTiles: number[] = [];
  private tries = 0;
  /** Whether belts may cross ground a gatherer could use: only once a line will not fit otherwise. */
  private loose = false;
  /** Whether a block is being planned: deposits and ways out are then chosen by how far a belt would go. */
  private planning = false;
  /** Ground old lines stood on, while a block is worked out with them taken up: kept off where it can be, so that as few go as may. */
  private avoid: ReadonlySet<number> | null = null;
  /** How far a belt would go to things, worked out for the copy as it stands (`walk`), and how many changes the copy has had. */
  private readonly fields = new Map<string, Int32Array>();
  private fieldsOf: { y: F.Yard; ver: number } | null = null;
  private ver = 0;
  /**
   * Parts that a new line into the depot could not be laid for, in this pass at a line. A machine
   * tried in another place usually meets the same ground, so it is not tried again for that part
   * until the next pass (with belts let across deposits, or after a plot is bought).
   */
  private readonly hopeless = new Set<string>();

  constructor(real: F.Yard, grades: Grades, sources: readonly Source[], old: readonly Old[] = []) {
    this.y = structuredClone(real);
    this.y.wire = null;
    this.grades = grades;
    this.sources = [...sources];
    this.old = old;
    for (let i = 0; i < this.y.kind.length; i++) {
      if (this.y.kind[i] !== F.DEPOT) continue;
      this.depotTiles.push(i);
      for (const d of DIRS) {
        const j = this.step(i, d);
        if (j >= 0 && this.y.kind[j] !== F.DEPOT) this.ring.add(j);
      }
    }
  }

  /** Where the copy stands, to come back to (`back`) if the lines worked out after it are not wanted. */
  save(): Mark {
    return {
      y: structuredClone(this.y),
      cmds: this.cmds.length,
      taps: this.taps.length,
      joined: this.joined.length,
      onto: this.onto.length,
      sources: [...this.sources],
    };
  }

  /** Comes back to where the copy stood when it was saved. */
  back(m: Mark): void {
    this.y = structuredClone(m.y);
    this.ver++;
    this.cmds.length = m.cmds;
    this.taps.length = m.taps;
    this.joined.length = m.joined;
    this.onto.length = m.onto;
    this.sources.length = 0;
    this.sources.push(...m.sources);
  }

  /** The most steps tried for a line: more for a planned block. */
  private get most(): number {
    return this.planning ? BLOCK_TRIES : TRIES;
  }

  /** The steps tried for the last line worked out. */
  get tried(): number {
    return this.tries;
  }

  // ---------- lines ----------

  /**
   * A line that makes a unit's thing into the depot, or nothing if no way can be found; with `clear`,
   * old lines may be taken up to make room for it, when nothing else will do.
   */
  depotLine(u: Unit, clear = false): Planned | null {
    return this.planned(
      u.item,
      "depot",
      u,
      () => {
        const k = this.hub(u);
        return k < 0 ? -1 : (this.sources[k]?.rate ?? -1);
      },
      () => this.blockHome(u),
      clear,
    );
  }

  /** A Study, and a line that makes a unit's folio into it; with `clear`, as `depotLine` says. */
  studyLine(u: Unit, clear = false): Planned | null {
    return this.planned(
      u.item,
      "study",
      u,
      () => this.study(u),
      () => this.blockStudy(u),
      clear,
    );
  }

  /**
   * A line of a unit's thing into the depot, laid as part of whatever is being tried, and kept among
   * the sources so that what needs it may split it. Says its place among them, or -1.
   */
  private hub(u: Unit): number {
    const t: Target = { tile: this.depotTile(), joins: this.joinable(u.item), item: u.item };
    const theirs = new Set(t.joins);
    const rate = this.make(u, t);
    if (rate < 0) return -1;
    const run = t.joins.filter((j) => !theirs.has(j));
    this.sources.push({ item: u.item, rate, into: "depot", tapped: 0, run, joinedAt: [] });
    return this.sources.length - 1;
  }

  /** Where on a line's belt the last splitter stands, and the first tile another line joins it, as places along the belt. */
  private marks(line: Source): { split: number; join: number } {
    const joins = line.run.findIndex((t) => line.joinedAt.includes(t) || this.joined.includes(t));
    return {
      split: line.run.findLastIndex((t) => this.y.kind[t] === F.SPLITTER),
      join: joins < 0 ? line.run.length : joins,
    };
  }

  /**
   * Belts into the depot a new line of a thing may join when it cannot reach the depot itself: one
   * of the same thing anywhere, as more of what it carries; another below every splitter on it, as
   * joined above a splitter it would send its things down the split.
   */
  private joinable(item: F.Item): number[] {
    const out: number[] = [];
    for (const line of this.sources)
      if (line.into === "depot")
        out.push(...(line.item === item ? line.run : line.run.slice(this.marks(line).split + 1)));
    return out;
  }

  /** Boilers and waterwheels until they give `short` more power, a line each; fewer if the yard has neither yet. */
  power(short: number): Planned[] {
    const out: Planned[] = [];
    let left = short;
    for (let n = 0; n < 16 && left > 0; n++) {
      const wheels = F.highest(this.y.open, F.WHEEL) > 0;
      const boilers = F.highest(this.y.open, F.BOILER) > 0;
      const wheelFirst = wheels && (left <= (F.GIVES[F.WHEEL] ?? 0) || !boilers);
      // Where the one it would rather have will not fit, the other.
      const wheel = wheelFirst ? this.wheelLine() : null;
      const boiler = wheel === null && boilers ? this.boilerLine() : null;
      const late = wheel === null && boiler === null && wheels && !wheelFirst ? this.wheelLine() : null;
      const line = wheel ?? boiler ?? late;
      if (!line) break;
      out.push(line);
      left -= line === boiler ? (F.GIVES[F.BOILER] ?? 0) - (F.DRAW[F.GATHERER] ?? 0) : (F.GIVES[F.WHEEL] ?? 0);
    }
    return out;
  }

  /**
   * Works a line out from where the commands so far leave the copy, and says what it makes a minute
   * flat out. Belts are kept off deposits; if the line will not fit so, they may cross them; if it
   * still will not, it is planned as a block (`block`, where one is given); if that will not fit
   * either, a plot is bought: the cheapest for sale that holds what the land has too little of, else
   * one that holds something the line gathers, else any. Then it is tried again.
   */
  private planned(
    item: F.Item | null,
    into: Planned["into"],
    u: Unit | null,
    build: () => number,
    block?: () => number,
    clear = false,
  ): Planned | null {
    const start = {
      cmds: this.cmds.length,
      taps: this.taps.length,
      joined: this.joined.length,
      onto: this.onto.length,
    };
    const lines = this.sources.length;
    const before = structuredClone(this.y);
    const raws = u ? [...gatherersOf(u).keys()] : [F.DEADFALL];
    const none = (): null => {
      // Nothing of a line that could not be laid stays, not even the plots bought for it.
      this.gaveUp = this.y;
      this.y = before;
      this.cmds.length = start.cmds;
      this.taps.length = start.taps;
      this.joined.length = start.joined;
      this.onto.length = start.onto;
      this.sources.length = lines;
      return null;
    };
    const done = (rate: number, taken: readonly Old[] = []): Planned => ({
      item,
      rate,
      into,
      cmds: this.cmds.slice(start.cmds),
      lines: this.sources.slice(lines),
      taps: this.taps.slice(start.taps),
      joined: this.joined.slice(start.joined),
      onto: this.onto.slice(start.onto),
      taken: taken.map((o) => o.id),
      gone: taken.flatMap((o) => o.sources),
    });
    const passes = [
      { loose: false, planning: false, lay: build },
      { loose: true, planning: false, lay: build },
      ...(block ? [{ loose: true, planning: true, lay: block }] : []),
    ];
    for (let round = 0; round < 4; round++) {
      for (const { loose, planning, lay } of passes) {
        this.tries = 0;
        this.loose = loose;
        this.planning = planning;
        this.hopeless.clear();
        let rate = -1;
        const built = this.attempt(() => (rate = lay()) >= 0);
        this.loose = false;
        this.planning = false;
        if (built) return done(rate);
      }
      const short = u ? this.shortOfGround(u) : null;
      const bought = (short !== null && this.buyPlot([short])) || this.buyPlot(raws) || this.buyPlot([]);
      if (!bought) {
        if (short !== null) this.why = `${this.why}; the land the yard can buy has no free ${F.itemName(short)}`;
        break;
      }
    }
    const cleared = clear && block ? this.clearing(block) : null;
    return cleared ? done(cleared.rate, cleared.taken) : none();
  }

  /**
   * A block laid where old lines stood, as a player clears ground it needs. It is worked out first
   * on the copy with every old line taken up (`old`), keeping off their ground where it can: that
   * says where it would go, and which old lines stand in its way. Those are then taken up one at a
   * time, nearest that place first, and the block tried again with the rest still standing to be
   * split; failing that, all of them go, and the block is laid as it was worked out. A belt of
   * another line that one of them had set a splitter on is laid again. What it makes a minute and
   * the lines it took up, or nothing. Whatever was worked out before it (a plot bought for the line)
   * stays.
   */
  private clearing(lay: () => number): { rate: number; taken: Old[] } | null {
    if (this.old.length === 0) return null;
    const mark = this.save();
    const back = (): null => {
      this.back(mark);
      return null;
    };
    const takeUp = (taken: readonly Old[], keep: boolean): boolean => {
      const going = new Set(taken.map((o) => o.id));
      for (const o of taken) {
        const tiles = o.tiles.filter((i) => this.y.kind[i] !== F.NONE);
        const c = { do: "clear", tiles };
        if (tiles.length > 0 && !(keep ? this.cmd(c) : this.quiet(c))) return false;
        for (const s of o.sources) {
          const line = this.sources[s];
          if (line) this.sources[s] = { ...line, rate: 0, tapped: 0, run: [], joinedAt: [] };
        }
      }
      // A belt one of them had set a splitter on is laid again, unless it was a belt of one going too.
      for (const o of taken)
        for (const r of o.restores) {
          if (going.has(r.owner) || this.y.kind[r.tile] !== F.NONE) continue;
          const c = {
            do: "build",
            kind: "belt",
            ...this.at(r.tile),
            dir: r.dir,
            ...(r.grade > 1 ? { grade: r.grade } : {}),
          };
          if (!(keep ? this.cmd(c) : this.quiet(c))) return false;
        }
      return true;
    };
    if (!takeUp(this.old, false)) return back();
    this.tries = 0;
    this.loose = true;
    this.planning = true;
    this.avoid = new Set(this.old.flatMap((o) => o.tiles));
    this.ver++;
    let rate = -1;
    const laid = this.attempt(() => (rate = lay()) >= 0);
    this.loose = false;
    this.planning = false;
    this.avoid = null;
    this.ver++;
    if (!laid) return back();
    const plan = {
      cmds: this.cmds.slice(mark.cmds),
      taps: this.taps.slice(mark.taps),
      joined: this.joined.slice(mark.joined),
      onto: this.onto.slice(mark.onto),
      sources: this.sources.slice(mark.sources.length),
    };
    const used = new Set(plan.cmds.flatMap((c) => this.tilesOf(c)));
    const there =
      this.tilesOf(plan.cmds.find((c) => c.do === "build" && c.kind !== "pylon") ?? {})[0] ?? this.depotTile();
    const nearest = (o: Old): number => Math.min(FAR, ...o.tiles.map((i) => this.dist(i, there)));
    const taken = this.old
      .filter((o) => o.tiles.some((i) => used.has(i)) || o.restores.some((r) => used.has(r.tile)))
      .toSorted((a, b) => nearest(a) - nearest(b) || a.id - b.id);
    for (let k = 1; k < taken.length; k++) {
      back();
      const some = taken.slice(0, k);
      if (!takeUp(some, true)) continue;
      this.tries = 0;
      this.loose = true;
      this.planning = true;
      let fewer = -1;
      const fits = this.attempt(() => (fewer = lay()) >= 0);
      this.loose = false;
      this.planning = false;
      if (fits) return { rate: fewer, taken: some };
    }
    back();
    if (!takeUp(taken, true)) return back();
    for (const c of plan.cmds) if (!this.cmd(c)) return back();
    this.taps.push(...plan.taps);
    this.joined.push(...plan.joined);
    this.onto.push(...plan.onto);
    this.sources.push(...plan.sources);
    return { rate, taken };
  }

  /** The tiles a command sets pieces down on. */
  private tilesOf(c: Rec): number[] {
    const read = F.readCommand({ tick: this.y.tick, ...c });
    if (!read) return [];
    if (read.do === "build") return [F.at(this.y, read.x, read.y)];
    if (read.do === "lay")
      return read.legs.flatMap((l) => {
        const i = F.at(this.y, l.x, l.y);
        const far = F.legSpan(l) + 1;
        return l.tunnel ? [i, F.at(this.y, l.x + (F.DX[l.dir] ?? 0) * far, l.y + (F.DY[l.dir] ?? 0) * far)] : [i];
      });
    return [];
  }

  // ---------- making things ----------

  /** Stands a unit, every piece handing into `t`, and says what it makes a minute flat out; less than nothing if it could not. */
  private make(u: Unit, t: Target): number {
    if (u.kind === F.GATHERER) return this.gather(u.item, u.count, u.grade, t);
    let made = 0;
    for (let c = 0; c < u.count; c++) {
      const each = this.machine(u, t);
      if (each < 0) return -1;
      made += each;
    }
    return made;
  }

  /**
   * What feeds a side of a machine: a part split off a line of it into the depot, if one has enough
   * to spare; else a line of its own straight in, which takes none of the depot's sides; else a line
   * of it built into the depot, twice what is needed so that half is enough, and split. Gatherers,
   * and everything before the splitter is unlocked, come straight in.
   */
  private feed(part: Unit, t: Target): number {
    if (part.kind === F.GATHERER || F.highest(this.y.open, F.SPLITTER) === 0) return this.make(part, t);
    const split = this.tap(part, t);
    if (split >= 0) return split;
    let got = -1;
    if (this.attempt(() => (got = this.make(part, t)) >= 0)) return got;
    const hub = `hub ${part.item}`;
    if (this.hopeless.has(hub)) return -1;
    const twice = size(part.item, 2 * part.perMinute, this.grades);
    if (this.attempt(() => this.hub(twice) >= 0 && (got = this.tap(part, t)) >= 0)) return got;
    this.hopeless.add(hub);
    return -1;
  }

  /** One machine of a unit, tried in its likeliest places: its way out toward `t`, a short belt into each other side it takes a part by. */
  private machine(u: Unit, t: Target): number {
    const recipe = F.RECIPE[u.item];
    if (!recipe) return -1;
    const inputs = u.kind === F.MILL ? 0 : recipe.from.length;
    const spots = this.spotsFor(u, t);
    if (spots.length === 0) return this.no(`no ground for a ${F.kindName(u.kind)} making ${F.itemName(u.item)}`);
    let tried = 0;
    for (const m of spots) {
      if (tried >= SPOTS || this.tries > this.most) return -1;
      const ways = DIRS.toSorted((a, b) => this.dist(this.step(m, a), t.tile) - this.dist(this.step(m, b), t.tile));
      for (const o of ways) {
        const out = this.step(m, o);
        if (!this.free(out) || !this.opens(out, m)) continue;
        const sides = DIRS.filter((s) => s !== o && this.stubOk(this.step(m, s), s));
        if (sides.length < inputs) continue;
        tried++;
        let made = -1;
        if (this.attempt(() => (made = this.machineAt(u, m, o, sides.slice(0, inputs), t)) >= 0)) return made;
      }
    }
    return -1;
  }

  /**
   * A machine on `m` facing `o`, a belt on each side in `stubs` pointing into it, its things run to
   * `t`, and then its parts, each into its own side. Says what it makes a minute: its own pace, or
   * what its parts let it, whichever is less.
   */
  private machineAt(u: Unit, m: number, o: F.Dir, stubs: readonly F.Dir[], t: Target): number {
    const out = this.step(m, o);
    const tiles = stubs.map((s) => this.step(m, s));
    const recipe = F.RECIPE[u.item];
    if (!recipe || !this.light(m, new Set([m, out, ...tiles]))) return -1;
    if (!this.put(F.kindName(u.kind), m, o, u.grade)) return -1;
    if (u.kind !== F.MILL && !this.cmd({ do: "recipe", ...this.at(m), item: F.itemName(u.item) })) return -1;
    for (const [k, s] of stubs.entries())
      if (!this.put("belt", tiles[k] ?? -1, BACK[s] ?? 0, this.grades(F.BELT))) return -1;
    const run = this.routeTo(out, t, t.tile === this.depotTile());
    if (!run) return this.no(`no way out of a ${F.kindName(u.kind)} making ${F.itemName(u.item)} at ${this.where(m)}`);
    let made = one(u);
    if (u.kind === F.MILL) {
      const part = u.parts[0];
      const fed = part ? this.make(part, { tile: m, joins: [] }) : -1;
      if (fed < 0) return -1;
      made = Math.min(made, fed / (recipe.need[0] ?? 1));
    } else {
      // Each part comes in by the side nearest the ground it is made from.
      const free = [...tiles];
      for (const [k, part] of u.parts.entries()) {
        const from = this.lies(part.item, m);
        const side = free.toSorted((a, b) => this.far(a, from) - this.far(b, from))[0];
        if (side === undefined) return -1;
        free.splice(free.indexOf(side), 1);
        const fed = this.feed(part, { tile: side, joins: [] });
        if (fed < 0) return -1;
        made = Math.min(made, fed / (recipe.need[k] ?? 1));
      }
    }
    t.joins.push(...run);
    return made;
  }

  /**
   * Splits what a part needs off a standing line of it into `t`, if half of what the line has left
   * is enough: a splitter on a straight stretch of its belt that nothing feeds from the side, its
   * free side run to `t`, its other side shut. Says what the new way brings a minute: half of what
   * the line has left.
   */
  private tap(part: Unit, t: Target): number {
    if (F.highest(this.y.open, F.SPLITTER) === 0) return -1;
    const y = this.y;
    const spots: { s: number; b: number; give: number }[] = [];
    for (const [s, line] of this.sources.entries()) {
      if (line.into !== "depot" || line.item !== part.item) continue;
      const taken = this.taps.reduce((sum, p) => sum + (p.source === s ? p.rate : 0), line.tapped);
      const give = (line.rate - taken) / 2;
      if (give < part.perMinute) continue;
      // Above where a line of another thing joins it, below which it carries that line's things too.
      // Below a splitter already there it takes half of what that one leaves, as it is booked; above
      // one, half of all that passes, and the one below gets less than it was booked for.
      const { join } = this.marks(line);
      for (const b of line.run.slice(0, join)) if (this.straight(b)) spots.push({ s, b, give });
    }
    spots.sort((a, c) => this.dist(a.b, t.tile) - this.dist(c.b, t.tile) || a.b - c.b);
    for (const { s, b, give } of spots.slice(0, 12)) {
      const d = DIRS[y.dir[b] ?? 0] ?? 0;
      for (const way of [1, 2] as const) {
        const side = this.step(b, way === 1 ? d + 3 : d + 1);
        if (!this.free(side)) continue;
        const ok = this.attempt(() => {
          if (!this.put("splitter", b, d)) return false;
          if (!this.cmd({ do: "way", ...this.at(b), way: 3 - way, open: false })) return false;
          const run = this.routeTo(side, t, false);
          if (!run) return false;
          this.taps.push({ source: s, rate: give });
          return true;
        });
        if (ok) return give;
      }
    }
    return this.no(`no split of ${F.itemName(part.item)} into ${this.where(t.tile)} (${spots.length} places)`);
  }

  /** Whether a belt is fed only from behind, by the piece there handing it on: where a splitter can take its place. */
  private straight(b: number): boolean {
    const y = this.y;
    if (y.kind[b] !== F.BELT) return false;
    const d = y.dir[b] ?? 0;
    const behind = this.step(b, d + 2);
    const hands = F.nextOf(y, behind) === b || (y.kind[behind] === F.SPLITTER && F.wayOut(y, behind, 0) === b);
    if (behind < 0 || !hands) return false;
    for (const s of [d + 1, d + 3]) {
      const j = this.step(b, s);
      if (j >= 0 && (F.nextOf(y, j) === b || y.kind[j] === F.SPLITTER || y.kind[j] === F.GATHERER)) return false;
    }
    return true;
  }

  /**
   * Where a machine might stand, likeliest first: a mill beside the ground its gatherers take from,
   * nearest to where its things go; a bench or workshop on open ground, taking in turn the places
   * nearest to half way from where its things go to where its parts are gathered, nearest to where
   * each of its parts is gathered, and nearest to where its things go.
   */
  private spotsFor(u: Unit, t: Target): number[] {
    const y = this.y;
    if (u.kind === F.MILL) {
      const out: { i: number; score: number }[] = [];
      const raw = u.parts[0]?.item ?? F.DEADFALL;
      const ground = this.deposits(raw, t.tile).slice(0, 40);
      for (let i = 0; i < y.kind.length; i++) {
        if (!this.plain(i)) continue;
        let near = Infinity;
        for (const g of ground) near = Math.min(near, this.dist(i, g));
        if (near > 3) continue;
        out.push({ i, score: this.dist(i, t.tile) + 4 * (near - 1) });
      }
      return out.toSorted((a, b) => a.score - b.score || a.i - b.i).map((s) => s.i);
    }
    const lies = this.lies(u.item, t.tile);
    const [tx, ty] = this.xy(t.tile);
    const anchors: [number, number][] = [
      [(tx + lies[0]) / 2, (ty + lies[1]) / 2],
      ...u.parts.map((p) => this.lies(p.item, t.tile)),
      [tx, ty],
    ];
    const room: number[] = [];
    for (let i = 0; i < y.kind.length; i++) if (this.plain(i) && this.roomy(i)) room.push(i);
    const lists = anchors.map((a) => room.toSorted((p, q) => this.far(p, a) - this.far(q, a) || p - q));
    const out: number[] = [];
    const seen = new Set<number>();
    for (let k = 0; k < room.length; k++)
      for (const list of lists) {
        const i = list[k];
        if (i !== undefined && !seen.has(i)) {
          seen.add(i);
          out.push(i);
        }
      }
    return out;
  }

  /** Gatherers on the ground nearest `t`, each straight into it or onto a belt of the line, or by a short run of its own; what they gather a minute. */
  private gather(raw: F.Item, n: number, grade: number, t: Target): number {
    let placed = 0;
    for (const g of this.deposits(raw, t.tile, t)) {
      if (placed >= n || this.tries > this.most) break;
      if (this.free(g) && this.attempt(() => this.gatherer(g, grade, t))) placed++;
    }
    if (placed < n) return this.no(`${placed} of ${n} gatherers of ${F.itemName(raw)} into ${this.where(t.tile)}`);
    return placed * F.makes(F.GATHERER, grade, null);
  }

  private gatherer(g: number, grade: number, t: Target): boolean {
    if (!this.light(g, new Set([g]))) return false;
    for (const d of DIRS) {
      const j = this.step(g, d);
      if (j >= 0 && (j === t.tile || t.joins.includes(j)) && takes(this.y, j, g)) {
        this.onto.push(j);
        return this.put("gatherer", g, d, grade);
      }
    }
    const onGround = (d: F.Dir): number => (this.y.land.deposit[this.step(g, d)] === F.NONE ? 0 : 1);
    const outs = DIRS.filter((d) => this.free(this.step(g, d))).toSorted(
      (a, b) => onGround(a) - onGround(b) || this.near(this.step(g, a), t) - this.near(this.step(g, b), t),
    );
    for (const d of outs)
      if (
        this.attempt(() => {
          if (!this.put("gatherer", g, d, grade)) return false;
          const run = this.routeTo(this.step(g, d), t, false);
          if (!run) return false;
          t.joins.push(...run);
          return true;
        })
      )
        return true;
    return false;
  }

  /** A Study on open ground, and the unit's folio line into it; what that line makes a minute. */
  private study(u: Unit): number {
    const lies = this.lies(u.item, this.depotTile());
    const [dx, dy] = this.xy(this.depotTile());
    const toward: [number, number] = [(dx + lies[0]) / 2, (dy + lies[1]) / 2];
    const spots: number[] = [];
    for (let i = 0; i < this.y.kind.length; i++) if (this.plain(i) && this.roomy(i)) spots.push(i);
    spots.sort((a, b) => this.far(a, toward) - this.far(b, toward) || a - b);
    for (const s of spots.slice(0, SPOTS)) {
      let made = -1;
      const ok = this.attempt(() => {
        if (!this.light(s, new Set([s])) || !this.put("study", s, 0, this.grades(F.STUDY))) return false;
        made = this.make(u, { tile: s, joins: [] });
        if (made < 0) return false;
        this.sources.push({ item: u.item, rate: made, into: "study", tapped: 0, run: [], joinedAt: [] });
        return true;
      });
      if (ok) return made;
    }
    return -1;
  }

  // ---------- planned blocks ----------

  /**
   * A Study, and a block making a unit's folio into it: the Study where belts from free deposits of
   * what the block gathers are shortest, and the block's last machine against one of its sides (each
   * of them, if the unit has more than one, against a side of its own).
   */
  private blockStudy(u: Unit): number {
    const single: Unit = { ...u, count: 1 };
    for (const s of this.sites(single, null)) {
      if (this.tries > BLOCK_TRIES) break;
      let made = 0;
      const ok = this.attempt(() => {
        const around = DIRS.map((d) => this.step(s, d));
        if (!this.light(s, new Set([s, ...around])) || !this.put("study", s, 0, this.grades(F.STUDY))) return false;
        for (let c = 0; c < u.count; c++) {
          const sides = DIRS.filter((d) => this.plain(this.step(s, d))).toSorted(
            (a, b) => this.rawsAway(single, this.step(s, a)) - this.rawsAway(single, this.step(s, b)),
          );
          if (!sides.some((d) => this.attempt(() => this.block(single, this.step(s, d), BACK[d] ?? 0)))) return false;
          made += capacity(single);
        }
        this.sources.push({ item: u.item, rate: made, into: "study", tapped: 0, run: [], joinedAt: [] });
        return true;
      });
      if (ok) return made;
    }
    return this.no(`no block of ${F.itemName(u.item)} fitted beside a Study`);
  }

  /**
   * A block making a unit's thing into the depot, for each of its machines: the machine where belts
   * from free deposits of what it gathers, and its belt home, are shortest; its belt home laid first,
   * into the depot, onto a belt into it that may be joined, or to a cart stop; or, failing that, a
   * cart stop set against it, where one more may stand. Then everything below it.
   */
  private blockHome(u: Unit): number {
    const single: Unit = { ...u, count: 1 };
    let made = 0;
    for (let c = 0; c < u.count; c++) {
      const stops: number[] = [];
      for (let i = 0; i < this.y.kind.length; i++) if (this.y.kind[i] === F.STOP) stops.push(i);
      const t: Target = { tile: this.depotTile(), joins: [...this.joinable(u.item), ...stops], item: u.item };
      let run: number[] | null = null;
      for (const p of this.sites(single, t)) {
        if (run || this.tries > BLOCK_TRIES) break;
        const ways = DIRS.filter((o) => this.free(this.step(p, o))).toSorted(
          (a, b) => this.near(this.step(p, a), t) - this.near(this.step(p, b), t),
        );
        for (const o of ways) {
          const out = this.step(p, o);
          const ok = this.attempt(() => {
            if (!this.machineOn(single, p, o)) return false;
            const home = this.routeTo(out, t, true);
            if (!home && !this.put("stop", out, 0)) return false;
            run = home ?? [];
            return this.parts(single, p, o);
          });
          if (ok) break;
          run = null;
        }
      }
      if (!run) return this.no(`no block of ${F.itemName(u.item)} fitted with a way home`);
      this.sources.push({ item: u.item, rate: capacity(single), into: "depot", tapped: 0, run, joinedAt: [] });
      made += capacity(single);
    }
    return made;
  }

  /** A block on `p` facing `o`: its machine, everything below it, and the gatherers of every mill in it. */
  private block(u: Unit, p: number, o: F.Dir): boolean {
    return this.machineOn(u, p, o) && this.parts(u, p, o);
  }

  /** Everything below a machine standing on `p` facing `o`: the machines that feed it, then the gatherers of every mill among them (itself too). */
  private parts(u: Unit, p: number, o: F.Dir): boolean {
    const mills: Mill[] = [];
    if (!this.below(u, p, o, mills)) return false;
    return mills.every(({ tile, feed }) => this.gather(feed.item, feed.count, feed.grade, { tile, joins: [] }) >= 0);
  }

  /** One machine of a unit on `p`, facing `o`: lit, with no pylon beside it, and set to make its thing. */
  private machineOn(u: Unit, p: number, o: F.Dir): boolean {
    if (!this.plain(p)) return false;
    if (!this.light(p, new Set([p, ...DIRS.map((d) => this.step(p, d))]))) return false;
    if (!this.put(F.kindName(u.kind), p, o, u.grade)) return false;
    return u.kind === F.MILL || this.cmd({ do: "recipe", ...this.at(p), item: F.itemName(u.item) });
  }

  /**
   * The machines feeding one on `p` facing `o`, each against the side its part comes in by and
   * handing its things straight in, and theirs in turn; a mill is noted for its gatherers instead.
   * The sides are tried as `assign` orders them.
   */
  private below(u: Unit, p: number, o: F.Dir, mills: Mill[]): boolean {
    if (u.kind === F.MILL) {
      const feed = u.parts[0];
      if (feed) mills.push({ tile: p, feed });
      return feed !== undefined;
    }
    for (const ways of this.assign(u.parts, p, o)) {
      if (this.tries > BLOCK_TRIES) return false;
      const had = mills.length;
      if (this.attempt(() => u.parts.every((part, k) => this.feeder(part, p, ways[k] ?? 0, mills)))) return true;
      mills.length = had;
    }
    return false;
  }

  /**
   * A part of the machine on `p`, coming in by its side `s`: split off a standing line of it into the
   * depot that has enough to spare, by a belt into that side, as a line laid greedily is fed, since
   * ground with ore on it runs out before what is gathered there does; else one machine against that
   * side; more than one, either side of a short belt into it.
   */
  private feeder(part: Unit, p: number, s: F.Dir, mills: Mill[]): boolean {
    const single: Unit = { ...part, count: 1 };
    const back = BACK[s] ?? 0;
    const stub = this.step(p, s);
    const split = (): boolean =>
      this.plain(stub) &&
      this.put("belt", stub, back, this.grades(F.BELT)) &&
      this.tap(part, { tile: stub, joins: [] }) >= 0;
    if (this.attempt(split)) return true;
    if (part.count === 1) {
      const q = this.step(p, s);
      return this.machineOn(single, q, back) && this.below(single, q, back, mills);
    }
    const belts: number[] = [];
    for (let b = this.step(p, s), k = 0; k < Math.ceil(part.count / 2); k++, b = this.step(b, s)) {
      if (!this.plain(b) || !this.put("belt", b, back, this.grades(F.BELT))) return false;
      belts.push(b);
    }
    let placed = 0;
    for (const b of belts)
      for (const side of [s + 1, s + 3]) {
        if (placed === part.count) break;
        const q = this.step(b, side);
        const face = BACK[side % 4] ?? 0;
        if (!this.machineOn(single, q, face) || !this.below(single, q, face, mills)) return false;
        placed++;
      }
    return placed === part.count;
  }

  /** The ways a machine's parts may come in by its sides other than `o`, likeliest first: each part by a side nearest the ground it is made from. */
  private assign(parts: readonly Unit[], p: number, o: F.Dir): F.Dir[][] {
    const sides = DIRS.filter((s) => s !== o && this.plain(this.step(p, s)));
    const out: { ways: F.Dir[]; score: number }[] = [];
    const pick = (used: F.Dir[]): void => {
      const part = parts[used.length];
      if (!part) {
        const score = used.reduce<number>((sum, s, k) => sum + this.rawsAway(parts[k] ?? part, this.step(p, s)), 0);
        out.push({ ways: [...used], score });
        return;
      }
      for (const s of sides)
        if (!used.includes(s)) {
          used.push(s);
          pick(used);
          used.pop();
        }
    };
    pick([]);
    return out.toSorted((a, b) => a.score - b.score).map((w) => w.ways);
  }

  /**
   * How far belts would go from a tile to free deposits of everything a unit's mills take: one belt
   * for each mill, and no further than `NO_GROUND` for a thing with no free ground in reach, which
   * may yet be split off a standing line.
   */
  private rawsAway(u: Unit | undefined, i: number): number {
    if (!u) return 0;
    if (u.kind === F.GATHERER) return Math.min(NO_GROUND, this.toRaw(i, u.item));
    let n = 0;
    for (let c = 0; c < u.count; c++) for (const part of u.parts) n += this.partAway(part, i);
    return n;
  }

  /** How far a part of a block is from a tile: to a standing line of it that may be split for it, or to the ground it is made from, whichever is nearer. */
  private partAway(part: Unit, i: number): number {
    const made = this.rawsAway(part, i);
    if (part.kind === F.GATHERER || F.highest(this.y.open, F.SPLITTER) === 0) return made;
    const runs: number[] = [];
    for (const [s, line] of this.sources.entries()) {
      if (line.into !== "depot" || line.item !== part.item) continue;
      const taken = this.taps.reduce((sum, t) => sum + (t.source === s ? t.rate : 0), line.tapped);
      if ((line.rate - taken) / 2 >= part.perMinute) runs.push(...line.run);
    }
    if (runs.length === 0) return made;
    const split = this.walk(`split ${part.item}: ${runs.join(",")}`, runs)[i] ?? FAR;
    return Math.min(made, split);
  }

  /**
   * Where a block might stand, likeliest first: plain ground with room round it, where belts to free
   * deposits of what it gathers (and, for a line into `t`, its belt home) are shortest; none within
   * `APART` of a likelier one, as a place beside one that will not do seldom does.
   */
  private sites(u: Unit, t: Target | null): number[] {
    const scored: { i: number; score: number }[] = [];
    for (let i = 0; i < this.y.kind.length; i++) {
      if (!this.plain(i) || !this.roomy(i)) continue;
      const score = this.rawsAway(u, i) + (t ? this.near(i, t) : 0) + AVOID * this.oldAround(i);
      if (score < FAR) scored.push({ i, score });
    }
    scored.sort((a, b) => a.score - b.score || a.i - b.i);
    const out: number[] = [];
    for (const { i } of scored) {
      if (out.length >= SITES) break;
      if (out.every((j) => this.dist(i, j) >= APART)) out.push(i);
    }
    return out;
  }

  /** How many tiles old lines stood on are within two of a tile, while they are kept off (`avoid`). */
  private oldAround(i: number): number {
    const avoid = this.avoid;
    if (!avoid) return 0;
    const [x, z] = this.xy(i);
    let n = 0;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (avoid.has(F.at(this.y, x + dx, z + dz))) n++;
    return n;
  }

  // ---------- how far a belt would go ----------

  /** How far a tile is from where a line's things go: as the crow flies, or, planning a block, as a belt would go there or onto a belt it may join. */
  private near(a: number, t: Target): number {
    if (!this.planning) return this.dist(a, t.tile);
    if (a < 0) return FAR;
    const ends = this.y.kind[t.tile] === F.DEPOT ? this.depotTiles : [t.tile];
    return this.walk(`to ${t.tile}: ${t.joins.join(",")}`, [...ends, ...t.joins])[a] ?? FAR;
  }

  /** How far a belt would go from a free tile to beside another. */
  private reach(from: number, to: number): number {
    const f = this.walk(`from ${from}`, [from]);
    let best = FAR;
    for (const d of DIRS) {
      const n = this.step(to, d);
      if (n >= 0) best = Math.min(best, f[n] ?? FAR);
    }
    return best;
  }

  /** How far a belt would go from a tile to a free deposit of a thing. */
  private toRaw(a: number, raw: F.Item): number {
    if (a < 0) return FAR;
    const key = `raw ${raw}`;
    const known = this.field(key);
    if (known) return known[a] ?? FAR;
    const at: number[] = [];
    for (let i = 0; i < this.y.kind.length; i++) if (this.y.land.deposit[i] === raw && this.free(i)) at.push(i);
    return this.walk(key, at)[a] ?? FAR;
  }

  /** A distance worked out for the copy as it stands now, if there is one. */
  private field(key: string): Int32Array | undefined {
    if (this.fieldsOf?.y !== this.y || this.fieldsOf.ver !== this.ver) {
      this.fields.clear();
      this.fieldsOf = { y: this.y, ver: this.ver };
    }
    return this.fields.get(key);
  }

  /**
   * For every tile, how far a belt laid from it would go to be beside one of `ends` (or on one, if it
   * is clear): a step for each tile, and under what stands by tunnel as the router counts one, its
   * near mouth on clear ground. Tiles it cannot reach are `FAR`.
   */
  private walk(key: string, ends: readonly number[]): Int32Array {
    const known = this.field(key);
    if (known) return known;
    const d = new Int32Array(this.y.kind.length).fill(FAR);
    const queue: number[][] = [];
    const push = (i: number, c: number): void => {
      if (c >= (d[i] ?? FAR)) return;
      d[i] = c;
      (queue[c] ??= []).push(i);
    };
    for (const e of ends) {
      if (this.free(e)) push(e, 0);
      for (const way of DIRS) if (this.free(this.step(e, way))) push(this.step(e, way), 0);
    }
    const span = this.y.open.span;
    const avoid = this.avoid;
    for (let c = 0; c < queue.length; c++)
      for (const i of queue[c] ?? []) {
        if ((d[i] ?? FAR) < c) continue;
        for (const way of DIRS) {
          const j = this.step(i, way);
          if (!this.free(j)) continue;
          push(j, c + (avoid?.has(j) ? AVOID : 1));
          for (let s = 1, under = this.step(j, way); s <= span && under >= 0; s++, under = this.step(under, way)) {
            if (this.y.kind[under] === F.DEPOT) break;
            const e = this.step(under, way);
            if (this.free(e)) push(e, c + 2 * s + 2 + DIG);
          }
        }
      }
    this.fields.set(key, d);
    return d;
  }

  // ---------- power ----------

  /** A boiler beside deadfall, its gatherer feeding it straight in. */
  private boilerLine(): Planned | null {
    return this.planned(null, "power", null, () => (this.boiler() ? 0 : -1));
  }
  private boiler(): boolean {
    const spots: number[] = [];
    for (const g of this.deposits(F.DEADFALL, this.depotTile()))
      for (const d of DIRS) {
        const b = this.step(g, d);
        if (this.plain(b) && !spots.includes(b)) spots.push(b);
      }
    for (const b of spots.slice(0, 3 * SPOTS))
      for (const d of DIRS) {
        const g = this.step(b, d);
        if (!this.free(g) || this.y.land.deposit[g] !== F.DEADFALL) continue;
        const keep = new Set([b, g]);
        const ok = this.attempt(
          () =>
            this.light(b, keep) &&
            this.light(g, keep) &&
            this.put("boiler", b, 0) &&
            this.put("gatherer", g, BACK[d] ?? 0, 1),
        );
        if (ok) return true;
      }
    return this.fail("no room for a boiler beside deadfall");
  }

  /** A waterwheel on the bank of the stream, nearest the depot. */
  private wheelLine(): Planned | null {
    const banks: number[] = [];
    for (let i = 0; i < this.y.kind.length; i++) if (this.plain(i) && F.besideWater(this.y.land, i)) banks.push(i);
    if (banks.length === 0) return null;
    const depot = this.depotTile();
    banks.sort((a, c) => this.dist(a, depot) - this.dist(c, depot) || a - c);
    const wheel = (): number => {
      for (const b of banks.slice(0, SPOTS))
        if (this.attempt(() => this.light(b, new Set([b])) && this.put("wheel", b, 0))) return 0;
      return -1;
    };
    return this.planned(null, "power", null, wheel);
  }

  // ---------- land ----------

  /** A thing a unit gathers that the land the yard owns has too few free tiles of, or nothing. */
  private shortOfGround(u: Unit): F.Item | null {
    for (const [raw, n] of gatherersOf(u)) if (this.deposits(raw, this.depotTile()).length < n) return raw;
    return null;
  }

  /** Buys the cheapest plot for sale that holds one of `raws` (any plot, with none named). Says whether it could. */
  private buyPlot(raws: readonly F.Item[]): boolean {
    const y = this.y;
    const holds = (p: F.Plotted): boolean => {
      if (raws.length === 0) return true;
      const at = y.land.plots.indexOf(p);
      for (let i = 0; i < y.land.deposit.length; i++)
        if (y.land.plot[i] === at && raws.some((r) => r === y.land.deposit[i])) return true;
      return false;
    };
    const plot = y.land.plots
      .filter((p) => F.plotState(y, p.plot).state === "for sale" && holds(p))
      .toSorted((a, b) => a.price - b.price || a.plot - b.plot)[0];
    return plot !== undefined && this.cmd({ do: "buyPlot", plot: F.plotName(plot.plot) });
  }

  // ---------- belts and power ----------

  /**
   * Lays a run from the free tile `from` into `t`: into its piece, or onto one of the belts that lead
   * there, whichever is nearest; with `piece`, onto a belt only if the piece cannot be reached.
   */
  private routeTo(from: number, t: Target, piece: boolean): number[] | null {
    const ends = [t.tile, ...t.joins.filter((j) => j !== t.tile)]
      .filter((e) => e >= 0)
      .map((e) => ({ e, d: e === t.tile && piece ? -1 : this.planning ? this.reach(from, e) : this.dist(from, e) }))
      .toSorted((a, b) => a.d - b.d || a.e - b.e)
      .slice(0, 6);
    for (const { e } of ends) {
      this.tries++;
      const legs = this.way(from, e);
      const laid = legs && this.lay(legs);
      if (!laid) continue;
      // A belt of another thing joined: below here it carries both, and nothing may be split off it.
      if (this.sources.some((l) => l.into === "depot" && l.item !== t.item && l.run.includes(e))) this.joined.push(e);
      this.onto.push(e);
      return laid;
    }
    return null;
  }

  /**
   * The router's way from a tile to a piece, kept off the ground a gatherer could use and off the
   * tiles beside the depot (unless it is going into the depot), as a player keeps belts off deposits
   * and the depot's sides free for lines going in; once a line will not fit so, off the depot's
   * sides only, and then its plain shortest way. Tunnels where it finds them shorter.
   */
  private way(from: number, to: number): F.Leg[] | null {
    const y = this.y;
    const into = to === this.depotTile();
    const avoid = this.avoid;
    const kept = (ground: boolean, around = false): F.Yard => {
      const kind = y.kind.slice();
      for (let i = 0; i < kind.length; i++)
        if (
          i !== from &&
          kind[i] === F.NONE &&
          ((ground && y.land.deposit[i] !== F.NONE) || (!into && this.ring.has(i)) || (around && avoid?.has(i)))
        )
          kind[i] = F.PYLON;
      return { ...y, kind };
    };
    const ways = !this.loose
      ? [kept(true)]
      : avoid
        ? [kept(true, true), kept(false, true), kept(true), kept(false), y]
        : [kept(true), kept(false), y];
    for (const on of ways) {
      const legs =
        F.route(on, this.xy(from), this.xy(to)) ?? F.route(on, this.xy(from), this.xy(to), { tunnels: false });
      if (legs && legs.length > 0) return legs;
    }
    return null;
  }

  /** Lays a run of belt at the grades the player builds belts and tunnels at, and gives the tiles of its belts. */
  private lay(legs: readonly F.Leg[]): number[] | null {
    const wire = legs.map((l) => {
      const kind = F.legKind(l);
      const g = this.grades(kind);
      const leg = { kind: F.kindName(kind), x: l.x, y: l.y, dir: l.dir, span: F.legSpan(l) };
      return g > 1 ? { ...leg, grade: g } : leg;
    });
    if (!this.cmd({ do: "lay", legs: wire })) return null;
    return legs.filter((l) => !l.tunnel).map((l) => F.at(this.y, l.x, l.y));
  }

  /** Stands pylons toward a tile, each as near it as can be joined to power, until power reaches it; never on `keep`. */
  private light(i: number, keep: ReadonlySet<number>): boolean {
    for (let n = 0; n < 12; n++) {
      if (F.litOf(this.y)[i] === 1) return true;
      const p = this.pylonSpot(i, keep);
      if (p < 0 || !this.put("pylon", p, 0)) return this.fail(`no pylon could light ${this.where(i)}`);
    }
    return F.litOf(this.y)[i] === 1;
  }

  private pylonSpot(i: number, keep: ReadonlySet<number>): number {
    const y = this.y;
    const lit = F.litOf(y);
    const link = squared(F.REACH.link, y.open.reach);
    const live: [number, number][] = [[y.land.depot[0], y.land.depot[1]]];
    for (let p = 0; p < y.kind.length; p++) if (y.kind[p] === F.PYLON && lit[p] === 1) live.push(this.xy(p));
    const [tx, ty] = this.xy(i);
    let best = -1;
    let bestScore = Infinity;
    for (let p = 0; p < y.kind.length; p++) {
      if (!this.plain(p) || keep.has(p)) continue;
      const [x, z] = this.xy(p);
      const d2 = (x - tx) ** 2 + (z - ty) ** 2;
      if (d2 < 3 || !live.some(([lx, lz]) => (x - lx) ** 2 + (z - lz) ** 2 <= link)) continue;
      // Not beside a deposit, where it would take a gatherer's way out.
      const score = Math.sqrt(d2) + (this.groundAt(p) > 0 ? 1.5 : 0);
      if (score < bestScore) {
        best = p;
        bestScore = score;
      }
    }
    return best;
  }

  // ---------- the copy ----------

  private no(why: string): -1 {
    this.why = why;
    this.trace?.push(why);
    return -1;
  }
  private fail(why: string): false {
    this.no(why);
    return false;
  }

  /** Plays a command on the copy without keeping it: for working a line out on ground cleared only on the copy. */
  private quiet(c: Rec): boolean {
    const read = F.readCommand({ tick: this.y.tick, ...c });
    if (!read || "refused" in F.play(this.y, read)) return false;
    this.ver++;
    return true;
  }

  /** Plays a command on the copy, keeps it if it is done, and says whether it was. */
  private cmd(c: Rec): boolean {
    const read = F.readCommand({ tick: this.y.tick, ...c });
    if (!read || "refused" in F.play(this.y, read)) return false;
    this.ver++;
    this.cmds.push(c);
    return true;
  }

  private put(kind: F.KindName, i: number, dir: F.Dir, grade = 1): boolean {
    if (i < 0) return false;
    const where = this.at(i);
    return this.cmd(grade > 1 ? { do: "build", kind, ...where, dir, grade } : { do: "build", kind, ...where, dir });
  }

  /** Tries a step; if it does not work, the copy and what was kept go back to what they were before it. */
  private attempt(f: () => boolean): boolean {
    const before = structuredClone(this.y);
    const kept = { cmds: this.cmds.length, taps: this.taps.length, joined: this.joined.length, onto: this.onto.length };
    const lines = this.sources.length;
    this.tries++;
    if (f()) return true;
    this.y = before;
    this.cmds.length = kept.cmds;
    this.taps.length = kept.taps;
    this.joined.length = kept.joined;
    this.onto.length = kept.onto;
    this.sources.length = lines;
    return false;
  }

  // ---------- tiles ----------

  private depotTile(): number {
    return F.at(this.y, this.y.land.depot[0], this.y.land.depot[1]);
  }
  private at(i: number): { x: number; y: number } {
    const [x, z] = this.xy(i);
    return { x, y: z };
  }
  private where(i: number): string {
    const [x, z] = this.xy(i);
    return `${x},${z}`;
  }
  private xy(i: number): [number, number] {
    return [i % this.y.land.w, Math.floor(i / this.y.land.w)];
  }
  private step(i: number, d: number): number {
    return i < 0 ? -1 : F.toward(this.y.land, i, d);
  }
  private dist(a: number, b: number): number {
    if (a < 0 || b < 0) return 1e6;
    const [ax, ay] = this.xy(a);
    const [bx, by] = this.xy(b);
    return Math.abs(ax - bx) + Math.abs(ay - by);
  }
  private far(i: number, p: readonly [number, number]): number {
    const [x, z] = this.xy(i);
    return Math.hypot(x - p[0], z - p[1]);
  }
  /** Ground a piece may stand on: the yard's own, clear, not the stream and not a redwood. */
  private free(i: number): boolean {
    const { land } = this.y;
    if (i < 0 || this.y.kind[i] !== F.NONE || land.water[i] === 1 || land.trunk[i] === 1) return false;
    const plot = land.plots[land.plot[i] ?? F.NONE];
    return plot !== undefined && this.y.plots.includes(plot.plot);
  }
  /** Free ground with nothing to gather in it and not beside the depot: where machines and pylons go. */
  private plain(i: number): boolean {
    return this.free(i) && this.y.land.deposit[i] === F.NONE && !this.ring.has(i);
  }
  /** How many free deposits are beside a tile. */
  private groundAt(i: number): number {
    let n = 0;
    for (const d of DIRS) {
      const j = this.step(i, d);
      if (this.free(j) && this.y.land.deposit[j] !== F.NONE) n++;
    }
    return n;
  }
  /** Whether every tile around one is free: room for a machine and the belts into it. */
  private roomy(i: number): boolean {
    const [x, z] = this.xy(i);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) if (!this.free(F.at(this.y, x + dx, z + dz))) return false;
    return true;
  }
  /** Whether a belt out of a machine on `m` onto `out` can go on from there. */
  private opens(out: number, m: number): boolean {
    return DIRS.some((d) => {
      const j = this.step(out, d);
      return j !== m && (this.free(j) || this.y.kind[j] === F.DEPOT);
    });
  }
  /** Whether a belt on `i`, on the side `s` of a machine, can be reached: plain itself, and two of the three tiles beyond it free. */
  private stubOk(i: number, s: F.Dir): boolean {
    if (!this.plain(i)) return false;
    const beyond = [this.step(i, s), this.step(i, s + 1), this.step(i, s + 3)];
    return beyond.filter((j) => this.free(j)).length >= 2;
  }
  /** The free deposits of a thing on the yard's land with a free tile beside them, nearest `to` first: planning, as a belt would go to `t`. */
  private deposits(raw: F.Item, to: number, t?: Target): number[] {
    const y = this.y;
    const out: number[] = [];
    for (let i = 0; i < y.kind.length; i++)
      if (y.land.deposit[i] === raw && this.free(i) && DIRS.some((d) => this.free(this.step(i, d)))) out.push(i);
    if (this.planning && t) {
      const far = new Map(out.map((i) => [i, this.near(i, t)]));
      return out
        .filter((i) => (far.get(i) ?? FAR) < FAR)
        .toSorted((a, b) => (far.get(a) ?? FAR) - (far.get(b) ?? FAR) || this.dist(a, to) - this.dist(b, to) || a - b);
    }
    return out.toSorted((a, b) => this.dist(a, to) - this.dist(b, to) || a - b);
  }
  /** Where the makings of a thing lie: the middle of the nearest free deposit of each thing from the ground it is made from. */
  private lies(item: F.Item, from: number): [number, number] {
    const raws = [...new Set(F.partsOf(item).filter((k) => F.isRaw(k)))];
    const spots = raws.flatMap((raw) => {
      const g = this.deposits(raw, from)[0];
      return g === undefined ? [] : [this.xy(g)];
    });
    if (spots.length === 0) return this.xy(from);
    return [spots.reduce((s, p) => s + p[0], 0) / spots.length, spots.reduce((s, p) => s + p[1], 0) / spots.length];
  }
}
