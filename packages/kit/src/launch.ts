/**
 * Leaf in a Discord call. Discord opens Leaf's `/` in its own frame, at its proxy for Leaf, with what
 * it is launching in the query: the frame, the platform, and the launch itself (`instance_id`), which
 * everyone in the call who opens it shares. Leaf sends that to the town with the query as it came.
 *
 * The launch goes with the player from page to page on Leaf's own addresses (`withLaunch`): on the
 * frame the town shows a game in, on a page going to another (`outside.go`, `leave`). Leaf lets
 * Discord frame a page only when its address carries a launch, and Discord's own code reads the
 * launch from the address of the page it talks to. Nothing is kept anywhere else: the address is
 * the one place the server and the page both see.
 */

/**
 * What Discord puts in the address of a page it launches: what its embedded app SDK reads (it needs
 * the first three), and the launch's own number. Leaf's own words in an address (`camp`, `of`) are
 * none of these.
 */
export const DISCORD_PARAMS = [
  "frame_id",
  "instance_id",
  "platform",
  "guild_id",
  "channel_id",
  "location_id",
  "launch_id",
  "referrer_id",
  "custom_id",
  "mobile_app_version",
] as const;

/** Discord's launch of Leaf, as a page's address names it. */
export interface Launch {
  /** The launch, one for everyone in the call who opens it: Leaf seats them all at one raid table. */
  readonly instance: string;
  /** Discord's words in the address, in Discord's order, as they are carried to the next page. */
  readonly params: readonly (readonly [string, string])[];
}

const isDiscords = (key: string): boolean => DISCORD_PARAMS.some((p) => p === key);

/** Discord's launch in a query, or null for a page Discord did not open. */
export function launchOf(search: string): Launch | null {
  const query = new URLSearchParams(search);
  const instance = query.get("instance_id") ?? "";
  if (instance === "" || (query.get("frame_id") ?? "") === "") return null;
  return { instance, params: [...query].filter(([key]) => isDiscords(key)) };
}

/** This page's launch: read once, as the page's address never changes under it. */
export const LAUNCH: Launch | null = typeof location === "undefined" ? null : launchOf(location.search);

/** Whether the page is open in a Discord call. */
export const inCall = (): boolean => LAUNCH !== null;

/**
 * A Leaf address (`url`, from the page at `from`) with the launch on it: Leaf's own words in it kept,
 * Discord's put on after them. Out of a call, and for another site's address, it is as it came.
 */
export function withLaunch(url: string, from: string, launch: Launch | null = LAUNCH): string {
  if (launch === null) return url;
  const at = new URL(url, from);
  if (at.origin !== new URL(from).origin) return url;
  for (const key of DISCORD_PARAMS) at.searchParams.delete(key);
  for (const [key, value] of launch.params) at.searchParams.append(key, value);
  return at.href;
}
