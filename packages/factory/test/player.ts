/**
 * Random play, for the tests: a seeded player (`Player`), and a yard with work for it to hand over.
 */
import { expect } from "bun:test";

import * as F from "../src/index.ts";
import { rng } from "./random.ts";
import { delivering } from "./yards.ts";

type Rec = Record<string, unknown>;

/**
 * A seeded player who gives a yard commands off the wire, valid and not, with ticks between: every
 * kind of command, on pieces of every kind, now and then a tick ahead or in the past.
 */
export class Player {
  readonly r: () => number;
  readonly y: F.Yard;
  readonly took: Map<string, number>;
  constructor(y: F.Yard, seed: number, took: Map<string, number>) {
    this.y = y;
    this.r = rng(seed);
    this.took = took;
  }
  int(n: number): number {
    return Math.floor(this.r() * n);
  }
  pick<T>(xs: readonly T[]): T | undefined {
    return xs[this.int(xs.length)];
  }
  /** A tile: usually one with something on it, now and then anywhere, once in a while off the map. */
  spot(): { x: number; y: number } {
    const { w, h } = this.y.land;
    const standing = [...this.y.kind.keys()].filter((i) => this.y.kind[i] !== F.NONE);
    const i = this.r() < 0.65 ? this.pick(standing) : undefined;
    if (i !== undefined) return { x: i % w, y: Math.floor(i / w) };
    return this.r() < 0.05 ? { x: w + this.int(3), y: this.int(h) } : { x: this.int(w), y: this.int(h) };
  }
  /** A tile with one of some kinds of piece on it, if there is one; else any spot. */
  of(...kinds: readonly F.Kind[]): { x: number; y: number } {
    const { w } = this.y.land;
    const tiles = [...this.y.kind.keys()].filter((i) => kinds.some((k) => this.y.kind[i] === k));
    const i = this.r() < 0.8 ? this.pick(tiles) : undefined;
    return i === undefined ? this.spot() : { x: i % w, y: Math.floor(i / w) };
  }
  /** A piece of some kind the yard may build (or of `only`), on a tile where it may stand, if one is found soon; else any. */
  where(only?: F.Kind): Rec {
    const y = this.y;
    const kind = only ?? this.pick(F.ALL_KINDS.filter((k) => (y.open.kinds[k] ?? 0) > 0)) ?? F.BELT;
    for (let tries = 0; tries < 30; tries++) {
      const x = this.int(y.land.w);
      const z = this.int(y.land.h);
      const dir = this.int(4);
      if (F.refusal(y, kind, x, z, Infinity, dir) === null) return { kind: F.kindName(kind), x, y: z, dir };
    }
    return { kind: F.kindName(kind), ...this.spot(), dir: 0 };
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
    const things = [...F.ITEMS, "moss"];
    switch (this.int(26)) {
      case 0:
        return { do: "build", kind: this.pick([...F.KINDS, "cart"]), dir: this.int(4), ...this.grade(), ...at };
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
        return { do: "placeBlueprint", slot, turns: this.int(4), ...at };
      }
      case 7:
        return { do: "saveBlueprint", slot: this.int(F.BLUEPRINTS_MOST), tiles: this.box() };
      case 8: {
        // Now and then a copy of one piece onto ground where a piece may stand, which a box at
        // random seldom finds; else a move or a copy, by the size of the box: the same draws either way.
        if (this.r() < 0.15) {
          const from = this.spot();
          const to = this.where();
          return { do: "copy", tiles: F.within(y, from.x, from.y, from.x, from.y), turns: 0, x: to.x, y: to.y };
        }
        const tiles = this.box();
        return { do: tiles.length % 3 === 0 ? "copy" : "move", tiles, turns: this.int(4), ...this.spot() };
      }
      case 9:
        return { do: "clear", tiles: this.box() };
      case 10:
        return { do: "upgrade", tiles: this.box() };
      case 11:
        return { do: "paint", tint: this.int(8), ...at };
      case 12: {
        const m = this.of(F.MILL, F.BENCH, F.WORKSHOP);
        const made = (F.MADE_BY[y.kind[F.at(y, m.x, m.y)] ?? F.NONE] ?? []).map((r) => F.itemName(r.out));
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
      case 17:
        return { do: "buyPlot", plot: this.pick([...F.PLOT_IDS, "moon"]) };
      case 18:
        return { do: "take", node: this.pick([...F.NODES.map((n) => n.id), "nap"]) };
      case 19: {
        // Any research to study; mostly research in the line to take out, as a player takes one out.
        const any = F.RESEARCH.map((r) => r.id);
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
        const any = [...F.NODES.map((n) => n.id), "nap"];
        // Mostly a node that may go in line, as a player picks one; now and then any, or none.
        if (this.r() < 0.7) {
          const may = F.NODES.filter((n) => F.queueRefusal(y, F.goal(n.id)) === null).map((n) => n.id);
          return { do: "queue", node: this.pick(may.length > 0 && this.r() < 0.8 ? may : any) };
        }
        // Mostly a node that is in line, as a player takes one out; now and then any, or none.
        const lined = y.queue.flatMap((g) => F.GOALS[g]?.id ?? []);
        return { do: "unqueue", node: this.pick(lined.length > 0 && this.r() < 0.8 ? lined : any) };
      }
      default:
        return (
          this.pick<Rec>([
            { do: "build", kind: "belt", x: -1, y: 2, dir: 0 },
            { do: "fly" },
            { do: "build", kind: "belt", x: 1, y: 2, dir: 0, grade: 4 },
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
export function boardFilled(): F.Yard {
  const y = delivering(5);
  for (const o of y.board) for (const n of F.ALL_ITEMS) o.filled[n] = o.want[n] ?? 0;
  return y;
}
