/**
 * What becomes of a player's connection in Live, and of Live itself as it stops, each one state
 * moved by the functions here and nowhere else.
 */

/**
 * A player's connection: none; open (this one, `pipe`); or gone since a moment (`since`), the
 * player waiting out their grace in their room for a connection to come back.
 */
export type Link<P> =
  | { readonly state: "none" }
  | { readonly state: "open"; readonly pipe: P }
  | { readonly state: "grace"; readonly since: number };

export const NO_LINK: Link<never> = { state: "none" };

/** A connection of the player's has opened: it is theirs now, and the one it takes over from, if any, is to close. */
export function linked<P>(link: Link<P>, pipe: P): { readonly link: Link<P>; readonly replaced: P | null } {
  return { link: { state: "open", pipe }, replaced: link.state === "open" && link.pipe !== pipe ? link.pipe : null };
}

/**
 * A connection closed at `at`. Not the player's (another has taken over): nothing changes, and
 * null says so. Theirs, and they signed out: they leave their room at once. Otherwise their grace
 * begins, and they stand still where they are.
 */
export function unlinked<P>(
  link: Link<P>,
  pipe: P,
  signedOut: boolean,
  at: number,
): { readonly link: Link<P>; readonly leaves: boolean } | null {
  if (link.state !== "open" || link.pipe !== pipe) return null;
  return signedOut ? { link: NO_LINK, leaves: true } : { link: { state: "grace", since: at }, leaves: false };
}

/** Whether a player's grace has run out by `now`: they leave their room, and have no connection. */
export const graceOver = <P>(link: Link<P>, now: number, graceMs: number): boolean =>
  link.state === "grace" && now - link.since >= graceMs;

/**
 * Live as it stops: running; then its farewell begun, every open visit being closed, no connection
 * let in; then with every open visit closed, nothing more of visits written, as a player who left
 * may be back in the next Leaf already, in a visit of its own.
 */
export type Stop = "running" | "closing visits" | "visits closed";

/** Live's stop moved on by what happened; anything out of order changes nothing. */
export function stopped(stop: Stop, event: "farewell" | "visits closed"): Stop {
  if (event === "farewell") return stop === "running" ? "closing visits" : stop;
  return stop === "closing visits" ? "visits closed" : stop;
}
