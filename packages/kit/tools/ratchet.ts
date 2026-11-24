/**
 * A ratchet: counts that may only go down. A check (`lint.ts`, `imports.ts`, `clones.ts`) counts
 * what it finds by group and key, such as a rule's hits by file, and holds the counts to a baseline
 * kept beside this file in `baseline/`:
 *
 * - a key the baseline does not have, or a count above the baseline's, fails;
 * - a count below the baseline's fails too, until the baseline is lowered in the same change, so
 *   that what was taken out cannot come back unseen. `--lower` writes it lowered: it never adds a
 *   key or raises a count, so a new hit is fixed, not written down.
 *
 * With no baseline file the check fails, so that deleting one cannot pass it; `--start` writes one
 * with what it finds: that is how a ratchet starts.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Counts by group and key: a rule's hits by file, say. */
export type Counts = Record<string, Record<string, number>>;

/** One count that is not what the baseline says. */
export interface Change {
  readonly group: string;
  readonly key: string;
  readonly was: number;
  readonly now: number;
}

const keysOf = (a: Counts, b: Counts): [string, string][] => {
  const all = new Set<string>();
  for (const counts of [a, b])
    for (const [group, keys] of Object.entries(counts))
      for (const key of Object.keys(keys)) all.add(`${group}\0${key}`);
  return [...all].toSorted().map((both) => {
    const [group = "", key = ""] = both.split("\0");
    return [group, key];
  });
};

/** What differs from the baseline: what is new or more (`worse`), and what is less (`better`). */
export function compare(baseline: Counts, now: Counts): { worse: Change[]; better: Change[] } {
  const worse: Change[] = [];
  const better: Change[] = [];
  for (const [group, key] of keysOf(baseline, now)) {
    const was = baseline[group]?.[key] ?? 0;
    const is = now[group]?.[key] ?? 0;
    if (is > was) worse.push({ group, key, was, now: is });
    else if (is < was) better.push({ group, key, was, now: is });
  }
  return { worse, better };
}

/** The baseline lowered to what is so now: never a new key, never a higher count. */
export function lowered(baseline: Counts, now: Counts): Counts {
  const out: Counts = {};
  for (const [group, keys] of Object.entries(baseline))
    for (const [key, was] of Object.entries(keys)) {
      const is = Math.min(was, now[group]?.[key] ?? 0);
      if (is > 0) (out[group] ??= {})[key] = is;
    }
  return out;
}

/** Counts in a stable order, so a baseline changes by the lines that changed. */
const sorted = (counts: Counts): Counts =>
  Object.fromEntries(
    Object.keys(counts)
      .toSorted()
      .map((group) => [
        group,
        Object.fromEntries(Object.entries(counts[group] ?? {}).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
      ]),
  );

/** Adds one to a count. */
export function count(counts: Counts, group: string, key: string, by = 1): void {
  const keys = (counts[group] ??= {});
  keys[key] = (keys[key] ?? 0) + by;
}

/**
 * Holds `now` to the baseline `baseline/<name>.json`, printing what differs; with `--lower` on the
 * command line, lowers the baseline first. `command` is how to run the check. Says whether it passed.
 */
export function hold(name: string, now: Counts, command: string): boolean {
  const path = join(import.meta.dir, "baseline", `${name}.json`);
  const write = (counts: Counts): void => writeFileSync(path, `${JSON.stringify(sorted(counts), null, 2)}\n`);
  if (!existsSync(path)) {
    if (!process.argv.includes("--start")) {
      console.error(`No ${name} baseline at ${path}: start one with \`${command} --start\` and commit it.`);
      return false;
    }
    write(now);
    console.log(`Started the ${name} baseline with what there is now: ${path}`);
    return true;
  }
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isCounts(parsed)) throw new Error(`${path} is not counts by group and key`);
  let baseline = parsed;
  if (process.argv.includes("--lower")) {
    baseline = lowered(baseline, now);
    write(baseline);
  }
  const { worse, better } = compare(baseline, now);
  for (const c of worse)
    console.error(
      c.was === 0 ? `new: ${c.group} ${c.key} (${c.now})` : `more: ${c.group} ${c.key}, ${c.now} (was ${c.was})`,
    );
  for (const c of better) console.error(`fewer: ${c.group} ${c.key}, ${c.now} (was ${c.was})`);
  if (worse.length > 0)
    console.error(`Fix what is new or more above: ${path} only goes down, and \`${command} --lower\` never raises it.`);
  if (better.length > 0) console.error(`Fewer than the baseline: lower it with \`${command} --lower\` and commit it.`);
  return worse.length === 0 && better.length === 0;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function isCounts(x: unknown): x is Counts {
  return (
    isRecord(x) &&
    Object.values(x).every((keys) => isRecord(keys) && Object.values(keys).every((n) => Number.isInteger(n)))
  );
}
