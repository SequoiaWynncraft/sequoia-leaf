/**
 * A blueprint as kept: its pieces packed into bytes (`packPrint`), as a yard keeps each of its
 * blueprints (`codec.ts`) and as a blueprint's code carries one (`code.ts`), and read back as plain
 * numbers before the rules vouch for them.
 */
import { fromBase64, Reader, toBase64, Writer } from "./bytes.ts";
import { packWays, type Piece, piecesOf } from "./pieces.ts";
import { NONE } from "./tables.ts";
import type { Print } from "./yard.ts";

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A blueprint as kept: each piece in its order, as its kind, x and y (a byte each), then its way
 * with a bit for each part that follows (4 span, 8 tint, 16 a splitter's ways, 32 a shut crate,
 * 64 recipe, 128 a grade above 1), then those, a byte each.
 */
export function packPrint(b: Uint8Array): Uint8Array {
  const o = new Writer();
  for (const p of piecesOf(b)) {
    o.byte(p.kind);
    o.byte(p.x);
    o.byte(p.y);
    const parts = partsOf(p);
    o.byte(p.dir | (p.open === false ? 32 : 0) | parts.reduce((f, [bit, v]) => (v === undefined ? f : f | bit), 0));
    for (const [, v] of parts) if (v !== undefined) o.byte(v);
  }
  return o.bytes();
}

/** The parts of a piece that follow its way, a byte each, in their order and each with its bit: a part it has not, undefined. */
function partsOf(p: Piece): readonly (readonly [number, number | undefined])[] {
  const ways = packWays(p.shut ?? 0, (p.first ?? -1) + 1, p.ins ?? 0);
  return [
    [4, p.span > 0 ? p.span : undefined],
    [8, (p.tint ?? 0) > 0 ? p.tint : undefined],
    [16, ways > 0 ? ways : undefined],
    [64, p.recipe],
    [128, (p.grade ?? 1) > 1 ? p.grade : undefined],
  ];
}

/** A blueprint's pieces as kept, before they are vouched for: every part a plain number. */
export type KeptPrint = readonly {
  readonly kind: number;
  readonly x: number;
  readonly y: number;
  readonly dir: number;
  readonly span: number;
  readonly recipe: number;
  readonly open: boolean;
  readonly tint: number;
  readonly ways: number;
  /** Its grade, where it is kept: above the first. */
  readonly grade?: number;
}[];

/** A blueprint as kept: its pieces before they are vouched for, and whether it is a plan of the whole yard. */
export interface KeptBlueprint {
  readonly pieces: KeptPrint | null;
  readonly whole: boolean;
}

/** A kept blueprint's pieces read back from their bytes, or null for bytes that are not pieces. */
export function unpackPrint(bytes: Uint8Array | null): KeptPrint | null {
  if (!bytes) return null;
  const r = new Reader(bytes);
  const out: KeptPrint[number][] = [];
  while (!r.done) {
    const kind = r.byte();
    const x = r.byte();
    const y = r.byte();
    const f = r.byte();
    const span = f & 4 ? r.byte() : 0;
    const tint = f & 8 ? r.byte() : 0;
    const ways = f & 16 ? r.byte() : 0;
    const recipe = f & 64 ? r.byte() : NONE;
    const grade = f & 128 ? r.byte() : undefined;
    if (r.over) return null;
    out.push({
      kind,
      x,
      y,
      dir: f & 3,
      span,
      recipe,
      open: (f & 32) === 0,
      tint,
      ways,
      ...(grade === undefined ? {} : { grade }),
    });
  }
  return out;
}

/** A blueprint's pieces as kept, in base64. */
export const printText = (b: Print): string => toBase64(packPrint(b.pieces));
/** A blueprint as kept read back: a plan of the whole yard is `{ whole }`, any other its text alone. */
export function keptBlueprint(v: unknown): KeptBlueprint {
  const all = isRec(v) && typeof v.whole === "string";
  const text = all ? v.whole : v;
  return { pieces: typeof text === "string" ? unpackPrint(fromBase64(text)) : null, whole: all };
}
