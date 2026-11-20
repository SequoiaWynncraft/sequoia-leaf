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
