/**
 * A blueprint as a code a player copies and pastes elsewhere (`blueprintCode`): a short prefix that
 * says the code's version, then in base64 with no padding a check of the blueprint's pieces (24 bits),
 * how many bytes of pieces follow (16 bits), and the pieces packed as a kept yard packs them
 * (`packPrint`). The same blueprint always gives the same code. A code cut short is never one of fewer
 * pieces, since fewer bytes follow than it says; a mistyped one fails its check. A plan of the whole
 * yard has none: it goes back where it was taken, in its own yard.
 *
 * The base64 is the plain one (`+` and `/`), not the URL one: Discord reads `__` as underlining and
 * leaves the underscores out of text copied off the message.
 *
 * A code pasted is read by the rules, on the page and on Leaf (`codePieces`): it is a blueprint only if
 * it is the code of one Save could have kept, every part of every piece as Save keeps it (its kind,
 * way, grade, span, colour, recipe and a splitter's ways or a sorter's side), from the corner of its
 * box, one piece a tile; so that it reads as exactly the text it was written as. Kept in a place
 * (`pasteBlueprint`), it is held to the place's limits as Save is (how many pieces, how big), but not
 * to what the yard has unlocked: a piece the yard may not build is refused when the blueprint is set
 * down, as any other.
 */
import { isDir } from "./build.ts";
import { fromBase64, toBase64 } from "./bytes.ts";
import { BLUEPRINT } from "./content/machines.ts";
import { boxOf, cellsOf, keptOf, packPieces, type Piece, unpackWays } from "./pieces.ts";
import { type KeptPrint, packPrint, unpackPrint } from "./prints.ts";
import { FIXED, isKind, locked, type Open, SPAN_MOST, SPANS } from "./tables.ts";
import type { Print, Yard } from "./yard.ts";

/** What every code begins with: which version of the code it is. */
export const CODE_PREFIX = "wb1.";

/** The most bytes a piece takes in a code: its kind, where, its way and what follows, and five of those. */
const PIECE_MOST = 9;
/** The bytes before a code's pieces: their check (3), then how many bytes of them follow (2). */
const HEAD = 5;

/** The longest a code can be: every tile of the largest box a blueprint holds a piece of the most bytes. */
export const CODE_MOST = CODE_PREFIX.length + Math.ceil((HEAD + BLUEPRINT.w * BLUEPRINT.h * PIECE_MOST) / 3) * 4;

/** Whether a command's code is text no longer than any code can be: the rules read it as they do it. */
export const isCode = (v: unknown): v is string => typeof v === "string" && v.length <= CODE_MOST;

/** A code as pasted, with the spaces and line breaks it often comes with left out: the text the rules read, and the page sends. */
export const cleanCode = (code: string): string => code.replace(/\s+/g, "");

/** Why a code is refused when it is not one. */
const NOT_A_CODE = "That is not a blueprint code";

/** 24 bits of a blueprint's packed pieces, written before them. */
function checkOf(packed: Uint8Array): number {
  let h = 0x811c9dc5;
  for (const b of packed) h = Math.imul(h ^ b, 0x01000193);
  return (h >>> 0) & 0xffffff;
}

/** The code of a blueprint's pieces packed as a kept yard packs them (`packPrint`): the prefix, their check and length, then them. */
export function packedCode(packed: Uint8Array): string {
  const check = checkOf(packed);
  const all = new Uint8Array(HEAD + packed.length);
  all.set([check >> 16, (check >> 8) & 255, check & 255, packed.length >> 8, packed.length & 255]);
  all.set(packed, HEAD);
  return `${CODE_PREFIX}${toBase64(all).replace(/=+$/, "")}`;
}

/** The code of a blueprint's pieces, `PIECE_BYTES` a piece as a blueprint keeps them. */
const codeOf = (pieces: Uint8Array): string => packedCode(packPrint(pieces));

/** A blueprint's code; none for a plan of the whole yard. */
export const blueprintCode = (print: Print): string | null => (print.whole ? null : codeOf(print.pieces));

/** The packed pieces a code carries after its prefix, if as many bytes of them follow as it says, and its check is theirs. */
function packedOf(text: string): Uint8Array | null {
  const body = text.slice(CODE_PREFIX.length);
  const bytes = fromBase64(body.padEnd(Math.ceil(body.length / 4) * 4, "="));
  if (!bytes || bytes.length <= HEAD) return null;
  const packed = bytes.subarray(HEAD);
  if (((bytes[3] ?? 0) << 8) + (bytes[4] ?? 0) !== packed.length) return null;
  return ((bytes[0] ?? 0) << 16) + ((bytes[1] ?? 0) << 8) + (bytes[2] ?? 0) === checkOf(packed) ? packed : null;
}

/** A piece read from a code, as a blueprint keeps it: a kind there is (not the depot), and a span for a tunnel alone. */
function pieceOf(p: KeptPrint[number]): Piece | null {
  const { kind: k, dir: d, span } = p;
  if (!isKind(k) || FIXED[k] === 1 || !isDir(d)) return null;
  if ((SPANS[k] === 1) !== span > 0 || span > SPAN_MOST) return null;
  const kept = keptOf(
    { recipe: p.recipe, open: p.open ? undefined : false, tint: p.tint, ...unpackWays(p.ways), grade: p.grade },
    k,
  );
  return { kind: k, x: p.x, y: p.y, dir: d, span, ...kept };
}

/** Whether no two pieces stand on one tile: each on its own, a tunnel on the one it comes up on too, a piece of more than one tile on all of its. */
function apart(pieces: readonly Piece[]): boolean {
  const taken = new Set<number>();
  for (const p of pieces) {
    for (const t of cellsOf(p).map(([x, z]) => x + z * 1024)) {
      if (taken.has(t)) return false;
      taken.add(t);
    }
  }
  return true;
}

/**
 * The pieces of the blueprint a code is, or nothing if it is not one Save could have kept. Spaces and
 * line breaks in it are let be: a code is often pasted with some.
 */
export function codePieces(code: string): Piece[] | null {
  if (!isCode(code)) return null;
  const text = cleanCode(code);
  if (!text.startsWith(CODE_PREFIX)) return null;
  const kept = unpackPrint(packedOf(text));
  if (!kept || kept.length === 0) return null;
  const pieces = kept.map(pieceOf).filter((p) => p !== null);
  if (pieces.length < kept.length || codeOf(packPieces(pieces)) !== text) return null;
  const box = boxOf(pieces);
  return box.x === 0 && box.y === 0 && apart(pieces) ? pieces : null;
}

/** Why some pieces cannot be kept in a place, as Save is held: how many they are and how big. */
function fits(open: Open, slot: number, pieces: readonly Piece[]): string | null {
  const { w, h } = boxOf(pieces);
  return locked(open, { blueprint: slot, pieces: pieces.length, w, h });
}

/** Why a code pasted could not be kept in any of a yard's places (each holds what the others do), or nothing if it could. */
export function codeRefusal(open: Open, code: string): string | null {
  const pieces = codePieces(code);
  return pieces ? fits(open, 0, pieces) : NOT_A_CODE;
}

/** Keeps the blueprint a code is in a place, over what was kept there. Says why it cannot be done, or nothing when it is. */
export function pasteBlueprint(y: Yard, slot: number, code: string): string | null {
  const pieces = codePieces(code);
  const why = pieces ? fits(y.open, slot, pieces) : NOT_A_CODE;
  if (why === null && pieces) y.blueprints[slot] = { pieces: packPieces(pieces), whole: false };
  return why;
}
