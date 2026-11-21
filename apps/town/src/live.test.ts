import { afterEach, describe, expect, test } from "bun:test";

import { restart, start } from "@sequoia-leaf/kit/live.ts";
import { isRecord } from "@sequoia-leaf/kit/net.ts";
import { balance, forgetLedger, leafShown } from "@sequoia-leaf/kit/purse.ts";
import { GUEST, HELLO, membersOnly, type Reply, type Standin, standin, TESTER } from "@sequoia-leaf/kit/standin.ts";

import { isFolk } from "./folk.ts";
import type { Happening, Person } from "./guild.ts";
import { compose } from "./letter.ts";
import {
  type Ev,
  GATHER,
  letterLines,
  makeLive,
  makeNews,
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
import { makeGuild, STANDINS } from "./madeup.ts";
import { inTownLine, lineFor } from "./news.ts";
import { blank } from "./save.ts";

/** What Leaf really sends, from the contract its own tests write. */
const contract: unknown = await Bun.file(new URL("../../../contracts/leaf-api-v1.json", import.meta.url)).json();
const answer = (route: string): unknown => {
  const r = isRecord(contract) ? contract[route] : null;
  return isRecord(r) ? r.body : null;
};
const QUESTS = answer("GET /v1/me/quests");
const EVENTS = answer("GET /v1/me/events");

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

const raid = (id: number, who: string, at = "2026-11-25T12:31:00.000Z", detail = "Nest of the Grootslangs"): Ev =>
  guildEvent(id, who, "leaf_earned", { source: "raid", detail, occurred_at: at });

describe("the quest board, live", () => {
  test("the member's quests are notes, with nothing to claim", () => {
    const notes = readQuests(QUESTS);
    expect(notes.length).toBeGreaterThan(1);
    for (const q of notes) {
      expect(q.claim).toBe(false);
      expect(q.pays).toBe("leaf");
      expect(q.reward).toBeGreaterThan(0);
    }
    const weekly = notes.find((q) => q.id === "weekly:2");
    expect(weekly).toMatchObject({
      title: "Complete 12 TCC raids or 60 wars",
      have: 0,
      need: 12,
      unit: "TCC raids",
      reward: 800,
      ends: null,
    });
  });

  test("a finished quest is full and paid; an open timed quest says when it ends", () => {
    const notes = readQuests(QUESTS);
    const timed = notes.find((q) => q.id === "timed:1");
    expect(timed?.have).toBe(timed?.need);
    expect(timed?.ends).toBeNull();
    const open = readQuests({
      quests: [
        {
          id: "timed:9",
          slot: "timed",
          title: "Take part in 6 wars",
          objective: { type: "wars", raid: null },
          progress: 2,
          target: 6,
          reward: { leaf: 500, xp: 250 },
          expires_at: "2026-11-25T16:00:00.000Z",
          completed_at: null,
        },
      ],
    });
    expect(open).toEqual([
      {
        id: "timed:9",
        title: "Take part in 6 wars",
        have: 2,
        need: 6,
        unit: "wars",
        reward: 500,
        pays: "leaf",
        claim: false,
        ends: Date.parse("2026-11-25T16:00:00.000Z"),
      },
    ]);
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

  test("it pays nothing: the ledger already has", () => {
    const madeUp = makeGuild();
    const away = { first: false, hours: 5, lines: letterLines(events) };
    const letter = compose({ ...blank(), lastSeen: 1, welcomed: "2026-11-25" }, Date.now(), away, []);
    expect(letter.leaf).toBe(0);
    expect(letter.coins).toBe(0);
    expect(letter.show).toBe(true);
    expect(letter.lines.every((l) => l.pay === undefined)).toBe(true);
    expect(madeUp.away(0, 1).lines.some((l) => l.pay)).toBe(true);
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
    news.add(guildEvent(2, "Bob", "level_up", { level: 9 }), 0);
    news.add(guildEvent(3, "Cleo", "achievement_paid", { label: "Gold", tier: "gold" }), 0);
    const told = news.due(GATHER);
    expect(told.map((h) => h.kind)).toEqual(["reached", "milestone", "war"]);
    expect(told.map((h) => lineFor(h)?.[0])).toEqual([
      "Bob reached level 9.",
      "Cleo reached a milestone: Gold.",
      "Alice held Detlas for the guild.",
    ]);
  });

  test("no amount of Leaf in any line of the feed", () => {
    const news = makeNews(ME);
    const amounts = { leaf: 110, xp: 110 };
    news.add(guildEvent(1, "Alice", "leaf_earned", { source: "raid", detail: "TNA", occurred_at: "a", ...amounts }), 0);
    news.add(guildEvent(2, "Bob", "leaf_earned", { source: "war", detail: "Ragni", occurred_at: "b", ...amounts }), 0);
    news.add(guildEvent(3, "Cleo", "level_up", { level: 4, leaf: 100 }), 0);
    news.add(guildEvent(4, "Dara", "achievement_paid", { label: "Silver", tier: "silver", leaf: 1000 }), 0);
    const lines = news.due(GATHER).map((h) => lineFor(h)?.[0] ?? "");
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

/** A list, or nothing. */
const listed = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** Whoever a moment is about. */
const people = (h: Happening): readonly Person[] =>
  h.kind === "party" || h.kind === "war" ? h.who : h.kind === "reached" || h.kind === "milestone" ? [h.who] : [];

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
    world.store.setItem("town.save.v1", JSON.stringify({ v: 1, cursor: 120 }));
    await start();
    expect(await prepare()).toBe(true);
    const p = prepared();
    if (!p) throw new Error("nothing prepared");
    expect(p.first).toBe(false);
    expect(world.sent.some((s) => s.path === "/v1/me/events?after=120")).toBe(true);

    const guild = makeLive(makeGuild({ quiet: true }), p);
    const heard: Happening[] = [];
    guild.hear((h) => heard.push(h));
    await Bun.sleep(20);
    world.clock.now += GATHER;
    guild.step(0.1);
    guild.step(0.1);
    expect(heard.filter((h) => h.kind === "party").length).toBe(1);
    expect(guild.told()).toBe(141);
    expect(guild.quests().every((q) => !q.claim)).toBe(true);
    expect(guild.me()).toMatchObject({
      name: "Tester",
      rank: "Captain",
      level: 7,
      skin: `/v1/game/skins/${TESTER.player.id}`,
    });
  });

  test("the first visit here starts from the member's newest news, and the letter is a plain welcome", async () => {
    world = standin({
      "GET /v1/game/hello": HELLO,
      "GET /v1/game/me": { status: 200, body: TESTER },
      "GET /v1/me/quests": { status: 200, body: QUESTS },
      "GET /v1/me/events": { status: 200, body: EVENTS },
    });
    await start();
    await prepare();
    const p = prepared();
    if (!p) throw new Error("nothing prepared");
    expect(p).toMatchObject({ first: true, mark: TESTER.event_cursor, since: [] });
    const away = makeLive(makeGuild({ quiet: true }), p).away(0, Date.now());
    expect(away.first).toBe(true);
    expect(away.lines.every((l) => l.pay === undefined && l.got === undefined)).toBe(true);
    expect(world.sent.some((s) => s.path.includes("after="))).toBe(false);
  });

  test("never hands the town an invented member: only those the server names, and the town's own calling", async () => {
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
    expect(await prepare()).toBe(true);
    const p = prepared();
    if (!p) throw new Error("nothing prepared");
    const madeUp = makeGuild({ quiet: true });
    const guild = makeLive(madeUp, p);
    const heard: Happening[] = [];
    guild.hear((h) => heard.push(h));
    guild.here("town");
    await Bun.sleep(20);
    // The made-up guild is left to run, and asked for everything it can do.
    for (let i = 0; i < 300 * 30; i++) guild.step(1 / 30);
    for (const kind of ["raid", "war", "level", "milestone", "call"] as const) madeUp.stir(kind);

    expect(guild.heard()).toBe(true);
    expect(guild.visitors().map((v) => v.name)).toEqual(["Alice", "Visitor", "Mira"]);
    expect(guild.resting().map((r) => r.name)).toEqual(["Bob"]);
    const named = new Set(
      [...reply.present, ...reply.resting].flatMap((m) => (isRecord(m) && typeof m.id === "string" ? [m.id] : [])),
    );
    expect(named.size).toBe(6);
    const invented = new Set(STANDINS.map((m) => m.name));
    for (const m of [...guild.visitors(), ...guild.resting()]) {
      expect(named.has(m.id)).toBe(true);
      expect(invented.has(m.name)).toBe(false);
      expect(m.skin).toBe(`/v1/game/skins/${m.id}`);
    }
    // All the made-up guild may say beside the real one is that one of the town's own came calling.
    expect(heard.length).toBeGreaterThan(0);
    for (const h of heard) {
      expect(h.kind).toBe("call");
      if (h.kind === "call") expect(isFolk(h.who)).toBe(true);
    }
    for (const who of heard.flatMap(people)) expect(invented.has(who.name)).toBe(false);
    expect(world.sent.find((s) => s.path === "/v1/game/presence")?.body).toEqual({ place: "town", stay: true });
  });

  test("a board the server cannot give means the town does not open", async () => {
    world = standin({
      "GET /v1/game/hello": HELLO,
      "GET /v1/game/me": { status: 200, body: TESTER },
      "GET /v1/me/quests": { status: 503 },
      "GET /v1/me/events": { status: 200, body: EVENTS },
    });
    await start();
    expect(await prepare()).toBe(false);
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
    for (const h of told) expect(lineFor(h)?.[0]).not.toMatch(/Leaf/);
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
    expect(await prepare()).toBe(true);
    const p = prepared();
    if (!p) throw new Error("nothing prepared");
    const guild = makeLive(makeGuild({ quiet: true }), p);
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
    expect(guild.boardNote()).toBe("Quests are for members of Sequoia. Raid with the guild and yours appear here.");
    expect(
      makeLive(makeGuild({ quiet: true }), {
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

  test("their arrival letter is the plain welcome, with only the townsfolk's lines", async () => {
    const guild = await guestTown([]);
    const now = Date.UTC(2026, 10, 25, 12);
    for (const away of [guild.away(0, now), guild.away(now - 30 * 3_600_000, now)]) {
      expect(
        away.lines.every((l) => (l.art === "folk" || l.art === "crab") && l.pay === undefined && l.got === undefined),
      ).toBe(true);
    }
    expect(guild.away(0, now).first).toBe(true);
  });
});
