/**
 * Leaf on this machine, for trying the game against it:
 *
 *   bun apps/api/test/play.ts <port> <public-dir> [--not-a-member] [--down] [--busy]
 *
 * It runs the real app on a database in memory, seeded with a day of play for
 * a member called Tester and four guild-mates, and serves `<public-dir>` (the
 * built pages: `town/`, `works/`, `battler/`) under `/play`. The backend,
 * Sierra and Mojang are the tests' stand-ins, so nothing leaves the machine.
 *
 * The cookie `seq_session=tester` is Tester's session; any other, or none, is
 * signed out. `/sign-in?return_to=<address>` sets it and goes back, as the
 * website's sign-in would, and `/sign-out?return_to=<address>` clears it.
 *
 * - `--not-a-member`: Tester is signed in but not in the guild, so the game's routes answer 403.
 * - `--down`: the backend can't be asked who Tester is, so they answer 503.
 * - `--busy`: every minute, a few guild-mates finish a raid together, for the guild's news.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { type PlayerId, playerId } from "@sequoia-leaf/core";
import { Effect } from "effect";

import { runAchievementSync } from "../src/achievements/run.ts";
import { runCreditSync } from "../src/earning/run.ts";
import {
  DAY,
  fakeBackend,
  fakeMojang,
  HOUR,
  MINUTE,
  type Rgba,
  sessionOf,
  skinPng,
  type TestClock,
  testLeaf,
} from "./support.ts";

const USAGE = "Usage: bun apps/api/test/play.ts <port> <public-dir> [--not-a-member] [--down] [--busy]";

const [portText = "", publicDirText = "", ...options] = process.argv.slice(2);
const port = Number(portText);
const known = new Set(["--not-a-member", "--down", "--busy"]);
if (
  !Number.isInteger(port) ||
  port <= 0 ||
  port > 65_535 ||
  publicDirText === "" ||
  options.some((o) => !known.has(o))
) {
  console.error(USAGE);
  process.exit(2);
}
const publicDir = resolve(publicDirText);
if (!existsSync(publicDir)) {
  console.error(`${publicDir} does not exist. Build the pages into it first.\n${USAGE}`);
  process.exit(2);
}
const notAMember = options.includes("--not-a-member");
const down = options.includes("--down");
const busy = options.includes("--busy");
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
const { backend, fetcher } = fakeBackend({
  tester: () =>
    down
      ? new Response("down", { status: 502 })
      : Response.json(sessionOf(tester.id, tester.name, notAMember ? null : tester.rank)),
  [SEEDING]: () =>
    seeding
      ? Response.json(sessionOf(tester.id, tester.name, tester.rank))
      : Response.json({ error: "unauthorized" }, { status: 401 }),
});

const mojang = fakeMojang();
for (const [index, member] of members.entries()) {
  const texture = `5e1f${index}a`;
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
  { mojang: mojang.service },
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
// with two or three guild-mates, three a window, and a dozen wars, so the rules finish some quests.
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
// The guild-mates raid without Tester too, and each reaches a milestone or two.
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

/** Every minute, two or three guild-mates come back from a raid. */
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
  const cookie =
    url.pathname === "/sign-in"
      ? "seq_session=tester; Path=/; HttpOnly; SameSite=Lax"
      : "seq_session=; Path=/; Max-Age=0";
  return new Response(null, { status: 302, headers: { Location: back, "Set-Cookie": cookie } });
}

Bun.serve({
  hostname: "127.0.0.1",
  port,
  // Seconds. An event stream writes a keep-alive every 20, well inside this.
  idleTimeout: 60,
  fetch: (request) => signing(request) ?? app.handle(request),
});

const state = notAMember ? " (Tester is not a member)" : down ? " (the backend is down)" : "";
console.log(`Leaf is playing at ${origin}/play/town/${state}`);
console.log(
  `Sign in: ${origin}/sign-in?return_to=${encodeURIComponent(`${origin}/play/town/`)}, or send the cookie seq_session=tester`,
);
