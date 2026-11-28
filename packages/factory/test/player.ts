/**
 * Random play, for the tests: a seeded player (`Player`), and a yard with work for it to hand over.
 */
import { expect } from "bun:test";

import * as F from "../src/index.ts";
import { rng } from "./random.ts";
import { buying, delivering, must } from "./yards.ts";

type Rec = Record<string, unknown>;

/**
 * How many things, nodes and pieces of research random play names in its commands (`command`): those
 * there were before tier 6, so that what is added later changes no recorded play it is not open in;
 * or, for a player told to (`every`), all of them.
 */
const BEFORE_6 = { items: 40, nodes: 39, research: 37 } as const;

/**
 * A seeded player who gives a yard commands off the wire, valid and not, with ticks between: every
 * kind of command, on pieces of every kind, now and then a tick ahead or in the past.
 */
export class Player {
  readonly r: () => number;
  readonly y: F.Yard;
  readonly took: Map<string, number>;
  readonly names: { readonly items: number; readonly nodes: number; readonly research: number };
  constructor(y: F.Yard, seed: number, took: Map<string, number>, every = false) {
    this.y = y;
    this.r = rng(seed);
    this.took = took;
    this.names = every ? { items: F.ITEMS.length, nodes: F.NODES.length, research: F.RESEARCH.length } : BEFORE_6;
  }
  int(n: number): number {
    return Math.floor(this.r() * n);
  }
  pick<T>(xs: readonly T[]): T | undefined {
    return xs[this.int(xs.length)];
  }
  /**
   * The plots the yard plays on: those it owns or may buy. Plots further out are no part of its
   * play, so the same player plays the same on a land with more of them.
   */
  plotsNear(): F.PlotName[] {
    return F.PLOT_IDS.filter((id) => F.plotState(this.y, F.plot(id)).state !== "not yet");
  }
  /** Anywhere the yard plays: a tile of a plot it owns or may buy (`plotsNear`). */
  anywhere(): { x: number; y: number } {
    const y = this.y;
    const near = y.land.plots.filter((p) => F.plotState(y, p.plot).state !== "not yet");
    const x0 = Math.min(...near.map((p) => p.x));
    const y0 = Math.min(...near.map((p) => p.y));
    const x1 = Math.max(...near.map((p) => p.x + p.w));
    const y1 = Math.max(...near.map((p) => p.y + p.h));
    return { x: x0 + this.int(x1 - x0), y: y0 + this.int(y1 - y0) };
  }
  /** The tiles whose piece's kind `has` takes, in the land's order: one pass, as large as the land is. */
  tilesWith(has: (kind: number) => boolean): number[] {
    const out: number[] = [];
    const kinds = this.y.kind;
    for (let i = 0; i < kinds.length; i++) if (has(kinds[i] ?? F.NONE)) out.push(i);
    return out;
  }
  /** A tile: usually one with something on it, now and then anywhere, once in a while off the map. */
  spot(): { x: number; y: number } {
    const { w, h } = this.y.land;
    const standing = this.tilesWith((k) => k !== F.NONE);
    const i = this.r() < 0.65 ? this.pick(standing) : undefined;
    if (i !== undefined) return { x: i % w, y: Math.floor(i / w) };
    return this.r() < 0.05 ? { x: w + this.int(3), y: this.int(h) } : this.anywhere();
  }
  /**
   * The first tile from a spot on, in the land's order and round again, with a piece on it that can be
   * copied (not the depot), drawing nothing; the spot itself if none is, or if it is off the land.
   */
  copyable(at: { x: number; y: number }): { x: number; y: number } {
    const { w, h } = this.y.land;
    if (at.x < 0 || at.y < 0 || at.x >= w || at.y >= h) return at;
    const n = w * h;
    for (let k = 0; k < n; k++) {
      const i = (at.y * w + at.x + k) % n;
      const kind = this.y.kind[i] ?? F.NONE;
      if (kind !== F.NONE && F.FIXED[kind] !== 1) return { x: i % w, y: Math.floor(i / w) };
    }
    return at;
  }
  /** A tile with one of some kinds of piece on it, if there is one; else any spot. */
  of(...kinds: readonly F.Kind[]): { x: number; y: number } {
    const { w } = this.y.land;
    const tiles = this.tilesWith((kind) => kinds.some((k) => k === kind));
    const i = this.r() < 0.8 ? this.pick(tiles) : undefined;
    return i === undefined ? this.spot() : { x: i % w, y: Math.floor(i / w) };
  }
  /** A piece of some kind the yard may build (or of `only`), on a tile where it may stand, if one is found soon; else any. */
  where(only?: F.Kind): Rec {
    const y = this.y;
    const kind = only ?? this.pick(F.ALL_KINDS.filter((k) => (y.open.kinds[k] ?? 0) > 0)) ?? F.BELT;
    // A waterwheel stands only beside the stream: it takes many tries to find a tile for one.
    for (let tries = 0; tries < 200; tries++) {
      const { x, y: z } = this.anywhere();
      const dir = this.int(4);
      if (F.refusal(y, kind, x, z, Infinity, dir) === null) return { kind: F.kindName(kind), x, y: z, dir };
    }
    return { kind: F.kindName(kind), ...this.spot(), dir: 0 };
  }
  /** The code of one of a yard's kept blueprints, a fifth of the time cut short; one of no blueprint, for none. */
  code(y: F.Yard): string {
    const print = this.pick(y.blueprints.filter((p) => p !== null && !p.whole));
    const code = (print && F.blueprintCode(print)) ?? `${F.CODE_PREFIX}AAAA`;
    return this.r() < 0.2 ? code.slice(0, -2) : code;
  }

  box(): number[] {
    const { x, y } = this.spot();
    const r = 1 + this.int(5);
    return F.within(this.y, x - r, y - r, x + r, y + this.int(5));
  }
  /** Pieces as the wire names them. */
  named(pieces: readonly F.Piece[]): Rec[] {
    return pieces.map((p) => ({
      ...p,
      kind: F.kindName(p.kind),
      ...(p.recipe === undefined ? {} : { recipe: F.itemName(p.recipe) }),
    }));
  }
  grade(): Rec {
    return this.r() < 0.3 ? { grade: 1 + this.int(3) } : {};
  }
  command(): Rec {
    const y = this.y;
    const at = this.spot();
    const orders = y.board.map((o) => o.id);
    // Names of things, nodes and research: those there were before tier 6, so that what is added
    // later changes no play it is not open in, as with the kinds' names below.
    const things = [...F.ITEMS.slice(0, this.names.items), "moss"];
    switch (this.int(28)) {
      case 0:
        // Any name, of a kind or none: the names of the first sixteen kinds, so a kind added later
        // changes no play it is not open in (it is built where it may stand, by `where`).
        return {
          do: "build",
          kind: this.pick([...F.KINDS.slice(0, 16), "cart"]),
          dir: this.int(4),
          ...this.grade(),
          ...at,
        };
      case 1:
        return { do: "build", ...this.where(), ...this.grade() };
      case 2:
        return { do: "remove", ...at };
      case 3:
        return { do: "turn", dir: this.int(5), ...at };
      case 4: {
        const to = this.spot();
        const legs = F.route(y, [at.x, at.y], [to.x, to.y], { tunnels: this.r() < 0.7 }) ?? [];
        return F.writeAct({ do: "lay", legs: legs.map((l) => Object.assign({}, l, this.grade())) });
      }
      case 5:
        return { do: "stand", pieces: this.named(F.placed(F.piecesAt(y, this.box()), this.int(4), at.x, at.y)) };
      case 6: {
        const slot = this.int(F.BLUEPRINTS_MOST);
        if (!y.blueprints[slot] || this.r() < 0.2) return { do: "deleteBlueprint", slot };
        // Half the time from a tile where a piece may stand, which a spot at random seldom is.
        const from = this.r() < 0.5 ? this.where() : at;
        return { do: "placeBlueprint", slot, turns: this.int(4), x: from.x, y: from.y };
      }
      case 7: {
        // A yard that may keep the whole yard now and then does, or pastes a code of one of its
        // blueprints (now and then broken in the copying): the same draws as ever for one that may not.
        const r = F.locked(y.open, { use: "whole" }) === null ? this.r() : 1;
        if (r < 0.15) return { do: "saveYard", slot: this.int(F.BLUEPRINTS_MOST) };
        if (r < 0.3) return { do: "pasteBlueprint", slot: this.int(F.BLUEPRINTS_MOST), code: this.code(y) };
        return { do: "saveBlueprint", slot: this.int(F.BLUEPRINTS_MOST), tiles: this.box() };
      }
      case 8: {
        // Now and then a copy of one piece onto ground where a piece may stand, which a box at
        // random seldom finds; else a move or a copy, by the size of the box: the same draws either way.
        if (this.r() < 0.15) {
          const from = this.copyable(this.spot());
          const to = this.where();
          return { do: "copy", tiles: F.within(y, from.x, from.y, from.x, from.y), turns: 0, x: to.x, y: to.y };
        }
        const tiles = this.box();
        return { do: tiles.length % 3 === 0 ? "copy" : "move", tiles, turns: this.int(4), ...this.spot() };
      }
      case 9:
        return { do: "clear", tiles: this.box() };
      case 10: {
        // At the price the yard asks now, as the page sends it.
        const tiles = this.box();
        return { do: "upgrade", tiles, price: F.upgradePrice(y, tiles) };
      }
      case 11:
        return { do: "paint", tint: this.int(8), ...at };
      case 12: {
        const m = this.of(F.MILL, F.BENCH, F.WORKSHOP);
        const made = (F.MADE_BY[y.kind[F.at(y, m.x, m.y)] ?? F.NONE] ?? [])
          .filter((r) => r.out < this.names.items)
          .map((r) => F.itemName(r.out));
        return { do: "recipe", item: this.r() < 0.1 ? null : this.pick(this.r() < 0.7 ? made : things), ...m };
      }
      case 13: {
        // Set to a thing, or to none; now and then flipped to one side or the other.
        const r = this.r();
        if (r < 0.25) return { do: "side", right: r < 0.15, ...this.of(F.SORTER) };
        return { do: "sort", item: r < 0.4 ? null : this.pick(things), ...this.of(F.SORTER) };
      }
      case 14:
        return {
          do: "tipOut",
          item: this.r() < 0.5 ? null : this.pick(things),
          ...this.of(F.MILL, F.BENCH, F.WORKSHOP, F.CRATE, F.BOILER, F.STUDY),
        };
      case 15:
        return { do: "crate", open: this.r() < 0.5, ...this.of(F.CRATE) };
      case 16: {
        // Opened or shut, or now and then turned to take things in, or back: the same draws either way.
        const way = this.int(4);
        const r = this.r();
        if (r < 0.25) {
          // A yard that may turn a splitter's ways in, with no splitter standing, builds one first.
          if (y.open.ins && !y.kind.includes(F.SPLITTER)) return { do: "build", ...this.where(F.SPLITTER) };
          return { do: "wayIn", way, on: r < 0.18, ...this.of(F.SPLITTER) };
        }
        return { do: "way", way, open: r < 0.55, ...this.of(F.SPLITTER) };
      }
      case 17: {
        // A plot it owns or may buy, one not for sale yet, or one there is none of: bought, or its
        // clearing taken on; or the clearing handed over, or now and then stopped.
        const plot = this.pick([...this.plotsNear(), "seam", "moon"]) ?? "moon";
        const r = this.r();
        if (r < 0.7) return buying(y, plot);
        if (r < 0.85) return { do: "clearPlot", plot };
        // The clearing being done, as the player saw it; now and then one stopped since, or one when there is none.
        const c = y.clearing;
        const start = c && !(r >= 0.95 && r < 0.97) ? c.start : "#0";
        return { do: r < 0.98 ? "handClearing" : "stopClearing", plot: c ? F.plotName(c.plot) : plot, start };
      }
      case 18:
        return { do: "take", node: this.pick([...F.NODES.slice(0, this.names.nodes).map((n) => n.id), "nap"]) };
      case 19: {
        // Any research to study; mostly research in the line to take out, as a player takes one out.
        const any = F.RESEARCH.slice(0, this.names.research).map((r) => r.id);
        if (this.r() < 0.7) return { do: "study", research: this.pick(any) };
        const lined = y.line.flatMap((g) => F.GOALS[g]?.id ?? []);
        return { do: "unstudy", research: this.pick(lined.length > 0 && this.r() < 0.8 ? lined : any) };
      }
      case 20:
        return { do: "swap", order: this.pick(orders) ?? this.int(50) };
      case 21: {
        const filled = y.board.filter((o) => F.isFilled(o.want, o.filled)).map((o) => o.id);
        return { do: "handOver", order: this.pick(filled.length > 0 ? filled : orders) ?? 0 };
      }
      case 22:
        return { do: "collect" };
      case 23:
        return { do: "first", way: this.pick([null, 0, 1, 2, 3]), ...this.of(F.SPLITTER) };
      case 24: {
        const named = F.NODES.slice(0, this.names.nodes);
        const any = [...named.map((n) => n.id), "nap"];
        // Mostly a node that may go in line, as a player picks one; now and then any, or none.
        if (this.r() < 0.7) {
          const may = named.filter((n) => F.queueRefusal(y, F.goal(n.id)) === null).map((n) => n.id);
          return { do: "queue", node: this.pick(may.length > 0 && this.r() < 0.8 ? may : any) };
        }
        // Mostly a node that is in line, as a player takes one out; now and then any, or none.
        const lined = y.queue.flatMap((g) => F.GOALS[g]?.id ?? []);
        return { do: "unqueue", node: this.pick(lined.length > 0 && this.r() < 0.8 ? lined : any) };
      }
      case 26:
        // Undo, mostly of what the yard would undo next; now and then of something else, as another tab would ask.
        return { do: "undo", entry: this.r() < 0.9 ? (y.history.at(-1)?.id ?? "") : `elsewhere-${this.int(1e6)}` };
      case 27: {
        // Mostly a tile of a redwood still standing, on a plot the yard owns or one it may buy; now and then anywhere.
        const near = (i: number): boolean => {
          const plot = y.land.plots[y.land.plot[i] ?? F.NONE];
          return plot !== undefined && F.plotState(y, plot.plot).state !== "not yet";
        };
        const standing = y.land.trees.flatMap((tiles) => tiles.filter((i) => near(i) && F.redwoodAt(y, i)));
        const i = this.r() < 0.85 ? this.pick(standing) : undefined;
        return {
          do: "fell",
          ...(i === undefined ? at : { x: i % y.land.w, y: Math.floor(i / y.land.w) }),
          price: F.fellPrice(y),
        };
      }
      default:
        return (
          this.pick<Rec>([
            { do: "build", kind: "belt", x: -1, y: 2, dir: 0 },
            { do: "fly" },
            // A grade past the highest there is: a command that does not read.
            { do: "build", kind: "belt", x: 1, y: 2, dir: 0, grade: F.TOP + 1 },
            { do: "clear", tiles: [1, 2, 99_999] },
            { do: "stand", pieces: "all" },
          ]) ?? {}
        );
    }
  }
  /**
   * Plays `n` commands, now and then a tick ahead or in the past, with ticks between; `after` is
   * shown the yard after each command and the ticks after it.
   */
  play(n: number, after?: (y: F.Yard) => void): void {
    const y = this.y;
    for (let k = 0; k < n; k++) {
      const ahead = this.r() < 0.2 ? this.int(80) : 0;
      const tick = this.r() < 0.05 ? Math.max(0, y.tick - 1 - this.int(5)) : y.tick + ahead;
      const c = F.readCommand({ ...this.command(), tick });
      if (!c) continue;
      // What the page would write for it reads back as the same command.
      expect(F.readCommand(JSON.parse(JSON.stringify(F.writeCommand(c))))).toEqual(c);
      const alone = F.decode(F.encode(y), y.land);
      if (!alone) throw new Error("the yard does not read back");
      F.stepTo(alone, tick);
      const did = F.play(y, c);
      if ("refused" in did) expect(F.encode(y)).toBe(F.encode(alone));
      else this.took.set(c.do, (this.took.get(c.do) ?? 0) + 1);
      for (const kind of y.kind) if (F.isKind(kind)) this.took.set(`piece ${F.kindName(kind)}`, 1);
      if (this.r() < 0.3) for (let t = 1 + this.int(this.r() < 0.1 ? 400 : 30); t > 0; t--) F.step(y);
      if (k % 50 === 49) {
        const back = F.decode(F.encode(y), y.land);
        expect(back && [F.check(back), F.encode(back)]).toEqual([F.check(y), F.encode(y)]);
      }
      after?.(y);
    }
  }
}

/** The delivering yard with every order on its board filled, so handing over is done as well as refused. */
/** A yard past tier 4's commission that owns today's nine plots and is clearing The Old Workings, all it wants delivered. */
export function clearingFilled(): F.Yard {
  const y = F.create({ seed: 16, tier: 5 });
  for (let more = true; more;) {
    const p = y.land.plots.find((q) => q.ring === 1 && F.plotState(y, q.plot).state === "for sale");
    more = p !== undefined;
    if (p) must(y, buying(y, F.plotName(p.plot)));
  }
  must(y, { do: "clearPlot", plot: "workings" });
  y.clearing?.filled.set(F.CLEARING[F.plot("workings")] ?? F.counts());
  y.history = [];
  return y;
}

export function boardFilled(): F.Yard {
  const y = delivering(5);
  for (const o of y.board) for (const n of F.ALL_ITEMS) o.filled[n] = o.want[n] ?? 0;
  return y;
}
