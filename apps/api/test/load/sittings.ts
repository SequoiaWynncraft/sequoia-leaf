/**
 * How long the raid's sittings take Leaf, in memory, through its routes (no network), as JSON:
 *
 *   bun apps/api/test/load/sittings.ts [ops] [due]
 *
 * 1. A sitting of eight members, each planning as the raid's bot does (`sittings-drive.ts`), played
 *    to mid-game (planning the sixth room or a later one); then `ops` reads of it (whole, and with the
 *    page's `rev`, unchanged) and `ops` commands at it (a stall held and let go, each one written),
 *    round the eight, the clock 5 ms on before each. Median and 99th percentile, in milliseconds.
 * 2. `due` sittings of one member and seven regulars each, opened and started together, so that all
 *    are due at once: the minute's sweep that brings them on, at the end of the first carousel, at the
 *    lock of the first room (every fight decided) and at its takings.
 *
 * (300 of each and 100 sittings by default.)
 */
import { playerId } from "@sequoia-leaf/core";
import { Schema } from "effect";

import { Sittings } from "../../src/sittings/service.ts";
import { playThrough, type Reach, type Seated, seen } from "../sittings-drive.ts";
import { fakeBackend, sessionOf, testLeaf } from "../support.ts";

const [ops = 300, due = 100] = process.argv.slice(2).map(Number);
const clock = { now: Date.UTC(2026, 10, 25, 12) };

const members: Seated[] = Array.from({ length: Math.max(8, due) }, (_, n) => ({
  player: playerId(`20000000-0000-4000-8000-${String(n).padStart(12, "0")}`),
  session: `m${n}`,
}));
const { fetcher } = fakeBackend(
  Object.fromEntries(
    members.map(({ player, session }, n) => [
      session,
      () => Response.json(sessionOf(playerId(player), `Member${n}`, "RECRUIT")),
    ]),
  ),
);
const leaf = testLeaf(clock, fetcher);
const app = leaf.app();

const headers = (session: string) => ({
  Cookie: `seq_session=${session}`,
  Origin: "https://leaf.seqwawa.com",
  "Content-Type": "application/json",
});
const get = async (path: string, session: string): Promise<unknown> =>
  (await app.request(path, { headers: headers(session) })).json();
const post = async (path: string, body: unknown, session: string): Promise<unknown> =>
  (await app.request(path, { method: "POST", headers: headers(session), body: JSON.stringify(body) })).json();
const reach: Reach = { get, post, to: async (at) => void (clock.now = Math.max(clock.now + 1000, at)) };
const act = (id: string, { player, session }: Seated, commands: readonly object[]) =>
  post(`/v1/game/sittings/${id}`, { player, commands }, session);
/** Opens a sitting as a member, and gives its id. */
async function opened({ player, session }: Seated): Promise<string> {
  const body = await post("/v1/game/sittings", { player }, session);
  const id = typeof body === "object" && body !== null ? Object.getOwnPropertyDescriptor(body, "id")?.value : null;
  if (typeof id !== "string") throw new Error(JSON.stringify(body));
  return id;
}

/** The median and 99th percentile of some timings, in milliseconds. */
function spread(ms: readonly number[]) {
  const sorted = ms.toSorted((a, b) => a - b);
  const at = (q: number) =>
    Math.round((sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0) * 100) / 100;
  return { n: sorted.length, median: at(0.5), p99: at(0.99) };
}
/** Times `n` calls of `one`, one after another, Leaf's clock 5 ms on before each. */
async function timed(n: number, one: (i: number) => Promise<unknown>): Promise<number[]> {
  const took: number[] = [];
  for (let i = 0; i < n; i++) {
    clock.now += 5;
    const began = performance.now();
    // oxlint-disable-next-line no-await-in-loop -- one after another, each timed
    await one(i);
    took.push(performance.now() - began);
  }
  return took;
}

// 1. Eight members at one sitting, played to mid-game.
const eight = members.slice(0, 8);
const at = (i: number): Seated => eight[i % eight.length] ?? members[0] ?? { player: "", session: "" };
const id = await opened(at(0));
for (const member of eight.slice(1)) {
  // oxlint-disable-next-line no-await-in-loop -- one after another, as people sit down
  await act(id, member, [{ id: `sit-${member.session}`, do: "sit" }]);
}
const { end: mid } = await playThrough(reach, id, eight, { stop: (now) => now.at === "plan" && now.room >= 5 });
const Bytes = Schema.Array(Schema.Struct({ bytes: Schema.Int }));
const [stored] = Schema.decodeUnknownSync(Bytes)(
  await leaf.query((sql) => sql`SELECT length(state) AS bytes FROM raid_sittings WHERE id = ${id}`),
);
const whole = await timed(ops, (i) => get(`/v1/game/sittings/${id}`, at(i).session));
const { rev } = seen(await get(`/v1/game/sittings/${id}`, at(0).session));
const unchanged = await timed(ops, (i) => get(`/v1/game/sittings/${id}?rev=${rev}`, at(i).session));
const commands = await timed(ops, (i) =>
  act(id, at(i), [{ id: `h-${i}`, do: "hold", on: Math.floor(i / eight.length) % 2 === 0 }]),
);
const after = seen(await get(`/v1/game/sittings/${id}`, at(0).session));

// 2. `due` sittings, opened and started together, swept at three deadlines.
clock.now += 2 * 60_000;
for (const member of eight) {
  // oxlint-disable-next-line no-await-in-loop -- one after another
  await act(id, member, [{ id: `leave-${member.session}`, do: "leave" }]);
}
const ids: string[] = [];
for (const member of members.slice(0, due)) {
  // oxlint-disable-next-line no-await-in-loop -- one after another
  const one = await opened(member);
  ids.push(one);
  // oxlint-disable-next-line no-await-in-loop -- one after another
  await act(one, member, [{ id: `start-${member.session}`, do: "start" }]);
}
const sweeps: Record<string, { swept: number; ms: number }> = {};
for (const deadline of ["carousel_end", "lock", "takings"]) {
  // oxlint-disable-next-line no-await-in-loop -- one deadline after another
  clock.now = seen(await get(`/v1/game/sittings/${ids[0]}`, at(0).session)).until;
  const began = performance.now();
  // oxlint-disable-next-line no-await-in-loop -- one deadline after another
  const swept = await leaf.run(Sittings.use((sittings) => sittings.sweep));
  sweeps[deadline] = { swept, ms: Math.round(performance.now() - began) };
}

console.log(
  JSON.stringify(
    {
      eight: {
        room: mid.room,
        stored_bytes: stored?.bytes ?? null,
        read_whole_ms: spread(whole),
        read_unchanged_ms: spread(unchanged),
        command_ms: spread(commands),
        stage_after: after.at,
      },
      sweep: { sittings: due, ...sweeps },
    },
    null,
    2,
  ),
);
await app.dispose();
await leaf.dispose();
