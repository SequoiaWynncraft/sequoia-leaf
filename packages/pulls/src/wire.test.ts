import { expect, test } from "bun:test";

import type { Ctx } from "@sequoia-leaf/core";
import { eraAt } from "@sequoia-leaf/raid/content/releases.ts";

import { type Banner, BANNERS, PULLS } from "./game.ts";
import { readBanners, readNotes, readView } from "./wire.ts";

/** Wednesday 25 November 2026, 12:00 UTC: banner-1 is open. */
const ctx: Ctx = {
  now: Date.UTC(2026, 10, 25, 12),
  player: { id: "mossback", guest: false },
  seed: 7,
  room: 0,
  awards: [],
  postcards: {},
};
const wire = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
const banner: Banner = BANNERS[0] ?? {
  id: "",
  opens: "base",
  from: 0,
  until: 0,
  headliner: "banner-1",
  look: "skin",
  shows: "name",
  featured: [],
};
const night = BANNERS[1];

test("a view and a pull's notes read back as Leaf made them, and nothing else reads", () => {
  const answer = PULLS.apply(
    PULLS.create(ctx),
    { do: "pull", pool: "banner-1", n: 10, with: "leaf", era: eraAt(ctx.now) },
    ctx,
  );
  if ("refused" in answer) throw new Error(answer.refused);
  const view = PULLS.view(answer.state, ctx);
  expect(readView(wire(view))).toEqual(view);
  expect(view.open).toEqual([{ id: "banner-1", until: banner.until }]);
  expect(readNotes(wire(answer.notes))).toEqual([...(answer.notes ?? [])]);
  expect(answer.notes).toHaveLength(10);

  expect(readView({ ...view, seeds: -1 })).toBeNull();
  expect(readView({ ...view, open: undefined })).toBeNull();
  expect(readNotes([{ t: "pull", prize: "thing:nothing", rarity: "Dryad", have: 1 }])).toBeNull();
  expect(readNotes([{ t: "pull", prize: "thing:fountain", rarity: "Leafkin", have: 1 }])).toBeNull();
});

const sent = (headliner: unknown) => ({
  banners: [
    { id: "banner-1", from: "2026-11-23T00:00:00.000Z", until: "2026-12-08T00:00:00.000Z", headliner },
    { id: "a-banner-these-rules-do-not-know", from: "", until: "", headliner: null },
  ],
});
test("the banners route reads into this package's banners, each with its headliner or none, and whom it calls", () => {
  expect(readBanners(sent({ id: "mossback", name: "Mossback" }))).toEqual([
    { ...banner, headliner: { id: "mossback", name: "Mossback" }, called: [] },
  ]);
  expect(readBanners(sent(null))).toEqual([{ ...banner, headliner: null, called: [] }]);
  expect(readBanners({})).toBeNull();
  // Groot Night calls four players besides its headliner, in order: grooterN is the Nth.
  const calls = [
    { id: "a", name: "Ash" },
    { id: "b", name: "Birch" },
  ];
  const groot = { id: "groot-night", from: "", until: "", headliner: { id: "c", name: "Cedar" }, called: calls };
  if (!night) throw new Error("no second banner");
  expect(readBanners({ banners: [groot] })).toEqual([{ ...night, headliner: groot.headliner, called: calls }]);
  // Anything but players there does not read.
  expect(readBanners({ banners: [{ ...groot, called: [{ id: 1 }] }] })).toBeNull();
  expect(readBanners({ banners: [{ ...groot, called: "Ash" }] })).toBeNull();
});
