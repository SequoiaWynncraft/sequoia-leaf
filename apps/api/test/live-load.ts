/**
 * How Live holds up: `bun apps/api/test/live-load.ts [players] [seconds] [yards] [visitors] [fresh]`
 * (32, 10, 0, 0 and 0 by default).
 *
 * It runs the real app on a free port with the tests' stand-in backend, opens a connection for
 * each player, puts them all in the town, and has every one walk about at the game's pace
 * (`CLIENT_HZ` moves a second). Each move is timed from when its player sent it to when each other
 * player in the same room was told it, on one clock, since everybody is in this one process. The
 * server and every player share one CPU here, so the times are an upper bound on the server's.
 * With `yards`, that many members have the largest kept yard in the Works, left eight hours ago,
 * and Leaf tends them all meanwhile, as it would after a deploy; with `visitors`, that many players
 * visit the first of those yards at once as the tending begins, and each visit is timed. With
 * `fresh`, the first player has the largest kept yard, written a minute ago: that many players visit
 * it at once, its owner's page sends a command right behind them, and then one every half second;
 * each command is timed from its sending to its answer.
 */
import { CLIENT_HZ, Flag, playerId, playPath, visitPath } from "@sequoia-leaf/core";
import { WORKS } from "@sequoia-leaf/yard";
import large from "@sequoia-leaf/yard/yards/large.json";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";

import { Live } from "../src/live/live.ts";
import { GAMES } from "../src/play/games.ts";
import { Play } from "../src/play/service.ts";
import { LiveClient } from "./live-client.ts";
import { fakeBackend, sessionOf, testLeaf } from "./support.ts";

const players = Number(process.argv[2] ?? 32);
const seconds = Number(process.argv[3] ?? 10);
const yards = Number(process.argv[4] ?? 0);
const visitors = Number(process.argv[5] ?? 0);
const fresh = Number(process.argv[6] ?? 0);
const counts = [yards, visitors, fresh];
if (
  !Number.isInteger(players) ||
  players < 2 ||
  !(seconds > 0) ||
  !counts.every((n) => Number.isInteger(n) && n >= 0) ||
  (visitors > 0 && yards === 0)
) {
  console.error(
    "Usage: bun apps/api/test/live-load.ts [players >= 2] [seconds] [yards] [visitors, with yards] [fresh]",
  );
  process.exit(2);
}

const ids = Array.from({ length: players }, (_, i) =>
  playerId(`10000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
);
// Those who only visit, as many as either kind of visit asks for.
const lookers = Array.from({ length: Math.max(visitors, fresh) }, (_, i) =>
  playerId(`30000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
);
// Every fourth player is a guest.
const { fetcher } = fakeBackend(
  Object.fromEntries([
    ...ids.map((id, i) => [`p${i}`, () => Response.json(sessionOf(id, `P${i}`, i % 4 === 3 ? null : "RECRUIT"))]),
    ...lookers.map((id, i) => [`v${i}`, () => Response.json(sessionOf(id, `V${i}`, "RECRUIT"))]),
  ]),
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

// The yards, eight hours behind, each as if its owner left then.
const left = Date.now() - 8 * 3600 * 1000;
const yard = WORKS.decode(JSON.stringify(large));
if (!yard) throw new Error("The largest kept yard does not read");
const ownerOf = (i: number) => playerId(`20000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
/** Keeps the largest yard as `owner`'s, standing at `at` and written then. */
const keep = (owner: string, at: number) => {
  yard.at = at;
  const kept = WORKS.encode(yard);
  return leaf.run(
    SqlClient.SqlClient.use(
      (sql) =>
        sql`INSERT INTO play_state (player_id, game, rev, state, updated_at) VALUES (${owner}, 'works', 1, ${kept}, ${at})`,
    ),
  );
};
for (let i = 0; i < yards; i++) {
  // oxlint-disable-next-line no-await-in-loop -- one after another
  await keep(ownerOf(i), left);
}
if (fresh > 0) await keep(ids[0] ?? "", Date.now() - 60_000);

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
let tended = "none";
if (yards > 0)
  void leaf.run(
    Play.use((play) => play.tend(Object.values(GAMES))).pipe(
      Effect.andThen(
        Effect.sync(() => {
          tended = `${yards} yards, eight hours each, in ${((performance.now() - started) / 1000).toFixed(1)} s`;
        }),
      ),
    ),
  );
/** A visit to `owner`'s yard, by the nth of those who only visit: how it was answered, and how long after the start. */
async function visitOf(owner: string, n: number) {
  const answer = await fetch(`${server.origin}${visitPath("works", owner)}`, {
    headers: { Authorization: `Bearer v${n}` },
  });
  await answer.arrayBuffer();
  return { status: answer.status, s: (performance.now() - started) / 1000 };
}
/** That many visit `owner`'s yard at once, as `what` says, and how they were answered. */
async function visitsTo(owner: string, many: number, what: string) {
  const done = await Promise.all(Array.from({ length: many }, (_, n) => visitOf(owner, n)));
  const statuses = [...new Set(done.map((d) => d.status))].join(", ");
  const slowest = Math.max(...done.map((d) => d.s)).toFixed(2);
  return `${many} visits to ${what}, answered ${statuses}, the last ${slowest} s after the start`;
}
let visited = "none";
if (visitors > 0) void visitsTo(ownerOf(0), visitors, "the first yard").then((said) => (visited = said));
let made = 0;
/** A command from the first player's page to their yard, and how long it took to be answered, in milliseconds. */
async function command() {
  const sent = performance.now();
  const answer = await fetch(`${server.origin}${playPath("works")}`, {
    method: "POST",
    headers: { Authorization: "Bearer p0", "Content-Type": "application/json" },
    body: JSON.stringify({ player: ids[0], commands: [{ id: `load-${++made}`, do: "collect", tick: 0 }] }),
  });
  await answer.arrayBuffer();
  if (answer.status !== 200) throw new Error(`A command was answered ${answer.status}`);
  return performance.now() - sent;
}
let freshVisited = "none";
let behind = NaN;
const commands: number[] = [];
if (fresh > 0)
  void (async () => {
    const visits = visitsTo(ids[0] ?? "", fresh, "a yard written a minute ago");
    behind = await command();
    freshVisited = await visits;
    // oxlint-disable-next-line no-await-in-loop -- one after another, as a page sends them
    for (; performance.now() - started < seconds * 1000; await Bun.sleep(500)) commands.push(await command());
  })();
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
      tended: yards > 0 && tended === "none" ? `still tending ${yards} yards` : tended,
      visited: visitors > 0 && visited === "none" ? `${visitors} visits still waiting` : visited,
      ...(fresh > 0 && {
        fresh: freshVisited === "none" ? `${fresh} visits still waiting` : freshVisited,
        owner_command_behind_them: ms(behind),
        owner_commands_after: {
          n: commands.length,
          p50: ms(commands.toSorted((a, b) => a - b)[Math.floor(commands.length / 2)] ?? NaN),
          max: ms(Math.max(...commands)),
        },
      }),
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
