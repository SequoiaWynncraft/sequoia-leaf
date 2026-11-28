import { describe, expect, test } from "bun:test";

import { launchOf, withLaunch } from "./launch.ts";

/** Discord's launch query, as its frame opens Leaf. */
const LAUNCH = "?instance_id=i-1-gc-2-3&location_id=gc-2-3&launch_id=1&frame_id=f-9&platform=desktop";
const launch = launchOf(LAUNCH);
/** The town, as Discord's proxy for Leaf serves it in the call. */
const TOWN = `https://1576204968619417712.discordsays.com/play/town/${LAUNCH}`;

describe("Discord's launch of Leaf", () => {
  test("is read from the page's query: the launch everyone in the call shares, and Discord's words", () => {
    expect(launch).toEqual({
      instance: "i-1-gc-2-3",
      params: [
        ["instance_id", "i-1-gc-2-3"],
        ["location_id", "gc-2-3"],
        ["launch_id", "1"],
        ["frame_id", "f-9"],
        ["platform", "desktop"],
      ],
    });
  });

  test("is Discord's words alone, whatever else the address says", () => {
    expect(launchOf(`?camp=someone&${LAUNCH.slice(1)}&of=else`)).toEqual(launch);
  });

  test("is none on a page Discord did not open", () => {
    for (const search of ["", "?frame_id=f-9", "?instance_id=i-1", "?instance_id=&frame_id=f-9", "?of=someone"])
      expect(launchOf(search)).toBeNull();
  });
});

describe("the launch, carried from page to page", () => {
  test("goes on the town's frame for a game, after the game's own words", () => {
    expect(withLaunch("../works/index.html", TOWN, launch)).toBe(
      `https://1576204968619417712.discordsays.com/play/works/index.html${LAUNCH}`,
    );
    expect(withLaunch("../works/index.html?of=p-2", TOWN, launch)).toBe(
      `https://1576204968619417712.discordsays.com/play/works/index.html?of=p-2&${LAUNCH.slice(1)}`,
    );
  });

  test("goes on a page's way to another, and on its way to another of its own addresses", () => {
    expect(withLaunch("?camp=p-1", TOWN, launch)).toBe(
      `https://1576204968619417712.discordsays.com/play/town/?camp=p-1&${LAUNCH.slice(1)}`,
    );
    expect(withLaunch("/play/works/", TOWN, launch)).toBe(
      `https://1576204968619417712.discordsays.com/play/works/${LAUNCH}`,
    );
  });

  test("is put on once, however many times the page goes on", () => {
    const again = withLaunch("?camp=p-1", TOWN, launch);

    expect(withLaunch("?camp=p-1", again, launch)).toBe(again);
    expect(launchOf(new URL(again).search)).toEqual(launch);
  });

  test("goes nowhere out of a call, nor to another site", () => {
    expect(withLaunch("../works/index.html", TOWN, null)).toBe("../works/index.html");
    expect(withLaunch("https://leaf.seqwawa.com/play/town/", TOWN, launch)).toBe("https://leaf.seqwawa.com/play/town/");
  });
});
