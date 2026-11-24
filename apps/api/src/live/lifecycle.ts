/**
 * What becomes of a player's connection in Live, and of Live itself as it stops, each one state
 * moved by the functions here and nowhere else.
 */

/**
 * A player's connection: none; open (this one, `pipe`); or gone since a moment (`since`), the
 * player waiting out their grace in their room for a connection to come back. Gone because the page
 * closed it itself (`handoff`), the next opening within a few seconds is the player going from one of
 * their pages to another (`handsOver`), until an opening takes that up.
 */
export type Link<P> =
  | { readonly state: "none" }
  | { readonly state: "open"; readonly pipe: P }
  | { readonly state: "grace"; readonly since: number; readonly handoff: boolean };

export const NO_LINK: Link<never> = { state: "none" };

/** A connection of the player's has opened: it is theirs now, and the one it takes over from, if any, is to close. */
export function linked<P>(link: Link<P>, pipe: P): { readonly link: Link<P>; readonly replaced: P | null } {
  return { link: { state: "open", pipe }, replaced: link.state === "open" && link.pipe !== pipe ? link.pipe : null };
}

/**
 * A connection closed at `at`, by the page itself (`clean`: it was done with it, or went) or not (it
 * dropped, or Leaf closed it). Not the player's (another has taken over): nothing changes, and null
 * says so. Theirs, and they signed out: they leave their room at once. Otherwise their grace begins,
 * and they stand still where they are.
 */
export function unlinked<P>(
  link: Link<P>,
  pipe: P,
  signedOut: boolean,
  at: number,
  clean: boolean,
): { readonly link: Link<P>; readonly leaves: boolean } | null {
  if (link.state !== "open" || link.pipe !== pipe) return null;
  return signedOut
    ? { link: NO_LINK, leaves: true }
    : { link: { state: "grace", since: at, handoff: clean }, leaves: false };
}

/**
 * Whether an opening at `now` hands the player over between their own pages: it takes over a
 * connection of theirs that is open, or comes within `withinMs` of one their page closed itself. A
 * drop, a refusal or an opening that failed is none.
 */
export const handsOver = <P>(link: Link<P>, now: number, withinMs: number): boolean =>
  link.state === "open" || (link.state === "grace" && link.handoff && now - link.since <= withinMs);

/** A page's clean close taken up by the opening it handed over to: the next opening is charged as any other. */
export const handedOver = <P>(link: Link<P>): Link<P> => (link.state === "grace" ? { ...link, handoff: false } : link);

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
