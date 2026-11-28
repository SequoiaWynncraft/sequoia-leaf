/**
 * Playing at random, and time away. A seeded player gives yards thousands of commands off the wire,
 * valid and not, with ticks between: a refused command leaves the yard as running on to its tick
 * alone leaves it, the yard reads back as itself throughout, every command the page would write
 * for one reads back as it, and every kind of command and piece takes effect somewhere. Leaf runs a yard on in slices of any size to the same yard, and it stands
 * still once its owner has been away as long as it runs unwatched. A visitor's copy that does what
 * Leaf tells it each batch did, at the ticks Leaf did it, is Leaf's yard after every batch.
 */
import { describe, expect, test } from "bun:test";

import type { Ctx } from "@sequoia-leaf/core";

import * as F from "../src/index.ts";
import { boardFilled, clearingFilled, Player } from "./player.ts";
import { delivering, generated } from "./yards.ts";

type Rec = Record<string, unknown>;

describe("random play", () => {
  const took = new Map<string, number>();
  const starts: [string, () => F.Yard][] = [
    ["a new yard", () => F.create({ seed: 11 })],
    ["a yard at tier 1", () => F.create({ seed: 12, tier: 1 })],
    ["a yard at tier 3", () => F.create({ seed: 13, tier: 3 })],
    ["a yard with tier 4 done", () => F.create({ seed: 14, tier: 5 })],
    ["a yard with tier 5's research done", () => F.create({ seed: 15, tier: 6 })],
    ["a yard with tier 6's research done", () => F.create({ seed: 16, tier: 7 })],
    ["a delivering yard, its board filled", boardFilled],
    ["a yard clearing a plot, all it wants delivered", clearingFilled],
    ["a generated yard", () => F.decode(F.encode(generated().y), generated().y.land) ?? F.create()],
  ];
  // The yard with every kind open plays longer: with 21 kinds to pick from, 500 commands may build none of one.
  for (const [name, start] of starts)
    test(`${name}: a refused command changes nothing, and the yard reads back as itself`, () => {
      new Player(start(), name.length * 7919, took, true).play(name.includes("tier 6") ? 2000 : 500);
    }, 60_000);

  test("reached every kind of command and piece", () => {
    const keys = [
      ...Object.keys(F.REFUSED),
      "collect",
      ...F.KINDS.filter((k) => k !== "depot").map((k) => `piece ${k}`),
    ];
    expect(keys.filter((k) => !took.has(k))).toEqual([]);
  });
});

const ctx = (now: number): Ctx => ({
  now,
  player: { id: "p", guest: false },
  seed: 9,
  room: 0,
  awards: [],
  postcards: {},
});
const at0 = 1_800_000_000_000;
const HOUR = 3600 * 1000;

/**
 * A batch of commands off the wire, done to a yard as Leaf's play service does them (`FACTORY`):
 * the yard run on to Leaf's clock, then each command run on to and done, and what a visitor is told
 * of each one done (`echo`), with Leaf's answer to the batch.
 */
function leafBatch(y: F.Yard, commands: readonly Rec[], now: number): { did: unknown[]; after: unknown } {
  const at = ctx(now);
  F.FACTORY.tend?.(y, at, () => true);
  F.FACTORY.advance(y, at);
  const did: unknown[] = [];
  for (const raw of commands) {
    const c = F.FACTORY.command(raw);
    if (!c) continue;
    F.FACTORY.tend?.(y, at, () => true, c);
    if (!("refused" in F.FACTORY.apply(y, c, at))) did.push(F.FACTORY.echo?.(y, c));
  }
  return { did, after: F.FACTORY.answer?.(y, at) };
}

/**
 * A visitor's copy does what Leaf told it a batch did, as the visitor's page does: each command at
 * its tick, as the rules read one off the wire, then on to the tick Leaf's answer is of. Gives the
 * copy's check there, and Leaf's.
 */
function follow(copy: F.Yard, told: { did: unknown[]; after: unknown }): [number, number] {
  const after = F.readAnswer(JSON.parse(JSON.stringify(told.after)));
  if (!after) throw new Error("Leaf's answer does not read");
  for (const echo of told.did) {
    const c = F.readCommand(JSON.parse(JSON.stringify(echo)));
    if (!c) throw new Error(`${JSON.stringify(echo)} does not read`);
    // Never in the copy's past: Leaf does a command at its yard's tick or later.
    expect(c.tick).toBeGreaterThanOrEqual(copy.tick);
    const done = F.play(copy, c);
    if ("refused" in done) throw new Error(`${c.do} was refused on the copy: ${done.why}`);
  }
  F.stepTo(copy, after.tick);
  const mine = F.check(copy);
  expect(F.hear(copy, after.hung)).toBe(true);
  return [mine, after.check];
}

describe("what a visitor is told", () => {
  // The owner away past the time the yard runs unwatched is eight hours of ticks each time: not for
  // the generated yard, where they would take seconds.
  const starts: [string, () => F.Yard, boolean][] = [
    ["a new yard", () => F.create({ seed: 21 }), true],
    ["a yard at tier 3", () => F.create({ seed: 23, tier: 3 }), true],
    ["a yard with tier 4 done", () => F.create({ seed: 24, tier: 5 }), true],
    ["a yard with tier 5's research done", () => F.create({ seed: 25, tier: 6 }), true],
    ["a delivering yard, its board filled", boardFilled, true],
    ["a yard clearing a plot, all it wants delivered", clearingFilled, true],
    ["a generated yard", () => F.decode(F.encode(generated().y), generated().y.land) ?? F.create(), false],
  ];
  const told = new Set<string>();
  for (const [name, start, away] of starts)
    test(`${name}: a copy that does a batch's commands at the ticks Leaf did them has Leaf's check`, () => {
      const y = start();
      y.at = at0;
      y.seen = F.here(y);
      const player = new Player(y, name.length * 104_729, new Map());
      let now = at0;
      // The visitor's copy is the yard as Leaf gives a visitor it.
      const shown = F.readView(F.FACTORY.visit?.(y, ctx(now)));
      const copy = shown && F.decode(shown.yard, y.land);
      if (!copy) throw new Error("the visit does not read");
      let done = 0;
      for (let batch = 0, batches = away ? 400 : 120; batch < batches; batch++) {
        // Time passes between batches; once in a while the owner is away past the time the yard runs unwatched.
        now += away && batch % 100 === 99 ? 9 * HOUR : player.int(3000);
        const clock = F.clockOf(y, now);
        // Now and then a node put in the line after the one in hand and taken out again, a machine
        // tipped out, and a clearing handed over, which play at random seldom finds a moment for.
        const lined = F.NODES.find((n) => {
          const g = F.goalNamed(n.id);
          return batch % 20 === 0 && g !== null && F.queueRefusal(y, g) === null;
        });
        const tipped = batch % 20 === 10 ? [{ do: "tipOut", item: null, ...player.of(F.MILL, F.BENCH, F.CRATE) }] : [];
        const ready = batch % 20 === 5 && F.clearingReady(y) ? y.clearing : null;
        const handed = ready ? [{ do: "handClearing", plot: F.plotName(ready.plot), start: ready.start }] : [];
        // Each stamped as the owner's page stamps them: about Leaf's clock, now and then behind it or ahead.
        const commands = [
          ...Array.from({ length: 1 + player.int(6) }, () => player.command()),
          ...(lined
            ? [
                { do: "queue", node: lined.id },
                { do: "unqueue", node: lined.id },
              ]
            : []),
          ...tipped,
          ...handed,
        ].map((c) => Object.assign(c, { tick: Math.max(0, clock - 40 + player.int(90)) }));
        const batched = leafBatch(y, commands, now);
        done += batched.did.length;
        for (const echo of batched.did) told.add(F.readCommand(echo)?.do ?? "");
        const [mine, leafs] = follow(copy, batched);
        expect(mine).toBe(leafs);
      }
      // The batches did something: this is not a copy and a yard that both stood still.
      expect(done).toBeGreaterThan(40);
    }, 30_000);

  test("was told every kind of command", () => {
    expect([...Object.keys(F.REFUSED), "collect"].filter((k) => !told.has(k))).toEqual([]);
  });
});

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
