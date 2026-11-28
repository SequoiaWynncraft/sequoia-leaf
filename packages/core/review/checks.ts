/**
 * The tests every game's pins have (`pins.ts`), as one call from the game's own test file: the keys
 * its writer cases write against the pins, and each standing and log row kept read as Leaf reads one.
 * A game's own rows (its state, its postcard) it tests itself, by its own reader.
 */
import { expect, test } from "bun:test";

import { talliedFrom } from "../src/tally.ts";
import { type Pinned, pinsNow, type Seen, type Versions } from "./pins.ts";

/** Registers the pins' tests for a game: `seen` runs its writer cases; its logs are the shapes named with `logs` before them (`works_`). */
export function pinTests(at: Pinned, seen: () => Seen, versions: Versions, logs: string): void {
  test("are written with the keys pinned beside each version the game writes now, and every row first seen is kept", () => {
    expect(pinsNow(at, seen(), versions)).toEqual({ refused: [], undeclared: [], unpinned: [], unkept: [], lost: [] });
  });
  test.each(at.rows("standing").map((r) => [r.path, r.row] as const))("%s reads as it was written", (_, row) => {
    expect(JSON.parse(row.text)).toEqual(row.read);
  });
  const kinds = Object.keys(versions).filter((s) => s.startsWith(logs));
  test.each(kinds.flatMap((kind) => at.rows(kind).map((r) => [r.path, kind, r.row] as const)))(
    "%s reads as the tally reads what is logged",
    (_, kind, row) => {
      const data: Record<string, unknown> = JSON.parse(row.text);
      expect(row.read).toEqual({ data, tallied: talliedFrom([{ kind, data }]) });
    },
  );
}
