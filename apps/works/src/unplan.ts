/**
 * An Undo of something built, raised or taken away, planned whole before any of it is sent (`tools.ts`
 * does the plan): every command it takes in one list, as the rules would do them, the commands that
 * give Coins back (or cost nothing) first and those that take Coins after, each in the order it came.
 * So an Undo whose whole the purse pays for is never short partway: the purse only grows until the
 * first command that takes Coins, and from there it falls to what it is after the whole.
 *
 * The plan is worked out on copies of the yard, by the rules themselves: once with Coins enough, to
 * price each command as it would fall, and once more in its order, with the purse as it is. Anything
 * the rules would refuse refuses the whole plan, with the rules' reason, before anything is sent.
 *
 * Within each of the two the order is the order of the parts (what was put down is taken up before
 * what it took the place of is stood again, on its tile), and of the pieces in each part, so tunnels,
 * pieces stood again and a yard's spare pieces fall as they did.
 */
import {
  type Act,
  decode,
  type Dir,
  encode,
  gradeOf,
  kindAt,
  NONE,
  type Piece,
  piecesAt,
  play,
  standLots,
  type Yard,
} from "@sequoia-leaf/factory";

/** What an Undo puts back, as `tools.ts` kept it. */
export interface Undoing {
  /** The tiles of what was put down, to take up. */
  readonly cells: readonly number[];
  /** What was turned, and the way it faced. */
  readonly turned: readonly { readonly i: number; readonly was: Dir }[];
  /** What was taken away (or had its place taken), to stand again. */
  readonly back: readonly Piece[];
  /** What was changed where it stands (turned, raised or lowered), to stand again as it was. */
  readonly was: readonly Piece[];
}

/** The commands an Undo takes, in the order of its parts. With Select, many pieces go as one; without it, one at a time. */
function actsOf(y: Yard, u: Undoing, select: boolean): Act[] {
  const cells = u.cells.filter((i) => y.kind[i] !== NONE);
  const out: Act[] = [];
  if (select && cells.length > 0) out.push({ do: "clear", tiles: cells });
  else for (const p of piecesAt(y, cells)) out.push({ do: "remove", x: p.x, y: p.y });
  for (const t of u.turned) out.push({ do: "turn", x: t.i % y.land.w, y: Math.floor(t.i / y.land.w), dir: t.was });
  for (const lot of standLots(u.back)) out.push({ do: "stand", pieces: lot });
  // What was changed and still stands of its kind.
  const was = u.was.filter((p) => kindAt(y, p.x, p.y) === p.kind);
  if (select || was.length === 1) for (const lot of standLots(was)) out.push({ do: "stand", pieces: lot });
  else
    for (const p of was)
      out.push({ do: "build", kind: p.kind, x: p.x, y: p.y, dir: p.dir, grade: gradeOf(p.kind, p.grade) });
  return out;
}

/** A copy of a yard for the rules to do commands on. */
const copyOf = (y: Yard): Yard | null => decode(encode(y), y.land);

/**
 * Does commands on a copy of a yard in turn, with `purse` Coins: what each took from the purse
 * (less what it gave back), or the rules' reason the first refused one was refused.
 */
function tried(y: Yard, acts: readonly Act[], purse: number): number[] | string {
  const copy = copyOf(y);
  if (!copy) return "The yard could not be read";
  const costs: number[] = [];
  let coins = purse;
  for (const a of acts) {
    const did = play(copy, { ...a, tick: copy.tick }, coins);
    if ("refused" in did) return did.why;
    const change = (did.coins ?? []).reduce((sum, c) => sum + c.amount, 0);
    coins += change;
    costs.push(-change);
  }
  return costs;
}

/** An Undo's plan: its commands in the order they go, and what they take from the purse in all; or why it cannot be done now. */
export type Plan = { readonly acts: readonly Act[]; readonly cost: number } | { readonly why: string };

/** Plans an Undo on a yard with `purse` Coins (`Undoing`, and whether Select is open), as the header says. */
export function undoPlan(y: Yard, u: Undoing, select: boolean, purse: number): Plan {
  const acts = actsOf(y, u, select);
  const priced = tried(y, acts, Infinity);
  if (typeof priced === "string") return { why: priced };
  const gives = acts.filter((_, k) => (priced[k] ?? 0) <= 0);
  const takes = acts.filter((_, k) => (priced[k] ?? 0) > 0);
  const ordered = [...gives, ...takes];
  const paid = tried(y, ordered, purse);
  if (typeof paid === "string") return { why: paid };
  return { acts: ordered, cost: paid.reduce((sum, c) => sum + c, 0) };
}
