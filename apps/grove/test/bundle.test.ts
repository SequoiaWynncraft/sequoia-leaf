import { describe, expect, test } from "bun:test";

import { fitPicture, HUD_BAR } from "../src/bundle/fit.ts";
import { ambianceAt, fill, pickGlade, readManifest, variantOf } from "../src/bundle/manifest.ts";
import { Ink, moonlit, packHex } from "../src/bundle/palette.ts";

/** A manifest as `grove/bundle.py` writes it, trimmed to two levels' boxes. */
const MANIFEST = {
  version: 1,
  canvas: { width: 256, height: 144 },
  frame_ms: 100,
  frames: 160,
  glade: {
    foot: [116, 126],
    hearth: [160, 134],
    levels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    variants: 3,
    seasons: ["normal", "winter"],
    ambiances: ["dusk", "night"],
    loop: "glade/L{level}-v{variant}-{season}-{ambiance}.gif",
    near: "glade/near-{season}.png",
    tree: "glade/L{level}-v{variant}-{season}-tree.png",
    ground: 139,
    tree_boxes: { "L01-v0-normal": [112, 118, 9, 11], "L13-v2-winter": [75, 0, 103, 127] },
  },
  effects: { aurora: "effects/aurora-{season}.png", sky: "effects/sky-{season}.png", frames: 160 },
  campfire: {
    loop: "campfire/campfire-{season}-{ambiance}.gif",
    near: "glade/near-{season}.png",
    fire: [128, 129],
    seats: [
      { x: 92, y: 131 },
      { x: 152, y: 131 },
    ],
    cat: [78, 128],
  },
  forest: {
    width: 1024,
    heart: 512,
    height: 144,
    pond: 800,
    gate: 905,
    layers: { far: { depth: 0.35, width: 525 }, ground: { depth: 1, width: 1024 }, near: { depth: 1.3, width: 1255 } },
    rows: [
      { name: "back", scale: 0.5, foot: 117, haze: 0.42 },
      { name: "front", scale: 0.72, foot: 128, haze: 0 },
    ],
    spots: [
      { row: "front", x: 591 },
      { row: "back", x: 441 },
    ],
    seasons: ["normal"],
    ambiances: ["dusk", "night"],
    layer: "forest/{layer}-{season}-{ambiance}.png",
    trees: "forest/trees-{row}-{season}-{ambiance}.png",
    great: { x: 437, w: 150, seam: 512 },
    "index-normal": { back: { "L13-v2": [0, 0, 52, 87, 21, 83] }, front: { "L01-v0": [630, 123, 9, 11, 4, 8] } },
  },
  later: { anything: true },
};

const glade = readManifest(MANIFEST).glade;

describe("the bundle's manifest", () => {
  test("reads the glade, the effects and keeps the sections it does not know", () => {
    const m = readManifest(MANIFEST);
    expect(m.width).toBe(256);
    expect(m.height).toBe(144);
    expect(m.glade.foot).toEqual({ x: 116, y: 126 });
    expect(m.glade.hearth).toEqual({ x: 160, y: 134 });
    expect(m.glade.treeBoxes.get("L01-v0-normal")).toEqual({ x: 112, y: 118, w: 9, h: 11 });
    expect(m.effects?.aurora).toBe("effects/aurora-{season}.png");
    expect(m.other.has("later")).toBe(true);
    expect(m.other.has("campfire")).toBe(false);
  });

  test("reads the Campfire's fire, seats and cat", () => {
    const c = readManifest(MANIFEST).campfire;
    expect(c?.fire).toEqual({ x: 128, y: 129 });
    expect(c?.seats).toEqual([
      { x: 92, y: 131 },
      { x: 152, y: 131 },
    ]);
    expect(c?.cat).toEqual({ x: 78, y: 128 });
    expect(c?.near).toBe("glade/near-{season}.png");
  });

  test("reads the Forest's layers, rows, spots and each season's atlas boxes", () => {
    const f = readManifest(MANIFEST).forest;
    expect(f?.layers.near).toEqual({ depth: 1.3, width: 1255 });
    expect(f?.rows.map((r) => [r.name, r.foot])).toEqual([
      ["back", 117],
      ["front", 128],
    ]);
    expect(f?.spots[0]).toEqual({ row: "front", x: 591 });
    expect(f?.great).toEqual({ x: 437, w: 150 });
    expect(f?.index.get("normal")?.get("back")?.get("L13-v2")).toEqual({
      x: 0,
      y: 0,
      w: 52,
      h: 87,
      footX: 21,
      footY: 83,
    });
  });

  test("reads a bundle from before the Campfire and the Forest, and refuses a broken one", () => {
    const { campfire: _, forest: __, ...older } = MANIFEST;
    const m = readManifest(older);
    expect(m.campfire).toBeNull();
    expect(m.forest).toBeNull();
    expect(() =>
      readManifest({ ...MANIFEST, forest: { ...MANIFEST.forest, spots: [{ row: "middle", x: 1 }] } }),
    ).toThrow("row");
    expect(() => readManifest({ ...MANIFEST, campfire: { ...MANIFEST.campfire, fire: [1] } })).toThrow("campfire.fire");
  });

  test("places the hearth for a bundle from before it had one", () => {
    const { hearth: _, ...older } = MANIFEST.glade;
    expect(readManifest({ ...MANIFEST, glade: older }).glade.hearth).toEqual({ x: 160, y: 134 });
  });

  test("refuses a manifest without a glade", () => {
    const { glade: _, ...rest } = MANIFEST;
    expect(() => readManifest(rest)).toThrow("glade");
  });

  test("names levels with two digits, as the bundle's files are named", () => {
    expect(fill("glade/L{level}-v{variant}.gif", { level: 7, variant: 2 })).toBe("glade/L07-v2.gif");
    expect(fill("glade/L{level}.gif", { level: 13 })).toBe("glade/L13.gif");
  });
});

describe("the glade's loop", () => {
  test("is night from 20:00 to 06:00 by the member's clock, and dusk otherwise", () => {
    expect([19, 20, 23, 0, 5, 6, 12].map(ambianceAt)).toEqual([
      "dusk",
      "night",
      "night",
      "night",
      "night",
      "dusk",
      "dusk",
    ]);
  });

  test("gives each member one stable variant of the three", () => {
    const seeds = ["a", "b", "c", "d", "e", "f", "g", "h"].map((s) => `member-${s}`);
    const variants = seeds.map((s) => variantOf(s, 3));
    expect(variants.every((v) => v >= 0 && v < 3)).toBe(true);
    expect(new Set(variants).size).toBe(3);
    expect(seeds.map((s) => variantOf(s, 3))).toEqual(variants);
  });

  test("picks the files for the level, the member's variant, the season and the light", () => {
    const seed = "sequoia";
    const v = variantOf(seed, 3);
    const pick = pickGlade(glade, { level: 9, seed, season: "winter", ambiance: "night" });
    expect(pick.loopPath).toBe(`glade/L09-v${v}-winter-night.gif`);
    expect(pick.treePath).toBe(`glade/L09-v${v}-winter-tree.png`);
    expect(pick.nearPath).toBe("glade/near-winter.png");
    expect(pick.tree).toBe(`L09-v${v}-winter`);
  });

  test("shares one tree mask between dusk and night", () => {
    const dusk = pickGlade(glade, { level: 4, seed: "x", season: "normal", ambiance: "dusk" });
    const night = pickGlade(glade, { level: 4, seed: "x", season: "normal", ambiance: "night" });
    expect(dusk.loopPath).not.toBe(night.loopPath);
    expect(dusk.treePath).toBe(night.treePath);
  });

  test("takes the nearest level the bundle has, and a season it has", () => {
    expect(pickGlade(glade, { level: 20, seed: "x", season: "normal", ambiance: "dusk" }).level).toBe(13);
    expect(pickGlade(glade, { level: 0, seed: "x", season: "normal", ambiance: "dusk" }).level).toBe(1);
    expect(pickGlade(glade, { level: 3, seed: "x", season: "autumn", ambiance: "dusk" }).season).toBe("normal");
  });

  test("carries the tree's box from the manifest", () => {
    const seed = Array.from({ length: 30 }, (_, i) => `member-${i}`).find((s) => variantOf(s, 3) === 0) ?? "";
    expect(pickGlade(glade, { level: 1, seed, season: "normal", ambiance: "dusk" }).box).toEqual({
      x: 112,
      y: 118,
      w: 9,
      h: 11,
    });
  });
});

describe("the picture on the screen", () => {
  const base = { picW: 256, picH: 144, hud: true, focusX: 116, clearRow: 133 };

  test("fills a 1440x900 window at five pixels an art pixel, centred, its tree above the hotbar", () => {
    const f = fitPicture({ ...base, devW: 1440, devH: 900, phone: false, hudScale: 3 });
    expect(f).toMatchObject({ scale: 5, W: 256, H: 144, cropX: 0, offX: 80, offY: 90 });
    expect(f.offY + 133 * f.scale).toBeLessThanOrEqual(900 - HUD_BAR * 3);
  });

  test("steps down a scale rather than hide the tree's foot under the hotbar", () => {
    const f = fitPicture({ ...base, devW: 1280, devH: 720, phone: false, hudScale: 3 });
    expect(f.scale).toBe(4);
    expect(f.offY + 133 * f.scale).toBeLessThanOrEqual(720 - HUD_BAR * 3);
  });

  test("raises the picture a little when that keeps a bigger scale", () => {
    const f = fitPicture({ ...base, devW: 1920, devH: 1080, phone: false, hudScale: 4 });
    expect(f.scale).toBe(7);
    expect(f.offY).toBeGreaterThanOrEqual(0);
    expect(f.offY).toBeLessThan(Math.floor((1080 - 144 * 7) / 2));
  });

  test("fills the screen at its own scale with no HUD", () => {
    const f = fitPicture({ ...base, devW: 1280, devH: 720, phone: false, hudScale: 3, hud: false });
    expect(f).toMatchObject({ scale: 5, offX: 0, offY: 0 });
  });

  test("shows a phone a whole-pixel crop centred on the tree, standing on the hotbar", () => {
    // 390x844 CSS at one device pixel per CSS pixel, the dock's 78 pixels taken off.
    const f = fitPicture({ ...base, devW: 390, devH: 766, phone: true, hudScale: 3 });
    expect(f.scale).toBe(4);
    expect(f.W).toBe(98);
    expect(f.cropX).toBe(116 - 49);
    expect(f.offY + 144 * f.scale).toBe(766 - HUD_BAR * 3);
  });

  test("keeps a crop inside the picture", () => {
    const f = fitPicture({ ...base, devW: 390, devH: 766, phone: true, hudScale: 3, focusX: 250 });
    expect(f.cropX + f.W).toBe(256);
  });
});

const lum = (c: number): number => (c & 255) + ((c >>> 8) & 255) + ((c >>> 16) & 255);

describe("the welcome's colours by night", () => {
  test("moonlight darkens and cools a colour, and leaves the lights alone", () => {
    const day = packHex("#7fa62e");
    const night = moonlit(day);
    expect(lum(night)).toBeLessThan(lum(day));
    expect((night >>> 16) & 255).toBeGreaterThan((day >>> 16) & 255);
    expect(new Ink("night").c("firefly")).toBe(packHex("#ffe58a"));
    expect(new Ink("night").c("leaf")).toBe(night);
    expect(new Ink("dusk").c("leaf")).toBe(day);
  });
});
