/**
 * Loads a Leaf started with `leaf.ts`, from a process of its own, and says how it held up, as JSON:
 *
 *   bun apps/api/test/load/drive.ts <port> [walkers] [owners] [visitors] [seconds] [sweep]
 *
 * (300 walkers, 20 owners, 50 visitors, 20 seconds and a sweep of at most 300 seconds by default;
 * `owners` as `leaf.ts` was given them.) It goes through three phases, each measured on its own:
 *
 * 1. `walk`: the walkers join over the first five seconds and walk about the town at the game's pace
 *    (`CLIENT_HZ` moves a second); each second, one in thirty connects again (joining the town
 *    anew); and each owner's page sends a batch of one to eight commands to their yard every second.
 * 2. `visits`: the same, with `visitors` players visiting the first owner's yard at once as it begins.
 * 3. `sweep`: the same, with Leaf tending the cold yards meanwhile, from the phase's beginning until
 *    it is done or `sweep` seconds have passed; and as it begins, `visitors` players visit one of
 *    those yards at once, which Leaf must bring eight hours on first.
 *
 * Each move is timed from its sending to each other walker in its room being told it, on this
 * process's clock; each command and visit from its sending to its answer. Leaf's own measures (the
 * event loop's delay, where the play service's jobs spent their time, CPU, memory, how far behind
 * the yard longest unwritten was) come from its `/load/report`.
 */
import { CLIENT_HZ, Flag, playPath, visitPath } from "@sequoia-leaf/core";
import { Schema } from "effect";

import { LiveClient } from "../live-client.ts";
import { coldId, ownerId, spread } from "./shared.ts";

const [port, walkers, owners, visitors, seconds, sweepMost] = [
  process.argv[2],
  process.argv[3] ?? 300,
  process.argv[4] ?? 20,
  process.argv[5] ?? 50,
  process.argv[6] ?? 20,
  process.argv[7] ?? 300,
].map(Number);
if (
  port === undefined ||
  walkers === undefined ||
  owners === undefined ||
  visitors === undefined ||
  seconds === undefined ||
  sweepMost === undefined ||
  ![port, walkers, owners, visitors, seconds, sweepMost].every((n) => Number.isInteger(n) && n >= 0) ||
  walkers < 2
) {
  console.error("Usage: bun apps/api/test/load/drive.ts <port> [walkers >= 2] [owners] [visitors] [seconds] [sweep]");
  process.exit(2);
}
const origin = `http://127.0.0.1:${port}`;

/** What this process measured in the phase under way. */
let moves: number[] = [];
let commands: number[] = [];
let refused: Record<string, number> = {};
let visits: number[] = [];
let coldVisits: number[] = [];
/** The room's words of who is about the walkers were told, and how many bytes they came to. */
let abouts = 0;
let aboutBytes = 0;
let phaseBegan = 0;
const phases: { name: string; [measure: string]: unknown }[] = [];
const begin = async (name: string) => {
  await fetch(`${origin}/load/phase?name=${name}`, { method: "POST" });
  moves = [];
  commands = [];
  refused = {};
  visits = [];
  coldVisits = [];
  abouts = 0;
  aboutBytes = 0;
  phaseBegan = performance.now();
};
const end = (name: string, more: Record<string, unknown> = {}) =>
  phases.push({
    name,
    moves_seen_ms: spread(moves),
    works_commands_ms: spread(commands),
    works_answers_not_200: refused,
    about_frames: {
      n: abouts,
      kib_per_walker_s: Number((aboutBytes / 1024 / walkers / ((performance.now() - phaseBegan) / 1000)).toFixed(1)),
    },
    ...(visits.length > 0 && { visits_ms: spread(visits) }),
    ...(coldVisits.length > 0 && { visits_to_a_cold_yard_ms: spread(coldVisits) }),
    ...more,
  });

/** A walker: their connection while it is open, and when each of their moves was sent, by number. */
interface Walker {
  readonly n: number;
  client: LiveClient | null;
  room: string;
  you: number;
  sent: Map<number, number>;
  openedAt: number;
  x: number;
  dx: number;
}
let failedOpens = 0;
/** Every walker's moves as sent, by room and their number in it. */
const sentBy = new Map<string, Map<number, number>>();
const keyOf = (room: string, you: number) => `${room}#${you}`;

/** Opens a walker's connection, and tries again in a few seconds if it does not open. */
const connect = async (w: Walker): Promise<void> => {
  const opened = await LiveClient.open(origin, { bearer: `w${w.n}` })
    .then(async (client) => ({ client, welcome: await client.next("welcome", () => true, 5000) }))
    .catch(() => null);
  if (opened === null) {
    failedOpens++;
    setTimeout(() => void connect(w), 2000 + Math.random() * 3000);
    return;
  }
  const { client, welcome } = opened;
  sentBy.delete(keyOf(w.room, w.you));
  Object.assign(w, { client, room: welcome.room, you: welcome.you, sent: new Map(), openedAt: performance.now() });
  sentBy.set(keyOf(w.room, w.you), w.sent);
  client.onSnapshot = (snapshot, at) => {
    for (const e of snapshot.entries) {
      if (e.id === w.you) continue;
      const sent = sentBy.get(keyOf(w.room, e.id))?.get(e.seq);
      if (sent !== undefined) moves.push(at - sent);
    }
    for (const m of client.texts)
      if (m.t === "about") {
        abouts++;
        aboutBytes += JSON.stringify(m).length;
      }
    // Only the timings are wanted: what arrives is let go.
    client.snapshots.length = 0;
    client.texts.length = 0;
  };
};

const all: Walker[] = Array.from({ length: walkers }, (_, n) => ({
  n,
  client: null,
  room: "",
  you: -1,
  sent: new Map(),
  openedAt: 0,
  x: (n * 37) % 512,
  dx: 64 / CLIENT_HZ,
}));
const step = (w: Walker) => {
  if (w.client === null) return;
  w.x += w.dx;
  if (w.x < 0 || w.x > 512) w.dx = -w.dx;
  const seq = w.client.move({
    x: w.x,
    y: (w.n * 53) % 352,
    vx: w.dx * CLIENT_HZ,
    vy: 0,
    facing: w.dx > 0 ? 2 : 1,
    pose: 1,
    flags: Flag.Moving,
    jump: 0,
  });
  w.sent.set(seq, performance.now());
  // Only the last few seconds' moves can still be seen.
  w.sent.delete((seq - 200) & 0xffff);
};
const walking = setInterval(() => all.forEach(step), 1000 / CLIENT_HZ);
const joining = setInterval(() => {
  for (const w of all) {
    if (w.client === null || performance.now() - w.openedAt < 20_000 || Math.random() >= 1 / 30) continue;
    const was = w.client;
    w.client = null;
    was.close();
    void connect(w);
  }
}, 1000);

let made = 0;
/** A batch of one to eight commands from an owner's page to their yard, timed. */
const command = async (i: number) => {
  const sent = performance.now();
  const many = 1 + Math.floor(Math.random() * 8);
  const answer = await fetch(`${origin}${playPath("works")}`, {
    method: "POST",
    headers: { Authorization: `Bearer o${i}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      player: ownerId(i),
      commands: Array.from({ length: many }, () => ({ id: `load-${++made}`, do: "collect", tick: 0 })),
    }),
  });
  await answer.arrayBuffer();
  if (answer.status === 200) commands.push(performance.now() - sent);
  else refused[answer.status] = (refused[answer.status] ?? 0) + 1;
};
// Each owner's page sends a batch a second, once the one before is answered, as a page does.
const paging = Array.from({ length: owners }, (_, i) =>
  setTimeout(
    function again() {
      void command(i).finally(() => (stopped ? undefined : setTimeout(again, 1000)));
    },
    (i * 1000) / Math.max(1, owners),
  ),
);
let stopped = false;

/** That many visit `owner`'s yard at once, each timed into `times`. */
const visitBurst = (owner: string, many: number, times: number[]) =>
  Promise.all(
    Array.from({ length: many }, async (_, n) => {
      const sent = performance.now();
      const answer = await fetch(`${origin}${visitPath("works", owner)}`, {
        headers: { Authorization: `Bearer v${n}` },
      });
      await answer.arrayBuffer();
      if (answer.status === 200) times.push(performance.now() - sent);
      else refused[`visit ${answer.status}`] = (refused[`visit ${answer.status}`] ?? 0) + 1;
    }),
  );

await begin("walk");
// Joining over the first five seconds.
for (const [i, w] of all.entries()) {
  setTimeout(() => void connect(w), (i * 5000) / walkers);
}
await Bun.sleep(seconds * 1000);
end("walk", { walkers_connected: all.filter((w) => w.client !== null).length });

await begin("visits");
const burst = visitBurst(ownerId(0), visitors, visits);
await Bun.sleep(seconds * 1000);
await burst;
end("visits");

await begin("sweep");
const sweepBegan = performance.now();
await fetch(`${origin}/load/sweep`, { method: "POST" });
const coldBurst = visitBurst(coldId(0), visitors, coldVisits);
const Swept = Schema.Struct({ done: Schema.Boolean, took_s: Schema.NullOr(Schema.Number) });
let swept: typeof Swept.Type = { done: false, took_s: null };
while (!swept.done && performance.now() - sweepBegan < sweepMost * 1000) {
  // oxlint-disable-next-line no-await-in-loop -- asked again every two seconds
  await Bun.sleep(2000);
  // oxlint-disable-next-line no-await-in-loop -- asked again every two seconds
  swept = Schema.decodeUnknownSync(Swept)(await (await fetch(`${origin}/load/swept`)).json());
}
await coldBurst;
end("sweep", { sweep: swept.done ? `done in ${swept.took_s} s` : `not done after ${sweepMost} s` });

stopped = true;
clearInterval(walking);
clearInterval(joining);
paging.forEach(clearTimeout);
const leaf: unknown = await (await fetch(`${origin}/load/report`)).json();
const cpu = process.cpuUsage();
console.log(
  JSON.stringify(
    {
      walkers,
      owners,
      visitors,
      driver_cpu_s: Number(((cpu.user + cpu.system) / 1e6).toFixed(1)),
      connections_refused: failedOpens,
      phases,
      leaf,
    },
    null,
    2,
  ),
);
for (const w of all) w.client?.close();
process.exit(0);
