import { afterAll, beforeAll, expect, test } from "bun:test";

import { type Standin, standin } from "@sequoia-leaf/kit/standin.ts";
import { thingOf } from "@sequoia-leaf/town/things.ts";

import { nameMembers } from "./members.ts";

let world: Standin | null = null;
const was = thingOf("member-banner-1")?.name;

beforeAll(() => {
  // No page here: a canvas that takes any drawing and gives back blank pixels, and a skin that never loads.
  const pen: object = new Proxy(
    {},
    {
      get: (_, name) =>
        name === "getImageData"
          ? (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) })
          : () => undefined,
      set: () => true,
    },
  );
  class Picture {
    src = "";
    addEventListener(): void {}
  }
  Object.assign(globalThis, {
    document: { createElement: () => ({ width: 1, height: 1, getContext: () => pen }) },
    Image: Picture,
    HTMLImageElement: Picture,
  });
});

afterAll(() => {
  world?.done();
  const thing = thingOf("member-banner-1");
  if (thing && was) thing.name = was;
  Object.assign(globalThis, { document: undefined, Image: undefined, HTMLImageElement: undefined });
});

test("a banner's member is called by their name alone once Leaf says who, and drawn each time who they are is better known", async () => {
  const headliner = { id: "p-quill", name: "Quillfeather" };
  let said: unknown = { banners: [{ id: "banner-1", headliner: null }] };
  world = standin({ "GET /v1/game/banners": () => ({ status: 200, body: said }) });
  const stood: string[] = [];
  const art = { stand: (id: string): number => stood.push(id) };
  // Nobody yet: drawn as nobody, and named as no more than is known; Groot Night's by its title.
  await nameMembers(art);
  expect([thingOf("member-banner-1")?.name, thingOf("member-groot-night")?.name, stood]).toEqual([
    "A guild member",
    "Commodore",
    ["member-banner-1", "member-groot-night"],
  ]);
  // Leaf says who: their name and nothing else, drawn again as them; their skin is asked for by their id.
  // Groot Night's member is drawn as them and keeps the title: never their name.
  said = {
    banners: [
      { id: "banner-1", headliner },
      { id: "groot-night", headliner: { id: "p-moss", name: "Mossy" } },
    ],
  };
  await nameMembers(art);
  expect([thingOf("member-banner-1")?.name, thingOf("member-groot-night")?.name]).toEqual([
    "Quillfeather",
    "Commodore",
  ]);
  expect(stood.filter((id) => id === "member-banner-1")).toHaveLength(3);
  expect(stood.filter((id) => id === "member-groot-night")).toHaveLength(3);
});
