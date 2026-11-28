/**
 * The pulls' stored shapes pinned (`@sequoia-leaf/core/review/pins.ts`): a player's pulls as Leaf
 * stores them, their standing and what they log, each by the keys its writer writes beside its
 * version, and a row of the pulls at each version in `pins/stored/` (beside the states in
 * `../stored`, which `stored.test.ts` reads under other content and numbers):
 *
 *     bun review/pins.ts           # the keys written now against the pins
 *     bun review/pins.ts --write   # the same, then a new version's keys and its rows written
 *
 * A player's pulls are played from new by commands off the wire (`PULLS.command`), and one of the
 * staff's grants off theirs, until a top-tier prize is won, so that every field is written.
 */
import { readdirSync, readFileSync } from "node:fs";

import { type Ctx, isRefused } from "@sequoia-leaf/core";
import { Pinned, Seen, writePins } from "@sequoia-leaf/core/review/pins.ts";
import { eraAt } from "@sequoia-leaf/raid/content/releases.ts";

import { decodePulls, encodePulls, PULLS, type Pulls, PULLS_VERSION, readStaffCommand } from "../src/game.ts";

export const PINS = new Pinned(new URL("pins/", import.meta.url));
/** Each shape's version now. The standing and the logs keep none of their own: their number stands for one. */
export const VERSIONS: Readonly<Record<string, number>> = {
  pulls: PULLS_VERSION,
  standing: 1,
  pulls_top: 1,
  pulls_granted: 1,
};
/** What a player has is keyed by prizes. */
export const seenNow = (): Seen => new Seen({ pulls: new Set(["have"]) });

/** Wednesday 25 November 2026, 12:00 UTC: banner-1 is open. */
const T0 = Date.UTC(2026, 10, 25, 12);
const ctx = (now: number, seed: number): Ctx => ({
  now,
  player: { id: "00000000-0000-4000-8000-00000000601d", guest: false },
  seed,
  room: 1e9,
  awards: [],
  postcards: {},
});

/** What Leaf stores of a player's pulls: the pulls (kept as a row called `kept`, if given) and their standing. */
function watch(seen: Seen, s: Pulls, kept?: string): void {
  const text = encodePulls(s);
  seen.saw("pulls", PULLS_VERSION, JSON.parse(text), kept === undefined ? undefined : { as: kept, text });
  seen.saw("standing", VERSIONS.standing ?? 1, PULLS.standing?.(s));
}

/** A player's pulls from new: a free pull, ten-pulls on the grove and the banner until a top-tier prize, an exchange and a grant. */
export function played(seen: Seen): Pulls {
  let s = PULLS.create(ctx(T0, 7));
  watch(seen, s, "new");
  let n = 0;
  const done = (c: Parameters<typeof PULLS.apply>[1] | null): boolean => {
    if (!c) throw new Error("the wire does not read a command");
    const answer = PULLS.apply(s, c, ctx(T0, n++));
    if (isRefused(answer)) return false;
    s = answer.state;
    for (const l of answer.log ?? []) seen.saw(l.kind, VERSIONS[l.kind] ?? 0, l.data);
    watch(seen, s);
    return true;
  };
  const era = eraAt(T0);
  done(PULLS.command({ do: "pull", pool: "grove", n: 1, with: "free", era }));
  for (let k = 0; k < 20 && !seen.keys.has("pulls_top"); k++)
    done(PULLS.command({ do: "pull", pool: k % 2 === 0 ? "grove" : "banner-1", n: 10, with: "leaf", era }));
  watch(seen, s, "pulled");
  for (const prize of Object.keys(s.have)) if (done(PULLS.command({ do: "exchange", prize }))) break;
  done(
    readStaffCommand({
      do: "grant",
      prize: "figure:greg",
      copies: 2,
      by: "00000000-0000-4000-8000-0000000060d2",
      name: "Staff",
    }),
  );
  watch(seen, s, "granted");
  return s;
}

/** The states `stored.test.ts` reads, as today's writer writes them again: their keys are seen too. */
export function storedAgain(seen: Seen): void {
  const dir = new URL("../stored/", import.meta.url);
  for (const name of readdirSync(dir)) {
    const s = decodePulls(readFileSync(new URL(name, dir), "utf8"));
    if (s) watch(seen, s);
  }
}

if (import.meta.main) {
  const seen = seenNow();
  played(seen);
  storedAgain(seen);
  if (!writePins(PINS, seen, VERSIONS, process.argv.includes("--write"))) process.exit(1);
}
