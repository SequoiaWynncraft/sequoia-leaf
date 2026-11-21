/**
 * The member's hand: picking figures up and putting them down, with a mouse or a finger. Anything
 * may be dragged (a figure about the board and bench or onto the stall to sell it, an offer off
 * the stall, an item onto a figure), and anything may be done by tapping instead: tap a thing,
 * then tap where it goes. Resting the pointer on a figure, or keeping a finger on it, says what
 * it is.
 *
 * The hand only works out what was meant and asks the rules to do it; `scene.ts` draws what the
 * hand is holding from the `marks` filled in here.
 */
import { el } from "@sequoia-leaf/kit/dom.ts";
import { unlock } from "@sequoia-leaf/kit/sound.ts";
import { LONG_PRESS } from "@sequoia-leaf/kit/tip.ts";

import {
  buy,
  type FigureId,
  giveItem,
  type ItemId,
  itemName,
  move,
  pieceAt,
  type Run,
  sell,
  sellValue,
  type Spot,
} from "../game/index.ts";
import { itemPic } from "./art/icons.ts";
import { framesOf } from "./art/sprites.ts";
import { unitUnder } from "./fightview.ts";
import { type Handing, handing, pieceNumbers, reachOf, reachOfOffer, startNumbers } from "./logic.ts";
import { hop, type Pawn, pawnAt, pawns, spotAt, spotXY } from "./pawns.ts";
import { foeAt, marks } from "./scene.ts";
import { snd } from "./sounds.ts";
import { artPx, boardToPage, toBoard, V } from "./stage.ts";
import { act, S } from "./state.ts";
import { acorns, cardAt, cardOff, figureCard, forgeCard, itemCard, onCard, pieceCard, plainCard } from "./ui/cards.ts";

type Held =
  | { what: "pawn"; id: number }
  | { what: "offer"; at: number; kind: FigureId }
  | { what: "item"; at: number; item: ItemId };

interface Press {
  held: Held | null;
  x: number;
  y: number;
  touch: boolean;
  moved: boolean;
  /** A finger kept still long enough to be asking what the thing is. */
  asked: boolean;
  timer: number;
}

let press: Press | null = null;
let dragging: Held | null = null;
/** Tapped, and waiting to be told where it goes. */
let picked: Held | null = null;
let canvas: HTMLCanvasElement | null = null;
/** What the resting mouse is on, and the timer for its card. */
let restKey = "";
let restTimer = 0;
const CARD = { hand: true };

/** Whether figures may be moved about just now: planning, with nothing waiting to be chosen. */
export const planning = (): boolean =>
  S.mode === "plan" && S.run !== null && S.run.phase === "plan" && S.run.choices.length === 0;

const spotOfPawn = (id: number): Spot | null => pawns.get(id)?.spot ?? null;
const sameSpot = (a: Spot, b: Spot): boolean => a.on === b.on && a.at === b.at;

/** Where a pawn is on the page, as a box for a card to sit beside. */
function pageBox(x: number, y: number, tall: number): { x: number; y: number; w: number; h: number } {
  const top = boardToPage(x - 9, y - tall - 8);
  const px = artPx();
  return { x: top.x, y: top.y, w: 18 * px, h: (tall + 12) * px };
}

function clearMarks(): void {
  marks.seats = [];
  marks.swaps = [];
  marks.slots = [];
  marks.target = null;
  marks.takers = [];
  marks.taker = -1;
  marks.held = -1;
  marks.ghost = null;
  marks.picked = -1;
  document.body.classList.remove("dragging", "selling", "sell-hot");
}

/** Lights where the thing in the hand, or the thing tapped, may go. */
function light(run: Run, held: Held): void {
  if (held.what === "pawn") {
    const from = spotOfPawn(held.id);
    if (!from) return;
    const reach = reachOf(run, from);
    marks.seats = reach.seats;
    marks.swaps = reach.swaps;
    marks.slots = [...reach.slots, ...reach.slotSwaps];
  } else if (held.what === "offer") {
    const reach = reachOfOffer(run);
    marks.seats = reach.seats;
    marks.slots = reach.slots;
  } else {
    marks.takers = [];
    for (const p of pawns.values()) {
      const piece = p.spot ? pieceAt(run, p.spot) : null;
      if (piece && handing(piece, held.item).can) marks.takers.push(p.id);
    }
  }
}

/** Puts down whatever was tapped, and the card that went with it. */
export function unpick(): void {
  picked = null;
  dragging = null;
  clearMarks();
  cardOff(CARD);
}

function sellButton(run: Run, spot: Spot): HTMLElement | null {
  const piece = pieceAt(run, spot);
  if (!piece) return null;
  return el(
    "button",
    "k-btn wood sm wide",
    {
      type: "button",
      onclick: () => {
        unpick();
        act((r) => sell(r, spot));
      },
    },
    "Sell",
    acorns(`+${sellValue(piece)}`),
  );
}

function showPawnCard(run: Run, p: Pawn, pinned: boolean): void {
  const piece = p.spot ? pieceAt(run, p.spot) : null;
  if (!piece || !p.spot) return;
  const actions = pinned && planning() ? sellButton(run, p.spot) : null;
  cardAt(
    pageBox(p.x, p.y, framesOf(p.kind).tall),
    pieceCard(piece, actions, run, pieceNumbers(run, p.spot)),
    CARD,
    pinned,
  );
}

function pick(run: Run, held: Held): void {
  unpick();
  picked = held;
  light(run, held);
  if (held.what === "pawn") {
    marks.picked = held.id;
    const p = pawns.get(held.id);
    if (p) showPawnCard(run, p, true);
    snd.lift();
  } else if (held.what === "item") {
    const slot = document.querySelector<HTMLElement>(`[data-item="${held.at}"]`);
    slot?.classList.add("lit");
    if (slot) {
      const r = slot.getBoundingClientRect();
      cardAt({ x: r.left, y: r.top, w: r.width, h: r.height }, itemCard(held.item, run, held.at), CARD, true);
    }
    snd.tap();
  }
}

function startDrag(run: Run, held: Held): void {
  cardOff();
  picked = null;
  clearMarks();
  dragging = held;
  light(run, held);
  document.body.classList.add("dragging");
  if (held.what === "pawn") {
    marks.held = held.id;
    const spot = spotOfPawn(held.id);
    const piece = spot ? pieceAt(run, spot) : null;
    const hint = document.getElementById("sellhint");
    if (piece && hint) {
      hint.replaceChildren("Sell for ", acorns(`+${sellValue(piece)}`));
      document.body.classList.add("selling");
    }
  } else if (held.what === "offer") marks.ghost = { kind: held.kind, pic: null };
  else marks.ghost = { kind: null, pic: itemPic(held.item) };
  snd.lift();
}

/** The party's figure an item in the hand is over, if it could take it. */
function takerAt(run: Run, x: number, y: number): Pawn | null {
  const p = pawnAt(run, x, y);
  return p && marks.takers.includes(p.id) ? p : null;
}

function whileDragging(run: Run, e: PointerEvent): void {
  const b = toBoard(e.clientX, e.clientY);
  marks.at = b;
  if (!dragging) return;
  const overShop = document.elementFromPoint(e.clientX, e.clientY)?.closest("#shop") != null;
  if (dragging.what === "item") {
    const p = takerAt(run, b.x, b.y);
    const id = p?.id ?? -1;
    if (id !== marks.taker) {
      marks.taker = id;
      cardOff(CARD);
      const piece = p?.spot ? pieceAt(run, p.spot) : null;
      if (p && piece) {
        const would = handing(piece, dragging.item);
        const says =
          would.can && would.forged
            ? forgeCard(dragging.item, would.with, would.forged)
            : plainCard(`Give ${itemName(dragging.item)}`, `to ${p.kind === "greg" ? "Greg" : "this figure"}.`);
        cardAt(pageBox(p.x, p.y, framesOf(p.kind).tall), says, CARD);
      }
    }
    return;
  }
  marks.target = overShop ? null : spotAt(b.x, b.y);
  document.body.classList.toggle("sell-hot", overShop && dragging.what === "pawn");
}

function drop(run: Run, e: PointerEvent): void {
  const held = dragging;
  const b = toBoard(e.clientX, e.clientY);
  const overShop = document.elementFromPoint(e.clientX, e.clientY)?.closest("#shop") != null;
  const spot = overShop ? null : spotAt(b.x, b.y);
  unpick();
  if (!held) return;
  if (held.what === "pawn") {
    const p = pawns.get(held.id);
    const from = spotOfPawn(held.id);
    if (!p || !from) return;
    // It comes down from where the hand let go of it.
    p.x = b.x;
    p.y = b.y + 6;
    if (overShop) {
      const done = act((r) => sell(r, from));
      if (!done?.ok) hop(p, spotXY(from), 0.2, 6);
      return;
    }
    if (spot && !sameSpot(spot, from)) {
      const done = act((r) => move(r, from, spot));
      if (done?.ok) return;
      if (spot.on === "board") marks.fullAt = V.t;
    }
    hop(p, spotXY(from), 0.2, 6);
    snd.place();
    return;
  }
  if (held.what === "offer") {
    if (overShop) return;
    buyTo(held.at, spot);
    return;
  }
  const taker = takerAt(run, b.x, b.y) ?? pawnAt(run, b.x, b.y);
  if (taker?.spot) {
    const to = taker.spot;
    act((r) => giveItem(r, held.at, to));
  }
}

/** Buys an offer, and if a place was meant, puts the figure there. */
function buyTo(offer: number, spot: Spot | null): void {
  const done = act((r) => buy(r, offer));
  if (!done?.ok || !spot) return;
  const bought = done.notes.find((n) => n.t === "bought");
  const merged = done.notes.some((n) => n.t === "merged");
  if (bought?.t !== "bought" || !bought.to || merged || sameSpot(bought.to, spot)) return;
  const from = bought.to;
  const moved = act((r) => move(r, from, spot));
  if (!moved?.ok && spot.on === "board") marks.fullAt = V.t;
}

/** A tap on the thing that was pressed. */
function tap(run: Run, held: Held | null, e: PointerEvent): void {
  const b = toBoard(e.clientX, e.clientY);
  if (held?.what === "offer") {
    unpick();
    act((r) => buy(r, held.at));
    return;
  }
  if (held?.what === "item") {
    if (picked?.what === "item" && picked.at === held.at) unpick();
    else pick(run, held);
    return;
  }
  if (held?.what === "pawn") {
    const p = pawns.get(held.id);
    const here = p?.spot;
    if (!p || !here) return;
    if (picked?.what === "item") {
      const item = picked.at;
      unpick();
      act((r) => giveItem(r, item, here));
      return;
    }
    if (picked?.what === "pawn") {
      const from = spotOfPawn(picked.id);
      const same = picked.id === held.id;
      unpick();
      if (!same && from) act((r) => move(r, from, here));
      return;
    }
    pick(run, held);
    return;
  }
  // A tap on the bare table: put the tapped thing there, or ask about whoever is waiting.
  const spot = spotAt(b.x, b.y);
  if (picked?.what === "pawn" && spot) {
    const from = spotOfPawn(picked.id);
    unpick();
    if (from) {
      const done = act((r) => move(r, from, spot));
      if (!done?.ok && spot.on === "board") marks.fullAt = V.t;
    }
    return;
  }
  unpick();
  showStranger(run, b.x, b.y, true);
}

/** The card for a figure that is not the party's to move: one waiting across the board, or anyone in a fight. */
function showStranger(run: Run, x: number, y: number, pinned: boolean): boolean {
  if (S.mode === "fight" || S.mode === "after") {
    const u = unitUnder(x, y);
    if (!u) return false;
    cardAt(
      pageBox(u.x, u.y, framesOf(u.unit.kind).tall),
      figureCard(u.unit.kind, u.unit.stars, {
        unit: u.unit,
        whose: u.unit.side === 0 ? "Yours" : `${run.foe.who}'s`,
        run: u.unit.side === 0 ? run : null,
        party: u.unit.side === 1 ? run.foe : null,
      }),
      CARD,
      pinned,
    );
    return true;
  }
  const foe = foeAt(run, x, y);
  if (!foe) return false;
  const placed = run.foe.figures.find((p) => p.seat === foe.seat);
  cardAt(
    { ...boardToPage(x - 9, y - 22), w: 18 * artPx(), h: 30 * artPx() },
    figureCard(foe.kind, foe.stars, {
      items: placed?.items ?? [],
      whose: `${run.foe.who}'s`,
      party: run.foe,
      numbers: startNumbers(run.foe, foe.seat),
    }),
    CARD,
    pinned,
  );
  return true;
}

/** The mouse resting on a figure says what it is, after a moment. */
function rest(run: Run, e: PointerEvent): void {
  if (e.target !== canvas) {
    if (restKey) {
      restKey = "";
      window.clearTimeout(restTimer);
      if (!picked) cardOff(CARD);
    }
    return;
  }
  const b = toBoard(e.clientX, e.clientY);
  const fighting = S.mode === "fight" || S.mode === "after";
  const own = fighting ? null : pawnAt(run, b.x, b.y);
  const unit = fighting ? unitUnder(b.x, b.y) : null;
  const foe = own || fighting ? null : foeAt(run, b.x, b.y);
  const key = own ? `p${own.id}` : unit ? `u${unit.unit.id}` : foe ? `f${foe.seat}` : "";
  if (canvas) canvas.style.cursor = own && planning() ? "grab" : key ? "help" : "default";
  if (key === restKey) return;
  restKey = key;
  window.clearTimeout(restTimer);
  if (picked) return;
  cardOff(CARD);
  if (!key) return;
  restTimer = window.setTimeout(() => {
    if (picked || dragging || !S.run) return;
    if (own) showPawnCard(S.run, own, false);
    else showStranger(S.run, b.x, b.y, false);
  }, 260);
}

function down(e: PointerEvent): void {
  unlock();
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const run = S.run;
  const target = e.target instanceof Element ? e.target : null;
  if (!run || !target || onCard(target)) return;
  window.clearTimeout(restTimer);
  let held: Held | null = null;
  const offerEl = target.closest<HTMLElement>("[data-offer]");
  const itemEl = target.closest<HTMLElement>("[data-item]");
  if (offerEl && planning()) {
    const at = Number(offerEl.dataset.offer);
    const kind = run.stall[at];
    if (kind) held = { what: "offer", at, kind };
  } else if (itemEl && planning()) {
    const at = Number(itemEl.dataset.item);
    const item = run.items[at];
    if (item !== undefined) held = { what: "item", at, item };
  } else if (target === canvas) {
    const b = toBoard(e.clientX, e.clientY);
    marks.at = b;
    const p = planning() ? pawnAt(run, b.x, b.y) : null;
    if (p) held = { what: "pawn", id: p.id };
  } else {
    // Anything else on the page: a button does its own work; the tapped thing is put down.
    if (picked && !target.closest("#shop, #rack")) unpick();
    return;
  }
  const touch = e.pointerType !== "mouse";
  press = { held, x: e.clientX, y: e.clientY, touch, moved: false, asked: false, timer: 0 };
  if (touch) {
    // A finger kept still is asking what the thing is, not using it.
    const mine = press;
    const onTable = target === canvas;
    press.timer = window.setTimeout(() => {
      if (press !== mine || mine.moved || !S.run) return;
      mine.asked = true;
      if (!onTable) return;
      const b = toBoard(mine.x, mine.y);
      const p = pawnAt(S.run, b.x, b.y);
      if (p && !(S.mode === "fight" || S.mode === "after")) showPawnCard(S.run, p, false);
      else showStranger(S.run, b.x, b.y, false);
    }, LONG_PRESS);
  }
}

function moveTo(e: PointerEvent): void {
  const run = S.run;
  if (!run) return;
  if (press && !press.moved) {
    const far = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    if (far > (press.touch ? 9 : 5)) {
      press.moved = true;
      window.clearTimeout(press.timer);
      if (press.held && !press.asked) startDrag(run, press.held);
    }
  }
  if (dragging) whileDragging(run, e);
  else if (!press && e.pointerType === "mouse") rest(run, e);
}

function up(e: PointerEvent): void {
  const run = S.run;
  const was = press;
  press = null;
  if (!was) return;
  window.clearTimeout(was.timer);
  if (!run) return;
  if (dragging) {
    drop(run, e);
    return;
  }
  if (was.asked || was.moved) return;
  if (was.held || e.target === canvas) tap(run, was.held, e);
}

function cancel(): void {
  if (press) window.clearTimeout(press.timer);
  press = null;
  if (dragging) unpick();
}

/** Starts listening to the mouse and to fingers. */
export function openHand(view: HTMLCanvasElement): void {
  canvas = view;
  window.addEventListener("pointerdown", down);
  window.addEventListener("pointermove", moveTo);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", cancel);
  window.addEventListener("keydown", (e) => {
    unlock();
    if (e.key === "Escape") {
      cancel();
      unpick();
    }
  });
  // An offer is a button too: the keyboard buys it.
  document.addEventListener("click", (e) => {
    if (e.detail !== 0 || !planning() || !(e.target instanceof Element)) return;
    const offer = e.target.closest<HTMLElement>("[data-offer]");
    if (offer) act((r) => buy(r, Number(offer.dataset.offer)));
  });
}

/** For looking at the table from outside: picks a figure up as a finger would, or lets go. */
export function grab(id: number | null, at?: { x: number; y: number }): void {
  const run = S.run;
  unpick();
  if (!run || id === null) return;
  startDrag(run, { what: "pawn", id });
  if (at) {
    marks.at = at;
    marks.target = spotAt(at.x, at.y);
  }
}
/** For looking from outside: taps one of the party's figures. */
export function tapPawn(id: number): void {
  if (S.run) pick(S.run, { what: "pawn", id });
}
/** For looking from outside: holds an item over one of the party's figures. */
export function hover(itemAt: number, id: number): void {
  const run = S.run;
  const item = run?.items[itemAt];
  const p = pawns.get(id);
  if (!run || item === undefined || !p) return;
  unpick();
  startDrag(run, { what: "item", at: itemAt, item });
  marks.at = { x: p.x + 4, y: p.y - 12 };
  marks.taker = id;
  const piece = p.spot ? pieceAt(run, p.spot) : null;
  const would: Handing = piece ? handing(piece, item) : { can: false };
  if (would.can && would.forged)
    cardAt(pageBox(p.x, p.y, framesOf(p.kind).tall), forgeCard(item, would.with, would.forged), CARD);
}
