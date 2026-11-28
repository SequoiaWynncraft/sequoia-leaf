/**
 * Every state of a hex on the board (`RAID-BOARD.md` section 5), on one sheet, enlarged: open the
 * page with `?sheet=hexes`. Each tile is three hexes of a half of the real board, drawn by the
 * game's own code (the halves, the hand's signs, the zone band, closed hexes, zones, a telegraph).
 * Under them, the swatch each look is tried on with.
 */
import { drawStanding } from "@sequoia-leaf/figures/sprites.ts";
import { CORAL, CREAM, INK } from "@sequoia-leaf/kit/palette.ts";
import { write } from "@sequoia-leaf/kit/text.ts";
import { type Ctx, makeCanvas, must } from "@sequoia-leaf/kit/util.ts";
import { type Looks, newLooks, type ZoneKind } from "@sequoia-leaf/raid";
import { catalogAt } from "@sequoia-leaf/raid/content/catalog.ts";
import type { UnitKind } from "@sequoia-leaf/raid/content/figures.ts";
import { LAST_ERA } from "@sequoia-leaf/raid/content/releases.ts";
import { SEATS } from "@sequoia-leaf/raid/hex.ts";

import { BOARD, drawShadow, hexSign, quietOf, SIGN, SIGN_ALPHA } from "../src/screen/art/board.ts";
import { paintLook } from "../src/screen/art/place.ts";
import { paintHalf } from "../src/screen/art/table.ts";
import { bare, closedMark } from "../src/screen/closed.ts";
import { drawZone as drawFightZone } from "../src/screen/fightmarks.ts";
import { BOARD_H, BOARD_W, cellXY, HEX_H, HEX_W, ROW } from "../src/screen/geometry.ts";
import { drawZone } from "../src/screen/zone.ts";

/** The board's corner in the picture each tile is cut from, and the picture's size. */
const OX = 12;
const OY = 12;
/** A tile: where it is cut from the board (its left and top, in board pixels), its size, and the sheet's zoom. */
const CUT = { x: 40, w: 64, h: 46 } as const;
const ZOOM = 4;
const COLUMNS = 5;
/** The three hexes of a tile on your half (two on a row and one under them), and on theirs. */
const NEAR = [37, 38, 45] as const;
const FAR = [9, 10, 17] as const;
const NOW = catalogAt(LAST_ERA);

/** Lays a sign on a hex. */
function put(g: Ctx, pic: HTMLCanvasElement, cell: number, alpha = 1): void {
  const at = cellXY(cell);
  g.globalAlpha = alpha;
  g.drawImage(pic, OX + at.x - HEX_W / 2, OY + at.y - HEX_H / 2);
  g.globalAlpha = 1;
}
/** A figure standing on a hex, with its shadow. */
function stand(g: Ctx, kind: UnitKind, cell: number): void {
  const at = cellXY(cell);
  drawShadow(g, OX + at.x, OY + at.y + 3);
  drawStanding(g, NOW, kind, OX + at.x, OY + at.y + 3, "plain");
}
const zone =
  (kind: ZoneKind, cells: readonly number[]) =>
  (g: Ctx): void =>
    drawFightZone(g, kind, cells, () => 1, OX, OY);

interface Tile {
  readonly label: string;
  /** Their half, not yours; a fight's quiet board. */
  readonly far?: boolean;
  readonly quiet?: boolean;
  readonly draw?: (g: Ctx) => void;
}
const [A, B, C] = NEAR;
const TILES: readonly Tile[] = [
  { label: "your half" },
  { label: "their half", far: true },
  { label: "in a fight", quiet: true },
  { label: "under a figure", draw: (g) => stand(g, "finch", C) },
  {
    label: "in the hand: free",
    draw: (g) => NEAR.forEach((c) => put(g, hexSign(null, SIGN.free), c, SIGN_ALPHA.free)),
  },
  {
    label: "its zone",
    draw: (g) => {
      drawZone(
        g,
        NEAR.map((c) => c - SEATS),
        OX,
        OY,
        0,
      );
      for (const c of NEAR) put(g, hexSign(null, SIGN.zone), c, SIGN_ALPHA.zoneRim);
    },
  },
  {
    label: "where it will go",
    draw: (g) => {
      for (const c of [A, B]) put(g, hexSign(null, SIGN.free), c, SIGN_ALPHA.free);
      put(g, hexSign(SIGN.aimFill, SIGN.aimFill), C, SIGN_ALPHA.aimFill);
      put(g, hexSign(null, SIGN.aim), C);
    },
  },
  {
    label: "would change places",
    draw: (g) => {
      put(g, hexSign(null, SIGN.swap), C, SIGN_ALPHA.swap);
      stand(g, "glorp", C);
    },
  },
  { label: "closed for sitting", draw: (g) => [A, C].forEach((c) => put(g, bare(), c)) },
  { label: "closed: a stump", draw: (g) => put(g, closedMark(["stumps"]), C) },
  { label: "closed: grown over", draw: (g) => [A, C].forEach((c) => put(g, closedMark(["narrow"]), c)) },
  { label: "slime", draw: zone("slime", [A, C]) },
  { label: "puddle", draw: zone("puddle", [B, C]) },
  { label: "dust", draw: zone("dust", NEAR) },
  { label: "ice", draw: zone("ice", [A, B]) },
  { label: "snow", draw: zone("snow", NEAR) },
  {
    label: "about to land",
    draw: (g) => {
      put(g, hexSign(CORAL, CORAL), A, 0.15);
      put(g, hexSign(CORAL, CORAL), C, 0.5);
      for (const c of [A, C]) put(g, hexSign(null, CORAL), c);
    },
  },
];

/** The board as a tile is cut from it: the wood, both halves, and the tile's own state on them. */
function boardFor(tile: Tile): HTMLCanvasElement {
  const { c, g } = makeCanvas(BOARD_W + OX * 2, BOARD_H + OY * 2);
  g.fillStyle = BOARD.wood;
  g.fillRect(0, 0, c.width, c.height);
  const tones = (t: typeof BOARD.near): typeof BOARD.near => (tile.quiet ? quietOf(t) : t);
  g.drawImage(paintHalf(true, tones(BOARD.far)), OX - 1, OY - 1);
  g.drawImage(paintHalf(false, tones(BOARD.near)), OX - 1, OY + 4 * ROW - 1);
  tile.draw?.(g);
  return c;
}

/** The swatches: the clearing bare and in each cloth, and the hall. */
const SWATCHES: readonly Looks[] = [
  ...(["bare", "baize", "plum", "gingham"] as const).map((cloth) => Object.assign(newLooks(), { cloth })),
  Object.assign(newLooks(), { place: "hall" as const }),
];

/** Shows the sheet in place of the table. */
export function showHexes(): void {
  const rows = Math.ceil(TILES.length / COLUMNS);
  const label = 18;
  const swatchH = 62 * 2;
  const sheet = makeCanvas(CUT.w * COLUMNS * ZOOM, (CUT.h * ZOOM + label) * rows + swatchH);
  const g = sheet.g;
  g.fillStyle = INK;
  g.fillRect(0, 0, sheet.c.width, sheet.c.height);
  g.imageSmoothingEnabled = false;
  TILES.forEach((tile, i) => {
    const top = cellXY(tile.far ? FAR[0] : NEAR[0]).y - HEX_H / 2 - 7;
    const x = (i % COLUMNS) * CUT.w * ZOOM;
    const y = Math.floor(i / COLUMNS) * (CUT.h * ZOOM + label);
    g.drawImage(boardFor(tile), OX + CUT.x, OY + top, CUT.w, CUT.h, x, y, CUT.w * ZOOM, CUT.h * ZOOM);
    write(g, tile.label, x + 8, y + CUT.h * ZOOM + 3, { px: 1, colour: CREAM });
  });
  SWATCHES.forEach((looks, i) => {
    const pic = paintLook(looks);
    g.drawImage(pic, i * (pic.width + 4) * 2, (CUT.h * ZOOM + label) * rows, pic.width * 2, pic.height * 2);
  });
  sheet.c.id = "sheet";
  sheet.c.style.cssText = `position:absolute;left:0;top:0;width:${sheet.c.width}px;height:${sheet.c.height}px;z-index:99`;
  document.body.style.background = INK;
  must(document.body, "body").append(sheet.c);
  document.body.style.overflow = "auto";
  document.documentElement.style.overflow = "auto";
}
