import { afterAll, beforeAll, expect, test } from "bun:test";

import { makePeople } from "@sequoia-leaf/figures/people.ts";
import type { Answer } from "@sequoia-leaf/kit/net.ts";
import { blankCanvas, noCanvas } from "@sequoia-leaf/kit/standin.ts";
import { thingOf } from "@sequoia-leaf/town/things.ts";

import { nameMembers } from "./members.ts";

const was = thingOf("member-banner-1")?.name;

beforeAll(() => {
  // No page here: a blank canvas, and a skin that never loads.
  blankCanvas();
});

afterAll(() => {
  const thing = thingOf("member-banner-1");
  if (thing && was) thing.name = was;
  noCanvas();
});

test("a banner's member is called by their name alone once Leaf says who, and drawn each time who they are is better known", async () => {
  const answers: ((a: Answer) => void)[] = [];
  const store = makePeople(
    () => new Promise<Answer>((done) => answers.push(done)),
    () => 0,
  );
  const stood: string[] = [];
  const art = { stand: (id: string): number => stood.push(id) };
  // Nobody yet: drawn as nobody, and named as no more than is known; Groot Night's by its title.
  nameMembers(art, store);
  expect([thingOf("member-banner-1")?.name, thingOf("member-groot-night")?.name, stood]).toEqual([
    "A guild member",
    "Commodore",
    ["member-banner-1", "member-groot-night"],
  ]);
  // Leaf says who: their name and nothing else, drawn again as them; their skin is asked for by their id.
  // Groot Night's member is drawn as them and keeps the title: never their name.
  store.see(["banner-1", "groot-night"]);
  answers.shift()?.({
    status: 200,
    body: {
      banners: [
        { id: "banner-1", headliner: { id: "p-quill", name: "Quillfeather" } },
        { id: "groot-night", headliner: { id: "p-moss", name: "Mossy" } },
      ],
    },
  });
  await Bun.sleep(0);
  expect([thingOf("member-banner-1")?.name, thingOf("member-groot-night")?.name]).toEqual([
    "Quillfeather",
    "Commodore",
  ]);
  expect(stood.filter((id) => id === "member-banner-1")).toHaveLength(2);
  expect(stood.filter((id) => id === "member-groot-night")).toHaveLength(2);
});
