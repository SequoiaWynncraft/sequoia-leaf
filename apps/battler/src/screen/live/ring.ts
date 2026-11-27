/**
 * The carousel, drawn on the table: the ring's nine figures stand in a ring across the board, each
 * holding its component, and turn slowly on the page's own clock, so nothing in it waits on Leaf. A
 * figure taken flies to whoever took it (the member's own to where it joins their run, another's to
 * their row of the players) and the ring closes up. While it is the member's turn the figures are
 * lit, and a tap on one takes it at once (Leaf's answer wins). Over each figure a button follows it
 * round: the tap, the keyboard and the figure's card; the ring holds still while the mouse is on one.
 */
import { beatAt, drawStanding, framesOf, hoverAt, nameOf } from "@sequoia-leaf/figures/sprites.ts";
import { link } from "@sequoia-leaf/kit/card.ts";
import { el } from "@sequoia-leaf/kit/dom.ts";
import { type Ctx, makeCanvas } from "@sequoia-leaf/kit/util.ts";
import { catalogOf, pieces, rackName, type RunView } from "@sequoia-leaf/raid";
import type { FigureId } from "@sequoia-leaf/raid/content/figures.ts";
import type { Offer, RingItem } from "@sequoia-leaf/raid/sitting/sitting.ts";
import type { SittingView } from "@sequoia-leaf/raid/sitting/view.ts";

import { heldPic } from "../art/icons.ts";
import { fly } from "../fx.ts";
import { BOARD_W, type Pt } from "../geometry.ts";
import { drawHeld, heldRow, heldTop } from "../held.ts";
import { hop, pawns, spotOfPawn, spotXY } from "../pawns.ts";
import { fadePawns, standAlso } from "../scene.ts";
import { snd } from "../sounds.ts";
import { artPx, boardSpot, boardToPage, type Standing, toBoard, V } from "../stage.ts";
import { figureRef } from "../ui/refs.ts";
import { closeUp, figureBox, focusAfter, ringMoves, stacking, turnOf } from "./reads.ts";

/**
 * The ring on the board, from its corner: its middle, how wide and deep it is, and how fast it turns
 * (radians a second, once a minute). Across the whole board; its back as high as the room over the
 * board allows (the bar along the top, and on a phone the players' row, cover the far edge), at most
 * `DEEPEST` deep; its nearest figure just behind the member's front row (`FRONT`), so that it never
 * stands among their own, unless that leaves it shallower than `SHALLOWEST`: then it comes forward
 * over the member's half, whose figures it dims while it stands there (`forward`).
 */
const RING = { x: BOARD_W / 2, y: 40, rx: 76, ry: 30, turn: (2 * Math.PI) / 60, forward: false };
const FRONT = 60;
const DEEPEST = 30;
const SHALLOWEST = 18;
/** How see-through the member's own figures are while the ring stands over them. */
const DIMMED = 0.45;
/** How far a figure at the back of the ring stands up over its feet, at most. */
const HEADROOM = 30;
/** How quickly a figure closes up the gap one taken leaves, and how long one arriving takes to land. */
const CLOSE = 5;
const ARRIVE = 0.45;

const R: {
  box: HTMLElement | null;
  take: ((offer: number) => void) | null;
  /** What the ring shows: the sitting as last heard, Leaf's clock, and whether it is up. */
  view: () => SittingView | null;
  now: () => number;
  up: () => boolean;
  /** Which carousel the ring is of (its room), so that a new one is laid out afresh. */
  room: number | null;
  /** Each place's angle round the ring past the ring's own turn, eased towards its spot as others are taken. */
  at: number[];
  /** When each place arrived, by the stage's clock, to drop it in. */
  came: number;
  /** The ring as last heard, to tell what has been taken since. */
  was: readonly Offer[];
  buttons: HTMLButtonElement[];
  lastT: number;
  /** How far the ring has turned, and the place the mouse is on, if any: the ring holds still under it, so its card can be read. */
  turned: number;
  held: number | null;
} = {
  box: null,
  take: null,
  view: () => null,
  now: () => 0,
  up: () => false,
  room: null,
  at: [],
  came: -9,
  was: [],
  buttons: [],
  lastT: 0,
  turned: 0,
  held: null,
};

/** The places still standing, in ring order. */
const standing = (ring: readonly Offer[]): number[] => ring.flatMap((o, i) => (o.by === null ? [i] : []));
/** Where a place stands now, from the board's corner: its feet, and which way it faces as the ring turns. */
function spotOf(i: number): { x: number; y: number; left: boolean } {
  const a = R.turned + (R.at[i] ?? 0);
  return { x: RING.x + Math.cos(a) * RING.rx, y: RING.y + Math.sin(a) * RING.ry, left: Math.sin(a) > 0 };
}
/** Each standing place's spot past the ring's turn: evenly round it. */
function spotsAround(ring: readonly Offer[]): Map<number, number> {
  const left = standing(ring);
  return new Map(left.map((i, k) => [i, -Math.PI / 2 + (2 * Math.PI * k) / Math.max(1, left.length)]));
}

/**
 * A figure and what it holds, as one small picture, what flies to whoever took it: the figure, and
 * under it its held-item mark on its dark tile, as the table draws them (`drawStanding`, `drawHeld`).
 * `feet` is the row of the picture the figure stands on.
 */
const flyers = new Map<string, { pic: HTMLCanvasElement; feet: number }>();
function flyerOf(kind: FigureId, item: RingItem): { pic: HTMLCanvasElement; feet: number } {
  const key = `${kind}:${item}`;
  const had = flyers.get(key);
  if (had) return had;
  const f = framesOf(kind);
  const held = heldPic(item);
  // The figure stands 2 pixels over its feet, and its held row starts 2 under them.
  const feet = f.ay + 2;
  const { c, g } = makeCanvas(Math.max(f.w, held.width), heldTop(feet, false) + held.height, true);
  g.drawImage(f.idle[0], Math.round(c.width / 2) - f.ax, feet - 2 - f.ay);
  drawHeld(g, heldRow([item], c.width / 2, heldTop(feet, false)), 0, 0);
  const made = { pic: c, feet };
  flyers.set(key, made);
  return made;
}

/** Builds the ring's buttons' box, and has the table draw the ring while the live table's carousel is up. */
export function buildRing(asks: {
  take: (offer: number) => void;
  view: () => SittingView | null;
  now: () => number;
  up: () => boolean;
}): void {
  R.box = el("div", "", { id: "live-ring", hidden: true, role: "group", "aria-label": "The carousel" });
  R.take = asks.take;
  R.view = asks.view;
  R.now = asks.now;
  R.up = asks.up;
  document.body.append(R.box);
  standAlso(drawRing);
  fadePawns(() => (RING.forward && R.room !== null && R.up() ? DIMMED : 1));
}

/** Fits the ring's depth under whatever is laid over the top of the board: the bar along the top, and the players' row on a phone. */
function fit(): void {
  const left = boardToPage(0, 0).x;
  const right = boardToPage(BOARD_W, 0).x;
  let top = 0;
  for (const id of ["hud", "live-players"]) {
    const r = document.getElementById(id)?.getBoundingClientRect();
    if (r && r.height > 0 && r.left < right && r.right > left) top = Math.max(top, r.bottom);
  }
  const back = Math.max(FRONT - 2 * DEEPEST, toBoard(0, top).y + HEADROOM);
  const front = Math.max(FRONT, back + 2 * SHALLOWEST);
  RING.ry = (front - back) / 2;
  RING.y = back + RING.ry;
  RING.forward = front > FRONT;
}

/** Lays a new carousel's ring out: every place at its spot, dropping in, and a button over each. */
function layOut(view: SittingView, ring: readonly Offer[]): void {
  fit();
  const spots = spotsAround(ring);
  R.at = ring.map((_, i) => spots.get(i) ?? 0);
  R.came = V.t;
  R.was = ring;
  R.held = null;
  R.buttons = ring.map((offer, i) => {
    const button = el("button", "ring-offer", {
      type: "button",
      "data-ring": i,
      "aria-label": `${nameOf(catalogOf(view), offer.kind)}, holding ${rackName(catalogOf(view), offer.item)}`,
      onclick: () => {
        if (mineNow()) R.take?.(i);
      },
      onpointerenter: (e: Event) => {
        if (e instanceof PointerEvent && e.pointerType === "mouse") R.held = i;
      },
      onpointerleave: () => {
        if (R.held === i) R.held = null;
      },
    });
    link(button, figureRef(offer.kind), { acts: true });
    button.hidden = offer.by !== null;
    return button;
  });
  R.box?.replaceChildren(...R.buttons);
}

/** Whether it is the member's turn to take, by Leaf's clock. */
function mineNow(): boolean {
  const view = R.view();
  return view !== null && turnOf(view, R.now()).at === "choosing";
}

/**
 * The sitting as it is now (`was`, as it was before): a new carousel is laid out; figures taken since
 * fly to whoever took them, the member's own hopping to where it joined their run; and the ring hides
 * outside a carousel.
 */
export function ringHeard(view: SittingView, was: SittingView | null): void {
  const box = R.box;
  if (!box) return;
  const { stage } = view;
  if (stage.at !== "carousel") {
    box.hidden = true;
    R.room = null;
    return;
  }
  box.hidden = false;
  fit();
  const moves = ringMoves(R.room, R.was, view.room, stage.ring);
  if (moves === "lay") {
    R.room = view.room;
    layOut(view, stage.ring);
    return;
  }
  for (const i of moves) {
    const offer = stage.ring[i];
    if (offer) flyOff(view, was?.run ?? null, offer, i);
    if (R.held === i) R.held = null;
  }
  // The ring closes up round what is left; the keyboard stays on a figure still standing.
  const had = R.buttons.findIndex((b) => b === document.activeElement);
  R.was = stage.ring;
  R.buttons.forEach((b, i) => (b.hidden = stage.ring[i]?.by !== null));
  const keep = had < 0 ? null : focusAfter(stage.ring, had);
  if (keep !== null && keep !== had) R.buttons[keep]?.focus({ preventScroll: true });
}

/** A figure taken flies from where it stands to whoever took it. */
function flyOff(view: SittingView, before: RunView | null, offer: Offer, i: number): void {
  const at = spotOf(i);
  if (offer.by === view.you && view.run) {
    // The member's own: the figure itself hops over from the ring to where it joined their run.
    const had = new Set(before ? pieces(before).map((p) => p.id) : []);
    const piece = pieces(view.run).find((p) => !had.has(p.id) && p.kind === offer.kind);
    const pawn = piece ? pawns.get(piece.id) : undefined;
    const spot = spotOfPawn(pawn);
    if (pawn && spot) {
      pawn.x = at.x;
      pawn.y = at.y;
      hop(pawn, spotXY(spot), 0.55, 26, true);
      snd.place();
      return;
    }
  }
  const row = offer.by === null ? null : document.querySelector(`#live-players [data-seat="${offer.by}"]`);
  const to = boardSpot(row) ?? { x: at.x, y: -20 };
  // It leaves standing where it stood, its held mark under it, and lands on its taker's row.
  const { pic, feet } = flyerOf(offer.kind, offer.item);
  fly(pic, { x: at.x, y: at.y - feet + pic.height / 2 }, to, { dur: 0.7, arc: 28 });
}

/** The middle of the ring, from the board's corner: nobody stands there, so words go there. */
export const ringMiddle = (): Pt => ({ x: RING.x, y: RING.y });

/** Hides the ring (stepping back from the table). */
export function hideRing(): void {
  if (R.box) R.box.hidden = true;
  R.room = null;
}

/** The ring as the table draws it this frame: each figure standing at its spot, and its button kept over it. */
function drawRing(g: Ctx): Standing[] {
  const view = R.view();
  const stage = view?.stage;
  if (!view || stage?.at !== "carousel" || !R.up() || R.room !== view.room) return [];
  const dt = Math.max(0, Math.min(0.1, V.t - R.lastT));
  R.lastT = V.t;
  // Under the pointer the ring holds still, turning and closing up alike (`closeUp`).
  const held = R.held !== null;
  if (!held) R.turned += dt * RING.turn;
  const spots = spotsAround(stage.ring);
  R.at = closeUp(R.at, spots, dt, held, CLOSE);
  const mine = turnOf(view, R.now()).at === "choosing";
  R.box?.classList.toggle("mine", mine);
  const places = [...spots.keys()];
  // The buttons stack as the figures are drawn, so a tap where two overlap takes the one in front.
  const stack = stacking(places.map((i) => spotOf(i)));
  return places.flatMap((i, k) => {
    const offer = stage.ring[i];
    const button = R.buttons[i];
    if (button && button.style.zIndex !== String(stack[k])) button.style.zIndex = String(stack[k]);
    return offer ? figureAt(g, view, offer, i, mine) : [];
  });
}

/** One figure of the ring this frame, dropping in as the ring arrives and bobbing while it is the member's turn; its button kept over it. */
function figureAt(g: Ctx, view: SittingView, offer: Offer, i: number, mine: boolean): Standing[] {
  const s = spotOf(i);
  const k = Math.min(1, Math.max(0, (V.t - R.came - i * 0.04) / ARRIVE));
  const lift = (1 - k * k) * 30 + (mine ? Math.abs(Math.sin(V.t * 5 + i)) * 2 : 0);
  const hover = hoverAt(offer.kind, V.t, i / 9);
  placeButton(R.buttons[i], figureBox(s, framesOf(offer.kind).tall + hover, lift), artPx());
  if (k <= 0) return [];
  const draw = (): void => {
    const shown = { hover, beat: beatAt(V.t, i / 9), left: s.left, lit: mine };
    drawStanding(g, catalogOf(view), offer.kind, V.bx + s.x, V.by + s.y - lift, "plain", shown);
    drawHeld(g, heldRow([offer.item], s.x, heldTop(s.y - lift, false)), V.bx, V.by);
  };
  return [{ x: s.x, y: s.y, draw, top: () => {} }];
}

/** Keeps a figure's button over it, where it is drawn this frame (`figureBox`), on the page. */
function placeButton(button: HTMLButtonElement | undefined, box: ReturnType<typeof figureBox>, px: number): void {
  if (!button) return;
  const top = boardToPage(box.x, box.y);
  const w = Math.round(box.w * px);
  const h = Math.round(box.h * px);
  button.style.translate = `${Math.round(top.x)}px ${Math.round(top.y)}px`;
  if (button.style.width !== `${w}px`) button.style.width = `${w}px`;
  if (button.style.height !== `${h}px`) button.style.height = `${h}px`;
}
