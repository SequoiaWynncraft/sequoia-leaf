/**
 * Staff commands for the Works (`readStaffCommand`, `applyStaff`), sent only through Leaf's own
 * code (`StaffCommand`), never from a player's page (`readCommand`). Each carries `by` and `name`,
 * moves no Coins, emits no player-visible activity, and leaves the yard untouched on refusal.
 */
import type { Done } from "@sequoia-leaf/core";

import { at, type Dir, fell, fellPrice, isDir } from "./build.ts";
import { fromBase64 } from "./bytes.ts";
import { CODE_MOST, codePieces, packedCode } from "./code.ts";
import { decode, encode } from "./codec.ts";
import type { Turned } from "./did.ts";
import { plotPrice } from "./land.ts";
import { unstudy } from "./orders.ts";
import { boxOf, cellsOf, clear, keptOf, packPieces, type Piece, piecesAt, placed, refusals, stand } from "./pieces.ts";
import { type KeptPrint, packPrint, unpackPrint } from "./prints.ts";
import {
  BOX_MOST,
  CLEARING,
  FIXED,
  type Goal,
  goalNamed,
  GOALS,
  isKind,
  NONE,
  type Plot,
  plotName,
  plotNamed,
  SPAN_MOST,
  SPANS,
} from "./tables.ts";
import { unpackWays } from "./tiles.ts";
import { changed, hold, redwoodAt, reopen, type Yard } from "./yard.ts";

/** Who sent a staff command: their Leaf id and display name. */
export interface StaffActor {
  readonly by: string;
  readonly name: string;
}

/** Marks goals done without pay, plus unmet needs in need order. */
export interface StaffLearn extends StaffActor {
  readonly do: "learn";
  readonly goals: readonly string[];
}

/** Grants plots as owned and cleared, without pay. */
export interface StaffPlots extends StaffActor {
  readonly do: "plots";
  readonly plots: readonly string[];
}

/** Places pieces from a blueprint code at (x, y) turned `turn`, or from packed print bytes. */
export type StaffPieces = StaffActor &
  (
    | {
        readonly do: "pieces";
        readonly code: string;
        readonly x: number;
        readonly y: number;
        readonly turn: Dir;
        readonly replace: boolean;
      }
    | {
        readonly do: "pieces";
        readonly packed: string;
        readonly replace: boolean;
      }
  );

/** Restores a full earlier yard from its encoded text. */
export interface StaffRestore extends StaffActor {
  readonly do: "restore";
  readonly yard: string;
}

export type WorksStaffCommand = StaffLearn | StaffPlots | StaffPieces | StaffRestore;

/** Summary returned in `Done.notes` for every accepted staff command. */
export interface StaffNote {
  readonly kind: "staff";
  readonly goals: readonly string[];
  readonly plots: readonly string[];
  readonly piecesBefore: number;
  readonly piecesAfter: number;
  readonly cost: number;
}

/** One blueprint chunk produced by `exportYard`. */
export interface ExportPart {
  readonly corner: { readonly x: number; readonly y: number };
  readonly size: { readonly w: number; readonly h: number };
  readonly pieces: number;
  readonly code: string;
}

const MAX_LIST = 256;
const MAX_PACKED = 2 * 1024 * 1024;
const MAX_YARD = 4 * 1024 * 1024;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isName = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
const isInt = (v: unknown, low: number, high: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= low && v <= high;

const stringList = (v: unknown): readonly string[] | null => {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_LIST) return null;
  const out: string[] = [];
  for (const item of v) {
    if (!isName(item)) return null;
    out.push(item);
  }
  return out;
};

/** Whether a command is one of the Works' staff commands. */
export function isStaffCommand(c: { readonly do: string }): c is WorksStaffCommand {
  return c.do === "learn" || c.do === "plots" || c.do === "pieces" || c.do === "restore";
}

function readPiecesCommand(v: Record<string, unknown>, actor: StaffActor): StaffPieces | null {
  const replace = v.replace === undefined ? false : v.replace;
  if (typeof replace !== "boolean") return null;
  const hasCode = v.code !== undefined;
  const hasPacked = v.packed !== undefined;
  if (hasCode === hasPacked) return null;
  if (hasCode) {
    const turn = v.turn === undefined ? 0 : v.turn;
    if (typeof v.code !== "string" || v.code.length === 0 || v.code.length > CODE_MOST * 2) return null;
    if (!isInt(v.x, -1000, 1000) || !isInt(v.y, -1000, 1000) || !isDir(turn)) return null;
    return { do: "pieces", code: v.code, x: v.x, y: v.y, turn, replace, ...actor };
  }
  if (typeof v.packed !== "string" || v.packed.length > MAX_PACKED) return null;
  return { do: "pieces", packed: v.packed, replace, ...actor };
}

/** Reads a Works staff command off Leaf's staff channel, or null for anything else. */
export function readStaffCommand(v: unknown): WorksStaffCommand | null {
  if (!isRecord(v) || !isName(v.by) || typeof v.name !== "string" || v.name.length > 64) return null;
  const actor: StaffActor = { by: v.by, name: v.name };
  if (v.do === "learn") {
    const goals = stringList(v.goals);
    return goals ? { do: "learn", goals, ...actor } : null;
  }
  if (v.do === "plots") {
    const plots = stringList(v.plots);
    return plots ? { do: "plots", plots, ...actor } : null;
  }
  if (v.do === "pieces") return readPiecesCommand(v, actor);
  if (v.do === "restore") {
    return typeof v.yard === "string" && v.yard.length > 0 && v.yard.length <= MAX_YARD
      ? { do: "restore", yard: v.yard, ...actor }
      : null;
  }
  return null;
}

/** Reads a `StaffNote` back from `Done.notes` (e.g. a batch result). */
export function readStaffNote(v: unknown): StaffNote | null {
  if (!isRecord(v) || v.kind !== "staff") return null;
  if (!Array.isArray(v.goals) || !Array.isArray(v.plots)) return null;
  const goals = v.goals.filter((g): g is string => typeof g === "string");
  const plots = v.plots.filter((p): p is string => typeof p === "string");
  if (goals.length !== v.goals.length || plots.length !== v.plots.length) return null;
  if (!isInt(v.piecesBefore, 0, 1e9) || !isInt(v.piecesAfter, 0, 1e9) || !isInt(v.cost, 0, Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return {
    kind: "staff",
    goals,
    plots,
    piecesBefore: v.piecesBefore,
    piecesAfter: v.piecesAfter,
    cost: v.cost,
  };
}

// ---------- helpers ----------

const no = (refused: string, why: string): Turned => ({ refused, why });
const allTiles = (y: Yard): number[] => Array.from({ length: y.land.w * y.land.h }, (_, i) => i);
const pieceCount = (y: Yard): number => piecesAt(y, allTiles(y)).length;

/** Clones a yard through its own codec so a refused staff command leaves the original untouched. */
function cloneYard(y: Yard): Yard {
  const copy = decode(encode(y), y.land);
  if (!copy) throw new Error("encoded yard did not decode");
  copy.rev = y.rev;
  return copy;
}

function collectNeeds(g: Goal, out: Goal[], seen: Set<Goal>): void {
  if (seen.has(g)) return;
  seen.add(g);
  for (const need of GOALS[g]?.needs ?? []) collectNeeds(need, out, seen);
  out.push(g);
}

function learn(y: Yard, c: StaffLearn): Done<Yard, StaffNote> | Turned {
  const requested: Goal[] = [];
  for (const id of c.goals) {
    const g = goalNamed(id);
    if (g === null) return no("unknown_goal", `Unknown goal: ${id}`);
    requested.push(g);
  }
  const draft = cloneYard(y);
  const ordered: Goal[] = [];
  const seen = new Set<Goal>();
  for (const g of requested) collectNeeds(g, ordered, seen);
  const added: string[] = [];
  for (const g of ordered) {
    if (draft.done.includes(g)) continue;
    draft.done.push(g);
    draft.got[g] = null;
    draft.queue = draft.queue.filter((q) => q !== g);
    unstudy(draft, g);
    if (draft.hand === g) hold(draft, -1);
    const id = GOALS[g]?.id;
    if (id !== undefined) added.push(id);
  }
  if (added.length > 0) reopen(draft);
  // Staff-learned goals never emit player-visible works_story activity.
  draft.told = draft.done.length;
  const count = pieceCount(draft);
  return {
    state: draft,
    notes: [{ kind: "staff", goals: added, plots: [], piecesBefore: count, piecesAfter: count, cost: 0 }],
    coins: [],
    log: [],
  };
}

function givePlots(y: Yard, c: StaffPlots): Done<Yard, StaffNote> | Turned {
  const requested: Plot[] = [];
  for (const id of c.plots) {
    const p = plotNamed(id);
    if (p === null || !y.land.plots.some((q) => q.plot === p)) return no("unknown_plot", `Unknown plot: ${id}`);
    requested.push(p);
  }
  const draft = cloneYard(y);
  const added: string[] = [];
  let cost = 0;
  for (const p of requested) {
    if (CLEARING[p] && !draft.cleared.includes(p)) draft.cleared.push(p);
    if (draft.clearing?.plot === p) draft.clearing = null;
    if (draft.plots.includes(p)) continue;
    cost += plotPrice(draft, p);
    draft.plots.push(p);
    added.push(plotName(p));
  }
  if (added.length > 0) {
    changed(draft);
    draft.rev++;
  }
  const count = pieceCount(draft);
  return {
    state: draft,
    notes: [{ kind: "staff", goals: [], plots: added, piecesBefore: count, piecesAfter: count, cost }],
    coins: [],
    log: [],
  };
}

function unpackPiece(p: KeptPrint[number]): Piece | null {
  const { kind: k, dir: d, span } = p;
  if (!isKind(k) || FIXED[k] === 1 || !isDir(d)) return null;
  if ((SPANS[k] === 1) !== span > 0 || span > SPAN_MOST) return null;
  const kept = keptOf(
    { recipe: p.recipe, open: p.open ? undefined : false, tint: p.tint, ...unpackWays(p.ways), grade: p.grade },
    k,
  );
  return { kind: k, x: p.x, y: p.y, dir: d, span, ...kept };
}

function decodeIncoming(c: StaffPieces): { readonly pieces: Piece[] } | Turned {
  if ("code" in c) {
    const raw = codePieces(c.code);
    if (raw === null) return no("invalid_code", "Blueprint code does not read");
    return { pieces: placed(raw, c.turn, c.x, c.y) };
  }
  const bytes = fromBase64(c.packed);
  const kept = unpackPrint(bytes);
  if (kept === null) return no("invalid_pieces", "Packed piece list does not read");
  const pieces: Piece[] = [];
  for (const p of kept) {
    const piece = unpackPiece(p);
    if (piece === null) return no("invalid_pieces", "Packed piece list contains an invalid piece");
    pieces.push(piece);
  }
  if (pieces.length === 0 && !c.replace) return no("empty_pieces", "Piece list is empty");
  return { pieces };
}

function checkGround(y: Yard, pieces: readonly Piece[]): Turned | null {
  for (const p of pieces) {
    for (const [x, z] of cellsOf(p)) {
      const i = at(y, x, z);
      if (i < 0) return no("off_land", `Piece at ${x},${z} is off the land`);
      const plot = y.land.plots[y.land.plot[i] ?? NONE];
      if (!plot || !y.plots.includes(plot.plot)) return no("plot_not_owned", `Tile ${x},${z} is not on an owned plot`);
      if (y.land.water[i] === 1) return no("on_water", `Tile ${x},${z} is on water`);
      if (FIXED[y.kind[i] ?? NONE] === 1) return no("on_depot", `Tile ${x},${z} is on the depot`);
    }
  }
  return null;
}

function classifyStandRefusal(why: string): string {
  if (why === "Two pieces cannot stand on one tile") return "overlap";
  if (why === "Something is here already") return "occupied";
  if (why === "That is off the map") return "off_land";
  if (why.endsWith("is not the yard's yet")) return "plot_not_owned";
  if (why === "Nothing can be built on the stream") return "on_water";
  if (why.includes("depot")) return "on_depot";
  if (why.includes("not unlocked yet") || why.includes("cart stop")) return "locked";
  return "cannot_place";
}

function fellUnder(y: Yard, pieces: readonly Piece[]): { readonly ok: true; readonly cost: number } | Turned {
  let cost = 0;
  for (const p of pieces) {
    for (const [x, z] of cellsOf(p)) {
      const i = at(y, x, z);
      if (i < 0 || !redwoodAt(y, i)) continue;
      const did = fell(y, x, z, fellPrice(y), Infinity);
      if (!did.ok) return no("cannot_fell", did.why);
      cost += did.cost;
    }
  }
  return { ok: true, cost };
}

function placePieces(y: Yard, c: StaffPieces): Done<Yard, StaffNote> | Turned {
  const incoming = decodeIncoming(c);
  if ("refused" in incoming) return incoming;
  const { pieces } = incoming;
  const before = pieceCount(y);
  const draft = cloneYard(y);
  const groundErr = checkGround(draft, pieces);
  if (groundErr !== null) return groundErr;
  if (c.replace) clear(draft, allTiles(draft));
  const felled = fellUnder(draft, pieces);
  if ("refused" in felled) return felled;
  const firstWhy = refusals(draft, pieces).find((r) => r !== null);
  if (firstWhy !== undefined) return no(classifyStandRefusal(firstWhy), firstWhy);
  const stood = stand(draft, pieces, Infinity);
  if (!stood.ok) return no(classifyStandRefusal(stood.why), stood.why);
  draft.history = [];
  draft.rev++;
  const after = pieceCount(draft);
  return {
    state: draft,
    notes: [
      {
        kind: "staff",
        goals: [],
        plots: [],
        piecesBefore: before,
        piecesAfter: after,
        cost: felled.cost + stood.cost,
      },
    ],
    coins: [],
    log: [],
  };
}

function restore(y: Yard, c: StaffRestore): Done<Yard, StaffNote> | Turned {
  const restored = decode(c.yard, y.land);
  if (restored === null) return no("invalid_yard", "Yard text does not decode");
  const before = pieceCount(y);
  const after = pieceCount(restored);
  restored.rev = y.rev + 1;
  return {
    state: restored,
    notes: [{ kind: "staff", goals: [], plots: [], piecesBefore: before, piecesAfter: after, cost: 0 }],
    coins: [],
    log: [],
  };
}

/** Applies a Works staff command to `y`. Moves no Coins, logs no player activity, leaves `y` untouched on refusal. */
export function applyStaff(y: Yard, c: WorksStaffCommand): Done<Yard, StaffNote> | Turned {
  switch (c.do) {
    case "learn":
      return learn(y, c);
    case "plots":
      return givePlots(y, c);
    case "pieces":
      return placePieces(y, c);
    case "restore":
      return restore(y, c);
  }
}

// ---------- export ----------

function splitAxis(pieces: readonly Piece[], axis: "x" | "y", limit: number): readonly [Piece[], Piece[]] | null {
  const box = boxOf(pieces);
  const origin = axis === "x" ? box.x : box.y;
  const span = axis === "x" ? box.w : box.h;
  const target = origin + Math.min(limit, Math.ceil(span / 2));
  const coords = [...new Set(pieces.map((p) => p[axis]))].toSorted((a, b) => a - b);
  if (coords.length < 2) return null;
  let bestCut = coords[1] ?? origin + 1;
  let bestDist = Infinity;
  for (let i = 1; i < coords.length; i++) {
    const cut = coords[i] ?? bestCut;
    const dist = Math.abs(cut - target);
    if (dist < bestDist) {
      bestDist = dist;
      bestCut = cut;
    }
  }
  const a: Piece[] = [];
  const b: Piece[] = [];
  for (const p of pieces) (p[axis] < bestCut ? a : b).push(p);
  return a.length > 0 && b.length > 0 ? [a, b] : null;
}

function splitPieces(pieces: readonly Piece[], maxW: number, maxH: number): Piece[][] {
  if (pieces.length === 0) return [];
  const box = boxOf(pieces);
  if (box.w <= maxW && box.h <= maxH) return [[...pieces]];
  const primary: "x" | "y" = box.w > maxW && (box.h <= maxH || box.w / maxW >= box.h / maxH) ? "x" : "y";
  const secondary: "x" | "y" = primary === "x" ? "y" : "x";
  const cut =
    splitAxis(pieces, primary, primary === "x" ? maxW : maxH) ??
    splitAxis(pieces, secondary, secondary === "x" ? maxW : maxH);
  if (cut !== null) return [...splitPieces(cut[0], maxW, maxH), ...splitPieces(cut[1], maxW, maxH)];
  if (pieces.length <= 1) return [[...pieces]];
  const mid = Math.ceil(pieces.length / 2);
  return [...splitPieces(pieces.slice(0, mid), maxW, maxH), ...splitPieces(pieces.slice(mid), maxW, maxH)];
}

/** Splits a yard's pieces into blueprint codes each fitting within `maxW × maxH` (default 40×30). */
export function exportYard(y: Yard, maxW = BOX_MOST.w, maxH = BOX_MOST.h): ExportPart[] {
  const pieces = piecesAt(y, allTiles(y));
  return splitPieces(pieces, maxW, maxH).map((part) => {
    const b = boxOf(part);
    const code = packedCode(packPrint(packPieces(placed(part, 0, 0, 0))));
    return { corner: { x: b.x, y: b.y }, size: { w: b.w, h: b.h }, pieces: part.length, code };
  });
}
