/**
 * Leaf on this machine, for trying the game against it:
 *
 *   bun apps/api/test/play.ts <port> <public-dir> [--guest] [--down] [--busy] [--admin] [--crowd <n>] [--dice <n>]
 *
 * It runs the real app on a database in memory, seeded with a day of play for
 * a member called Tester and four other members, and serves `<public-dir>`
 * (the built pages: `town/`, `works/`, `battler/`) under `/play`. Two of the
 * four are in the game (Birchwood in town, Mossling at the table, saying so
 * every half minute) and two left a while ago and doze in town (Fernhollow
 * three hours ago, Quillon forty minutes ago, by the Works). Pebblefoot, who
 * is not in the guild, is in town too, as a guest. Birchwood and Pebblefoot
 * are in the town's live room as well, walking about it (`/v1/game/live`).
 * The backend, Sierra and Mojang are the tests' stand-ins, so nothing leaves
 * the machine.
 *
 * The cookie `seq_session=tester` is Tester's session; any other, or none, is
 * signed out. `/sign-in?return_to=<address>` sets it and goes back, as the
 * website's sign-in would, and `/sign-out?return_to=<address>` clears it and
 * ends the session, as the website's sign-out does, until Tester signs in again.
 * Each of the others has a session too, `as-<name>` in small letters
 * (`seq_session=as-quillon`), for a second page as somebody else:
 * `/sign-in?as=quillon&return_to=<address>` sets it. A page as somebody the
 * script walks about the town takes their place there, and they stop.
 *
 * SIGTERM or Ctrl-C stops it as a deploy stops Leaf: live connections are told Leaf is
 * restarting (1012), and event streams end, before the server goes.
 *
 * - `--guest`: Tester is signed in but not in the guild (any more), so they play as a guest.
 * - `--down`: the backend can't be asked who Tester is, so they answer 503.
 * - `--busy`: every minute, a few of the four finish a raid together, for the guild's news.
 * - `--admin`: the backend knows one more session, `staff`, of Warden, a website admin who is not
 *   in the guild, for the staff's view of who played (`GET /v1/game/admin/activity`);
 *   `/sign-in?as=warden` signs a page in as them.
 * - `--crowd <n>`: n more members, each in their own skin, in the town's live room and walking
 *   about it along its paths: stopping, sitting on a log by the fire a while, and waving now and
 *   then. They say nothing of where they are but by being in the room. Every third is on a phone.
 * - `--dice <n>`: Leaf's dice fall the same way every time from `n`, so that a tour plays the same
 *   game each time it runs. Without it they are the machine's.
 *
 * The games Leaf plays (the play service) are served as in production. For the screenshot tours,
 * `POST /test/play/raid` with `{ "stage": [...] }` stages a moment at Tester's raid table that play
 * does not reach by itself (`stage-raid.ts`); nothing like it is served by the guild's own Leaf.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { CLIENT_HZ, Flag, type PlayerId, playerId } from "@sequoia-leaf/core";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { runAchievementSync } from "../src/achievements/run.ts";
import { runCreditSync } from "../src/earning/run.ts";
import { LiveClient } from "./live-client.ts";
import { stageRaid } from "./stage-raid.ts";
import {
  DAY,
  fakeBackend,
  fakeMojang,
  HOUR,
  MINUTE,
  type Rgba,
  sessionOf,
  skinPng,
  steadyDice,
  type TestClock,
  testLeaf,
} from "./support.ts";

const USAGE =
  "Usage: bun apps/api/test/play.ts <port> <public-dir> [--guest] [--down] [--busy] [--admin] [--crowd <n>] [--dice <n>]";

const [portText = "", publicDirText = "", ...given] = process.argv.slice(2);
const port = Number(portText);
const known = new Set(["--guest", "--down", "--busy", "--admin"]);
const crowdAt = given.indexOf("--crowd");
const crowdSize = crowdAt < 0 ? 0 : Number(given[crowdAt + 1]);
const diceAt = given.indexOf("--dice");
const diceText = diceAt >= 0 ? given[diceAt + 1] : undefined;
const steady = diceText === undefined ? undefined : Number(diceText);
/** The options with a value, each with its value, taken out. */
const valued = new Set([crowdAt, diceAt].flatMap((i) => (i >= 0 ? [i, i + 1] : [])));
const flags = given.filter((_, i) => !valued.has(i));
if (
  !Number.isInteger(port) ||
  port <= 0 ||
  port > 65_535 ||
  publicDirText === "" ||
  !Number.isInteger(crowdSize) ||
  crowdSize < 0 ||
  crowdSize > 200 ||
  flags.some((o) => !known.has(o)) ||
  (diceAt >= 0 && (steady === undefined || !Number.isInteger(steady)))
) {
  console.error(USAGE);
  process.exit(2);
}
const publicDir = resolve(publicDirText);
if (!existsSync(publicDir)) {
  console.error(`${publicDir} does not exist. Build the pages into it first.\n${USAGE}`);
  process.exit(2);
}
const guest = flags.includes("--guest");
const down = flags.includes("--down");
const busy = flags.includes("--busy");
const admin = flags.includes("--admin");
const origin = `http://127.0.0.1:${port}`;

interface Member {
  readonly id: PlayerId;
  readonly name: string;
  readonly rank: string;
  readonly look: { readonly skin: Rgba; readonly hair: Rgba; readonly shirt: Rgba; readonly legs: Rgba };
}

const members: readonly Member[] = [
  {
    id: playerId("7e570000-0000-4000-8000-000000000001"),
    name: "Tester",
    rank: "Strategist",
    look: { skin: [224, 172, 140, 255], hair: [92, 58, 33, 255], shirt: [52, 110, 70, 255], legs: [58, 62, 92, 255] },
  },
  {
    id: playerId("7e570000-0000-4000-8000-000000000002"),
    name: "Birchwood",
    rank: "Captain",
    look: { skin: [198, 140, 104, 255], hair: [30, 26, 24, 255], shirt: [150, 60, 48, 255], legs: [70, 52, 40, 255] },
  },
  {
    id: playerId("7e570000-0000-4000-8000-000000000003"),
    name: "Mossling",
    rank: "Recruiter",
    look: { skin: [236, 196, 168, 255], hair: [214, 176, 92, 255], shirt: [96, 128, 60, 255], legs: [44, 60, 44, 255] },
  },
  {
    id: playerId("7e570000-0000-4000-8000-000000000004"),
    name: "Fernhollow",
    rank: "Recruit",
    look: { skin: [150, 100, 72, 255], hair: [60, 40, 30, 255], shirt: [62, 92, 140, 255], legs: [40, 40, 52, 255] },
  },
  {
    id: playerId("7e570000-0000-4000-8000-000000000005"),
    name: "Quillon",
    rank: "Chief",
    look: { skin: [226, 180, 150, 255], hair: [150, 60, 40, 255], shirt: [120, 90, 150, 255], legs: [66, 56, 80, 255] },
  },
];
const [tester, ...mates] = members;
if (tester === undefined) {
  throw new Error("Tester is missing");
}
/** Somebody who is not in the guild, in town as a guest. */
const pebblefoot = {
  id: playerId("7e570000-0000-4000-8000-000000000006"),
  name: "Pebblefoot",
  look: { skin: [240, 200, 170, 255], hair: [200, 200, 205, 255], shirt: [180, 130, 60, 255], legs: [90, 70, 50, 255] },
} as const;

/** With `--admin`: one of the guild's staff, a website admin, not in the guild. */
const warden = { id: playerId("7e570000-0000-4000-8000-000000000007"), name: "Warden" } as const;
/** Warden's session, for asking `GET /v1/game/admin/activity` with a Bearer header. */
const STAFF = "staff";

/** Invented handles for `--crowd`: none of them the town's own, the four, or the made-up guild's stand-ins. */
const CROWD_NAMES = [
  "Thistledown",
  "Brackenfoot",
  "Hollyhock",
  "Larkspur",
  "Cobblestep",
  "Dewberry",
  "Nettlebrook",
  "Rushlight",
  "Mapleshade",
  "Tansy",
  "Sorrelby",
  "Hazelnook",
  "Ashgrove",
  "Moonpetal",
  "Burrowby",
  "Clovermere",
  "Duskmoth",
  "Elderleaf",
  "Foxglove",
  "Gorseby",
  "Heathertop",
  "Primrose",
  "Juniper",
  "Kindlewood",
] as const;
const CROWD_RANKS = ["Recruit", "Recruiter", "Captain", "Strategist", "Chief"] as const;

/** A colour of the crowd's, the same for the same member and part each time. */
const shade = (n: number, part: number): Rgba => {
  const h = Math.imul(n * 7 + part * 131 + 17, 2_654_435_761) >>> 0;
  return [40 + (h % 200), 40 + ((h >>> 8) % 200), 40 + ((h >>> 16) % 200), 255];
};
const crowd: readonly Member[] = Array.from({ length: crowdSize }, (_, n) => ({
  id: playerId(`7e570000-0000-4000-8000-${String(100 + n).padStart(12, "0")}`),
  name: `${CROWD_NAMES[n % CROWD_NAMES.length] ?? "Crowd"}${n < CROWD_NAMES.length ? "" : String(Math.floor(n / CROWD_NAMES.length) + 1)}`,
  rank: CROWD_RANKS[n % CROWD_RANKS.length] ?? "Recruit",
  look: { skin: shade(n, 0), hair: shade(n, 1), shirt: shade(n, 2), legs: shade(n, 3) },
}));

// The clock is the real one, except while the past day is being played.
let playingAt: number | undefined;
const clock: TestClock = {
  get now() {
    return playingAt ?? Date.now();
  },
  set now(at: number) {
    playingAt = at;
  },
};

/** The session the script uses for itself while it plays the day, whatever Tester's is. */
const SEEDING = "seeding";
let seeding = true;
/** The script's own session for each of the other four, to say where they are in the game. */
const sessionFor = (member: { readonly name: string }) => `as-${member.name.toLowerCase()}`;
/** Tester signed out on the website: their session has ended, until they sign in again. */
let signedOut = false;
const { backend, fetcher } = fakeBackend({
  tester: () =>
    down
      ? new Response("down", { status: 502 })
      : signedOut
        ? Response.json({ error: "unauthorized" }, { status: 401 })
        : Response.json(sessionOf(tester.id, tester.name, guest ? null : tester.rank)),
  [SEEDING]: () =>
    seeding
      ? Response.json(sessionOf(tester.id, tester.name, tester.rank))
      : Response.json({ error: "unauthorized" }, { status: 401 }),
  ...Object.fromEntries(
    [...mates, ...crowd].map((mate) => [
      sessionFor(mate),
      () => Response.json(sessionOf(mate.id, mate.name, mate.rank)),
    ]),
  ),
  [sessionFor(pebblefoot)]: () => Response.json(sessionOf(pebblefoot.id, pebblefoot.name, null)),
  ...(admin
    ? Object.fromEntries(
        [STAFF, sessionFor(warden)].map((token) => [
          token,
          () => Response.json({ ...sessionOf(warden.id, warden.name, null), website_admin: true }),
        ]),
      )
    : {}),
});

const mojang = fakeMojang();
for (const [index, member] of [...members, pebblefoot, ...crowd].entries()) {
  const texture = `5e1f${index.toString(16)}a`;
  mojang.profiles.set(member.id, { name: member.name, skin: `http://textures.minecraft.net/texture/${texture}` });
  mojang.textures.set(`https://textures.minecraft.net/texture/${texture}`, skinPng(member.look));
}

const leaf = testLeaf(
  clock,
  fetcher,
  {
    publicDir,
    publicOrigin: origin,
    gameSignInUrl: `${origin}/sign-in?return_to=`,
  },
  { mojang: mojang.service, ...(steady === undefined ? {} : { dice: steadyDice(steady) }) },
);
const app = leaf.app();

// The day's play, as the backend and Sierra would report it.

interface RaidCredit {
  completion_id: number;
  completed_at: string;
  raid_name: string;
  season_rating: number;
  player_uuid: string;
}
interface WarCredit {
  war_submission_id: number;
  completed_at: string;
  territory: string;
  in_claim: boolean;
  war_points: number;
  season_rating: number;
  player_uuid: string;
}
const raids: RaidCredit[] = [];
const wars: WarCredit[] = [];
const awards: unknown[] = [];

const RAID_NAMES = [
  "Nest of the Grootslangs",
  "Orphion's Nexus of Light",
  "The Canyon Colossus",
  "The Nameless Anomaly",
  "The Wartorn Palace",
];
const TERRITORIES = ["Detlas", "Ragni", "Almuj", "Nemract", "Troms", "Cinfras", "Thesead", "Rodoroc", "Llevigar"];

const dayStart = Math.floor((Date.now() - 24 * HOUR) / MINUTE) * MINUTE;
const at = (minutes: number) => new Date(dayStart + minutes * MINUTE).toISOString();

/** A raid the party finished `minutes` into the day. */
function raid(minutes: number, party: readonly Member[], name: string, rating = 110) {
  const completion = 5000 + raids.length;
  for (const member of party) {
    raids.push({
      completion_id: completion,
      completed_at: at(minutes),
      raid_name: name,
      season_rating: rating,
      player_uuid: member.id,
    });
  }
}

function war(minutes: number, party: readonly Member[], territory: string, inClaim: boolean, points: number) {
  const submission = 9000 + wars.length;
  for (const member of party) {
    wars.push({
      war_submission_id: submission,
      completed_at: at(minutes),
      territory,
      in_claim: inClaim,
      war_points: points,
      season_rating: 30,
      player_uuid: member.id,
    });
  }
}

function award(minutes: number, member: Member, ladder: string, milestone: string, threshold: number) {
  awards.push({
    award_id: `${member.id}:${ladder}:${milestone}`,
    player_uuid: member.id,
    achievement_key: ladder,
    milestone_id: milestone,
    tier: milestone,
    threshold,
    label: milestone.charAt(0).toUpperCase() + milestone.slice(1),
    earned_at: at(minutes),
  });
}

const pick = <A>(list: readonly A[], index: number): A => {
  const value = list[index % list.length];
  if (value === undefined) {
    throw new Error("An empty list");
  }
  return value;
};

// Tester plays in the guild's timed windows, which open every four hours for two: a dozen raids
// with two or three of the others, three a window, and a dozen wars, so the rules finish some quests.
const windowsOfTheDay = Array.from({ length: 6 }, (_, k) => (Math.ceil(dayStart / (4 * HOUR)) + k) * 4 * HOUR)
  .filter((opens) => opens + 2 * HOUR < Date.now() - 5 * MINUTE)
  .map((opens) => (opens - dayStart) / MINUTE);
for (let n = 0; n < 12; n++) {
  const opens = pick(windowsOfTheDay, Math.floor(n / 3));
  const party = [tester, pick(mates, n), pick(mates, n + 1), ...(n % 3 === 0 ? [pick(mates, n + 2)] : [])];
  raid(opens + 10 + (n % 3) * 25, party, pick(RAID_NAMES, Math.floor(n / 3)), n % 4 === 0 ? 80 : 110);
  war(
    pick(windowsOfTheDay, n) + 85 + (n % 2) * 12,
    n % 2 === 0 ? [tester, pick(mates, n)] : [tester],
    pick(TERRITORIES, n),
    n % 3 === 0,
    20 + (n % 5) * 9,
  );
}
// The others raid without Tester too, and each reaches a milestone or two.
for (const [index, mate] of mates.entries()) {
  for (let n = 0; n < 4; n++) {
    raid(45 + index * 17 + n * 260, [mate, pick(mates, index + 1)], pick(RAID_NAMES, index + n), 110);
  }
  war(400 + index * 90, [mate], pick(TERRITORIES, index + 3), index % 2 === 0, 35);
  award(300 + index * 200, mate, `raid:${["NOTG", "NOL", "TCC", "TNA"][index] ?? "TNA"}`, "bronze", 25);
}
// Tester reaches a dozen milestones.
for (const [n, [ladder, milestone, threshold]] of (
  [
    ["raid:NOTG", "bronze", 25],
    ["raid:NOL", "bronze", 25],
    ["raid:TCC", "bronze", 25],
    ["raid:TNA", "bronze", 25],
    ["raid:WTP", "bronze", 25],
    ["raid:NOTG", "silver", 50],
    ["raid:NOL", "silver", 50],
    ["raid:TCC", "silver", 50],
    ["raid:TNA", "silver", 50],
    ["raid:WTP", "silver", 50],
    ["war:all", "bronze", 25],
    ["war:all", "silver", 50],
  ] as const
).entries()) {
  award(50 + n * 110, tester, ladder, milestone, threshold);
}

const within = (iso: string, from: number, to: number) => {
  const t = Date.parse(iso);
  return t >= from && t < to;
};
backend.credits = (from, to) => ({
  raids: raids.filter((credit) => within(credit.completed_at, from, to)),
  wars: wars.filter((credit) => within(credit.completed_at, from, to)),
});
backend.awards = (from, to) => ({
  awards: awards.filter(
    (each) =>
      typeof each === "object" &&
      each !== null &&
      "earned_at" in each &&
      typeof each.earned_at === "string" &&
      within(each.earned_at, from, to),
  ),
});

const quests = async (): Promise<unknown> =>
  (await app.request("/v1/me/quests", { headers: { Authorization: `Bearer ${SEEDING}` } })).json();

/** Tester swaps their daily or weekly for another, paying what it costs now. */
async function reroll(slot: "daily" | "weekly") {
  const board = await quests();
  const quest =
    typeof board === "object" && board !== null && "quests" in board && Array.isArray(board.quests)
      ? board.quests.find(
          (each: unknown) => typeof each === "object" && each !== null && "slot" in each && each.slot === slot,
        )
      : undefined;
  if (typeof quest !== "object" || quest === null || !("id" in quest) || !("reroll_leaf" in quest)) {
    return;
  }
  await app.request(`/v1/me/quests/${String(quest.id)}/reroll`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SEEDING}`, "Content-Type": "application/json" },
    body: JSON.stringify({ leaf: quest.reroll_leaf }),
  });
}

/**
 * Plays the day: the feeds are read every ten minutes, as they happen, and
 * Tester rerolls now and then. Tester first swapped a daily two days before,
 * so they have dailies banked, as a member who plays every few days does.
 */
async function playTheDay() {
  clock.now = dayStart - 2 * DAY;
  await leaf.run(Effect.all([runCreditSync("recent"), runAchievementSync("recent")]));
  await reroll("daily");
  const end = Date.now() - MINUTE;
  const steps = Math.floor((end - dayStart) / (10 * MINUTE));
  const rerollAt = new Set([20, 70, 110]);
  for (let step = 0; step <= steps; step++) {
    clock.now = Math.min(dayStart + step * 10 * MINUTE, end);
    // oxlint-disable-next-line no-await-in-loop -- the feeds are read in order, as time passes
    await leaf.run(Effect.all([runCreditSync("recent"), runAchievementSync("recent")]));
    if (rerollAt.has(step)) {
      // oxlint-disable-next-line no-await-in-loop -- after the feeds, at that moment
      await reroll(step === 70 ? "weekly" : "daily");
    }
  }
  playingAt = undefined;
}

await playTheDay();
seeding = false;

/** One of the four, or Pebblefoot, says where they are in the game, as their game would. */
async function arrive(member: { readonly name: string }, place: string) {
  await app.request("/v1/game/presence", {
    method: "PUT",
    headers: { Authorization: `Bearer ${sessionFor(member)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ place }),
  });
}

// Two left a while ago, and their characters doze in town; two are in the game, and keep saying so.
const [birchwood, mossling, fernhollow, quillon] = mates;
if (birchwood && mossling && fernhollow && quillon) {
  clock.now = Date.now() - 3 * HOUR;
  await arrive(fernhollow, "town");
  clock.now = Date.now() - 40 * MINUTE;
  await arrive(quillon, "works");
  playingAt = undefined;
  const here = () => Promise.all([arrive(birchwood, "town"), arrive(mossling, "table"), arrive(pebblefoot, "town")]);
  await here();
  setInterval(() => void here(), 30_000);
}

/** Every minute, two or three of the four come back from a raid. */
function keepBusy() {
  let n = 0;
  setInterval(() => {
    n += 1;
    const party = [pick(mates, n), pick(mates, n + 1), ...(n % 2 === 0 ? [pick(mates, n + 2)] : [])];
    const completion = 7000 + n;
    const now = new Date(Date.now() - 40_000).toISOString();
    for (const member of party) {
      raids.push({
        completion_id: completion,
        completed_at: now,
        raid_name: pick(RAID_NAMES, n),
        season_rating: 110,
        player_uuid: member.id,
      });
    }
    void leaf.run(runCreditSync("recent").pipe(Effect.ignore));
  }, MINUTE);
}
if (busy) {
  keepBusy();
}

/** The website's sign-in and sign-out, as far as the game can tell: the cookie set or cleared, and back. */
function signing(request: Request): Response | undefined {
  const url = new URL(request.url);
  if (url.pathname !== "/sign-in" && url.pathname !== "/sign-out") {
    return undefined;
  }
  const back = url.searchParams.get("return_to") ?? `${origin}/play/town/`;
  if (!back.startsWith(`${origin}/`)) {
    return new Response("return_to must be an address on this server", { status: 400 });
  }
  if (url.pathname === "/sign-out") {
    // Only Tester's session can end: the others' are the script's own.
    if (request.headers.get("cookie")?.includes("seq_session=tester") ?? true) signedOut = true;
    return new Response(null, {
      status: 302,
      headers: { Location: back, "Set-Cookie": "seq_session=; Path=/; Max-Age=0" },
    });
  }
  // `?as=<name>`: one of the others, for a second page as somebody else; otherwise Tester.
  const as = url.searchParams.get("as")?.toLowerCase();
  const other = [...mates, pebblefoot, ...crowd, ...(admin ? [warden] : [])].find((m) => m.name.toLowerCase() === as);
  if (as !== undefined && !other) return new Response("There is nobody of that name here", { status: 404 });
  if (!other) signedOut = false;
  const session = other ? sessionFor(other) : "tester";
  return new Response(null, {
    status: 302,
    headers: { Location: back, "Set-Cookie": `seq_session=${session}; Path=/; HttpOnly; SameSite=Lax` },
  });
}

// Served as production serves it, so that live connections work too, with the sign-in beside it.
const signingRoute = (path: "/sign-in" | "/sign-out") =>
  HttpRouter.add(
    "GET",
    path,
    Effect.map(HttpServerRequest.HttpServerRequest, (request) =>
      HttpServerResponse.fromWeb(
        signing(new Request(`${origin}${request.url}`, { headers: request.headers })) ??
          new Response(null, { status: 404 }),
      ),
    ),
  );
/** Stages a moment at Tester's raid table, for the tours. */
const stagingRoute = HttpRouter.add(
  "POST",
  "/test/play/raid",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body: unknown = yield* request.json.pipe(Effect.orElseSucceed(() => null));
    const ops =
      typeof body === "object" && body !== null && "stage" in body && Array.isArray(body.stage) ? body.stage : [];
    // Staged through the same Leaf the routes use, on the same database.
    const made = yield* Effect.promise(() => leaf.run(stageRaid(tester.id, ops).pipe(Effect.orDie)));
    return HttpServerResponse.jsonUnsafe({ made });
  }),
);
const served = await leaf.serve(
  port,
  Layer.mergeAll(signingRoute("/sign-in"), signingRoute("/sign-out"), stagingRoute),
);

// Stopped as a deploy stops Leaf: every live connection is told Leaf is restarting (1012) before
// the server goes, so that a page reconnects as it would to the next container.
let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  void served.close().finally(() => process.exit(0));
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

/**
 * Two of those in town walk about it live, as a player's game would say they do: Birchwood round
 * the square, and Pebblefoot, the guest, from spot to spot with a pause at each.
 */
async function walk(who: { readonly name: string }, path: readonly (readonly [number, number])[], pause: number) {
  const client = await LiveClient.open(origin, { bearer: sessionFor(who), device: "desktop" });
  await client.welcome();
  const speed = 30;
  let leg = 0;
  let [x, y] = path[0] ?? [256, 200];
  let resting = 0;
  setInterval(() => {
    const dt = 1 / CLIENT_HZ;
    const [tx, ty] = path[(leg + 1) % path.length] ?? [x, y];
    if (resting > 0) {
      resting -= dt;
      return;
    }
    const dx = tx - x;
    const dy = ty - y;
    const d = Math.hypot(dx, dy);
    const step = speed * dt;
    // The town's facings: 0 down, 1 left, 2 right, 3 up.
    const facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : dy < 0 ? 3 : 0;
    if (d <= step) {
      [x, y] = [tx, ty];
      leg = (leg + 1) % path.length;
      resting = pause;
      client.move({ x, y, vx: 0, vy: 0, facing, pose: 0, flags: 0, jump: 0 });
      return;
    }
    x += (dx / d) * step;
    y += (dy / d) * step;
    client.move({ x, y, vx: (dx / d) * speed, vy: (dy / d) * speed, facing, pose: 0, flags: Flag.Moving, jump: 0 });
  }, 1000 / CLIENT_HZ);
}
if (birchwood) {
  await walk(
    birchwood,
    [
      [200, 190],
      [320, 190],
      [320, 250],
      [200, 250],
    ],
    0,
  );
}
// Round the south of the fire, never through it.
await walk(
  pebblefoot,
  [
    [256, 120],
    [150, 220],
    [210, 258],
    [300, 258],
    [380, 230],
  ],
  3,
);

// ---------- the crowd ----------

/**
 * The town's paths as the crowd walks them, in the town's art pixels: spots on open ground, and
 * which two can be walked between in a straight line without crossing anything solid (the fire and
 * its logs, the stumps, the quest board, the lantern tree, the great stump).
 */
const SPOTS: Readonly<Record<string, readonly [number, number]>> = {
  gate: [256, 112],
  road: [256, 137],
  roadW: [180, 137],
  treasury: [104, 136],
  roadE: [330, 140],
  works: [380, 138],
  board: [206, 168],
  squareN: [256, 182],
  squareNW: [222, 186],
  squareW: [206, 222],
  squareSW: [222, 248],
  squareS: [256, 252],
  squareSE: [292, 246],
  squareE: [306, 222],
  squareNE: [290, 186],
  market: [190, 262],
  stalls: [120, 264],
  pondW: [340, 247],
  pond: [378, 252],
  tree: [352, 218],
  stumpW: [400, 210],
  stumpS: [444, 232],
  south: [252, 280],
  garden: [240, 300],
  gardenW: [200, 318],
  bench: [130, 322],
  // Where somebody steps up to a seat by the fire from.
  logN: [248, 188],
  logSW: [248, 246],
  logSE: [264, 246],
  logE: [300, 214],
};
const WAYS: readonly (readonly [string, string])[] = [
  ["gate", "road"],
  ["road", "roadW"],
  ["roadW", "treasury"],
  ["road", "roadE"],
  ["roadE", "works"],
  ["road", "board"],
  ["road", "squareN"],
  ["squareN", "squareNW"],
  ["squareN", "squareNE"],
  ["squareN", "logN"],
  ["squareNW", "squareW"],
  ["squareW", "squareSW"],
  ["squareSW", "squareS"],
  ["squareS", "logSW"],
  ["squareS", "logSE"],
  ["squareS", "squareSE"],
  ["squareSE", "squareE"],
  ["squareE", "logE"],
  ["squareE", "squareNE"],
  ["squareSW", "market"],
  ["market", "stalls"],
  ["squareSE", "pondW"],
  ["pondW", "pond"],
  ["squareE", "tree"],
  ["tree", "stumpW"],
  ["stumpW", "stumpS"],
  ["squareS", "south"],
  ["south", "garden"],
  ["garden", "gardenW"],
  ["gardenW", "bench"],
];
/**
 * The seats by the fire the crowd sits on: where the sitter is, which way they face, and the spot
 * they step up from. Never the log the town keeps for its member, or the stump on the west where
 * the town's glorp sits.
 */
const LOGS: readonly { readonly x: number; readonly y: number; readonly facing: number; readonly from: string }[] = [
  { x: 248, y: 201, facing: 0, from: "logN" },
  { x: 248, y: 236, facing: 3, from: "logSW" },
  { x: 264, y: 236, facing: 3, from: "logSE" },
  { x: 291, y: 213, facing: 1, from: "logE" },
];
const NEXT = new Map<string, string[]>();
for (const [a, b] of WAYS) {
  NEXT.set(a, [...(NEXT.get(a) ?? []), b]);
  NEXT.set(b, [...(NEXT.get(b) ?? []), a]);
}
/** The spots along the way from one spot to another, the first left out. */
function way(from: string, to: string): string[] {
  const back = new Map<string, string>([[from, from]]);
  const queue = [from];
  for (let here = queue.shift(); here !== undefined && here !== to; here = queue.shift()) {
    for (const next of NEXT.get(here) ?? []) {
      if (back.has(next)) continue;
      back.set(next, here);
      queue.push(next);
    }
  }
  const out: string[] = [];
  for (let here = to; here !== from; here = back.get(here) ?? from) out.unshift(here);
  return out;
}
const chance = <A>(list: readonly A[]): A => pick(list, Math.floor(Math.random() * list.length));
const between = (low: number, high: number) => low + Math.random() * (high - low);
/** The town's facings: 0 down, 1 left, 2 right, 3 up. */
const facingOf = (dx: number, dy: number) => (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : dy < 0 ? 3 : 0);
const sitting = new Set<number>();
const WANDER = Object.keys(SPOTS).filter((name) => !name.startsWith("log"));

/**
 * One of the crowd, in the town's live room as a player's game would be: walking from spot to spot
 * along the paths at about the town's pace, `CLIENT_HZ` moves a second while walking and one when
 * they stop; standing a few seconds at each, now and then sitting on a free log by the fire for a
 * while, and waving (or cheering, laughing, sending a heart) now and then.
 */
async function wander(member: Member, phone: boolean) {
  const client = await LiveClient.open(origin, { bearer: sessionFor(member), device: phone ? "phone" : "desktop" });
  await client.welcome();
  // Only the walking is wanted; what Leaf says back would pile up.
  client.onSnapshot = () => {
    client.snapshots.length = 0;
  };
  let spot = chance(WANDER);
  let [x, y] = SPOTS[spot] ?? [256, 200];
  let facing = 0;
  let route: string[] = [];
  /** The log they are on their way to (kept for them), and the one they are sitting on. */
  let going: number | null = null;
  let seat: number | null = null;
  let resting = between(0, 4);
  const speed = between(48, 64);
  const say = (moving: boolean, vx = 0, vy = 0) =>
    client.move({ x, y, vx, vy, facing, pose: seat === null ? 0 : 1, flags: moving ? Flag.Moving : 0, jump: 0 });
  const emote = (sometimes: number) => {
    if (Math.random() >= sometimes) return;
    client.send({ t: "act", kind: "emote", arg: Math.random() < 0.6 ? "wave" : chance(["cheer", "laugh", "heart"]) });
  };
  const letGo = () => {
    for (const log of [going, seat]) if (log !== null) sitting.delete(log);
    going = null;
    seat = null;
  };
  say(false);
  const tick = setInterval(() => {
    client.texts.length = 0;
    client.arrived.length = 0;
    if (client.closed) {
      // Somebody signed in as them elsewhere has taken their place: they stop.
      clearInterval(tick);
      letGo();
      return;
    }
    const dt = 1 / CLIENT_HZ;
    if (resting > 0) {
      resting -= dt;
      if (resting > 0) return;
      if (seat !== null) {
        // Up off the log, back to where they stepped up from.
        letGo();
        [x, y] = SPOTS[spot] ?? [x, y];
        say(false);
      }
      const free = LOGS.map((_, i) => i).filter((i) => !sitting.has(i));
      if (free.length > 0 && Math.random() < 0.25) {
        going = chance(free);
        sitting.add(going);
        route = way(spot, LOGS[going]?.from ?? spot);
      } else route = way(spot, chance(WANDER.filter((name) => name !== spot)));
    }
    const next = route[0];
    if (next === undefined) return;
    const [tx, ty] = SPOTS[next] ?? [x, y];
    const dx = tx - x;
    const dy = ty - y;
    const d = Math.hypot(dx, dy);
    const step = speed * dt;
    if (d > 0) facing = facingOf(dx, dy);
    if (d > step) {
      x += (dx / d) * step;
      y += (dy / d) * step;
      say(true, (dx / d) * speed, (dy / d) * speed);
      return;
    }
    [x, y] = [tx, ty];
    spot = next;
    route.shift();
    if (route.length > 0) return;
    const log = going === null ? undefined : LOGS[going];
    if (log) {
      // Sits down on the log, facing the fire, for a while.
      seat = going;
      going = null;
      [x, y] = [log.x, log.y];
      facing = log.facing;
      resting = between(10, 25);
      say(false);
      emote(0.5);
      return;
    }
    resting = between(2, 7);
    facing = chance([0, 0, 1, 2]);
    say(false);
    emote(0.3);
  }, 1000 / CLIENT_HZ);
}
await Promise.all(crowd.map((member, n) => wander(member, n % 3 === 0)));

const state = guest ? " (Tester is a guest)" : down ? " (the backend is down)" : "";
console.log(
  `Leaf is playing at ${origin}/play/town/${state}${crowd.length > 0 ? `, with a crowd of ${crowd.length}` : ""}`,
);
console.log(
  `Sign in: ${origin}/sign-in?return_to=${encodeURIComponent(`${origin}/play/town/`)}, or send the cookie seq_session=tester`,
);
if (admin) {
  console.log(`Who played: curl -H 'Authorization: Bearer ${STAFF}' ${origin}/v1/game/admin/activity`);
}
