/**
 * The town's layout, labelled, for whoever edits the map (`@sequoia-leaf/town/map`): open the page
 * with `?sheet=map`. The town is drawn as it stands, by day, three screen pixels to each of its own,
 * and over it the squares, those blocked, every piece's id at its anchor, the rest spots, the
 * places, the busy spots at the games and the spots of the town's own, with a line saying which mark
 * is which.
 */

import { type Ctx, makeCanvas, must, type Pt } from "@sequoia-leaf/kit/util.ts";
import { CELL } from "@sequoia-leaf/town/map/grid.ts";
import type { SeatAt } from "@sequoia-leaf/town/map/kinds.ts";
import { BOUNDS, BUSY, ERRANDS, PIECES, PLACES, RESTS, type Spot, TOWN } from "@sequoia-leaf/town/map/map.ts";

import { GROUND, paintGround } from "./ground.ts";
import type { Sprites } from "./sprites.ts";
import { props } from "./town.ts";
import { buildTown } from "./townart.ts";

/** Screen pixels to each of the town's, and the strip the legend takes under it. */
const K = 3;
const LEGEND = 22;

/** The colour of a rest spot, by who rests there. */
const SEAT_COLOUR: Readonly<Record<SeatAt, string>> = {
  fire: "#ff9d3c",
  bench: "#6ee07a",
  works: "#5cb8ff",
  table: "#d58cff",
};

const LEGEND_TEXT =
  "red: blocked | +: piece | dot: seat, its line the way they face (orange fire, green bench, blue Works bench, violet stump; ringed: the member's) | square: place, diamond: its prompt | triangle: busy | x: the town's own";

/** A point of the town on the sheet. */
const at = (x: number, y: number): Pt => ({ x: (x - BOUNDS.x) * K, y: (y - BOUNDS.y) * K });

/** Words on the sheet, light on a dark edge so that they read over anything. */
function label(g: Ctx, text: string, x: number, y: number, colour = "#fff"): void {
  g.strokeStyle = "rgba(0,0,0,0.85)";
  g.lineWidth = 3;
  g.strokeText(text, x, y);
  g.fillStyle = colour;
  g.fillText(text, x, y);
}

/** The town as it stands: its ground, then everything standing, far to near; the chest and the belt are drawn over their spots. */
function drawTown(s: Sprites): HTMLCanvasElement {
  const ground = paintGround();
  buildTown(s, must(ground.getContext("2d"), "ground"));
  const { c, g } = makeCanvas(BOUNDS.w, BOUNDS.h);
  g.drawImage(ground, GROUND.x - BOUNDS.x, GROUND.y - BOUNDS.y);
  for (const p of props.toSorted((a, b) => a.z - b.z)) {
    if (p.sprite) g.drawImage(p.sprite.c, p.x - p.sprite.ax - BOUNDS.x, p.y - p.sprite.ay - BOUNDS.y);
    else p.extra?.(g, p.x - BOUNDS.x, p.y - BOUNDS.y);
  }
  return c;
}

/** Faint lines every square, and the blocked squares tinted. */
function drawSquares(g: Ctx): void {
  g.fillStyle = "rgba(255,40,40,0.3)";
  for (let cy = 0; cy < TOWN.gh; cy++)
    for (let cx = 0; cx < TOWN.gw; cx++)
      if (TOWN.cellBlocked(cx, cy)) g.fillRect(cx * CELL * K, cy * CELL * K, CELL * K, CELL * K);
  g.strokeStyle = "rgba(255,255,255,0.13)";
  g.lineWidth = 1;
  g.beginPath();
  for (let cx = 0; cx <= TOWN.gw; cx++) {
    g.moveTo(cx * CELL * K + 0.5, 0);
    g.lineTo(cx * CELL * K + 0.5, TOWN.gh * CELL * K);
  }
  for (let cy = 0; cy <= TOWN.gh; cy++) {
    g.moveTo(0, cy * CELL * K + 0.5);
    g.lineTo(TOWN.gw * CELL * K, cy * CELL * K + 0.5);
  }
  g.stroke();
}

/** Each piece's anchor, with its id; the rest of a group by their number in it, the group's id on its first. */
function drawPieces(g: Ctx): void {
  g.font = "10px monospace";
  for (const p of PIECES) {
    const { x, y } = at(p.x, p.y);
    g.fillStyle = "#fff";
    g.fillRect(x - 3, y, 7, 1);
    g.fillRect(x, y - 3, 1, 7);
    const n = p.id.split(".")[1];
    label(g, n === undefined || n === "0" ? p.id : `.${n}`, x + 4, y - 3);
  }
}

/** Which way a mark points for somebody facing `dir`: down towards us, left, right or up, away. */
const AHEAD: readonly Pt[] = [
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
];

/** The rest spots: a dot, a line the way the sitter faces, in the colour of who rests there; the member's ringed. */
function drawRests(g: Ctx): void {
  for (const r of RESTS) {
    const { x, y } = at(r.x, r.y);
    const ahead = AHEAD[r.dir] ?? { x: 0, y: 1 };
    g.fillStyle = SEAT_COLOUR[r.at];
    g.strokeStyle = SEAT_COLOUR[r.at];
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, 3.5, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + ahead.x * 12, y + ahead.y * 12);
    g.stroke();
    if (r.yours) {
      g.beginPath();
      g.arc(x, y, 7, 0, Math.PI * 2);
      g.stroke();
    }
  }
}

/** The places: a square where they are used from, with the place's id; a diamond where the prompt floats. */
function drawPlaces(g: Ctx): void {
  g.font = "bold 11px monospace";
  for (const pl of PLACES) {
    const s = at(pl.stand.x, pl.stand.y);
    const p = at(pl.prompt.x, pl.prompt.y);
    g.strokeStyle = "#ffe36b";
    g.lineWidth = 2;
    g.strokeRect(s.x - 5, s.y - 5, 10, 10);
    g.beginPath();
    g.moveTo(p.x, p.y - 6);
    g.lineTo(p.x + 6, p.y);
    g.lineTo(p.x, p.y + 6);
    g.lineTo(p.x - 6, p.y);
    g.closePath();
    g.stroke();
    label(g, pl.id, s.x + 8, s.y + 12, "#ffe36b");
  }
}

/** A busy spot at a game: a triangle pointing the way they face. */
function triangle(g: Ctx, s: Spot): void {
  const { x, y } = at(s.x, s.y);
  const a = AHEAD[s.dir] ?? { x: 0, y: 1 };
  g.beginPath();
  g.moveTo(x + a.x * 7, y + a.y * 7);
  g.lineTo(x - a.x * 4 - a.y * 5, y - a.y * 4 + a.x * 5);
  g.lineTo(x - a.x * 4 + a.y * 5, y - a.y * 4 - a.x * 5);
  g.closePath();
  g.fill();
}

/** A spot of the town's own: a cross. */
function cross(g: Ctx, s: Spot): void {
  const { x, y } = at(s.x, s.y);
  g.beginPath();
  g.moveTo(x - 5, y - 5);
  g.lineTo(x + 5, y + 5);
  g.moveTo(x + 5, y - 5);
  g.lineTo(x - 5, y + 5);
  g.stroke();
}

function drawSpots(g: Ctx): void {
  g.fillStyle = "#4dffe0";
  for (const b of Object.values(BUSY)) for (const s of b.spots) triangle(g, s);
  g.strokeStyle = "#ff6bd5";
  g.lineWidth = 2;
  for (const ss of Object.values(ERRANDS)) for (const s of ss) cross(g, s);
}

/** The town's layout, labelled: `?sheet=map`. */
export function showMapSheet(s: Sprites): void {
  const town = drawTown(s);
  const w = BOUNDS.w * K;
  const h = BOUNDS.h * K;
  const { c, g } = makeCanvas(w, h + LEGEND);
  g.imageSmoothingEnabled = false;
  g.drawImage(town, 0, 0, w, h);
  drawSquares(g);
  drawRests(g);
  drawSpots(g);
  drawPlaces(g);
  drawPieces(g);
  g.fillStyle = "#141f1c";
  g.fillRect(0, h, w, LEGEND);
  g.font = "11px monospace";
  label(g, LEGEND_TEXT, 6, h + 15);
  c.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h + LEGEND}px;z-index:99`;
  document.body.style.overflow = "auto";
  document.documentElement.style.overflow = "auto";
  document.body.style.height = `${h + LEGEND}px`;
  document.body.append(c);
  document.body.dataset.sheet = "map";
}
