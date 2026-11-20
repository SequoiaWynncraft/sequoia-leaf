/**
 * Who sits where at the Campfire: everyone in the call on a seat from the bundle's manifest (the two
 * logs, then the ground in front of the fire, then behind it), in its order, each facing the fire.
 * The cast is drawn facing right, so whoever sits right of the fire is drawn mirrored. Sitters come
 * back to front, the order they are drawn in.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Sitter<P> {
  person: P;
  /** The seat's place in the manifest's list. */
  seat: number;
  /** Where they sit: their foot on the log or the ground. */
  x: number;
  y: number;
  /** Facing left, toward a fire on their left. */
  flip: boolean;
}

/** The people on the seats, back to front; anyone past the last seat stands out of the picture. */
export function seatPeople<P>(people: readonly P[], seats: readonly Point[], fire: Point): Sitter<P>[] {
  return people
    .slice(0, seats.length)
    .flatMap((person, i): Sitter<P>[] => {
      const s = seats[i];
      return s ? [{ person, seat: i, x: s.x, y: s.y, flip: s.x > fire.x }] : [];
    })
    .toSorted((a, b) => a.y - b.y || a.x - b.x);
}

/** Where a sitter's cone leaves their paws when they throw it into the fire: a step toward it, up off the seat. */
export const throwFrom = (s: Sitter<unknown>): Point => ({ x: s.x + (s.flip ? -8 : 8), y: s.y - 6 });

/** A box in the HUD's grid. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** A nametag to draw: its name, its plate's middle and top row, and the box it covers. */
export interface Tag {
  name: string;
  x: number;
  y: number;
  box: Rect;
}

/**
 * Where each nametag goes, from where each would like to be (just over its head, `x` its middle,
 * `y` its plate's bottom row, `w` its plate's width) in a HUD `width` wide. Nearer companions (`front`) are placed first.
 * A tag that would cover one already placed slides a little sideways, then steps up; none leaves the
 * screen's sides.
 */
export function placeTags(
  want: readonly { name: string; w: number; x: number; y: number; front: number }[],
  width: number,
): Tag[] {
  const out: Tag[] = [];
  for (const w of want.toSorted((a, b) => b.front - a.front || a.x - b.x)) {
    const plate = w.w;
    const half = Math.ceil(plate / 2);
    const clampX = (x: number): number => Math.max(half + 2, Math.min(width - half - 2, x));
    const box = (x: number, y: number): Rect => ({ x: Math.round(x - plate / 2) - 1, y: y - 1, w: plate + 2, h: 11 });
    let at: { x: number; y: number } | null = null;
    for (let lift = 0; !at && lift < 8; lift++)
      for (const dx of [0, -4, 4, -8, 8]) {
        const x = clampX(Math.round(w.x + dx));
        const y = Math.round(w.y - 9 - lift * 10);
        if (!out.some((o) => overlaps(o.box, box(x, y)))) {
          at = { x, y };
          break;
        }
      }
    const x = at?.x ?? clampX(Math.round(w.x));
    const y = at?.y ?? Math.round(w.y - 9);
    out.push({ name: w.name, x, y, box: box(x, y) });
  }
  return out;
}
