/**
 * How Live holds up: `bun apps/api/test/live-load.ts [players] [seconds]` (32 and 10 by default).
 *
 * It runs the real app on a free port with the tests' stand-in backend, opens a connection for
 * each player, puts them all in the town, and has every one walk about at the game's pace
 * (`CLIENT_HZ` moves a second). Each move is timed from when its player sent it to when each other
 * player in the same room was told it, on one clock, since everybody is in this one process. The
 * server and every player share one CPU here, so the times are an upper bound on the server's.
 */
import { CLIENT_HZ, Flag, playerId } from "@sequoia-leaf/core";
import { Effect } from "effect";

import { Live } from "../src/live/live.ts";
import { LiveClient } from "./live-client.ts";
import { fakeBackend, sessionOf, testLeaf } from "./support.ts";

const players = Number(process.argv[2] ?? 32);
const seconds = Number(process.argv[3] ?? 10);
if (!Number.isInteger(players) || players < 2 || !(seconds > 0)) {
  console.error("Usage: bun apps/api/test/live-load.ts [players >= 2] [seconds]");
  process.exit(2);
}

const ids = Array.from({ length: players }, (_, i) =>
  playerId(`10000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
);
// Every fourth player is a guest.
const { fetcher } = fakeBackend(
  Object.fromEntries(
    ids.map((id, i) => [`p${i}`, () => Response.json(sessionOf(id, `P${i}`, i % 4 === 3 ? null : "RECRUIT"))]),
  ),
);
// The real clock: the tick keeps time by it.
const clock = {
  get now() {
    return Date.now();
  },
  set now(_: number) {},
};
const leaf = testLeaf(clock, fetcher);
const server = await leaf.serve();

const clients = await Promise.all(ids.map((_, i) => LiveClient.open(server.origin, { bearer: `p${i}` })));
const welcomes = await Promise.all(clients.map((c) => c.welcome()));

/** When each player sent each of its moves, by room and number in it. */
const sentAt = new Map<string, Map<number, number>>();
const key = (room: string, id: number) => `${room}#${id}`;
for (const w of welcomes) sentAt.set(key(w.room, w.you), new Map());

const latencies: number[] = [];
let snapshots = 0;
let bytes = 0;
for (const [i, c] of clients.entries()) {
  const room = welcomes[i]?.room ?? "";
  c.onSnapshot = (snapshot, at) => {
    snapshots++;
    bytes += 15 + snapshot.entries.length * 24;
    for (const e of snapshot.entries) {
      const sent = sentAt.get(key(room, e.id))?.get(e.seq);
      if (sent !== undefined && e.id !== welcomes[i]?.you) latencies.push(at - sent);
    }
    // Only the timings are wanted; letting snapshots pile up would measure memory instead.
    c.snapshots.length = 0;
  };
}

const cpuBefore = process.cpuUsage();
const started = performance.now();
let moves = 0;
const walkers = clients.map((c, i) => {
  const mine = sentAt.get(key(welcomes[i]?.room ?? "", welcomes[i]?.you ?? 0));
  let x = (i * 37) % 512;
  let dx = 64 / CLIENT_HZ;
  return setInterval(() => {
    x += dx;
    if (x < 0 || x > 512) dx = -dx;
    const seq = c.move({
      x,
      y: (i * 53) % 352,
      vx: dx * CLIENT_HZ,
      vy: 0,
      facing: dx > 0 ? 2 : 1,
      pose: 1,
      flags: Flag.Moving,
      jump: 0,
    });
    mine?.set(seq, performance.now());
    moves++;
  }, 1000 / CLIENT_HZ);
});

await Bun.sleep(seconds * 1000);
for (const w of walkers) clearInterval(w);
await Bun.sleep(200);
const elapsed = (performance.now() - started) / 1000;
const cpu = process.cpuUsage(cpuBefore);
const census = await leaf.run(Live.use((live) => live.census));

latencies.sort((a, b) => a - b);
const pct = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] ?? NaN;
const ms = (n: number) => `${n.toFixed(1)} ms`;
console.log(
  JSON.stringify(
    {
      players,
      rooms: census.rooms,
      seconds: Number(elapsed.toFixed(1)),
      moves_sent: moves,
      snapshots_received: snapshots,
      moves_seen: latencies.length,
      latency: { p50: ms(pct(50)), p95: ms(pct(95)), p99: ms(pct(99)), max: ms(latencies.at(-1) ?? NaN) },
      per_player_kib_s: Number((bytes / players / elapsed / 1024).toFixed(1)),
      cpu_of_one_core_server_and_players: `${(((cpu.user + cpu.system) / 1e6 / elapsed) * 100).toFixed(0)}%`,
    },
    null,
    2,
  ),
);

for (const c of clients) c.close();
await server.close();
await leaf.dispose();
await Effect.runPromise(Effect.void);
process.exit(0);
