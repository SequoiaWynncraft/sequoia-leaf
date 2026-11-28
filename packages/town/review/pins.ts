/**
 * The town's stored shapes pinned (`@sequoia-leaf/core/review/pins.ts`): the town as Leaf stores it,
 * its standing and what it logs, each by the keys its writer writes beside its version, and a row of
 * the town at each version in `pins/stored/`:
 *
 *     bun review/pins.ts           # the keys written now against the pins
 *     bun review/pins.ts --write   # the same, then a new version's keys and its rows written
 *
 * A member's town is played from new by commands off the wire (`TOWN.command`), with Leaf's clock
 * bringing a caller and awards from the other games, so that every field is written.
 */
import { type Ctx, isRefused } from "@sequoia-leaf/core";
import { Pinned, sawLogs, Seen, versionOf, writePins } from "@sequoia-leaf/core/review/pins.ts";

import { STALLS } from "../src/catalogue.ts";
import { TOWN, type Town, TOWN_VERSION } from "../src/game.ts";
import { letter } from "../src/mail.ts";

export const PINS = new Pinned(new URL("pins/", import.meta.url));
/** For each shape, the versions the town's writers write now. The standing and the logs keep none of their own: their 1 stands for one. */
export const VERSIONS: Readonly<Record<string, readonly number[]>> = {
  town: [TOWN_VERSION],
  standing: [1],
  town_bought: [1],
  town_pet: [1],
  town_crab: [1],
  town_greeted: [1],
};
/** The tray is keyed by things. */
export const seenNow = (): Seen => new Seen({ town: new Set(["camp.tray"]) });

/** Wednesday 25 November 2026, 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 25, 12);
const ctx = (now: number, awards: readonly string[] = []): Ctx => ({
  now,
  player: { id: "00000000-0000-4000-8000-00000000601d", guest: false },
  seed: 7,
  room: 1e9,
  awards,
  postcards: {},
});
/** What a pull and the raid gave the member, for the camp. */
const AWARDS = ["pull:thing:fountain", "pull:headliner:banner-1", "model-crab"];

/**
 * What Leaf stores of a town, as `TOWN.encode` writes it: the town, kept as a row called `kept` if
 * given, which must read as the town it was written from; and its standing, kept beside the last.
 */
function watch(seen: Seen, s: Town, kept?: string): void {
  const text = TOWN.encode(s);
  const read: unknown = JSON.parse(JSON.stringify(s));
  seen.saw("town", versionOf(text), JSON.parse(text), kept === undefined ? undefined : { as: kept, text, read });
  const standing = TOWN.standing?.(s);
  const row = { as: "played", text: JSON.stringify(standing), read: standing };
  seen.saw("standing", 1, standing, kept === "played" ? row : undefined);
}

/** A member's town played from new, every command off the wire; what Leaf stores of it seen at every step. */
export function played(seen: Seen): Town {
  const [stall] = STALLS;
  const ware = stall?.stock[0];
  if (!stall || !ware) throw new Error("no stall");
  let s = TOWN.create(ctx(T0));
  watch(seen, s, "new");
  let now = T0;
  const send = (raw: Readonly<Record<string, unknown>>): void => {
    const c = TOWN.command(JSON.parse(JSON.stringify(raw)));
    if (!c) throw new Error(`the wire does not read ${JSON.stringify(raw)}`);
    const done = TOWN.apply(s, c, ctx(now, AWARDS));
    if (isRefused(done)) throw new Error(`${JSON.stringify(raw)} was refused: ${done.refused}`);
    s = done.state;
    sawLogs(seen, done.log ?? [], "played");
    watch(seen, s);
  };
  send({ do: "welcome", cursor: null });
  send({ do: "spotCrab" });
  send({ do: "buy", stall: stall.id, thing: ware.thing });
  send({ do: "choosePet", pet: "fox" });
  now = s.nextCall + 1;
  s = TOWN.advance(s, ctx(now, AWARDS));
  watch(seen, s, "caller");
  send({ do: "greet", visit: s.visit?.id ?? 0 });
  send({ do: "setOut", thing: "fountain", x: 30, y: 20, t: 0 });
  const n = s.camp.placed.find((p) => p.id === "fountain")?.n ?? 0;
  send({ do: "move", n, x: 34, y: 22, t: 0 });
  // What the stall sold, a lantern, set out and lit.
  send({ do: "setOut", thing: ware.thing, x: 40, y: 24, t: 0 });
  send({ do: "toggle", n: s.camp.placed.find((p) => p.id === ware.thing)?.n ?? 0 });
  send({ do: "looked", through: s.camp.looked + s.camp.fresh.length });
  // Letters come with Leaf's mail, which these rules do not post: one is put in the box as it would arrive.
  s.camp.letters.push(letter("golden", "Tindra", "for you", "pumpkin"));
  send({ do: "readMail" });
  send({ do: "takePresent", letter: "golden" });
  send({ do: "stay", on: true });
  send({ do: "here", cursor: 3 });
  watch(seen, s, "played");
  send({ do: "putAway", n });
  send({ do: "clearLetters" });
  return s;
}

if (import.meta.main) {
  const seen = seenNow();
  played(seen);
  if (!writePins(PINS, seen, VERSIONS, process.argv.includes("--write"))) process.exit(1);
}
