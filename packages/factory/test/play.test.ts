/**
 * Playing at random, and time away. A seeded player gives yards thousands of commands off the wire,
 * valid and not, with ticks between: a refused command leaves the yard as running on to its tick
 * alone leaves it, the yard reads back as itself throughout, and every kind of command and piece
 * takes effect somewhere. Leaf runs a yard on in slices of any size to the same yard, and it stands
 * still once its owner has been away as long as it runs unwatched.
 */
import { describe, expect, test } from "bun:test";

import type { Ctx } from "@sequoia-leaf/core";

import * as F from "../src/index.ts";
import { rng } from "./random.ts";
import { delivering, generated } from "./yards.ts";

type Rec = Record<string, unknown>;

class Player {
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
  /** A piece of some kind the yard may build, on a tile where it may stand, if one is found soon; else any. */
  where(): Rec {
    const y = this.y;
    const kind = this.pick(F.ALL_KINDS.filter((k) => (y.open.kinds[k] ?? 0) > 0)) ?? F.BELT;
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
    switch (this.int(24)) {
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
        return { do: "lay", legs: this.named(legs.map((l) => Object.assign({}, l, this.grade()))) };
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
      case 8:
        return { do: "move", tiles: this.box(), turns: this.int(4), ...this.spot() };
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
      case 13:
        return { do: "sort", item: this.r() < 0.2 ? null : this.pick(things), ...this.of(F.SORTER) };
      case 14:
        return {
          do: "tipOut",
          item: this.r() < 0.5 ? null : this.pick(things),
          ...this.of(F.MILL, F.BENCH, F.WORKSHOP, F.CRATE, F.BOILER, F.STUDY),
        };
      case 15:
        return { do: "crate", open: this.r() < 0.5, ...this.of(F.CRATE) };
      case 16:
        return { do: "way", way: this.int(4), open: this.r() < 0.4, ...this.of(F.SPLITTER) };
      case 17:
        return { do: "buyPlot", plot: this.pick([...F.PLOT_IDS, "moon"]) };
      case 18:
        return { do: "take", node: this.pick([...F.NODES.map((n) => n.id), "nap"]) };
      case 19:
        return { do: this.r() < 0.7 ? "study" : "unstudy", research: this.pick(F.RESEARCH.map((r) => r.id)) };
      case 20:
        return { do: "swap", order: this.pick(orders) ?? this.int(50) };
      case 21: {
        const filled = y.board.filter((o) => F.isFilled(o.want, o.filled)).map((o) => o.id);
        return { do: "handOver", order: this.pick(filled.length > 0 ? filled : orders) ?? 0 };
      }
      case 22:
        return { do: "collect" };
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
  /** Plays `n` commands, now and then a tick ahead or in the past, with ticks between. */
  play(n: number): void {
    const y = this.y;
    for (let k = 0; k < n; k++) {
      const ahead = this.r() < 0.2 ? this.int(80) : 0;
      const tick = this.r() < 0.05 ? Math.max(0, y.tick - 1 - this.int(5)) : y.tick + ahead;
      const c = F.readCommand({ ...this.command(), tick });
      if (!c) continue;
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
    }
  }
}

/** The delivering yard with every order on its board filled, so handing over is done as well as refused. */
function boardFilled(): F.Yard {
  const y = delivering(5);
  for (const o of y.board) for (const n of F.ALL_ITEMS) o.filled[n] = o.want[n] ?? 0;
  return y;
}

describe("random play", () => {
  const took = new Map<string, number>();
  const starts: [string, () => F.Yard][] = [
    ["a new yard", () => F.create({ seed: 11 })],
    ["a yard at tier 1", () => F.create({ seed: 12, tier: 1 })],
    ["a yard at tier 3", () => F.create({ seed: 13, tier: 3 })],
    ["a delivering yard, its board filled", boardFilled],
    ["a generated yard", () => F.decode(F.encode(generated().y), generated().y.land) ?? F.create()],
  ];
  for (const [name, start] of starts)
    test(`${name}: a refused command changes nothing, and the yard reads back as itself`, () => {
      new Player(start(), name.length * 7919, took).play(500);
    }, 30_000);

  test("reached every kind of command and piece", () => {
    const keys = [
      ...Object.keys(F.REFUSED),
      "collect",
      ...F.KINDS.filter((k) => k !== "depot").map((k) => `piece ${k}`),
    ];
    expect(keys.filter((k) => !took.has(k))).toEqual([]);
  });
});

const ctx = (now: number): Ctx => ({ now, player: { id: "p", guest: false }, seed: 9, room: 0, awards: [] });
const at0 = 1_800_000_000_000;
const HOUR = 3600 * 1000;

/** The delivering yard, last seen now, tended to `hours` away in slices of `n` ticks. */
function tended(hours: number, n: number, tier = 4): F.Yard {
  const y = tier === 4 ? delivering() : F.create({ seed: 1, tier });
  y.at = at0;
  y.seen = F.here(y);
  for (let further = true; further;) {
    let left = n;
    further = F.FACTORY.tend?.(y, ctx(at0 + hours * HOUR), () => left-- > 0) ?? false;
  }
  return y;
}

describe("time away", () => {
  test("tended in slices of any size, a yard comes to the same yard", () => {
    const one = F.encode(tended(1, 1));
    expect(F.encode(tended(1, 7777))).toBe(one);
    expect(F.encode(tended(1, 1e9))).toBe(one);
  });

  test("it stands still once its owner has been away as long as it runs unwatched: as many hours as it has unlocked, more once more is", () => {
    // What is open keeps the time the yard runs unwatched in ticks.
    const early = tended(20, 1e9, 3);
    expect(early.tick - early.seen.tick).toBe(early.open.away);
    const late = tended(20, 1e9);
    expect(late.open.away).toBeGreaterThan(early.open.away);
    expect(late.tick - late.seen.tick).toBe(late.open.away);
    expect(F.awayOf(late)).toMatchObject({ seconds: late.open.away / 10 });
  });
});
