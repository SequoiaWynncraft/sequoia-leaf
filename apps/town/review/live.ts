/**
 * A stand-in for the guild's server, for looking at the town live without one:
 * `bun review/live.ts <port> [--signed-out | --not-a-member | --down]`.
 *
 * It serves the built town and games under `/play/` (from `dist/`, `../works/dist/` and
 * `../battler/dist/`) and answers the routes the game asks, as the spec has them, for a made-up
 * member called Tester: a rank, some Leaf, three quests, a day of news since the town last told
 * them any, five others in the game, and the saves kept in memory. Their skin is the test skin
 * (`~/.cache/grove-blocks/skins/notes.png`); nobody else's is found. `GET /review/raid` sends the
 * guild's stream a raid party coming home, one of them in town.
 *
 * `--signed-out` answers 401 (and its sign-in sends the page straight back), `--not-a-member` 403
 * and `--down` 503.
 */

import { homedir } from "node:os";

const port = Number(process.argv[2] ?? 8790);
const mode = process.argv[3] ?? "";
const origin = `http://127.0.0.1:${port}`;
const HERE = new URL("..", import.meta.url).pathname;
const SITES: Readonly<Record<string, string>> = {
  town: `${HERE}dist`,
  works: `${HERE}../works/dist`,
  battler: `${HERE}../battler/dist`,
};
const SKIN = `${homedir()}/.cache/grove-blocks/skins/notes.png`;

const ME = "10000000-0000-0000-0000-00000000000a";
const HOUR = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const json = (body: unknown, status = 200): Response => Response.json(body, { status });

// ---------- the member, their quests and their news ----------

const me = {
  player: { id: ME, username: "Tester" },
  rank: "captain",
  leaf: 2450,
  xp: 5230,
  level: { number: 7, xp_into_level: 230, xp_for_next_level: 1400 },
  event_cursor: 151,
};

const goal = (type: string, raid: string | null, title: string, progress: number, target: number): unknown => ({
  type,
  raid,
  title,
  progress,
  target,
});

function quests(): unknown {
  const now = Date.now();
  const top = now - (now % (4 * HOUR));
  return {
    daily: { charges: 1, charge_cap: 3, next_charge_at: iso(top + 20 * HOUR) },
    timed: { ends_at: iso(top + 2 * HOUR), next_at: iso(top + 4 * HOUR) },
    quests: [
      {
        id: "timed:31",
        slot: "timed",
        title: "Complete 2 NOL raids or 6 wars",
        objective: { type: "raids", raid: "nol" },
        progress: 1,
        target: 2,
        goals: [goal("raids", "nol", "Complete 2 NOL raids", 1, 2), goal("wars", null, "Take part in 6 wars", 2, 6)],
        reward: { leaf: 500, xp: 250 },
        started_at: iso(top),
        expires_at: iso(top + 2 * HOUR),
        completed_at: null,
        reroll_leaf: null,
      },
      {
        id: "daily:12",
        slot: "daily",
        title: "Complete 3 TNA raids or 9 wars",
        objective: { type: "raids", raid: "tna" },
        progress: 3,
        target: 3,
        goals: [goal("raids", "tna", "Complete 3 TNA raids", 3, 3), goal("wars", null, "Take part in 9 wars", 1, 9)],
        reward: { leaf: 300, xp: 150 },
        started_at: iso(top - 6 * HOUR),
        expires_at: null,
        completed_at: iso(now - 2 * HOUR),
        reroll_leaf: null,
      },
      {
        id: "weekly:4",
        slot: "weekly",
        title: "Complete 12 raids or 36 wars",
        objective: { type: "raids", raid: null },
        progress: 7,
        target: 12,
        goals: [goal("raids", null, "Complete 12 raids", 7, 12), goal("wars", null, "Take part in 36 wars", 4, 36)],
        reward: { leaf: 800, xp: 400 },
        started_at: iso(now - 3 * 24 * HOUR),
        expires_at: iso(now + 4 * 24 * HOUR),
        completed_at: null,
        reroll_leaf: 0,
      },
    ],
    recently_completed: [],
  };
}

/** What happened to Tester over the last day, oldest first: ids 141 to 151. */
function news(): unknown[] {
  const now = Date.now();
  const at = (h: number): string => iso(now - h * HOUR);
  const raid = (id: number, h: number, detail: string): unknown => ({
    id,
    type: "leaf_earned",
    created_at: at(h),
    data: { source: "raid", leaf: 110, xp: 110, detail, occurred_at: at(h + 0.05) },
  });
  return [
    raid(141, 20, "The Nameless Anomaly"),
    raid(142, 19, "The Nameless Anomaly"),
    raid(143, 9, "Nest of the Grootslangs"),
    {
      id: 144,
      type: "leaf_earned",
      created_at: at(8),
      data: { source: "war", leaf: 73, xp: 73, detail: "Detlas", occurred_at: at(8.1), in_claim: true },
    },
    raid(145, 6, "Orphion's Nexus of Light"),
    {
      id: 146,
      type: "quest_completed",
      created_at: at(6),
      data: { quest: { id: "daily:12", title: "Complete 3 TNA raids or 9 wars", reward: { leaf: 300, xp: 150 } } },
    },
    { id: 147, type: "level_up", created_at: at(6), data: { level: 7, leaf: 100 } },
    raid(148, 3, "The Canyon Colossus"),
    raid(149, 2, "The Canyon Colossus"),
    {
      id: 150,
      type: "achievement_paid",
      created_at: at(2),
      data: { label: "Silver", tier: "silver", ladder: "raid:TCC", leaf: 1000, xp: 0 },
    },
    raid(151, 1, "The Canyon Colossus"),
  ];
}

// ---------- the town slot, as if the member had been here yesterday ----------

const saves = new Map<string, { version: number; data: unknown; updated_at: string }>([
  [
    "town",
    {
      version: 3,
      updated_at: iso(Date.now() - 22 * HOUR),
      data: {
        saved_at: Date.now() - 22 * HOUR,
        keys: { "town.save.v1": JSON.stringify({ v: 1, lastSeen: Date.now() - 22 * HOUR, cursor: 140, welcomed: "" }) },
      },
    },
  ],
  [
    "purse",
    {
      version: 5,
      updated_at: iso(Date.now()),
      data: { saved_at: Date.now(), keys: { "town.purse.v1": '{"coins":640}' } },
    },
  ],
]);

// ---------- who else is here ----------

const OTHERS = [
  { id: "20000000-0000-0000-0000-000000000001", username: "Brambleton", place: "town" },
  { id: "20000000-0000-0000-0000-000000000002", username: "Kestrelle", place: "town" },
  { id: "20000000-0000-0000-0000-000000000003", username: "Oakhollow", place: "works" },
  { id: "20000000-0000-0000-0000-000000000004", username: "Mirefoot", place: "table" },
  { id: "20000000-0000-0000-0000-000000000005", username: "Thistledown", place: "camp" },
];

// ---------- streams ----------

const encoder = new TextEncoder();
const guildStreams = new Set<ReadableStreamDefaultController<Uint8Array>>();
let guildId = 900;

function events(keep: Set<ReadableStreamDefaultController<Uint8Array>> | null, first: number): Response {
  let beat: ReturnType<typeof setInterval> | null = null;
  let mine: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      mine = c;
      keep?.add(c);
      c.enqueue(encoder.encode(`id: ${first}\n\n`));
      beat = setInterval(() => {
        c.enqueue(encoder.encode(": still here\n\n"));
      }, 20_000);
    },
    cancel() {
      if (beat) clearInterval(beat);
      if (mine) keep?.delete(mine);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}

/** A raid party of three comes home: one is in town, two were only out raiding. */
function raidHome(): number {
  const occurred = iso(Date.now() - 2 * 60_000);
  const party = [
    { id: OTHERS[1]?.id ?? "", username: "Kestrelle" },
    { id: "20000000-0000-0000-0000-000000000009", username: "Wickerbill" },
    { id: "20000000-0000-0000-0000-00000000000a", username: "Saltmarsh" },
  ];
  for (const player of party) {
    const id = ++guildId;
    const e = {
      id,
      type: "leaf_earned",
      created_at: iso(Date.now()),
      player,
      data: { source: "raid", detail: "Orphion's Nexus of Light", occurred_at: occurred },
    };
    const frame = encoder.encode(`id: ${id}\nevent: leaf_earned\ndata: ${JSON.stringify(e)}\n\n`);
    for (const c of guildStreams) c.enqueue(frame);
  }
  return guildStreams.size;
}

// ---------- the server ----------

async function page(path: string): Promise<Response> {
  const [, , game = "", ...rest] = path.split("/");
  const root = SITES[game];
  if (!root) return new Response("not found", { status: 404 });
  const file = Bun.file(`${root}/${rest.join("/") || "index.html"}`);
  if (path.includes("..") || !(await file.exists())) return new Response("not found", { status: 404 });
  return new Response(file);
}

async function sentBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const v: unknown = await req.json();
    return typeof v === "object" && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v)) : {};
  } catch {
    return {};
  }
}

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  if (path === "/") return Response.redirect(`${origin}/play/town/`, 302);
  if (path.startsWith("/play/")) return page(path);
  if (path === "/signin") return Response.redirect(url.searchParams.get("return_to") ?? `${origin}/play/town/`, 302);
  if (path === "/review/raid") return json({ sent: raidHome() });
  if (path === "/v1/game/hello") return json({ sign_in: `${origin}/signin?return_to=`, leaf_spending: false });
  if (mode === "--signed-out") return json({ code: "unauthorized", message: "Sign in again" }, 401);
  if (mode === "--not-a-member")
    return json({ code: "not_a_member", message: "Leaf is for current Sequoia members" }, 403);
  if (mode === "--down") return json({ code: "identity_unavailable", message: "Try again soon" }, 503);
  if (path === "/v1/game/me") return json(me);
  if (path === "/v1/me/quests") return json(quests());
  if (path === "/v1/me/events") {
    const after = Number(url.searchParams.get("after") ?? -1);
    const all = news().filter((e) => typeof e === "object" && e !== null && "id" in e && Number(e.id) > after);
    return json({ events: after < 0 ? all.slice(-50) : all.slice(0, 100) });
  }
  if (path === "/v1/me/events/stream") return events(null, me.event_cursor);
  if (path === "/v1/game/guild/events/stream") return events(guildStreams, guildId);
  if (path === "/v1/game/presence" && req.method === "PUT") {
    const place = (await sentBody(req)).place;
    return json({ present: [{ id: ME, username: "Tester", place }, ...OTHERS] });
  }
  if (path.startsWith("/v1/game/skins/")) {
    const id = path.split("/").pop() ?? "";
    const file = Bun.file(SKIN);
    return id === ME && (await file.exists())
      ? new Response(file, { headers: { "Content-Type": "image/png" } })
      : json({ code: "no_skin", message: "No skin" }, 404);
  }
  if (path.startsWith("/v1/game/saves/")) {
    const slot = path.split("/").pop() ?? "";
    const row = saves.get(slot);
    if (req.method === "GET")
      return row ? json({ slot, ...row }) : json({ code: "no_save", message: "Nothing is saved in that slot" }, 404);
    const b = await sentBody(req);
    if ((row?.version ?? 0) !== b.version) return json({ code: "version_conflict", message: "Read it again" }, 409);
    const next = { version: (row?.version ?? 0) + 1, data: b.data, updated_at: iso(Date.now()) };
    saves.set(slot, next);
    return json({ version: next.version, updated_at: next.updated_at });
  }
  return json({ code: "not_found", message: "No such route" }, 404);
}

Bun.serve({ port, hostname: "127.0.0.1", fetch: route, idleTimeout: 0 });
console.log(`${origin}/play/town/ ${mode}`);
