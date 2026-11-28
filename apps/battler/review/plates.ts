/**
 * The plates over figures, close: open the page with `?sheet=plates`, and `&zoom=6` to see it six
 * times as big. On each ground a figure stands on (the bare board's two halves, the gingham's checks,
 * the bench), a figure under its plate in each state: planning at one, two and three stars holding
 * none to three, resting on the bench; in a fight ours and theirs, hurt, shielded, with mana full, a
 * boss, and a figure of great health. Under them every item's picture beside how a figure holds it.
 * Drawn by the game's own code.
 */
import { drawStanding, framesOf } from "@sequoia-leaf/figures/sprites.ts";
import { CREAM, INK } from "@sequoia-leaf/kit/palette.ts";
import { write } from "@sequoia-leaf/kit/text.ts";
import { type Ctx, makeCanvas, must } from "@sequoia-leaf/kit/util.ts";
import type { RackItem } from "@sequoia-leaf/raid";
import { catalogAt } from "@sequoia-leaf/raid/content/catalog.ts";
import type { UnitKind } from "@sequoia-leaf/raid/content/figures.ts";
import { COMPONENT_IDS, EMBLEM_IDS, FINISHED_IDS } from "@sequoia-leaf/raid/content/items.ts";
import { LAST_ERA } from "@sequoia-leaf/raid/content/releases.ts";

import { BENCH, BOARD, CHECK, CLOTHS } from "../src/screen/art/board.ts";
import { heldPic, itemPic } from "../src/screen/art/icons.ts";
import { drawPlate, type Plate } from "../src/screen/plate.ts";

const NOW = catalogAt(LAST_ERA);
const CELL_W = 30;
const CELL_H = 50;

/** A plate's state, and the figure under it. */
interface Shown {
  readonly kind: UnitKind;
  readonly plate: Partial<Plate>;
}
const plate = (o: Partial<Plate>): Plate => ({
  stars: 1,
  ours: true,
  hp: 700,
  maxHp: 700,
  shield: 0,
  mana: 30,
  manaFull: 100,
  items: [],
  big: false,
  ...o,
});
const THREE: readonly RackItem[] = ["blackthorn", "glowcap", "quilt"];
/** Planning, then a fight. */
const STATES: readonly Shown[] = [
  { kind: "finch", plate: { mana: 0 } },
  { kind: "badger", plate: { stars: 2, mana: 0, maxHp: 1100, hp: 1100, items: ["thorn"] } },
  { kind: "heron", plate: { stars: 3, mana: 0, maxHp: 900, hp: 900, items: ["plume", "glowcap"] } },
  { kind: "rock", plate: { stars: 3, mana: 0, maxHp: 2400, hp: 2400, items: THREE } },
  { kind: "whitefox", plate: { stars: 3, items: ["hoard"], resting: true } },
  { kind: "crab12", plate: { stars: 2, hp: 380, maxHp: 900, mana: 60, items: ["stump", "conker"] } },
  { kind: "fogowl", plate: { stars: 3, hp: 600, maxHp: 900, shield: 300, mana: 100, items: THREE } },
  { kind: "greg", plate: { stars: 3, ours: false, hp: 1900, maxHp: 2600, mana: 20, items: ["wasptail", "lichen"] } },
  { kind: "kettle", plate: { stars: 2, ours: false, hp: 31_000, maxHp: 48_000, mana: 70, items: THREE } },
  { kind: "bushgnome", plate: { stars: 1, ours: false, hp: 500, maxHp: 700, manaFull: 0, items: [] } },
];

/** The grounds a plate is seen on: each face of the bare board, the gingham's checks, the bench's plank. */
const GROUNDS: readonly { readonly name: string; readonly at: (x: number, y: number) => string }[] = [
  { name: "your half", at: () => BOARD.near.face },
  { name: "their half", at: () => BOARD.far.face },
  {
    name: "gingham",
    at: (x, y) => {
      const a = Math.floor(x / 4) % 2;
      const b = Math.floor(y / 4) % 2;
      return a + b === 2 ? CHECK : a + b === 1 ? CLOTHS.gingham.nap : CLOTHS.gingham.ground;
    },
  },
  { name: "bench", at: () => BENCH.plank },
];

/** A row of figures under their plates on one ground. */
function row(g: Ctx, top: number, ground: (x: number, y: number) => string): void {
  for (let y = 0; y < CELL_H; y++)
    for (let x = 0; x < CELL_W * STATES.length; x++) {
      g.fillStyle = ground(x, y);
      g.fillRect(x, top + y, 1, 1);
    }
  STATES.forEach((s, i) => {
    const kind = s.kind;
    const f = framesOf(kind);
    const x = i * CELL_W + CELL_W / 2;
    const foot = top + CELL_H - 6;
    drawStanding(g, NOW, kind, x, foot, "plain");
    drawPlate(g, x, foot - 3 - f.tall, plate(s.plate));
  });
}

/** The items, each large beside how a figure holds it. */
function items(g: Ctx, top: number): number {
  const all: RackItem[] = [...COMPONENT_IDS, ...FINISHED_IDS, ...EMBLEM_IDS.slice(0, 7)];
  const per = 10;
  all.forEach((id, i) => {
    const x = (i % per) * 24 + 2;
    const y = top + Math.floor(i / per) * 16 + 2;
    g.drawImage(itemPic(id), x, y);
    g.drawImage(heldPic(id), x + 15, y + 3);
  });
  return Math.ceil(all.length / per) * 16 + 4;
}

export function showPlates(zoom = 6): void {
  const w = CELL_W * STATES.length;
  const h = CELL_H * GROUNDS.length + 3 * 16 + 8;
  const small = makeCanvas(w, h);
  const g = small.g;
  g.fillStyle = INK;
  g.fillRect(0, 0, w, h);
  GROUNDS.forEach((ground, i) => row(g, i * CELL_H, ground.at));
  items(g, CELL_H * GROUNDS.length);
  const big = makeCanvas(w * zoom, h * zoom);
  big.g.imageSmoothingEnabled = false;
  big.g.drawImage(small.c, 0, 0, big.c.width, big.c.height);
  GROUNDS.forEach((ground, i) =>
    write(big.g, ground.name, 4, i * CELL_H * zoom + 4, { px: Math.max(1, zoom / 3), colour: CREAM, shadow: INK }),
  );
  big.c.id = "sheet";
  big.c.style.cssText = `position:absolute;left:0;top:0;width:${big.c.width}px;height:${big.c.height}px;image-rendering:pixelated;z-index:99`;
  must(document.body, "body").append(big.c);
  document.body.style.overflow = "auto";
  document.documentElement.style.overflow = "auto";
}
