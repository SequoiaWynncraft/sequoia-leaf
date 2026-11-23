/**
 * Random play: a seeded script that gives a pair of yards thousands of commands, valid and not,
 * with ticks between. Targets lean toward what stands, so most commands do something.
 */
import * as Y from "@sequoia-leaf/yard";

import type { Pair } from "./sides.ts";

type Rec = Record<string, unknown>;

/** A run of numbers from 0 up to 1, the same every time for the same seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Player {
  readonly r: () => number;
  readonly pair: Pair;
  constructor(pair: Pair, seed: number) {
    this.pair = pair;
    this.r = rng(seed);
  }
  int(n: number): number {
    return Math.floor(this.r() * n);
  }
  pick<T>(xs: readonly T[]): T | undefined {
    return xs[this.int(xs.length)];
  }
  chance(p: number): boolean {
    return this.r() < p;
  }

  get w(): Y.World {
    return this.pair.yard;
  }
  /** A tile: usually one with something on it, now and then anywhere, and once in a while off the map. */
  spot(): { x: number; y: number } {
    const { w, h } = this.w.land;
    if (this.chance(0.65)) {
      const tiles = this.standing();
      const i = this.pick(tiles);
      if (i !== undefined) return { x: i % w, y: Math.floor(i / w) };
    }
    if (this.chance(0.05)) return { x: w + this.int(3), y: this.int(h + 3) };
    return { x: this.int(w), y: this.int(h) };
  }
  /** A tile with one of some kinds of piece on it that `ok` likes, if there is one; else any tile. */
  of(kinds: readonly Y.Kind[], ok: (b: Y.Building) => boolean = () => true): { x: number; y: number } {
    const w = this.w;
    const tiles = this.standing().filter((i) => {
      const b = w.cells[i];
      return b !== null && b !== undefined && kinds.includes(b.kind) && ok(b);
    });
    const i = this.chance(0.75) ? this.pick(tiles) : undefined;
    return i === undefined ? this.spot() : { x: i % w.land.w, y: Math.floor(i / w.land.w) };
  }
  standing(): number[] {
    const out: number[] = [];
    this.w.cells.forEach((b, i) => {
      if (b) out.push(i);
    });
    return out;
  }
  /** The tiles of the pieces in a small box about a tile. */
  box(): { tiles: number[]; x: number; y: number } {
    const { x, y } = this.spot();
    const r = 1 + this.int(5);
    return { tiles: Y.within(this.w, x - r, y - r, x + r, y + this.int(5)), x, y };
  }
  dir(): number {
    return this.chance(0.02) ? 7 : this.int(4);
  }
  kind(): string {
    return this.chance(0.02) ? "cart" : (this.pick(Y.KINDS) ?? "belt");
  }
  item(): string | null {
    return this.chance(0.15) ? null : this.chance(0.02) ? "moss" : (this.pick(Y.ITEMS) ?? "plank");
  }
  piece(x: number, y: number): Rec {
    const kind = this.kind();
    return {
      kind,
      x,
      y,
      dir: this.dir(),
      span: kind === "tunnel" ? 1 + this.int(3) : 0,
      ...(this.chance(0.2) ? { recipe: this.item() } : {}),
      ...(this.chance(0.1) ? { open: false } : {}),
      ...(this.chance(0.3) ? { tint: this.int(8) } : {}),
      ...(this.chance(0.2) ? { shut: this.int(8) } : {}),
    };
  }

  /** One command off the wire, any kind of it. */
  command(): Rec {
    const w = this.w;
    const at = this.spot();
    const orders = w.board.map((o) => o.id);
    switch (this.int(25)) {
      case 0:
      case 1:
        return { do: "build", kind: this.kind(), dir: this.dir(), ...at };
      case 2:
        // A splitter or joiner set down on a belt, or a crate put in a line.
        return { do: "build", kind: this.pick(["splitter", "joiner", "crate"]), dir: this.dir(), ...this.of(["belt"]) };
      case 3:
        return { do: "remove", ...at };
      case 4:
        return { do: "turn", dir: this.dir(), ...at };
      case 5:
      case 6: {
        // A run of belt the router finds, as the page lays one, now and then bent onto a belt.
        const to = this.spot();
        const legs = Y.route(w, [at.x, at.y], [to.x, to.y], { tunnels: this.chance(0.7) });
        const turn = this.chance(0.2) ? { turn: { ...this.spot(), dir: this.dir() } } : {};
        if (legs) return { do: "lay", legs, ...turn };
        return { do: "lay", legs: [this.piece(at.x, at.y), this.piece(at.x + 1, at.y)], ...turn };
      }
      case 7: {
        // A copy of what stands in a box, set down elsewhere, as the page's copy does.
        const { tiles } = this.box();
        const pieces = Y.placed(Y.piecesAt(w, tiles), this.int(4), at.x, at.y);
        return { do: "stand", pieces: pieces.slice(0, Y.STAND_MOST + (this.chance(0.05) ? 5 : 0)) };
      }
      case 8:
        return {
          do: "stand",
          pieces: Array.from({ length: 1 + this.int(4) }, () => this.piece(this.spot().x, this.spot().y)),
        };
      case 9: {
        const { tiles } = this.box();
        const to = this.spot();
        return { do: "move", tiles, turns: this.int(4), x: to.x + this.int(3) - 1, y: to.y + this.int(3) - 1 };
      }
      case 10:
        return { do: "clear", tiles: this.box().tiles };
      case 11:
        return { do: "paint", tint: this.int(8), ...at };
      case 12: {
        const m = this.of(["mill", "bench", "workshop", "gatherer"]);
        const kind = w.cells[w.land.w * m.y + m.x]?.kind;
        const made = Y.RECIPES.filter((r) => r.by === kind).map((r) => r.out);
        return { do: "recipe", item: this.chance(0.7) ? (this.pick(made) ?? null) : this.item(), ...m };
      }
      case 13: {
        const m = this.of(["mill", "bench", "workshop", "crate", "boiler"], (b) => b.count > 0);
        const b = w.cells[w.land.w * m.y + m.x];
        const has = Y.ITEMS.filter((k) => (b?.buf[k] ?? 0) > 0);
        return { do: "tipOut", item: this.chance(0.5) ? (this.pick(has) ?? null) : this.item(), ...m };
      }
      case 14:
        return { do: "crate", open: this.chance(0.5), ...this.of(["crate"]) };
      case 15:
        return { do: "way", way: this.int(4), open: this.chance(0.4), ...this.of(["splitter"]) };
      case 16:
        return { do: "saveBlueprint", slot: this.int(4), tiles: this.box().tiles };
      case 17: {
        // A blueprint set down, as the page does: its pieces placed, turned, on a tile.
        const slot = this.int(3);
        const print = w.blueprints[slot];
        if (!print || this.chance(0.2)) return { do: "deleteBlueprint", slot };
        return { do: "stand", pieces: Y.placed(print, this.int(4), at.x, at.y).slice(0, Y.STAND_MOST) };
      }
      case 18:
        return { do: "buyPlot", plot: this.chance(0.05) ? "moon" : this.pick(Y.PLOT_IDS) };
      case 19:
        return { do: "buyPlan", plan: this.chance(0.05) ? "magic" : this.pick(Y.PLAN_IDS) };
      case 20:
        return { do: "swap", order: this.pick(orders) ?? this.int(50) };
      case 21: {
        const filled = w.board.filter((o) => Y.isFilled(o.want, o.filled)).map((o) => o.id);
        return {
          do: "handOver",
          order: this.pick(filled.length > 0 && this.chance(0.8) ? filled : orders) ?? this.int(50),
        };
      }
      case 22:
        return { do: "collect" };
      case 23:
        // Nonsense of every shape.
        return (
          this.pick<Rec>([
            { do: "build", kind: "belt", x: -1, y: 2, dir: 0 },
            { do: "fly" },
            { do: "build", kind: "belt", x: 1.5, y: 2, dir: 0 },
            { do: "clear", tiles: [1, 2, 99_999] },
            { do: "stand", pieces: "all" },
            { do: "lay", legs: [{ kind: "belt", x: 1, y: 1, dir: 0 }] },
            { do: "recipe", x: 1, y: 1 },
          ]) ?? {}
        );
      default: {
        // A machine told what to make, a crate shut, a way shut: what a player sets on a card.
        const b = w.cells[w.land.w * at.y + at.x];
        if (b?.kind === "splitter") return { do: "way", way: this.int(3), open: this.chance(0.5), ...at };
        if (b?.kind === "crate") return { do: "crate", open: this.chance(0.5), ...at };
        const recipe = Y.RECIPES.filter((r) => r.by === b?.kind).map((r) => r.out);
        return { do: "recipe", item: this.pick(recipe) ?? null, ...at };
      }
    }
  }

  /** Plays `n` commands with ticks between, comparing after each. */
  play(n: number, where: string): void {
    for (let k = 0; k < n; k++) {
      const c = this.command();
      // Mostly at the yard's tick; now and then a tick ahead, which runs both on, or one in the past.
      const ahead = this.chance(0.2) ? this.int(40) : 0;
      const tick = this.chance(0.03) ? Math.max(0, this.w.tick - 5) : this.w.tick + ahead;
      this.pair.do({ ...c, tick }, `${where} #${k}`);
      this.pair.same(`${where} after #${k} (${String(c.do)})`);
      if (this.chance(0.3)) this.pair.run(1 + this.int(this.chance(0.1) ? 400 : 30), 100, where);
    }
  }
}
