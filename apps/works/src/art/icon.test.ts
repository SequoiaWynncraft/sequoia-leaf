/**
 * A kind's picture for a card, as `art.icon` gives it from the art the page makes for the land. There
 * is no canvas here, so a stand-in (`@sequoia-leaf/kit/standin-gl.ts`) keeps each canvas's size and draws nothing: enough to tell the
 * depot's picture for a slot (20 pixels square and its edge) from the yard's (54 by 66), which a card
 * would cut down to its roof.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { DEPOT, LAND } from "@sequoia-leaf/factory";
import { FakeCard, standInCanvases } from "@sequoia-leaf/kit/standin-gl.ts";

import { makeArt } from "./index.ts";

const away = { take: (): void => undefined };
beforeAll(() => {
  away.take = standInCanvases(new FakeCard());
});
afterAll(() => away.take());

describe("a kind's picture for a card", () => {
  test("the depot's is the one drawn for a slot, whole in it with its edge, not the yard's", () => {
    const art = makeArt(LAND);
    const pic = art.icon(DEPOT);
    expect([pic.width, pic.height]).toEqual([22, 22]);
    expect([art.m.depot.c.width, art.m.depot.c.height]).toEqual([54, 66]);
  });
});
