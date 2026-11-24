/**
 * The tick gives the same yards it gave when the record was written (`replays.ts`): every replay's
 * digests, line for line. A line that differs says which hour (or which fifty commands) of which
 * replay went otherwise first.
 */
import { describe, expect, test } from "bun:test";

import { RECORD, replay, REPLAYS } from "./replays.ts";

const record: unknown = await Bun.file(RECORD).json();
/** The lines the record has for a replay: none for one it does not have. */
function kept(name: string): string[] {
  const lines: unknown = typeof record === "object" && record !== null ? Reflect.get(record, name) : undefined;
  return Array.isArray(lines) ? lines.filter((l) => typeof l === "string") : [];
}

describe("the tick gives the yards the record has", () => {
  for (const [name, run] of REPLAYS)
    test(
      name,
      () => {
        expect(replay(run)).toEqual(kept(name));
      },
      60_000,
    );
});
