import { expect, test } from "bun:test";

import { type Banner, BANNERS } from "@sequoia-leaf/raid/content/banners.ts";

import { memberOf, seated } from "./member.ts";

test("a member headliner is found through the banner that names it, whatever the two ids are", () => {
  expect(memberOf("banner-1", BANNERS)).toBe("banner-1");
  // A banner of its own id naming a member figure of another id: Leaf's people are said by the banner.
  const rows: readonly Banner[] = [
    {
      id: "a-later-banner",
      opens: "groot-night",
      from: 0,
      until: 1,
      headliner: "banner-1",
      look: "skin",
      shows: "name",
      featured: [],
    },
    {
      id: "the-sets-own",
      opens: "penguin-month",
      from: 0,
      until: 1,
      headliner: "greg",
      look: "set",
      shows: "name",
      featured: [],
    },
  ];
  expect(memberOf("a-later-banner", rows)).toBe("banner-1");
  expect(memberOf("banner-1", rows)).toBeNull();
  // A headliner the set draws is nobody's: nobody is looked up for it.
  expect(memberOf("the-sets-own", rows)).toBeNull();
});

test("Groot Night's grooters are worn by seat: seat N is grooterN, and an empty seat stays a stand-in", () => {
  const called = [
    { seat: 3, id: "p3", name: "Birch" },
    { seat: 1, id: "p1", name: "Ash" },
    { seat: 7, id: "p7", name: "Too far" },
  ];
  expect(seated(called)).toEqual([
    ["grooter3", { seat: 3, id: "p3", name: "Birch" }],
    ["grooter1", { seat: 1, id: "p1", name: "Ash" }],
  ]);
  expect(seated([])).toEqual([]);
});
