import { afterEach, describe, expect, test } from "bun:test";

import { restart, start } from "@sequoia-leaf/kit/live.ts";
import { isRecord } from "@sequoia-leaf/kit/net.ts";
import { balance, forgetLedger, leafShown } from "@sequoia-leaf/kit/purse.ts";
import {
  GUEST,
  HELLO,
  membersOnly,
  type Reply,
  type Route,
  type Standin,
  standin,
  TESTER,
} from "@sequoia-leaf/kit/standin.ts";

import type { Happening } from "./guild.ts";
import {
  type Ev,
  GATHER,
  letterLines,
  makeLive,
  makeNews,
  NO_REROLL,
  prepare,
  prepared,
  rankName,
  readEvent,
  readEvents,
  readQuests,
  toResting,
  toVisitors,
  unprepare,
  weekOf,
} from "./live.ts";
import { inTownLine, lineFor, makePace, PACE, STALE } from "./news.ts";

/** What Leaf really sends, from the contract its own tests write. */
const contract: unknown = await Bun.file(new URL("../../../contracts/leaf-api-v1.json", import.meta.url)).json();
const answer = (route: string): unknown => {
  const r = isRecord(contract) ? contract[route] : null;
  return isRecord(r) ? r.body : null;
};
const QUESTS = answer("GET /v1/me/quests");
const EVENTS = answer("GET /v1/me/events");
/** A list, or nothing. */
const listed = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const ME = "10000000-0000-0000-0000-00000000000a";

/** One of the guild's events, as the guild's stream sends it. */
function guildEvent(id: number, who: string, type: string, data: Record<string, unknown>): Ev {
  const e = readEvent({
    id,
    type,
    created_at: "2026-11-25T12:40:00.000Z",
    player: { id: `id-${who}`, username: who },
    data,
  });
  if (!e) throw new Error("not an event");
  return e;
}
const sse = (text: string): Reply =>
  new Response(text, { status: 200, headers: { "Content-Type": "text/event-stream" } });
const frame = (id: number, type: string, data: unknown): string =>
  `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
/** One of the guild's events as a frame of the guild's stream. */
const ev = (id: number, who: string, type: string, data: Record<string, unknown>): string =>
  frame(id, type, { id, type, created_at: "x", player: { id: `id-${who}`, username: who }, data });

const raid = (id: number, who: string, at = "2026-11-25T12:31:00.000Z", detail = "Nest of the Grootslangs"): Ev =>
  guildEvent(id, who, "leaf_earned", { source: "raid", detail, occurred_at: at });

describe("the quest board, live", () => {
  test("the member's quests are notes, each with its kind, its ways to finish it and what a reroll costs", () => {
    const notes = readQuests(QUESTS);
    expect(notes.length).toBeGreaterThan(1);
    for (const q of notes) expect(q.reward).toBeGreaterThan(0);
    expect(notes.find((q) => q.id === "weekly:2")).toEqual({
      id: "weekly:2",
      slot: "weekly",
      title: "Complete 12 TCC raids or 60 wars",
      goals: [
        { have: 0, need: 12, unit: "TCC raids" },
        { have: 0, need: 60, unit: "wars" },
      ],
      reward: 800,
      ends: Date.parse("2026-11-30T00:00:00.000Z"),
      reroll: 100,
    });
  });

  test("a finished quest is full and paid by the goal that did it, and cannot be rerolled", () => {
    const notes = readQuests(QUESTS);
    expect(notes.find((q) => q.id === "timed:1")).toMatchObject({
      goals: [{ have: 2, need: 2, unit: "TNA raids" }],
      ends: null,
      reroll: null,
    });
    expect(notes.find((q) => q.id === "daily:1")?.goals).toEqual([{ have: 3, need: 3, unit: "TNA raids" }]);
  });

  test("an either-or quest shows each way's own count; with only one count from Leaf, it shows that one", () => {
    const open = {
      id: "daily:9",
      slot: "daily",
      title: "Complete 3 NOL raids or 9 wars",
      objective: { type: "wars", raid: null },
      progress: 4,
      target: 9,
      goals: [
        { type: "raids", raid: "nol", progress: 1, target: 3 },
        { type: "wars", raid: null, progress: 4, target: 9 },
      ],
      reward: { leaf: 300, xp: 150 },
      expires_at: null,
      completed_at: null,
      reroll_leaf: 0,
    };
    const { goals, ...alone } = open;
    expect(readQuests({ quests: [open] })).toEqual([
      {
        id: "daily:9",
        slot: "daily",
        title: "Complete 3 NOL raids or 9 wars",
        goals: [
          { have: 1, need: 3, unit: "NOL raids" },
          { have: 4, need: 9, unit: "wars" },
        ],
        reward: 300,
        ends: null,
        reroll: 0,
      },
    ]);
    for (const one of [alone, { ...open, goals: goals.slice(1) }, { ...open, goals: [goals[0], { type: "wars" }] }])
      expect(readQuests({ quests: [one] })[0]?.goals).toEqual([{ have: 4, need: 9, unit: "wars" }]);
  });

  test("every quest is listed, however many", () => {
    const weekly = listed(isRecord(QUESTS) ? QUESTS.quests : null)[0];
    const many = Array.from({ length: 8 }, (_, n) => ({ ...(isRecord(weekly) ? weekly : {}), id: `weekly:${n}` }));
    expect(readQuests({ quests: many })).toHaveLength(8);
  });

  test("the same quest open and just finished is one note", () => {
    const ids = readQuests(QUESTS).map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the arrival letter, live", () => {
  const events = readEvents(EVENTS);

  test("raids summed, wars, quests, the level reached and milestones, each with the Leaf already paid", () => {
    expect(letterLines(events)).toEqual([
      { art: "leaf", text: "15 raids with the guild", got: 15 * 110 },
      { art: "banner", text: "2 wars for the guild", got: 73 + 12 },
      { art: "leaf", text: "2 quests finished", got: 500 + 300 },
      { art: "leaf", text: "You reached level 2", got: 100 },
      { art: "leaf", text: "A milestone reached: Gold", got: 2500 },
    ]);
  });

  test("nothing new is no lines", () => {
    expect(letterLines([])).toEqual([]);
  });

  test("the week counts what the member's newest news reaches back to", () => {
    const now = Date.parse("2026-11-26T00:00:00.000Z");
    expect(weekOf(events, now)).toEqual(["15 raids", "2 wars", "2 quests"]);
    const fifty = Array.from({ length: 50 }, (_, i) => ({ ...raid(i, "Tester"), at: now - 1000 }));
    expect(weekOf(fifty, now)).toEqual(["50+ raids"]);
    expect(weekOf([], now)).toEqual(["a quiet one so far"]);
  });
});

describe("the guild's news, live", () => {
  test("raid events with one detail and occurred_at are one party, told once all have come in", () => {
    const news = makeNews(ME);
    news.add(raid(1, "Alice"), 0);
    news.add(raid(2, "Bob"), 500);
    news.add(raid(3, "Cleo", "2026-11-25T12:45:00.000Z"), 900);
    news.add(raid(4, "Dara"), 900);
    expect(news.due(900 + GATHER - 1)).toEqual([]);
    const told = news.due(900 + GATHER);
    expect(told).toEqual([
      {
        kind: "party",
        raid: "Nest of the Grootslangs",
        who: [
          { id: "id-Alice", name: "Alice", you: false },
          { id: "id-Bob", name: "Bob", you: false },
          { id: "id-Dara", name: "Dara", you: false },
        ],
      },
      { kind: "party", raid: "Nest of the Grootslangs", who: [{ id: "id-Cleo", name: "Cleo", you: false }] },
    ]);
    // A late name for a party already told does not tell it again.
    news.add(raid(5, "Eli"), 9000);
    expect(news.due(9000 + GATHER)).toEqual([]);
  });

  test("a war is the banner for that territory; a level and a milestone are lines", () => {
    const news = makeNews(ME);
    news.add(
      guildEvent(1, "Alice", "leaf_earned", {
        source: "war",
        detail: "Detlas",
        occurred_at: "2026-11-25T12:37:00.000Z",
        in_claim: true,
      }),
      0,
    );
    news.add(guildEvent(2, "Bob", "level_up", { level: 10 }), 0);
    news.add(guildEvent(3, "Cleo", "achievement_paid", { label: "Gold", tier: "gold" }), 0);
    const told = news.due(GATHER);
    expect(told.map((h) => h.kind)).toEqual(["reached", "milestone", "war"]);
    expect(told.map((h) => lineFor(h)?.[0])).toEqual([
      "Bob reached level 10.",
      "Cleo reached a milestone: Gold.",
      "Alice fought at Detlas.",
    ]);
  });

  test("a war says only who fought there, named as a raid party is, in the guild's claim or not", () => {
    const fought = ["Alice", "Bob", "Cleo"];
    for (const claim of [{ in_claim: true }, { in_claim: false }, {}]) {
      const news = makeNews(ME);
      const at = { occurred_at: "2026-11-25T12:37:00.000Z", ...claim };
      fought.forEach((who, i) => {
        news.add(guildEvent(i + 1, who, "leaf_earned", { source: "war", detail: "Ragni", ...at }), 0);
        news.add(guildEvent(i + 10, who, "leaf_earned", { source: "raid", detail: "TNA", ...at }), 0);
      });
      news.add(guildEvent(20, "Tester", "leaf_earned", { source: "war", detail: "Ragni", ...at }), 0);
      const told = news.due(GATHER);
      const war = told.find((h) => h.kind === "war");
      const party = told.find((h) => h.kind === "party");
      expect(party && lineFor(party)?.[0]).toBe("Alice, Bob and Cleo came back from TNA.");
      expect(war && lineFor(war)).toEqual(["Alice, Bob and 2 more fought at Ragni.", "rose"]);
    }
    // The member is "You", first, as in a raid party's line.
    const news = makeNews("id-Alice");
    news.add(guildEvent(1, "Bob", "leaf_earned", { source: "war", detail: "Detlas", occurred_at: "t" }), 0);
    news.add(guildEvent(2, "Alice", "leaf_earned", { source: "war", detail: "Detlas", occurred_at: "t" }), 0);
    const [war] = news.due(GATHER);
    expect(war && lineFor(war)?.[0]).toBe("You and Bob fought at Detlas.");
  });

  test("another member's level is a line only at a multiple of five; the member's own always is", () => {
    const news = makeNews(ME);
    const mine = (id: number, level: number): Ev => {
      const e = readEvent({
        id,
        type: "level_up",
        created_at: "x",
        player: { id: ME, username: "Tester" },
        data: { level },
      });
      if (!e) throw new Error("not an event");
      return e;
    };
    [71, 74, 75, 76, 80, 100, 103].forEach((level, i) => {
      news.add(guildEvent(i + 1, "Wrenly", "level_up", { level }), 0);
    });
    news.add(mine(20, 74), 0);
    news.add(mine(21, 75), 0);
    const told = news.due(0);
    // Every level still reaches the town, for whatever it does in the world; only the feed is choosy.
    expect(told.length).toBe(9);
    expect(told.flatMap((h) => lineFor(h)?.[0] ?? [])).toEqual([
      "Wrenly reached level 75.",
      "Wrenly reached level 80.",
      "Wrenly reached level 100.",
      "You reached level 74.",
      "You reached level 75.",
    ]);
  });

  test("no amount of Leaf in any line of the feed", () => {
    const news = makeNews(ME);
    const amounts = { leaf: 110, xp: 110 };
    news.add(guildEvent(1, "Alice", "leaf_earned", { source: "raid", detail: "TNA", occurred_at: "a", ...amounts }), 0);
    news.add(guildEvent(2, "Bob", "leaf_earned", { source: "war", detail: "Ragni", occurred_at: "b", ...amounts }), 0);
    news.add(guildEvent(3, "Cleo", "level_up", { level: 5, leaf: 100 }), 0);
    news.add(guildEvent(4, "Dara", "achievement_paid", { label: "Silver", tier: "silver", leaf: 1000 }), 0);
    const lines = news.due(GATHER).flatMap((h) => lineFor(h)?.[0] ?? []);
    expect(lines.length).toBe(4);
    for (const line of lines) {
      expect(line).not.toMatch(/Leaf|110|100|1000/);
    }
  });

  test("the member is named as themself, first, and the same event twice is told once", () => {
    const news = makeNews(ME);
    const mine = readEvent({
      id: 7,
      type: "leaf_earned",
      created_at: "x",
      player: { id: ME, username: "Tester" },
      data: { source: "raid", detail: "TNA", occurred_at: "t" },
    });
    if (!mine) throw new Error("not an event");
    news.add(raid(6, "Alice", "t", "TNA"), 0);
    news.add(mine, 0);
    news.add(mine, 10);
    const told = news.due(10 + GATHER);
    expect(told.length).toBe(1);
    expect(told.map((h) => lineFor(h)?.[0])).toEqual(["You and Alice came back from TNA."]);
  });
});

describe("the feed's pace, live", () => {
  test("at most one line every twenty seconds; the others wait their turn, oldest first", () => {
    const pace = makePace<string>();
    for (const line of ["first", "second", "third"]) pace.add(line, 1000);
    const said: [number, string][] = [];
    for (let t = 1000; t <= 1000 + 3 * PACE; t += 500) for (const line of pace.due(t)) said.push([t, line]);
    expect(said).toEqual([
      [1000, "first"],
      [1000 + PACE, "second"],
      [1000 + 2 * PACE, "third"],
    ]);
    // A line after a quiet spell is said at once.
    pace.add("fourth", 1000 + 5 * PACE);
    expect(pace.due(1000 + 5 * PACE)).toEqual(["fourth"]);
    pace.add("fifth", 1000 + 5 * PACE + 1);
    expect(pace.due(1000 + 6 * PACE - 1)).toEqual([]);
    expect(pace.due(1000 + 6 * PACE)).toEqual(["fifth"]);
  });

  test("a line that has waited more than five minutes is dropped", () => {
    const pace = makePace<number>();
    for (let n = 0; n < 20; n++) pace.add(n, 0);
    const said: number[] = [];
    for (let t = 0; t <= 20 * PACE; t += 1000) said.push(...pace.due(t));
    // Each waits twenty seconds more than the last: those whose turn came within five minutes are said.
    expect(said).toEqual(Array.from({ length: STALE / PACE + 1 }, (_, n) => n));
    pace.add(99, 20 * PACE);
    expect(pace.due(20 * PACE)).toEqual([99]);
  });
});

describe("the live guild", () => {
  let world: Standin | null = null;
  afterEach(() => {
    world?.done();
    world = null;
    restart();
    forgetLedger();
    unprepare();
  });

  test("own news heard in town moves the letter's start past it, and is not told again", async () => {
    world = standin({
      "GET /v1/game/hello": HELLO,
      "GET /v1/game/me": { status: 200, body: TESTER },
      "GET /v1/me/quests": { status: 200, body: QUESTS },
      "GET /v1/me/events": (s) =>
        s.path.includes("after=") ? { status: 200, body: { events: [] } } : { status: 200, body: EVENTS },
      "GET /v1/me/events/stream": sse(
        `id: 140\n\n${frame(141, "leaf_earned", { id: 141, type: "leaf_earned", created_at: "x", data: { source: "raid", detail: "TNA", occurred_at: "t", leaf: 110, xp: 110 } })}`,
      ),
      "GET /v1/game/guild/events/stream": sse(
        frame(900, "leaf_earned", {
          id: 900,
          type: "leaf_earned",
          created_at: "x",
          player: { id: TESTER.player.id, username: "Tester" },
          data: { source: "raid", detail: "TNA", occurred_at: "t" },
        }).repeat(2),
      ),
    });
    await start();
    // How far Leaf's town says the member's news has been told.
    expect(await prepare(120)).toBe(true);
    const p = prepared();
    if (!p) throw new Error("nothing prepared");
    expect(p.first).toBe(false);
    expect(world.sent.some((s) => s.path === "/v1/me/events?after=120")).toBe(true);

    const guild = makeLive(p);
    const heard: Happening[] = [];
    guild.hear((h) => heard.push(h));
    await Bun.sleep(20);
    world.clock.now += GATHER;
    guild.step(0.1);
    guild.step(0.1);
    expect(heard.filter((h) => h.kind === "party").length).toBe(1);
    expect(guild.told()).toBe(141);
    expect(guild.me()).toMatchObject({
      name: "Tester",
      rank: "Captain",
      level: 7,
      skin: `/v1/game/skins/${TESTER.player.id}`,
    });
  });

  test("the first visit here starts from the member's newest news, and the letter has none of it", async () => {
    world = standin({
      "GET /v1/game/hello": HELLO,
      "GET /v1/game/me": { status: 200, body: TESTER },
      "GET /v1/me/quests": { status: 200, body: QUESTS },
      "GET /v1/me/events": { status: 200, body: EVENTS },
    });
    await start();
    await prepare(null);
    const p = prepared();
    if (!p) throw new Error("nothing prepared");
    expect(p).toMatchObject({ first: true, mark: TESTER.event_cursor, since: [] });
    expect(makeLive(p).news()).toEqual([]);
    expect(world.sent.some((s) => s.path.includes("after="))).toBe(false);
  });

  /** The guild over Leaf's quests with the weekly as `weekly:1`, free to reroll, its reroll answered by `reroll`. */
  async function onTheBoard(reroll: Route | Reply) {
    world = standin({
      "GET /v1/game/hello": HELLO,
      "GET /v1/game/me": { status: 200, body: TESTER },
      "GET /v1/me/quests": { status: 200, body: QUESTS },
      "GET /v1/me/events": { status: 200, body: EVENTS },
      "POST /v1/me/quests/weekly:1/reroll": reroll,
    });
    await start();
    await prepare(null);
    const p = prepared();
    if (!p) throw new Error("nothing prepared");
    const quests = p.quests.map((q) => (q.id === "weekly:2" ? { ...q, id: "weekly:1", reroll: 0 } : q));
    return { guild: makeLive({ ...p, quests }), posted: () => (world?.sent ?? []).filter((s) => s.method === "POST") };
  }
  const REROLLED = answer("POST /v1/me/quests/{id}/reroll");

  test("a reroll's new quest takes the old one's place at once, and the purse shows the Leaf left", async () => {
    const { guild, posted } = await onTheBoard({ status: 200, body: REROLLED });
    expect(guild.quests().map((q) => q.id)).toEqual(["weekly:1", "timed:1", "daily:1"]);
    expect(await guild.reroll("weekly:1", 0)).toEqual({ spent: 0 });
    expect(posted().map((s) => [s.path, s.body])).toEqual([["/v1/me/quests/weekly:1/reroll", { leaf: 0 }]]);
    expect(guild.quests().map((q) => q.id)).toEqual(["weekly:2", "timed:1", "daily:1"]);
    // The next one costs Leaf.
    expect(guild.quests()[0]?.reroll).toBe(100);
    expect(balance().leaf).toBe(5135);
  });

  test("a paid reroll sends the Leaf the member was shown", async () => {
    const paid = isRecord(REROLLED) ? { ...REROLLED, leaf: 2350, spent: 100 } : {};
    const { guild, posted } = await onTheBoard({ status: 200, body: paid });
    expect(await guild.reroll("weekly:1", 100)).toEqual({ spent: 100 });
    expect(posted().map((s) => s.body)).toEqual([{ leaf: 100 }]);
    expect(balance().leaf).toBe(2350);
  });

  test("each refusal is said in Leaf's own words, and nothing else changes", async () => {
    const replies: Reply[] = [
      { status: 409, body: answer("POST /v1/me/quests/{id}/reroll, the cost changed") },
      { status: 409, body: answer("POST /v1/me/quests/{id}/reroll, the same quest again") },
      // Leaf's words for the other two.
      { status: 409, body: { code: "insufficient_leaf", message: "You don't have enough Leaf to reroll it" } },
      { status: 409, body: { code: "not_rerollable", message: "That quest can't be rerolled" } },
      { status: 500 },
      "offline",
    ];
    const { guild } = await onTheBoard(() => replies.shift() ?? "offline");
    const board = guild.quests();
    const leaf = balance().leaf;
    // One after another: while one is on its way, the next is not sent.
    const again = () => guild.reroll("weekly:1", 0);
    const said = [await again(), await again(), await again(), await again(), await again(), await again()];
    expect(said).toEqual([
      { said: "Rerolling it costs something else now. Refresh your quests" },
      { said: "That quest is no longer in its slot. Refresh your quests" },
      { said: "You don't have enough Leaf to reroll it" },
      { said: "That quest can't be rerolled" },
      { said: NO_REROLL },
      { said: NO_REROLL },
    ]);
    expect(guild.quests()).toBe(board);
    expect(balance().leaf).toBe(leaf);
  });

  test("a reroll is sent once, however often it is pressed", async () => {
    const { guild, posted } = await onTheBoard({ status: 200, body: REROLLED });
    const twice = await Promise.all([guild.reroll("weekly:1", 0), guild.reroll("weekly:1", 0)]);
    expect(twice).toEqual([{ spent: 0 }, null]);
    // Pressed on the note just swapped away, before the board is drawn again.
    expect(await guild.reroll("weekly:1", 0)).toBeNull();
    expect(posted()).toHaveLength(1);
  });

  test("hands the town only those the server names, each in their own skin", async () => {
    const route = isRecord(GAME) ? GAME["PUT /v1/game/presence"] : null;
    const leaf = isRecord(route) && isRecord(route.body) ? route.body : {};
    const reply = {
      present: [
        { id: TESTER.player.id, username: "Tester", place: "town" },
        ...listed(leaf.present),
        { id: "m-1", username: "Mira", place: "table" },
      ],
      resting: [
        ...listed(leaf.resting),
        { id: "m-2", username: "Odo", place: "camp", seen_at: "2026-11-25T10:00:00.000Z" },
      ],
    };
    world = standin({
      "GET /v1/game/hello": HELLO,
      "GET /v1/game/me": { status: 200, body: TESTER },
      "GET /v1/me/quests": { status: 200, body: QUESTS },
      "GET /v1/me/events": { status: 200, body: EVENTS },
      "PUT /v1/game/presence": { status: 200, body: reply },
    });
    await start();
    expect(await prepare(null)).toBe(true);
    const p = prepared();
    if (!p) throw new Error("nothing prepared");
    const guild = makeLive(p);
    const heard: Happening[] = [];
    guild.hear((h) => heard.push(h));
    guild.here("town");
    await Bun.sleep(20);
    for (let i = 0; i < 300; i++) guild.step(1);

    expect(guild.heard()).toBe(true);
    expect(guild.visitors().map((v) => v.name)).toEqual(["Alice", "Visitor", "Mira"]);
    expect(guild.resting().map((r) => r.name)).toEqual(["Bob"]);
    const named = new Set(
      [...reply.present, ...reply.resting].flatMap((m) => (isRecord(m) && typeof m.id === "string" ? [m.id] : [])),
    );
    expect(named.size).toBe(6);
    for (const m of [...guild.visitors(), ...guild.resting()]) {
      expect(named.has(m.id)).toBe(true);
      expect(m.skin).toBe(`/v1/game/skins/${m.id}`);
    }
    // Nothing of the guild's happened, so nothing is told.
    expect(heard).toEqual([]);
  });

  test("the world does not wait for the feed: a party and a war come in at once, their lines in turn", async () => {
    world = standin({
      "GET /v1/game/hello": HELLO,
      "GET /v1/game/me": { status: 200, body: TESTER },
      "GET /v1/me/quests": { status: 200, body: QUESTS },
      "GET /v1/me/events": { status: 200, body: EVENTS },
      "GET /v1/game/guild/events/stream": sse(
        ev(900, "Alice", "leaf_earned", { source: "raid", detail: "TNA", occurred_at: "t" }) +
          ev(901, "Bob", "leaf_earned", { source: "war", detail: "Detlas", occurred_at: "t", in_claim: true }) +
          ev(902, "Cleo", "level_up", { level: 74 }) +
          ev(903, "Dara", "achievement_paid", { label: "Gold", tier: "gold" }),
      ),
    });
    await start();
    expect(await prepare(null)).toBe(true);
    const p = prepared();
    if (!p) throw new Error("nothing prepared");
    const guild = makeLive(p);
    const heard: string[] = [];
    const said: [number, string][] = [];
    const t0 = world.clock.now;
    // As the town stages it: whatever happens in the world at once, and the line handed to the feed.
    guild.hear((h) => {
      heard.push(h.kind);
      guild.say(h, (text) => said.push([(world?.clock.now ?? 0) - t0, text]));
    });
    await Bun.sleep(20);
    guild.step(0.1);
    expect(heard.toSorted()).toEqual(["milestone", "reached"]);
    expect(said).toEqual([[0, "Dara reached a milestone: Gold."]]);
    world.clock.now += GATHER;
    guild.step(0.1);
    expect(heard.toSorted()).toEqual(["milestone", "party", "reached", "war"]);
    expect(said.length).toBe(1);
    for (let s = 0; s < 60; s++) {
      world.clock.now += 1000;
      guild.step(1);
    }
    expect(said).toEqual([
      [0, "Dara reached a milestone: Gold."],
      [PACE, "Alice came back from TNA."],
      [2 * PACE, "Bob fought at Detlas."],
    ]);
  });

  test("a board the server cannot give means the town does not open", async () => {
    world = standin({
      "GET /v1/game/hello": HELLO,
      "GET /v1/game/me": { status: 200, body: TESTER },
      "GET /v1/me/quests": { status: 503 },
      "GET /v1/me/events": { status: 200, body: EVENTS },
    });
    await start();
    expect(await prepare(null)).toBe(false);
  });
});

describe("who is here, and who is dozing", () => {
  test("those resting: never the member, nobody in the game, nobody last at their camp; newest first, at most twelve", () => {
    const at = Date.UTC(2026, 10, 25, 12);
    const present = [{ id: "a", name: "Alice", place: "works" as const, rank: null, guest: false }];
    const resting = [
      { id: ME, name: "Tester", place: "town" as const, seen: at - 1, guest: false },
      { id: "a", name: "Alice", place: "town" as const, seen: at - 2, guest: false },
      { id: "b", name: "Bob", place: "camp" as const, seen: at - 3, guest: false },
      ...Array.from({ length: 14 }, (_, i) => ({
        id: `n${i}`,
        name: `N${i}`,
        place: "table" as const,
        seen: at - 9 + i,
        guest: false,
      })),
    ];
    const r = toResting(resting, present, ME);
    expect(r.length).toBe(12);
    expect(r[0]).toEqual({ id: "n13", name: "N13", rank: null, at: "table", skin: "/v1/game/skins/n13", seen: at + 4 });
    expect(r.map((x) => x.seen)).toEqual(r.map((x) => x.seen).toSorted((x, y) => y - x));
    expect(r.some((x) => x.id === ME || x.id === "a" || x.id === "b")).toBe(false);
  });

  test("everybody but the member, nobody at their own camp, at most twelve", () => {
    const present = [
      { id: ME, name: "Tester", place: "town" as const, rank: "captain", guest: false },
      { id: "a", name: "Alice", place: "works" as const, rank: "chief", guest: false },
      { id: "b", name: "Bob", place: "camp" as const, rank: null, guest: false },
      ...Array.from({ length: 14 }, (_, i) => ({
        id: `n${i}`,
        name: `N${i}`,
        place: "table" as const,
        rank: null,
        guest: false,
      })),
    ];
    const v = toVisitors(present, ME);
    expect(v.length).toBe(12);
    expect(v[0]).toEqual({ id: "a", name: "Alice", rank: "Chief", at: "works", skin: "/v1/game/skins/a" });
    expect(v.some((x) => x.id === ME || x.id === "b")).toBe(false);
  });

  test("a guest is drawn like any member, their own skin and name, with Guest for a rank, here or dozing", () => {
    const present = [{ id: "g", name: "Wanderer", place: "town" as const, rank: null, guest: true }];
    const gone = [{ id: "h", name: "Drifter", place: "works" as const, seen: 5, guest: true }];
    expect(toVisitors(present, ME)).toEqual([
      { id: "g", name: "Wanderer", rank: "Guest", at: "town", skin: "/v1/game/skins/g" },
    ]);
    expect(toResting(gone, present, ME)).toEqual([
      { id: "h", name: "Drifter", rank: "Guest", at: "works", skin: "/v1/game/skins/h", seen: 5 },
    ]);
  });

  test("the feed counts everybody else in town, members and guests together", () => {
    expect([0, 1, 3].map(inTownLine)).toEqual(["The town is quiet.", "1 is in town.", "3 are in town."]);
  });

  test("ranks as the guild writes them, capitalised; others as they come", () => {
    expect(rankName("strategist")).toBe("Strategist");
    expect(rankName("OWNER")).toBe("Owner");
    expect(rankName("Keeper of Crabs")).toBe("Keeper of Crabs");
    expect(rankName(null)).toBe("Friend");
  });
});

const GAME: unknown = await Bun.file(new URL("../../../contracts/leaf-game-v1.json", import.meta.url)).json();

describe("the guild's news Leaf really sends", () => {
  const route = isRecord(GAME) ? GAME["GET /v1/game/guild/events"] : null;
  const events = readEvents(isRecord(route) ? route.body : null);

  test("members paid for one raid at one time come home as one party; nothing says how much", () => {
    expect(events.length).toBeGreaterThan(10);
    const news = makeNews(ME);
    for (const e of events) news.add(e, 0);
    const told = news.due(GATHER);
    const parties = told.filter((h) => h.kind === "party");
    expect(parties.length).toBe(9);
    expect(parties.filter((h) => h.who.length === 2).map((h) => h.who.map((p) => p.name))).toEqual([
      ["Alice", "Bob"],
      ["Alice", "Bob"],
    ]);
    expect(told.map((h) => h.kind).filter((k) => k !== "party")).toEqual(["reached", "milestone", "war"]);
    for (const h of told) expect(lineFor(h)?.[0] ?? "").not.toMatch(/Leaf/);
    const war = told.find((h) => h.kind === "war");
    expect(war && lineFor(war)?.[0]).toMatch(/ fought at Detlas\.$/);
  });
});

describe("a guest's town", () => {
  let world: Standin | null = null;
  afterEach(() => {
    world?.done();
    world = null;
    restart();
    forgetLedger();
    unprepare();
  });

  /** A guest's town, opened and listening, against a server that refuses (and writes down) anything only a member may ask. */
  async function guestTown(asked: string[]) {
    world = standin({
      "GET /v1/game/hello": HELLO,
      "GET /v1/game/me": { status: 200, body: GUEST },
      "PUT /v1/game/presence": {
        status: 200,
        body: {
          present: [
            { id: GUEST.player.id, username: "Wanderer", place: "town", guest: true },
            { id: "m-1", username: "Mira", place: "town", guest: false },
            { id: "g-2", username: "Drifter", place: "table", guest: true },
          ],
          resting: [],
        },
      },
      ...membersOnly(asked),
    });
    await start();
    expect(await prepare(null)).toBe(true);
    const p = prepared();
    if (!p) throw new Error("nothing prepared");
    const guild = makeLive(p);
    guild.hear(() => undefined);
    // Away first, so that arriving in town says so even when an earlier test left this page there.
    guild.here(null);
    guild.here("town");
    await Bun.sleep(20);
    for (let i = 0; i < 30; i++) guild.step(1 / 30);
    return guild;
  }

  test("opens with no call only a member may make: no quests, no news of theirs or the guild's", async () => {
    const asked: string[] = [];
    const guild = await guestTown(asked);
    expect(asked).toEqual([]);
    expect(world?.sent.map((s) => s.path)).toEqual(["/v1/game/hello", "/v1/game/me", "/v1/game/presence"]);
    // Others in town, members and guests, are there all the same.
    expect(guild.visitors()).toEqual([
      { id: "m-1", name: "Mira", rank: null, at: "town", skin: "/v1/game/skins/m-1" },
      { id: "g-2", name: "Drifter", rank: "Guest", at: "table", skin: "/v1/game/skins/g-2" },
    ]);
  });

  test("their purse has Coins and no Leaf, and they are a Guest where a member has a rank", async () => {
    const guild = await guestTown([]);
    expect(balance().leaf).toBe(0);
    expect(leafShown()).toBe(false);
    expect(guild.me()).toMatchObject({ name: "Wanderer", rank: "Guest", level: 1, ranks: [], week: [] });
  });

  test("their quest board is one note saying quests are for members", async () => {
    const guild = await guestTown([]);
    expect(guild.quests()).toEqual([]);
    expect(guild.boardNote()).toBe("Quests are for members of Sequoia. Join the guild to take part.");
    expect(
      makeLive({
        me: {
          id: ME,
          name: "Tester",
          rank: "captain",
          guest: false,
          leaf: 0,
          level: { number: 1, into: 0, next: 1 },
          cursor: 0,
        },
        quests: [],
        since: [],
        first: true,
        mark: 0,
        week: [],
      }).boardNote(),
    ).toBeNull();
  });

  test("their arrival letter has no news of theirs: a guest has none", async () => {
    const guild = await guestTown([]);
    expect(guild.news()).toEqual([]);
  });
});
