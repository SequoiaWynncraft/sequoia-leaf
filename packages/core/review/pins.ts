/**
 * Stored shapes pinned, for every game: for each shape Leaf stores (a game's state, a postcard, a
 * standing, what a game logs), the keys its writer writes, pinned beside its version. Leaf runs two
 * containers on one database during a deploy, so a row one writes must mean the same to the other: a
 * version once pinned keeps its keys for ever, and a shape that gains or loses a field takes a new
 * version (one that re-means a field takes one too, though no key says so). A shape kept with no
 * version of its own is given a number that stands for one, and moves when its keys do.
 *
 * Beside the pins, a stored row of each shape at each version: written when that version is first
 * seen, and never again. Each must read for ever. Each game's review holds its own, as `keys.txt` and
 * `stored/` in a folder of its own, and a test that runs its writers and asks `pinsNow`; the same
 * script writes the pins and the rows first seen with `--write` (`writePins`).
 *
 * The keys are what the goldens saw written, so a shape's writer must be seen writing each of its
 * fields: a field no golden row has is a field no pin holds.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

/** For each shape, the keys pinned at each version. */
export type Pins = Map<string, Map<number, readonly string[]>>;

/**
 * Every key a value is written with, as a path: `board[].want`, `camp.tray.*`. An object at a path
 * in `maps` is keyed by ids rather than field names, and its keys are one, `*`.
 */
export function keysOf(v: unknown, maps: ReadonlySet<string>, into = new Set<string>(), at = ""): Set<string> {
  if (Array.isArray(v)) for (const x of v) keysOf(x, maps, into, `${at}[]`);
  else if (typeof v === "object" && v !== null) {
    const map = maps.has(at);
    for (const [k, x] of Object.entries(v)) {
      const path = `${at === "" ? "" : `${at}.`}${map ? "*" : k}`;
      into.add(path);
      keysOf(x, maps, into, path);
    }
  }
  return into;
}

/** The name of a stored row: `yard-v11-gate.json`. */
export const rowName = (shape: string, version: number, kept: string): string => `${shape}-v${version}-${kept}.json`;

/** What the goldens saw written: the keys of each shape at each version, and a first row of each case worth keeping. */
export class Seen {
  readonly keys = new Map<string, Map<number, Set<string>>>();
  /** By the name its stored row would have (`rowName`). */
  readonly rows = new Map<string, string>();
  /** For each shape, the paths of it that are keyed by ids (`keysOf`). */
  readonly maps: Readonly<Record<string, ReadonlySet<string>>>;
  constructor(maps: Readonly<Record<string, ReadonlySet<string>>> = {}) {
    this.maps = maps;
  }
  /**
   * A value written as a shape at a version: its keys, and, kept as a case, the first text of that
   * case at that version as a row worth keeping. `value` is the text read as plain values, as the
   * shape's pin should see it: for a shape with packed parts, those parts as keys.
   */
  saw(shape: string, version: number, value: unknown, kept?: { readonly as: string; readonly text: string }): void {
    const versions = this.keys.get(shape) ?? new Map<number, Set<string>>();
    this.keys.set(shape, versions);
    const keys = versions.get(version) ?? new Set<string>();
    versions.set(version, keys);
    keysOf(value, this.maps[shape] ?? new Set(), keys);
    const name = kept && rowName(shape, version, kept.as);
    if (kept && name && !this.rows.has(name)) this.rows.set(name, kept.text);
  }
  /** The keys seen, as pins: each shape's at each version, in order. */
  pins(): Pins {
    return new Map(
      [...this.keys].map(([shape, versions]) => [
        shape,
        new Map([...versions].map(([v, keys]) => [v, [...keys].toSorted()])),
      ]),
    );
  }
}

// ---------- keys.txt ----------

export function readPins(text: string): Pins {
  const pins: Pins = new Map();
  for (const block of text.split(/\n(?=\S)/)) {
    const [head = "", ...keys] = block.split("\n").filter((l) => l !== "");
    const [shape = "", version] = head.split(" ");
    if (shape === "" || version === undefined) continue;
    const versions = pins.get(shape) ?? new Map<number, readonly string[]>();
    pins.set(
      shape,
      versions.set(
        Number(version),
        keys.map((k) => k.trim()),
      ),
    );
  }
  return pins;
}
/** Pins as `keys.txt` has them: each shape by name, each of its versions in order, a key a line under it. */
export function pinsText(pins: Pins): string {
  const out: string[] = [];
  for (const shape of [...pins.keys()].toSorted()) {
    const versions = pins.get(shape);
    for (const v of [...(versions?.keys() ?? [])].toSorted((a, b) => a - b))
      out.push(`${shape} ${v}`, ...(versions?.get(v) ?? []).map((k) => `  ${k}`));
  }
  return out.map((l) => `${l}\n`).join("");
}

/**
 * The pins as they would be written now, or why they cannot be: a version pinned already keeps its
 * keys, so a shape written with other keys under it is refused. A new version is pinned beside the
 * old, which stay pinned for the rows they wrote.
 */
export function pinned(was: Pins, now: Pins): { pins: Pins; refused: string[] } {
  const pins: Pins = new Map([...was].map(([s, v]) => [s, new Map(v)]));
  const refused: string[] = [];
  for (const [shape, versions] of now)
    for (const [v, keys] of versions) {
      const before = pins.get(shape)?.get(v);
      if (before && before.join() !== keys.join()) {
        const moved = [
          ...keys.filter((k) => !before.includes(k)).map((k) => `+${k}`),
          ...before.filter((k) => !keys.includes(k)).map((k) => `-${k}`),
        ];
        refused.push(
          `${shape} is written with other keys at version ${v} (${moved.join(" ")}): a stored shape that changes takes a new version`,
        );
      }
      if (!before) pins.set(shape, (pins.get(shape) ?? new Map<number, readonly string[]>()).set(v, keys));
    }
  return { pins, refused };
}

// ---------- a game's pins, on disk ----------

/** A game's pins and stored rows, in a folder of its review (`dir`, ending in `/`). */
export class Pinned {
  readonly dir: URL;
  readonly stored: URL;
  constructor(dir: URL) {
    this.dir = dir;
    this.stored = new URL("stored/", dir);
  }
  written(): Pins {
    const file = new URL("keys.txt", this.dir);
    return readPins(existsSync(file) ? readFileSync(file, "utf8") : "");
  }
  /** The stored rows of a shape, of every version, by name. */
  rows(shape: string): [string, string][] {
    if (!existsSync(this.stored)) return [];
    return readdirSync(this.stored)
      .filter((name) => name.startsWith(`${shape}-v`))
      .toSorted()
      .map((name): [string, string] => [name, readFileSync(new URL(name, this.stored), "utf8")]);
  }
  /** The version a stored row was kept at, by its name. */
  static versionOf(name: string): number {
    return Number(/-v(\d+)-/.exec(name)?.[1] ?? Number.NaN);
  }
}

/** What differs between the pins written and what the writers write now (`versions`: each shape's version now). */
export interface Check {
  /** Shapes whose keys moved under a version already pinned. */
  readonly refused: readonly string[];
  /** Shapes at their version now that no pin holds yet, or that the goldens never saw written. */
  readonly unpinned: readonly string[];
  /** Rows of a case at a version that is not kept yet. */
  readonly unkept: readonly string[];
}
export function pinsNow(at: Pinned, seen: Seen, versions: Readonly<Record<string, number>>): Check {
  const was = at.written();
  const { refused } = pinned(was, seen.pins());
  const unpinned = Object.entries(versions).flatMap(([shape, v]) =>
    !seen.keys.get(shape)?.has(v)
      ? [`${shape} ${v} is never seen written`]
      : was.get(shape)?.has(v)
        ? []
        : [`${shape} ${v} is not pinned yet`],
  );
  const unkept = [...seen.rows.keys()].filter((name) => !existsSync(new URL(name, at.stored)));
  return { refused, unpinned, unkept };
}

/** A stored row as the repository keeps it: as `bun fmt` leaves it. */
function formatted(name: string, text: string): string {
  const run = Bun.spawnSync({
    cmd: [process.execPath, "fmt", `--stdin-filepath=${name}`],
    stdin: Buffer.from(text),
    stdout: "pipe",
  });
  if (run.exitCode !== 0) throw new Error(`${name} would not format`);
  return run.stdout.toString();
}

/**
 * Says how the pins stand, and with `write`, writes them and each row first seen: nothing, and
 * false, when a shape is refused.
 */
export function writePins(at: Pinned, seen: Seen, versions: Readonly<Record<string, number>>, write: boolean): boolean {
  const check = pinsNow(at, seen, versions);
  const now = Object.entries(versions).map(([s, v]) => `${s} ${v}`);
  const state = check.refused.length > 0 ? "refused" : check.unpinned.length > 0 ? "not all pinned" : "as pinned";
  console.log(`keys: ${now.join(", ")}: ${state}.`);
  for (const line of [...check.refused, ...check.unpinned]) console.log(`  ${line}`);
  console.log(
    `stored: ${check.unkept.length === 0 ? "every case has its rows" : `${check.unkept.join(", ")} not kept yet`}.`,
  );
  if (!write) return check.refused.length === 0;
  if (check.refused.length > 0) {
    console.log("Pins not written: give each shape refused a new version first.");
    return false;
  }
  mkdirSync(at.stored, { recursive: true });
  writeFileSync(new URL("keys.txt", at.dir), pinsText(pinned(at.written(), seen.pins()).pins));
  for (const name of check.unkept) writeFileSync(new URL(name, at.stored), formatted(name, seen.rows.get(name) ?? ""));
  return true;
}
