/**
 * Stored shapes pinned, for every game: for each shape Leaf stores (a game's state, a postcard, a
 * standing, what a game logs), the keys its writer writes, pinned beside its version. Leaf runs two
 * containers on one database during a deploy, so a row one writes must mean the same to the other: a
 * version once pinned keeps its keys for ever, and a shape that gains or loses a field takes a new
 * version (one that re-means a field takes one too, though no key says so). A shape kept with no
 * version of its own is given a number that stands for one, and moves when its keys do.
 *
 * The keys are what the game's writer cases write (`Seen`): cases made to take every branch of the
 * writer, not whatever a game happened to play to. What the game's goldens see written is checked
 * against them (`uncovered`), so a branch the cases miss shows. Each game says, for each shape, the
 * versions its writers write now: a shape seen at a version it does not say, or one it says and that
 * is never seen, stops the pins.
 *
 * Beside the pins, a stored row of each case at each version (`stored/`), with what it must read as,
 * worked out from the state it was written from: written when that version is first seen, and never
 * again. `inventory.txt` lists every row kept, and only grows: each must be there, and must read as
 * it says for ever. The same script writes the pins, the rows first seen and their lines in the
 * inventory with `--write` (`writePins`).
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

import type { Logged } from "../src/play.ts";
import { talliedFrom } from "../src/tally.ts";

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

/** A stored row as the repository keeps it: the text Leaf stores, and what it must read as. */
export interface Row {
  readonly text: string;
  readonly read: unknown;
}
/** A row a case kept: its shape and version, and the row. */
export interface Kept {
  readonly shape: string;
  readonly version: number;
  readonly row: Row;
}

/** What the writers were seen writing: the keys of each shape at each version, and a first row of each case worth keeping. */
export class Seen {
  readonly keys = new Map<string, Map<number, Set<string>>>();
  /** By the name its stored row would have (`rowName`). */
  readonly rows = new Map<string, Kept>();
  /** For each shape, the paths of it that are keyed by ids (`keysOf`). */
  readonly maps: Readonly<Record<string, ReadonlySet<string>>>;
  constructor(maps: Readonly<Record<string, ReadonlySet<string>>> = {}) {
    this.maps = maps;
  }
  /**
   * A value written as a shape at a version: its keys, and, kept as a case, the first row of that
   * case at that version as a row worth keeping. `value` is the text read as plain values, as the
   * shape's pin should see it: for a shape with packed parts, those parts as keys.
   */
  saw(shape: string, version: number, value: unknown, kept?: { readonly as: string } & Row): void {
    const versions = this.keys.get(shape) ?? new Map<number, Set<string>>();
    this.keys.set(shape, versions);
    const keys = versions.get(version) ?? new Set<string>();
    versions.set(version, keys);
    keysOf(value, this.maps[shape] ?? new Set(), keys);
    if (!kept) return;
    const name = rowName(shape, version, kept.as);
    if (!this.rows.has(name)) this.rows.set(name, { shape, version, row: { text: kept.text, read: kept.read } });
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

/** What `other` saw written that the pins do not hold at its version, or a version they have nothing at: what the cases missed. */
export function uncovered(pins: Pins, other: Seen): string[] {
  return [...other.pins()].flatMap(([shape, versions]) =>
    [...versions].flatMap(([v, keys]) => {
      const pin = pins.get(shape)?.get(v);
      if (!pin) return [`${shape} ${v} is written, and no case writes it`];
      const missed = keys.filter((k) => !pin.includes(k));
      return missed.length === 0 ? [] : [`${shape} ${v} is written with ${missed.join(" ")}, which no case writes`];
    }),
  );
}

// ---------- keys.txt ----------

export function readPins(text: string): Pins {
  const pins: Pins = new Map();
  for (const block of text.split(/\n(?=\S)/)) {
    const [head = "", ...keys] = block.split("\n").filter((l) => l !== "");
    const [shape = "", version] = head.split(" ");
    if (shape === "" || version === undefined) continue;
    const versions = pins.get(shape) ?? new Map<number, readonly string[]>();
    const trimmed = keys.map((k) => k.trim());
    pins.set(shape, versions.set(Number(version), trimmed));
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

/** A line of the inventory: a row kept, by its shape, its version and its path from the pins' folder. */
export interface Listed {
  readonly shape: string;
  readonly version: number;
  readonly path: string;
}
const isRow = (v: unknown): v is Row =>
  typeof v === "object" && v !== null && "text" in v && typeof v.text === "string" && "read" in v;

/** A game's pins, its stored rows and their inventory, in a folder of its review (`dir`, ending in `/`). */
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
  /** Every row kept, as `inventory.txt` lists them: `shape version path`, a line each. */
  inventory(): Listed[] {
    const file = new URL("inventory.txt", this.dir);
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => {
        const [shape = "", version = "", path = ""] = l.split(" ");
        return { shape, version: Number(version), path };
      });
  }
  /** A row kept, by its path from the pins' folder. */
  row(path: string): Row {
    const v: unknown = JSON.parse(readFileSync(new URL(path, this.dir), "utf8"));
    if (!isRow(v)) throw new Error(`${path} is not a stored row`);
    return v;
  }
  /** The rows kept of a shape, every version, as the inventory lists them. */
  rows(shape: string): (Listed & { readonly row: Row })[] {
    return this.inventory()
      .filter((l) => l.shape === shape)
      .map((l) => ({ shape: l.shape, version: l.version, path: l.path, row: this.row(l.path) }));
  }
}

/** What stands between the pins written and what the writers write now. */
export interface Check {
  /** Shapes whose keys moved under a version already pinned. */
  readonly refused: readonly string[];
  /** Shapes seen at a version the game does not say its writers write, and those it says that are never seen. */
  readonly undeclared: readonly string[];
  /** Shapes at a version the game writes now that no pin holds yet. */
  readonly unpinned: readonly string[];
  /** Rows of a case at a version that are not kept yet. */
  readonly unkept: readonly string[];
  /** Rows the inventory lists that are not there, and rows there that it does not list. */
  readonly lost: readonly string[];
}
/** For each shape, the versions its writers write now. */
export type Versions = Readonly<Record<string, readonly number[]>>;

/** Shapes seen at versions not said, and said and never seen. */
function undeclaredIn(seen: Seen, versions: Versions): string[] {
  const said = (shape: string, v: number): boolean => versions[shape]?.includes(v) ?? false;
  const unsaid = [...seen.keys].flatMap(([shape, vs]) =>
    [...vs.keys()].flatMap((v) => (said(shape, v) ? [] : [`${shape} ${v} is written, and not said`])),
  );
  const unseen = Object.entries(versions).flatMap(([shape, vs]) =>
    vs.flatMap((v) => (seen.keys.get(shape)?.has(v) ? [] : [`${shape} ${v} is said, and never seen written`])),
  );
  return [...unsaid, ...unseen];
}

export function pinsNow(at: Pinned, seen: Seen, versions: Versions): Check {
  const was = at.written();
  const unpinned = Object.entries(versions).flatMap(([shape, vs]) =>
    vs.flatMap((v) => (was.get(shape)?.has(v) ? [] : [`${shape} ${v} is not pinned yet`])),
  );
  const listed = at.inventory();
  const paths = new Set(listed.map((l) => l.path));
  const there = existsSync(at.stored) ? readdirSync(at.stored).map((name) => `stored/${name}`) : [];
  const lost = [
    ...listed.flatMap((l) => (existsSync(new URL(l.path, at.dir)) ? [] : [`${l.path} is listed, and gone`])),
    ...there.filter((p) => !paths.has(p)).map((p) => `${p} is there, and not listed`),
  ];
  return {
    refused: pinned(was, seen.pins()).refused,
    undeclared: undeclaredIn(seen, versions),
    unpinned,
    unkept: [...seen.rows.keys()].filter((name) => !paths.has(`stored/${name}`)),
    lost,
  };
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
 * Says how the pins stand, and whether they stand as written. With `write`, and nothing refused,
 * undeclared or lost, writes the keys of each version newly written, each row first seen and its
 * line in the inventory: never a row again, and never a version the game does not say.
 */
export function writePins(at: Pinned, seen: Seen, versions: Versions, write: boolean): boolean {
  const check = pinsNow(at, seen, versions);
  const now = Object.entries(versions).map(([s, vs]) => `${s} ${vs.join(" and ")}`);
  const stops = [...check.refused, ...check.undeclared, ...check.lost];
  const state = stops.length > 0 ? "refused" : check.unpinned.length > 0 ? "not all pinned" : "as pinned";
  console.log(`keys: ${now.join(", ")}: ${state}.`);
  for (const line of [...stops, ...check.unpinned]) console.log(`  ${line}`);
  const unkept = check.unkept.length === 0 ? "every case has its rows" : `${check.unkept.join(", ")} not kept yet`;
  console.log(`stored: ${unkept}.`);
  if (stops.length > 0) {
    if (write) console.log("Pins not written: give each shape refused a new version, and say each version written.");
    return false;
  }
  if (!write) return check.unpinned.length === 0 && check.unkept.length === 0;
  mkdirSync(at.stored, { recursive: true });
  writeFileSync(new URL("keys.txt", at.dir), pinsText(pinned(at.written(), seen.pins()).pins));
  for (const name of check.unkept) {
    const kept = seen.rows.get(name);
    if (!kept) continue;
    writeFileSync(new URL(name, at.stored), formatted(name, JSON.stringify(kept.row)));
    appendFileSync(new URL("inventory.txt", at.dir), `${kept.shape} ${kept.version} stored/${name}\n`);
  }
  return true;
}

/**
 * Where a value read now is not as a stored row says it must read (`Row.read`), by path: every key
 * the row says, down through records, must be there as it says; a list must be as long, and each of
 * it as it says. A key the row does not say (one a later reader adds) is let be, so that a row reads
 * as it says for ever.
 */
export function readsOtherwise(was: unknown, now: unknown, at = ""): string[] {
  // As a stored row's has been: written out as JSON.
  const read: unknown = now === undefined ? undefined : JSON.parse(JSON.stringify(now));
  if (Array.isArray(was)) {
    if (!Array.isArray(read) || read.length !== was.length) return [at || "the whole"];
    return was.flatMap((v, n) => readsOtherwise(v, read[n], `${at}[${n}]`));
  }
  if (typeof was === "object" && was !== null) {
    if (typeof read !== "object" || read === null || Array.isArray(read)) return [at || "the whole"];
    const of = new Map(Object.entries(read));
    return Object.entries(was).flatMap(([k, v]) => readsOtherwise(v, of.get(k), at === "" ? k : `${at}.${k}`));
  }
  return was === read ? [] : [at || "the whole"];
}

/** The version a stored text says it is of (its `v`), or -1 for one that says none. */
export function versionOf(text: string): number {
  const raw: unknown = JSON.parse(text);
  return typeof raw === "object" && raw !== null && "v" in raw && typeof raw.v === "number" ? raw.v : -1;
}

/**
 * What Leaf stores of what a command logged (`Done.log`): each thing's data, as the `activity` table
 * keeps it, by its kind; a row of each kind kept as `kept` if given, read as the tally reads it
 * (`talliedFrom`). What a game logs keeps no version of its own: its 1 stands for one.
 */
export function sawLogs(seen: Seen, log: readonly Logged[], kept?: string): void {
  for (const l of log) {
    const row = { text: JSON.stringify(l.data), read: { data: l.data, tallied: talliedFrom([l]) } };
    seen.saw(l.kind, 1, l.data, kept === undefined ? undefined : { as: kept, ...row });
  }
}
