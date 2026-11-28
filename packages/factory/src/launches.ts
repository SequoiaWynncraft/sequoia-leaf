/**
 * The yard's launches (tier 8, SPEC-2 section 6.1): for each kind of launch (`LAUNCH_KINDS`), the
 * launches ever and the launches spent, and a level of each track of endless research (`TRACK_IDS`):
 * fifteen numbers, kept and checked. A launch pad's launch adds to `ever` (`kinds/launchpad.ts`); what
 * spends launches and raises a level comes with endless research.
 *
 * Kept by name, only those above 0, and nothing at all for a yard with none, so such a yard keeps and
 * checks as it did before tier 8. A part or a name this Leaf does not know is a newer Leaf's
 * (`named.ts`): such a yard is not read, rather than read with it let go.
 */
import { LAUNCH_KINDS, TRACK_IDS } from "./content/rockets.ts";

/** The fifteen numbers: launches ever and spent, by kind of launch, and a level of each track. */
export interface Launches {
  readonly ever: Uint32Array;
  readonly spent: Uint32Array;
  readonly levels: Uint32Array;
}

/** A yard's launches before its first: none. */
export const noLaunches = (): Launches => ({
  ever: new Uint32Array(LAUNCH_KINDS.length),
  spent: new Uint32Array(LAUNCH_KINDS.length),
  levels: new Uint32Array(TRACK_IDS.length),
});

/** The three parts, by the name each is kept under, with the names of its numbers. */
const PARTS = [
  ["ever", LAUNCH_KINDS],
  ["spent", LAUNCH_KINDS],
  ["levels", TRACK_IDS],
] as const;
/** The most a kept number may be: past it the yard is no yard's. */
const MOST = 1e9;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** Whether a yard has any launch number above 0. */
export const anyLaunches = (l: Launches): boolean => PARTS.some(([part]) => l[part].some((v) => v > 0));

/** The launches as kept: each part by name with its numbers above 0, by name; nothing for a yard with none. */
export function keptLaunches(l: Launches): { launches?: Record<string, Record<string, number>> } {
  if (!anyLaunches(l)) return {};
  const kept: Record<string, Record<string, number>> = {};
  for (const [part, names] of PARTS) {
    const some = names.flatMap((name, n): [string, number][] =>
      (l[part][n] ?? 0) > 0 ? [[name, l[part][n] ?? 0]] : [],
    );
    if (some.length > 0) kept[part] = Object.fromEntries(some);
  }
  return { launches: kept };
}

/** Puts back kept launches onto a yard's (as new): each a whole number up to the most, by a name this Leaf knows. */
export function launchesOnto(l: Launches, kept: unknown): void {
  if (!isRec(kept)) return;
  for (const [part, names] of PARTS) {
    const v = kept[part];
    if (!isRec(v)) continue;
    names.forEach((name, n) => {
      const c = v[name];
      if (typeof c === "number" && Number.isInteger(c) && c >= 0 && c <= MOST) l[part][n] = c;
    });
  }
}

/**
 * What a kept yard's launches say for reading it (`named.ts`): whether it keeps any, which no Leaf
 * before tier 8 knew; and whether every part and name in them is one this Leaf knows.
 */
export function launchNames(kept: unknown): { readonly any: boolean; readonly known: boolean } {
  if (kept === undefined) return { any: false, known: true };
  if (!isRec(kept)) return { any: true, known: false };
  const known = Object.entries(kept).every(([part, v]) => {
    const names: readonly string[] | undefined = PARTS.find(([p]) => p === part)?.[1];
    return names !== undefined && isRec(v) && Object.keys(v).every((name) => names.includes(name));
  });
  return { any: true, known };
}

/** Mixes the launches into a check: each number above 0, by its part and place; nothing for a yard with none. Makes nothing. */
export function mixLaunches(l: Launches, mix: (v: number) => void): void {
  mixPart(l.ever, 0, mix);
  mixPart(l.spent, 1, mix);
  mixPart(l.levels, 2, mix);
}

/** Mixes in one part of the launches, the `p`th: each number above 0, by its place. */
function mixPart(part: Uint32Array, p: number, mix: (v: number) => void): void {
  for (let n = 0; n < part.length; n++)
    if ((part[n] ?? 0) > 0) {
      mix(0x90000 | (p << 8) | n);
      mix(part[n] ?? 0);
    }
}
