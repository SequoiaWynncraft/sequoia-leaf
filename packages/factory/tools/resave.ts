/**
 * A dry run of the codec over real yards: `bun packages/factory/tools/resave.ts <folder>`. Every
 * `.json` file in the folder is a kept yard (the text Leaf keeps in `play_state.state`, or a save of
 * `test/saves/`, `{ "text": ... }`). Each is read, kept again and read again, and the script reports
 * any difference: a yard that does not read; one whose second reading differs from its first (its
 * kept text or its check); one that reads otherwise on a land with a ring of plots round the guild's
 * (`test/ring.ts`: every piece, redwood felled and plan from the depot, and the check); and anything
 * the first reading let go (`losses`): a piece that did not stand, Coins paid back into the till for
 * one, a plot, a redwood felled or a plan not kept. A yard kept on more land than this Leaf's, or by
 * a newer version, does not read here: it is a newer Leaf's (`keptLater`). It reads nothing but the
 * folder, writes nothing, and ends with 1 if any yard differs.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { unpackCells } from "../src/cells.ts";
import * as F from "../src/index.ts";
import { readKeptLand } from "../src/keptland.ts";
import { RINGED } from "../test/ring.ts";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** A file's kept yard: the record itself, or a save's `text`. */
function keptText(file: string): string | null {
  const text = readFileSync(file, "utf8");
  try {
    const raw: unknown = JSON.parse(text);
    if (isRec(raw) && typeof raw.text === "string") return raw.text;
    return isRec(raw) ? text : null;
  } catch {
    return null;
  }
}

/** How many pieces a kept yard keeps, before any is stood. */
function keptPieces(raw: Rec): number {
  if (Array.isArray(raw.cells)) return raw.cells.length;
  const on = readKeptLand(raw.land);
  const bytes = typeof raw.cells === "string" ? F.fromBase64(raw.cells) : null;
  return (on && bytes && unpackCells(bytes, on.w * on.h)?.length) ?? 0;
}

const standing = (y: F.Yard): number => y.kind.filter((k) => k !== F.NONE && k !== F.DEPOT).length;

/** Everything kept with a place, each place from the depot, as one text: the pieces, the redwoods felled, the plans. */
function places(y: F.Yard): string {
  const [dx, dy] = y.land.depot;
  const at = (x: number, z: number): string => `${x - dx},${z - dy}`;
  const piece = (p: F.Piece, whole: boolean): string =>
    JSON.stringify(Object.assign({}, p, whole ? { x: 0, y: 0, at: at(p.x, p.y) } : {}));
  return JSON.stringify({
    pieces: F.piecesAt(y, [...y.kind.keys()]).map((p) => piece(p, true)),
    felled: y.land.trees.flatMap((tiles, t) =>
      y.felled[t] === 1 ? [at((tiles[0] ?? 0) % y.land.w, Math.floor((tiles[0] ?? 0) / y.land.w))] : [],
    ),
    plans: y.blueprints.map((b) => b && F.piecesOf(b.pieces).map((p) => piece(p, b.whole))),
  });
}

const count = (v: unknown): number => (Array.isArray(v) ? v.filter((x) => x !== null).length : 0);

/** What the first reading of a kept yard (`raw`) let go, as lines: none for a yard read whole. */
function losses(raw: Rec, first: F.Yard): string[] {
  const kept = keptPieces(raw);
  const stood = standing(first);
  const till = typeof raw.till === "number" ? raw.till : 0;
  // The first design kept its till in whole Coins.
  const paid = first.till - (raw.v === 3 ? Math.floor(till * F.MILLI) : till);
  const owned = new Set<string>(first.plots.map(F.plotName));
  const dropped = (Array.isArray(raw.plots) ? raw.plots : []).filter((n) => typeof n !== "string" || !owned.has(n));
  const felled = count(raw.felled) - first.felled.filter((f) => f === 1).length;
  const plans = count(raw.blueprints) - first.blueprints.filter((b) => b !== null).length;
  return [
    ...(stood < kept ? [`${kept - stood} of ${kept} pieces did not stand`] : []),
    ...(paid > 0 ? [`${paid / F.MILLI} Coins paid back into the till`] : []),
    ...(dropped.length > 0 ? [`plots not kept: ${dropped.join(", ")}`] : []),
    ...(felled > 0 ? [`${felled} redwoods felled not kept`] : []),
    ...(plans > 0 ? [`${plans} plans not kept`] : []),
  ];
}

/** What differs about one kept yard, as lines, and a note of what it is. */
function differences(text: string): { lines: string[]; note: string } {
  const raw: unknown = JSON.parse(text);
  const note = isRec(raw) ? `v${String(raw.v)}, ${keptPieces(raw)} pieces kept` : "";
  if (F.keptLater(text)) return { lines: ["a newer Leaf's (a later version, or kept on more land): not read"], note };
  const first = F.decode(text);
  if (!isRec(raw) || !first) return { lines: ["does not read"], note };
  const lines = losses(raw, first);
  const again = F.decode(F.encode(first));
  if (!again) lines.push("kept again, does not read");
  else {
    if (F.encode(again) !== F.encode(first)) lines.push("kept again, reads otherwise");
    if (F.check(again) !== F.check(first)) lines.push(`kept again, check ${F.check(again)} not ${F.check(first)}`);
  }
  const ringed = F.decode(text, RINGED);
  first.history = [];
  if (!ringed) lines.push("does not read on a land with a ring");
  else {
    if (places(ringed) !== places(first)) lines.push("on a land with a ring, something kept is elsewhere");
    if (F.check(ringed) !== F.check(first)) lines.push("on a land with a ring, the check differs");
  }
  return { lines, note };
}

const folder = process.argv[2];
if (folder === undefined) {
  console.error("Say the folder of kept yards: bun packages/factory/tools/resave.ts <folder>");
  process.exit(2);
}
const files = readdirSync(folder)
  .filter((f) => f.endsWith(".json"))
  .toSorted();
let differ = 0;
for (const name of files) {
  const text = keptText(join(folder, name));
  const { lines, note } = text === null ? { lines: ["is not a kept yard"], note: "" } : differences(text);
  if (lines.length > 0) differ++;
  console.log(`${lines.length > 0 ? "DIFFERS" : "same   "} ${name}${note ? `: ${note}` : ""}`);
  for (const line of lines) console.log(`        ${line}`);
}
console.log(`${files.length} yards, ${differ} differ`);
process.exit(differ > 0 ? 1 : 0);
