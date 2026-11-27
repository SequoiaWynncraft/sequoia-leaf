import { afterEach, describe, expect, it } from "bun:test";

import { CLOSE, type PlayerId, playerId, SITTINGS_ROOM } from "@sequoia-leaf/core";

import { Live } from "../src/live/live.ts";
import { LiveClient } from "./live-client.ts";
import { fakeBackend, sessionOf, testLeaf } from "./support.ts";

/**
 * A player's listener (`listen.ts`): a connection into a listening room (the open tables'), beside
 * their presence connection in town or a camp, that hears what Leaf tells the player and is seen by
 * nobody. Neither kind replaces the other; a new listener replaces only the old one. Against Leaf on
 * a real port, with its live connections.
 */

const alice = playerId("50000000-0000-0000-0000-000000000001");
const bob = playerId("50000000-0000-0000-0000-000000000002");
const ORIGIN = "https://leaf.seqwawa.com";
const TOKENS: Record<PlayerId, string> = { [alice]: "alice-token", [bob]: "bob-token" };
const token = (who: PlayerId): string => TOKENS[who] ?? "";

const clock = { now: Date.UTC(2026, 10, 27, 12) };
let services: ReturnType<typeof testLeaf> | null = null;
let server: Awaited<ReturnType<ReturnType<typeof testLeaf>["serve"]>> | null = null;
const open: LiveClient[] = [];

async function start(mostPlayers?: number): Promise<void> {
  const fake = fakeBackend({
    "alice-token": () => Response.json(sessionOf(alice, "Alice", "CAPTAIN")),
    "bob-token": () => Response.json(sessionOf(bob, "Bob", "RECRUIT")),
  });
  services = testLeaf(clock, fake.fetcher, {}, { live: { graceMs: 0, ...(mostPlayers ? { mostPlayers } : {}) } });
  server = await services.serve();
}

afterEach(async () => {
  for (const c of open.splice(0)) c.close();
  await server?.close();
  await services?.dispose();
  server = null;
  services = null;
});

/** A player's page, live in a room (`sittings`: a listener), once Leaf has welcomed it. */
async function into(who: PlayerId, room: string): Promise<LiveClient> {
  const client = await LiveClient.open(server?.origin ?? "", { cookie: token(who), origin: ORIGIN }, room);
  open.push(client);
  await client.welcome();
  return client;
}
const census = async () => services?.run(Live.use((live) => live.census));
const opening = async (who: PlayerId): Promise<string> => {
  const response = await fetch(`${server?.origin ?? ""}/v1/game/sittings`, {
    method: "POST",
    headers: { Cookie: `seq_session=${token(who)}`, Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ player: who }),
  });
  const body: unknown = await response.json();
  return typeof body === "object" && body !== null && "id" in body ? String(body.id) : "";
};

describe("a listener", () => {
  it("lives beside the player's presence: neither replaces the other, and nobody sees the listener", async () => {
    await start();
    const bobs = await into(bob, "town");
    const presence = await into(alice, "town");
    expect((await bobs.next("joined")).member.name).toBe("Alice");
    const listener = await LiveClient.open(
      server?.origin ?? "",
      { cookie: token(alice), origin: ORIGIN },
      SITTINGS_ROOM,
    );
    open.push(listener);
    // Welcomed into its room by name, with nobody in it.
    expect(await listener.welcome()).toMatchObject({ room: SITTINGS_ROOM, you: 0, roster: [] });
    await presence.settled();
    await listener.settled();
    await bobs.settled();
    expect([presence.closed, listener.closed]).toEqual([null, null]);
    expect(bobs.texts.filter((m) => m.t === "left" || m.t === "joined")).toEqual([]);
    expect(await census()).toEqual({ players: 2, connected: 3, rooms: { "town/1": 2 } });
    // Her presence from another tab replaces only her presence.
    const again = await into(alice, "town");
    expect((await presence.ended()).code).toBe(CLOSE.replaced);
    await listener.settled();
    await again.settled();
    expect(listener.closed).toBeNull();
    expect(await census()).toMatchObject({ players: 2, connected: 3 });
  });

  it("is replaced by the player's next listener, and only by it", async () => {
    await start();
    const presence = await into(alice, "town");
    const first = await into(alice, SITTINGS_ROOM);
    const second = await into(alice, SITTINGS_ROOM);
    expect((await first.ended()).code).toBe(CLOSE.replaced);
    await second.settled();
    await presence.settled();
    expect([second.closed, presence.closed]).toEqual([null, null]);
    expect(await census()).toEqual({ players: 1, connected: 2, rooms: { "town/1": 1 } });
  });

  it("hears the player's nudges as their presence does, and the open tables' list, which their presence does not", async () => {
    await start();
    const presence = await into(alice, "town");
    const listener = await into(alice, SITTINGS_ROOM);
    const id = await opening(alice);
    expect(await presence.next("sitting")).toEqual({ t: "sitting", id, rev: 0 });
    expect(await listener.next("sitting")).toEqual({ t: "sitting", id, rev: 0 });
    expect(await listener.next("sittings")).toEqual({ t: "sittings" });
    await presence.settled();
    expect(presence.texts.filter((m) => m.t === "sittings")).toEqual([]);
  });

  it("sends nothing but pings and joins no room; a presence connection does not join the listening room", async () => {
    await start();
    const bobs = await into(bob, "town");
    const presence = await into(alice, "town");
    await bobs.next("joined");
    const listener = await into(alice, SITTINGS_ROOM);
    listener.send({ t: "join", room: "town" });
    await listener.settled();
    expect(listener.texts.filter((m) => m.t === "welcome")).toEqual([]);
    presence.send({ t: "join", room: SITTINGS_ROOM });
    expect(await presence.next("error")).toEqual({ t: "error", code: "unknown_room" });
    await bobs.settled();
    expect(bobs.texts.filter((m) => m.t === "left")).toEqual([]);
    expect((await census())?.rooms).toEqual({ "town/1": 2 });
  });

  it("is its player's one place among the most players Live holds, and goes with the farewell", async () => {
    await start(1);
    await into(alice, "town");
    const listener = await into(alice, SITTINGS_ROOM);
    // Alice is the one player Live holds; Bob is turned away, for a listener as for presence.
    const bobs = await LiveClient.open(
      server?.origin ?? "",
      { cookie: token(bob), origin: ORIGIN },
      SITTINGS_ROOM,
    ).then(
      () => "opened",
      () => "turned away",
    );
    expect(bobs).toBe("turned away");
    expect(await census()).toMatchObject({ players: 1, connected: 2 });
    await services?.run(Live.use((live) => live.farewell));
    expect((await listener.ended()).code).toBe(CLOSE.restart);
  });
});
