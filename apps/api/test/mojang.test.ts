import { describe, expect, it } from "bun:test";

import { playerId } from "@sequoia-leaf/core";
import { Effect, Option } from "effect";

import { MAX_SKIN_BYTES, Mojang, MojangError } from "../src/game/mojang.ts";
import { fakeBackend, type Fetcher, sessionOf, testLeaf } from "./support.ts";

const alice = playerId("10000000-0000-0000-0000-000000000001");
const bob = playerId("10000000-0000-0000-0000-00000000000b");

/** A profile as Mojang's session server sends it, with its textures property base64-encoded. */
function profile(name: string, textures: unknown) {
  return {
    id: bob.replaceAll("-", ""),
    name,
    properties: [{ name: "textures", value: Buffer.from(JSON.stringify(textures)).toString("base64") }],
    profileActions: [],
  };
}

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);

/** Mojang's session server and texture server, answering from `answers` by address; it records each address asked. */
function mojangAt(answers: Record<string, () => Response>) {
  const asked: string[] = [];
  const fetcher: Fetcher = (url) => {
    asked.push(url);
    const answer = answers[url];
    return Promise.resolve(answer === undefined ? new Response("not found", { status: 404 }) : answer());
  };
  return { asked, fetcher };
}

/** Runs an effect against Mojang over the stand-in network. */
const run = <A, E>(fetcher: Fetcher, effect: Effect.Effect<A, E, Mojang>) => testLeaf({ now: 0 }, fetcher).run(effect);

describe("Mojang, over the network", () => {
  it("reads a player's name and skin address from their profile, asked by the UUID without dashes", async () => {
    const { asked, fetcher } = mojangAt({
      "https://sessionserver.mojang.com/session/minecraft/profile/1000000000000000000000000000000b": () =>
        Response.json(
          profile("Bob", {
            textures: { SKIN: { url: "http://textures.minecraft.net/texture/b0b5" }, CAPE: { url: "x" } },
          }),
        ),
    });

    const found = await run(
      fetcher,
      Mojang.use((mojang) => mojang.profile(bob)),
    );

    expect(found).toEqual(Option.some({ name: "Bob", skin: "http://textures.minecraft.net/texture/b0b5" }));
    expect(asked).toEqual([
      "https://sessionserver.mojang.com/session/minecraft/profile/1000000000000000000000000000000b",
    ]);
  });

  it("reads no skin address for a player in a default skin, and no profile for a UUID that is no one's", async () => {
    const { fetcher } = mojangAt({
      "https://sessionserver.mojang.com/session/minecraft/profile/1000000000000000000000000000000b": () =>
        Response.json(profile("Bob", { textures: {} })),
      "https://sessionserver.mojang.com/session/minecraft/profile/10000000000000000000000000000001": () =>
        new Response(null, { status: 204 }),
    });

    const bobs = await run(
      fetcher,
      Mojang.use((mojang) => mojang.profile(bob)),
    );
    const nobodys = await run(
      fetcher,
      Mojang.use((mojang) => mojang.profile(alice)),
    );

    expect(bobs).toEqual(Option.some({ name: "Bob", skin: undefined }));
    expect(nobodys).toEqual(Option.none());
  });

  it("fails on an answer that is not a profile, or an error", async () => {
    const { fetcher } = mojangAt({
      "https://sessionserver.mojang.com/session/minecraft/profile/1000000000000000000000000000000b": () =>
        Response.json({ name: "Bob", properties: [{ name: "textures", value: "not base64 JSON" }] }),
      "https://sessionserver.mojang.com/session/minecraft/profile/10000000000000000000000000000001": () =>
        new Response("slow down", { status: 429 }),
    });

    const malformed = await run(fetcher, Effect.flip(Mojang.use((mojang) => mojang.profile(bob))));
    const limited = await run(fetcher, Effect.flip(Mojang.use((mojang) => mojang.profile(alice))));

    expect(malformed).toBeInstanceOf(MojangError);
    expect(limited).toBeInstanceOf(MojangError);
  });

  it("fetches a skin of up to 64 KiB, and fails on a larger one", async () => {
    const { fetcher } = mojangAt({
      "https://textures.minecraft.net/texture/b0b5": () => new Response(png),
      "https://textures.minecraft.net/texture/b16": () => new Response(new Uint8Array(MAX_SKIN_BYTES + 1)),
    });

    const small = await run(
      fetcher,
      Mojang.use((mojang) => mojang.texture(new URL("https://textures.minecraft.net/texture/b0b5"))),
    );
    const large = await run(
      fetcher,
      Effect.flip(Mojang.use((mojang) => mojang.texture(new URL("https://textures.minecraft.net/texture/b16")))),
    );

    expect(small).toEqual(png);
    expect(large.message).toBe("The skin is larger than 65536 bytes");
  });

  it("serves a member a skin through Leaf, fetched over HTTPS from the address Mojang writes with http:", async () => {
    const backend = fakeBackend({ "alice-token": () => Response.json(sessionOf(alice, "Alice")) });
    const { asked, fetcher } = mojangAt({
      "https://sessionserver.mojang.com/session/minecraft/profile/1000000000000000000000000000000b": () =>
        Response.json(profile("Bob", { textures: { SKIN: { url: "http://textures.minecraft.net/texture/b0b5" } } })),
      "https://textures.minecraft.net/texture/b0b5": () => new Response(png),
    });
    const app = testLeaf({ now: 0 }, (url, init) =>
      new URL(url).hostname === "backend.test" ? backend.fetcher(url, init) : fetcher(url, init),
    ).app();

    const response = await app.request(`/v1/game/skins/${bob}`, { headers: { Cookie: "seq_session=alice-token" } });

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    expect(asked).toEqual([
      "https://sessionserver.mojang.com/session/minecraft/profile/1000000000000000000000000000000b",
      "https://textures.minecraft.net/texture/b0b5",
    ]);
    await app.dispose();
  });
});
