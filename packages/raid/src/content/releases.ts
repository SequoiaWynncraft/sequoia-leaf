/**
 * The raid's releases, in the order they open, each at a moment of Leaf's clock (0: at once, as it
 * merges). What exists at a moment is what the releases open by then have brought (`catalog.ts`),
 * so a release is built and merged ahead of its day and opens on Leaf's clock, with no deploy on
 * the day. An era is how many releases are open: it only grows.
 *
 * `joins` is when a release's figures join the pulls: as it opens, or (`next`) as the next release
 * that joins as it opens does, for one that opens while a banner is open, so that a banner's prizes
 * stay what it opened with. The expansion's first release opens on merge, during the first banner,
 * and so does `gaz-stall`, which puts the first banner's headliner on everyone's stall: the eras
 * before it are live at no moment, so no banner is open in them (`Figure.everyones`).
 */
export const RELEASES = [
  { id: "base", at: 0, joins: "opening" },
  { id: "groot", at: 0, joins: "next" },
  { id: "gaz-stall", at: 0, joins: "next" },
  { id: "groot-night", at: Date.UTC(2026, 11, 8), joins: "opening" },
  { id: "penguin-month", at: Date.UTC(2026, 11, 22), joins: "opening" },
  { id: "up-the-tree", at: Date.UTC(2027, 0, 5), joins: "opening" },
] as const;
export type ReleaseId = (typeof RELEASES)[number]["id"];

declare const eraBrand: unique symbol;
/** How many releases are open: a whole number from 1 (the base is always open) that only grows. */
export type Era = number & { readonly [eraBrand]: true };

/** An era as stored data may say it, or not. */
export const isEra = (v: unknown): v is Era =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= RELEASES.length;
function era(n: number): Era {
  if (!isEra(n)) throw new RangeError(`An era is a whole number from 1 to ${RELEASES.length}, not ${n}`);
  return n;
}

/** Every release open: what any stored id may be one of. */
export const LAST_ERA: Era = era(RELEASES.length);

/** The era at a moment of Leaf's clock. Only Leaf's clock: a page reads the era Leaf sent it. */
export const eraAt = (now: number): Era => era(Math.max(1, RELEASES.filter((r) => r.at <= now).length));

/** The era a release opens: itself and every release before it. */
export const eraOf = (release: ReleaseId): Era => era(RELEASES.findIndex((r) => r.id === release) + 1);

/**
 * What "no era" means, for everything kept before there was one: the era live when eras came in,
 * the base and the expansion's first release.
 */
export const LEGACY_ERA: Era = eraOf("groot");

/** The era the pulls draw from at an era: all of it, but the newest releases whose figures join with a later one. */
export function pullsEra(at: Era): Era {
  let n: number = at;
  while (n > 1 && RELEASES[n - 1]?.joins === "next") n--;
  return era(n);
}
