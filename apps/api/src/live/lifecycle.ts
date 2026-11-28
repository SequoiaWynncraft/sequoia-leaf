/**
 * What becomes of a player's connection in Live, and of Live itself as it stops, each one state
 * moved by the functions here and nowhere else.
 */

/**
 * One grace period of a player's, from the drop that began it (`since`, by Leaf's clock) until a
 * connection of theirs opens or it runs out. Each is an object of its own: it runs out when the wait
 * begun with it is over (`graceRunsOut`), and that ends this period and no other. Leaf's clock never
 * says when; it may be set back or forward meanwhile.
 */
export interface Grace {
  readonly since: number;
}

/**
 * A player's connection: none; open (this one, `pipe`); or gone a moment ago, the player waiting
 * out a grace period of theirs (`grace`) in their room for a connection to come back. Gone because
 * the page closed it itself (`handoff`), the next opening within a few seconds is the player going
 * from one of their pages to another (`handsOver`), until an opening takes that up.
 */
export type Link<P> =
  | { readonly state: "none" }
  | { readonly state: "open"; readonly pipe: P }
  | { readonly state: "grace"; readonly grace: Grace; readonly handoff: boolean };

export const NO_LINK: Link<never> = { state: "none" };

/** A connection of the player's has opened: it is theirs now, and the one it takes over from, if any, is to close. */
export function linked<P>(link: Link<P>, pipe: P): { readonly link: Link<P>; readonly replaced: P | null } {
  return { link: { state: "open", pipe }, replaced: link.state === "open" && link.pipe !== pipe ? link.pipe : null };
}

/**
 * The player's link once a connection closed at `at`, by the page itself (`clean`: it was done with
 * it, or went) or not (it dropped, or Leaf closed it). Not the player's (another has taken over):
 * nothing changes, and null says so. Theirs, and they signed out: none, and they leave their room at
 * once. Otherwise a grace period of its own begins, and they stand still where they are.
 */
export function unlinked<P>(link: Link<P>, pipe: P, signedOut: boolean, at: number, clean: boolean): Link<P> | null {
  if (link.state !== "open" || link.pipe !== pipe) return null;
  return signedOut ? NO_LINK : { state: "grace", grace: { since: at }, handoff: clean };
}

/**
 * Whether an opening at `now` hands the player over between their own pages: it takes over a
 * connection of theirs that is open, or comes within `withinMs` of one their page closed itself. A
 * drop, a refusal or an opening that failed is none.
 */
export const handsOver = <P>(link: Link<P>, now: number, withinMs: number): boolean =>
  link.state === "open" || (link.state === "grace" && link.handoff && now - link.grace.since <= withinMs);

/** A page's clean close taken up by the opening it handed over to: the next opening is charged as any other. */
export const handedOver = <P>(link: Link<P>): Link<P> => (link.state === "grace" ? { ...link, handoff: false } : link);

/**
 * Whether grace period `grace` running out ends the player's link: only while the link is in that
 * very period. A connection that came back, or dropped again and began a period of its own, is not
 * ended by an older one's running out. Ended, they leave their room, and have no connection.
 */
export const graceRunsOut = <P>(link: Link<P>, grace: Grace): boolean => link.state === "grace" && link.grace === grace;

/**
 * Live as it stops: running; then its farewell begun, every open visit being handed over to the
 * next Leaf, no connection let in; then with every open visit handed over, nothing more of visits
 * written: they are the next Leaf's, and a connection closing here is nobody's leaving.
 */
export type Stop = "running" | "handing over" | "handed over";

/** Live's stop moved on by what happened; anything out of order changes nothing. */
export function stopped(stop: Stop, event: "farewell" | "handed over"): Stop {
  if (event === "farewell") return stop === "running" ? "handing over" : stop;
  return stop === "handing over" ? "handed over" : stop;
}
