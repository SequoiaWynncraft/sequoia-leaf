import { describe, expect, test } from "bun:test";

import { variantOf } from "../src/bundle/manifest.ts";
import {
  clampCamera,
  layerOffset,
  layerWidth,
  look,
  plant,
  toGround,
  toPicture,
  treeKey,
} from "../src/scenes/forest/valley.ts";

/** The bundle's valley: 1024 wide, seen 256 at a time, its layers at these depths and widths. */
const VALLEY = 1024;
const VIEW = 256;
const LAYERS = {
  far: { depth: 0.35, width: 525 },
  ground: { depth: 1, width: 1024 },
  near: { depth: 1.3, width: 1255 },
};

describe("the forest's parallax", () => {
  test("makes each layer as wide as the bundle's", () => {
    for (const l of Object.values(LAYERS)) expect(layerWidth(l.depth, VALLEY, VIEW)).toBe(l.width);
  });

  test("slides each layer at its depth: the far valley slowly, the near ferns faster", () => {
    expect(layerOffset(128, 0.35, VIEW)).toBe(0);
    expect(layerOffset(512, 1, VIEW)).toBe(384);
    expect(layerOffset(512, 0.35, VIEW)).toBe(134);
    expect(layerOffset(512, 1.3, VIEW)).toBe(499);
  });

  test("never shows past any layer's edge, anywhere the camera can be", () => {
    for (let cx = 128; cx <= 896; cx += 0.5)
      for (const l of Object.values(LAYERS)) {
        const off = layerOffset(cx, l.depth, VIEW);
        expect(off).toBeGreaterThanOrEqual(0);
        expect(off + VIEW).toBeLessThanOrEqual(l.width);
      }
  });

  test("keeps the camera's centre inside the valley", () => {
    expect(clampCamera(0, VALLEY, VIEW)).toBe(128);
    expect(clampCamera(512, VALLEY, VIEW)).toBe(512);
    expect(clampCamera(5000, VALLEY, VIEW)).toBe(896);
  });

  test("puts a ground x and its picture column on each other", () => {
    expect(toPicture(512, 512, VIEW)).toBe(128);
    expect(toGround(128, 512, VIEW)).toBe(512);
    // The far ridge's pennant stands in the middle when the camera is where the war glides to.
    expect(toPicture(230, 128 + (230 - 128) / 0.35, VIEW, 0.35)).toBe(128);
  });
});

describe("what a screen shows", () => {
  test("shows a wide screen the whole picture round its camera", () => {
    expect(look(512, 256, VALLEY, VIEW)).toEqual({ cx: 512, cropX: 0 });
    expect(look(0, 256, VALLEY, VIEW)).toEqual({ cx: 128, cropX: 0 });
  });

  test("shows a phone the middle of the picture, its crop sliding on to reach the valley's ends", () => {
    expect(look(512, 78, VALLEY, VIEW)).toEqual({ cx: 512, cropX: 89 });
    expect(look(0, 78, VALLEY, VIEW)).toEqual({ cx: 128, cropX: 0 });
    expect(look(VALLEY, 78, VALLEY, VIEW)).toEqual({ cx: 896, cropX: 256 - 78 });
    // Looking at the valley's first column on a phone shows it at the screen's middle.
    const l = look(60, 78, VALLEY, VIEW);
    expect(toGround(l.cropX + 39, l.cx, VIEW)).toBe(60);
  });
});

describe("members on spots", () => {
  const spots = [
    { row: "front", x: 591 },
    { row: "back", x: 441 },
    { row: "back", x: 590 },
    { row: "front", x: 416 },
  ];
  const members = [
    { name: "a", seed: "member-a", level: 1, tenure: 0 },
    { name: "b", seed: "member-b", level: 9, tenure: 5 },
    { name: "c", seed: "member-c", level: 9, tenure: 2 },
    { name: "d", seed: "member-d", level: 4, tenure: 9 },
    { name: "e", seed: "member-e", level: 12, tenure: 30 },
  ];

  test("stands the highest trees nearest the heart, the older member first among equals", () => {
    expect(plant(members, spots).map((p) => [p.member.name, p.x, p.row])).toEqual([
      ["e", 591, "front"],
      ["c", 441, "back"],
      ["b", 590, "back"],
      ["d", 416, "front"],
    ]);
  });

  test("lands the same members on the same spots whatever order they come in", () => {
    const one = plant(members, spots).map((p) => [p.member.name, p.spot]);
    expect(plant(members.toReversed(), spots).map((p) => [p.member.name, p.spot])).toEqual(one);
  });

  test("gives each spot to one member, and none to members past the last spot", () => {
    const planted = plant(members, spots);
    expect(new Set(planted.map((p) => p.spot)).size).toBe(planted.length);
    expect(planted.some((p) => p.member.name === "a")).toBe(false);
  });

  test("draws each member's own tree: their level and their stable variant", () => {
    expect(treeKey({ seed: "member-b", level: 9, tenure: 0 })).toBe(`L09-v${variantOf("member-b", 3)}`);
    expect(treeKey({ seed: "x", level: 40, tenure: 0 }).startsWith("L13-")).toBe(true);
    expect(treeKey({ seed: "x", level: 0, tenure: 0 }).startsWith("L01-")).toBe(true);
  });
});
