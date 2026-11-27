import { describe, expect, test } from "bun:test";

import { ENDLESS } from "./content/endless.ts";
import type { BossId } from "./content/figures.ts";
import { ROOM_COUNT, ROOMS } from "./content/rooms.ts";
import { paidFor } from "./depths.ts";
import { chairsOf, roomAt } from "./endless.ts";
import type { Party } from "./party.ts";
import {
  folded,
  foughtAt,
  keepRoom,
  KEPT_ROOMS,
  metLately,
  noRooms,
  type RoomRecord,
  roomsFought,
  storedRun,
} from "./record.ts";
import { type Run, startRun, summariseRun } from "./run.ts";
import { checkRun } from "./save.ts";
import { CAT } from "./testkit.ts";
import { wayOn } from "./way.ts";

/** A run of the Deep Woods `n` rooms in: won, lost and drawn, bosses beaten and not, members' boards met. */
function deepIn(n: number): { run: Run; whole: RoomRecord[] } {
  const whole = Array.from({ length: n }, (_, room): RoomRecord => {
    const kind = roomAt(room)?.kind ?? "spar";
    const result = room % 7 === 3 ? "loss" : room % 11 === 5 ? "draw" : "win";
    const boss = kind === "boss" ? (["oldbramble", "hoardmagpie", "bigcrab"] as const)[room % 3] : null;
    const met = kind === "spar" && room % 2 === 0 ? { met: `member-${room % 5}` } : {};
    return { room, kind, result, standing: [2, result === "win" ? 0 : 3], boss: boss ?? null, ...met };
  });
  const run = startRun(1, { era: CAT.era, way: wayOn({ id: "deep" }) });
  run.room = n;
  return { run, whole };
}
const across: Party = { who: "Them", title: "", figures: [], boons: [], might: 100, by: "member-9" };

/** What the readers of a whole record read of it, worked out from every room as they did before rooms were folded. */
function readOfWhole(run: Run, whole: readonly RoomRecord[]) {
  const wins = whole.filter((r) => r.result === "win");
  const bosses: BossId[] = [];
  for (const r of wins) if (r.boss && r.room < ROOM_COUNT && !bosses.includes(r.boss)) bosses.push(r.boss);
  return {
    cleared: new Set(wins.filter((r) => r.kind === ROOMS[r.room]?.kind).map((r) => r.room)).size,
    reached: Math.min(ROOM_COUNT, Math.max(run.room, ...whole.map((r) => r.room)) + 1),
    bosses,
    chairs: Math.min(ENDLESS.chairs, wins.filter((r) => r.room >= ROOM_COUNT && r.kind === "boss").length),
    wonLast: wins.some((r) => r.room === ROOM_COUNT - 1),
    met: [...whole.flatMap((r) => (r.met === undefined ? [] : [r.met])), "member-9"].slice(-2),
    fought: Array.from({ length: whole.length + 2 }, (_, at) => whole.some((r) => r.room === at)),
  };
}

describe("a run's record, kept to its last rooms", () => {
  test.each([0, 1, 14, 15, 99, 100, 101, 250])("is read by every reader %p rooms in as its whole record was", (n) => {
    const { run, whole } = deepIn(n);
    Object.assign(run, folded(run.way, whole.slice(), noRooms()));
    expect(run.record).toEqual(whole.slice(-KEPT_ROOMS));
    expect(roomsFought(run)).toBe(n);
    const was = readOfWhole(run, whole);
    const summary = summariseRun(run);
    expect([summary.cleared, summary.reached, summary.bosses]).toEqual([was.cleared, was.reached, was.bosses]);
    expect(chairsOf(run)).toBe(was.chairs);
    expect(paidFor(run, { ...summary, ending: "lost" }).ending).toBe(was.wonLast ? "won" : "lost");
    expect(metLately(run, across)).toEqual(was.met);
    expect(was.fought.map((_, at) => foughtAt(run, at))).toEqual(was.fought);
  });

  test("written room by room comes to what folding the whole record does", () => {
    const { run, whole } = deepIn(250);
    for (const r of whole) keepRoom(run, r);
    expect({ record: run.record, before: run.before }).toEqual(folded(run.way, whole.slice(), noRooms()));
  });

  test("is stored as rows, and read back as it was; rooms before it that do not add up are refused", () => {
    const { run, whole } = deepIn(250);
    for (const r of whole) keepRoom(run, r);
    run.streak = 0;
    const stored = (before: unknown): unknown => JSON.parse(JSON.stringify({ ...storedRun(run), before }));
    const back = checkRun(stored(run.before), false, false, true);
    expect(back.ok && { record: back.run.record, before: back.run.before }).toEqual({
      record: run.record,
      before: run.before,
    });
    // As objects, the rows are no record; and rows are not objects.
    expect(checkRun(stored(run.before), false, false, false).ok).toBe(false);
    for (const before of [
      { ...run.before, won: run.before.fought + 1 },
      { ...run.before, fought: -1 },
      { ...run.before, lost: 1.5 },
      { ...run.before, furthest: run.room + 2 },
      { ...run.before, cleared: [ROOM_COUNT] },
      { ...run.before, met: ["a", "b", "c"] },
      { ...run.before, bosses: ["nobody"] },
    ])
      expect(checkRun(stored(before), false, false, true).ok).toBe(false);
  });
});
