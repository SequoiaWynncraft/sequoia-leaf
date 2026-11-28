/**
 * The Works' goldens: what today's rules do, written down, so that a change meant to change nothing
 * proves it, and one meant to change something shows what it changed:
 *
 *     bun review/golden.ts           # every golden against the rules now: what differs, set by set
 *     bun review/golden.ts --write   # the same, then the goldens written as the rules have them now
 *
 * `golden.test.ts` holds them in `bun run verify`. Regenerating one is a line in the PR's
 * description saying why. In `golden/`:
 *
 * - `yards.txt`: a staged yard at every tier, made by the tests' stagers (`test/yards.ts` and the tier
 *   5 and 6 yards), each run on `TICKS` ticks; by a hash of where it started and one of where it ended
 *   (`state.ts`);
 * - `scripts.txt`: commands read off the wire as Leaf takes them (`FACTORY.command`), each done or
 *   refused by `FACTORY.apply` (`scripts.ts`); by a hash of what each did (refused with what, or what
 *   it paid, whether that was free of the earnings cap, logged and noted) and one of the yard at the end;
 * - `long.txt`: a yard brought on 8 hours as Leaf brings one: in one go (`advance`), in `tend`'s
 *   slices, and in slices with the yard stored and read back between each, as Leaf may let go of its
 *   copy between them. The three must end as one yard, or nothing is compared or written;
 * - `keys.txt`, `stored/` and `inventory.txt`: the keys of each shape the Works has Leaf store, pinned
 *   beside its version, and a row of each case at each version, from the writer cases (`cases.ts`).
 *   What the goldens see written must be in them.
 *
 * A golden hashes what the rules did, never how a yard is stored, each record's keys in order
 * (`@sequoia-leaf/core/review/golden.ts`); a change of the stored shape alone changes no golden but
 * `keys.txt`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { type Ctx, isRefused } from "@sequoia-leaf/core";
import { type Golden, goldensIn, goldensText, Hash, hashOf, tell } from "@sequoia-leaf/core/review/golden.ts";
import { Pinned, sawLogs, type Seen, uncovered, writePins } from "@sequoia-leaf/core/review/pins.ts";

import * as F from "../src/index.ts";
import { roadbedYard } from "../test/roadbed.ts";
import { townlightYard } from "../test/townlight.ts";
import { junctions, lay, must, staged, STAGES } from "../test/yards.ts";
import { cases, seenNow, VERSIONS, watch } from "./cases.ts";
import { type Script, SCRIPTS, type Step } from "./scripts.ts";
import { inWords, yardState } from "./state.ts";

export const GOLDEN = new URL("golden/", import.meta.url);
export const PINS = new Pinned(GOLDEN);
/** How long each staged yard is run on: ten minutes of the yard's time. */
export const TICKS = 6000;
const HOUR_MS = 3600 * 1000;

// ---------- staged yards, run on ----------

/** Tier 1 open, the first lessons done by play: planks sawn from deadfall and ore gathered, each laid into the depot. */
function tierOne(): F.Yard {
  const y = F.create({ seed: 20_261_122, tier: 1 });
  const [cx, cz] = y.land.depot;
  must(y, { do: "build", kind: "gatherer", x: cx + 5, y: cz + 3, dir: 3 });
  must(y, { do: "build", kind: "mill", x: cx + 5, y: cz + 2, dir: 2 });
  lay(y, [cx + 4, cz + 2], [cx, cz]);
  must(y, { do: "build", kind: "gatherer", x: cx - 5, y: cz - 3, dir: 0 });
  lay(y, [cx - 4, cz - 3], [cx, cz]);
  for (let k = 0; k < 600; k++) F.step(y);
  return y;
}

/** The staged yards: every stage the tests' stagers make, a yard at tier 1, and tier 5's and 6's. */
export const YARDS: readonly (readonly [string, () => F.Yard])[] = [
  ...STAGES.map((s): [string, () => F.Yard] => [s, () => staged(s)]),
  ["tier 1", tierOne],
  ["junctions", junctions],
  ["townlight", () => townlightYard()],
  ["townlight without slag", () => townlightYard(false)],
  ["roadbed", () => roadbedYard()],
  ["roadbed without cracking", () => roadbedYard(false)],
];
/** The tiers the staged yards stand at, from the first to the last the Works has open in a stager. */
export const TIERS = [0, 1, 2, 3, 4, 5, 6];

export function yardLine(name: string, make: () => F.Yard, seen: Seen): Golden & { readonly tier: number } {
  const y = make();
  const start = hashOf(yardState(y));
  const tier = y.open.tier;
  watch(seen, y);
  for (let k = 0; k < TICKS; k++) F.step(y);
  watch(seen, y);
  return { id: `yard ${name}`, says: inWords(y), hashes: `start ${start} end ${hashOf(yardState(y))}`, tier };
}
export const yardLines = (seen: Seen): Golden[] =>
  YARDS.map(([name, make]) => {
    const { id, says, hashes } = yardLine(name, make, seen);
    return { id, says, hashes };
  });

// ---------- commands off the wire ----------

const ctxAt = (now: number, seed: number, room: number): Ctx => ({
  now,
  player: { id: "00000000-0000-4000-8000-00000000601d", guest: false },
  seed,
  room,
  awards: [],
  postcards: {},
});

const STAFF_ACTOR = { by: "00000000-0000-4000-8000-0000000060d2", name: "Staff" } as const;

/** A step of a script done: a command read off the wire (or staff channel) and done or refused, or the yard run on. */
function stepDone(
  y: F.Yard,
  script: Script,
  step: Step,
  n: number,
  seen: Seen,
): { y: F.Yard; did: unknown; ok: boolean } {
  const room = script.room ?? 1e9;
  if ("wait" in step) {
    const at = y.at + (step.wait + F.LEAD) * F.TICK_MS;
    return { y: F.FACTORY.advance(y, ctxAt(at, n, room)), did: ["wait", step.wait, y.tick], ok: true };
  }
  const raw =
    "staff" in step
      ? typeof step.staff === "function"
        ? step.staff(y)
        : step.staff
      : typeof step.send === "function"
        ? step.send(y)
        : step.send;
  const c =
    "staff" in step
      ? F.readStaffCommand(JSON.parse(JSON.stringify({ ...STAFF_ACTOR, ...raw })))
      : F.FACTORY.command(JSON.parse(JSON.stringify({ tick: y.tick, id: `c${n}`, ...raw })));
  if (!c) throw new Error(`the wire does not read ${JSON.stringify(raw)}`);
  const done = F.FACTORY.apply(y, c, ctxAt(y.at, n, room));
  if (isRefused(done)) return { y, did: [raw.do, "refused", done.refused], ok: false };
  sawLogs(seen, done.log ?? []);
  // Whether a payment is free of the earnings cap is what Leaf pays it in by.
  const coins = (done.coins ?? []).map((m) => [m.amount, m.reason, m.key, m.free === true]);
  return { y: done.state, did: [raw.do, coins, done.log ?? [], done.notes], ok: true };
}

export function scriptLine(script: Script, seen: Seen): Golden {
  let y = script.yard();
  const draws = new Hash();
  const results: string[] = [];
  script.steps.forEach((step, n) => {
    const done = stepDone(y, script, step, n, seen);
    y = done.y;
    draws.add(done.did);
    if (!("wait" in step)) results.push(done.ok ? "d" : "r");
  });
  watch(seen, y);
  return {
    id: `script ${script.name}`,
    says: `${results.join("")}: ${inWords(y)}`,
    hashes: `did ${draws.short()} end ${hashOf(yardState(y))}`,
  };
}
export const scriptLines = (seen: Seen): Golden[] => SCRIPTS.map((s) => scriptLine(s, seen));

// ---------- 8 hours, in one go and in slices ----------

/** The yard brought on: the gate's, tier 4 open, which runs 12 hours unwatched. */
const longYard = (): F.Yard => staged("gate");
/** How many ticks a slice runs. */
const SLICE = 5000;
export const WAYS = ["one go", "slices", "stored slices"] as const;

/**
 * Brings a yard on 8 hours: in one go, in `tend`'s slices, or in slices with the yard stored and read
 * back between each, as Leaf may. Each yard it stores, and the end, are seen written (`seen`).
 */
export function broughtOn(way: (typeof WAYS)[number], seen: Seen): F.Yard {
  let y = longYard();
  const ctx = ctxAt(y.at + 8 * HOUR_MS, 1, 1e9);
  if (way === "one go") return seenAt(seen, F.FACTORY.advance(y, ctx));
  for (let further = true; further;) {
    let left = SLICE;
    further = F.FACTORY.tend?.(y, ctx, () => left-- > 0) ?? false;
    if (way === "stored slices" && further) {
      watch(seen, y);
      const read = F.FACTORY.decode(F.FACTORY.encode(y));
      if (!read) throw new Error("a yard stored between slices does not read");
      y = read;
    }
  }
  return seenAt(seen, F.FACTORY.advance(y, ctx));
}
const seenAt = (seen: Seen, y: F.Yard): F.Yard => {
  watch(seen, y);
  return y;
};
/** The three ways' ends, each as the goldens see a yard, and the parts in which a way ends otherwise than in one go. */
export function longRuns(seen: Seen): { lines: Golden[]; apart: string[] } {
  const ends = WAYS.map((way) => {
    const y = broughtOn(way, seen);
    return { way, y, state: yardState(y) };
  });
  const [first] = ends;
  const apart = ends.flatMap(({ way, state }) =>
    Object.keys(state).flatMap((part) =>
      Bun.deepEquals(state[part], first?.state[part]) ? [] : [`${way} ends otherwise than one go in its ${part}`],
    ),
  );
  const lines = ends.map(({ way, y, state }) => ({
    id: `long ${way}`,
    says: inWords(y),
    hashes: `end ${hashOf(state)}`,
  }));
  return { lines, apart };
}

// ---------- all of it ----------

export interface Goldens {
  readonly yards: Golden[];
  readonly scripts: Golden[];
  readonly long: Golden[];
  /** Where the long ways end apart: nothing, or no golden is compared or written. */
  readonly apart: string[];
  /** What the writer cases write: the pins. */
  readonly cases: Seen;
  /** What the goldens saw written, which the cases must hold. */
  readonly played: Seen;
}
const read = (name: string): string =>
  existsSync(new URL(name, GOLDEN)) ? readFileSync(new URL(name, GOLDEN), "utf8") : "";
export const written = (name: "yards" | "scripts" | "long"): Golden[] => goldensIn(read(`${name}.txt`));

export function goldensNow(): Goldens {
  const played = seenNow();
  const yards = yardLines(played);
  const scripts = scriptLines(played);
  const { lines, apart } = longRuns(played);
  const seen = seenNow();
  cases(seen);
  return { yards, scripts, long: lines, apart, cases: seen, played };
}

if (import.meta.main) {
  const write = process.argv.includes("--write");
  const now = goldensNow();
  if (now.apart.length > 0) {
    console.log(`The long ways end apart, so nothing is compared or written:\n  ${now.apart.join("\n  ")}`);
    process.exit(1);
  }
  tell("yards", written("yards"), now.yards);
  tell("scripts", written("scripts"), now.scripts);
  tell("long", written("long"), now.long);
  // Nothing is written unless everything holds: what play writes is all in the cases, and the pins stand.
  const missed = uncovered(now.cases.pins(), now.played);
  if (missed.length > 0) {
    console.log(
      `What the goldens see written that no writer case writes, so nothing is written:\n  ${missed.join("\n  ")}`,
    );
    process.exit(1);
  }
  if (!writePins(PINS, now.cases, VERSIONS, write)) process.exit(1);
  if (write) {
    writeFileSync(new URL("yards.txt", GOLDEN), goldensText(now.yards));
    writeFileSync(new URL("scripts.txt", GOLDEN), goldensText(now.scripts));
    writeFileSync(new URL("long.txt", GOLDEN), goldensText(now.long));
    console.log("Written. Say why in the PR's description.");
  }
}
