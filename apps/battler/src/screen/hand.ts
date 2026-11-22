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
import { canvasCard, close, hold, onCard, pick as pickCard, point, show, surface } from "@sequoia-leaf/kit/card.ts";
import { unlock } from "@sequoia-leaf/kit/sound.ts";
import { LONG_PRESS } from "@sequoia-leaf/kit/tip.ts";
import { type FigureId, isComponentId, type ItemId, pieceAt, type Run, sellValue, type Spot } from "@sequoia-leaf/raid";

import { itemPic } from "./art/icons.ts";
import { framesOf } from "./art/sprites.ts";
import { unitUnder } from "./fightview.ts";
import { handing, reachOf, reachOfOffer } from "./logic.ts";
import { hop, type Pawn, pawnAt, pawns, spotAt, spotXY } from "./pawns.ts";
import { foeAt, heldUnder, marks } from "./scene.ts";
import { snd } from "./sounds.ts";
import { artPx, boardToPage, toBoard, V } from "./stage.ts";
import { ask, doNow, S } from "./state.ts";
import { acorns, dropRef, foeRef, itemRef, pieceRef, unitRef } from "./ui/cards.ts";

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
/** What the resting mouse is on, as a card's reference. */
let restKey = "";

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
  marks.forging = null;
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
    marks.forging = isComponentId(held.item) ? held.item : null;
    for (const p of pawns.values()) {
      const piece = p.spot ? pieceAt(run, p.spot) : null;
      if (piece && handing(piece, held.item).can) marks.takers.push(p.id);
    }
  }
}

/** Puts down whatever was tapped, and the card that went with it. */
export function unpick(): void {
  const was = dragging;
  picked = null;
  dragging = null;
  clearMarks();
  if (was) {
    show(null);
    hold(false);
  }
  close(canvasCard);
}

/** A box on the page round a pawn, for its card. */
const pawnBox = (p: Pawn): { x: number; y: number; w: number; h: number } => pageBox(p.x, p.y, framesOf(p.kind).tall);

function showPawnCard(run: Run, p: Pawn, pinned: boolean): void {
  const piece = p.spot ? pieceAt(run, p.spot) : null;
  if (!piece || !p.spot) return;
  const b = pawnBox(p);
  if (pinned) pickCard(pieceRef(p.id), b.x, b.y, b.w, b.h);
  else point(pieceRef(p.id), b.x, b.y, b.w, b.h);
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
      pickCard(itemRef(held.item, held.at), r.left, r.top, r.width, r.height);
    }
    snd.tap();
  }
}

function startDrag(run: Run, held: Held): void {
  close();
  hold(true);
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
      const box = p ? pawnBox(p) : null;
      if (p && box) show(dropRef(dragging.at, p.id), box.x, box.y, box.w, box.h);
      else show(null);
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
      const done = doNow({ do: "sell", from });
      if (!done?.ok) hop(p, spotXY(from), 0.2, 6);
      return;
    }
    if (spot && !sameSpot(spot, from)) {
      const done = doNow({ do: "move", from, to: spot });
      if (done?.ok) return;
      if (done && spot.on === "board") marks.fullAt = V.t;
    }
    hop(p, spotXY(from), 0.2, 6);
    snd.place();
    return;
  }
  if (held.what === "offer") {
    if (overShop) return;
    void buyTo(held.at, spot);
    return;
  }
  const taker = takerAt(run, b.x, b.y) ?? pawnAt(run, b.x, b.y);
  if (taker?.spot) {
    const to = taker.spot;
    doNow({ do: "give", item: held.at, to });
  }
}

/** The offer at a place on the stall, as the page shows it: what waits while Leaf answers a purchase. */
const offerAt = (offer: number): Element | null => document.querySelector(`[data-offer="${offer}"]`);

/** Buys an offer (Leaf answers), and if a place was meant, puts the figure there once it is bought. */
async function buyTo(offer: number, spot: Spot | null): Promise<void> {
  const done = await ask({ do: "buy", offer }, offerAt(offer));
  if (!done?.ok || !spot) return;
  const bought = done.notes.find((n) => n.t === "bought");
  const merged = done.notes.some((n) => n.t === "merged");
  if (bought?.t !== "bought" || !bought.to || merged || sameSpot(bought.to, spot)) return;
  const moved = doNow({ do: "move", from: bought.to, to: spot });
  if (moved && !moved.ok && spot.on === "board") marks.fullAt = V.t;
}

/** A tap on the thing that was pressed. */
function tap(run: Run, held: Held | null, e: PointerEvent): void {
  const b = toBoard(e.clientX, e.clientY);
  if (held?.what === "offer") {
    unpick();
    void ask({ do: "buy", offer: held.at }, offerAt(held.at));
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
      doNow({ do: "give", item, to: here });
      return;
    }
    if (picked?.what === "pawn") {
      const from = spotOfPawn(picked.id);
      const same = picked.id === held.id;
      unpick();
      if (!same && from) doNow({ do: "move", from, to: here });
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
      const done = doNow({ do: "move", from, to: spot });
      if (done && !done.ok && spot.on === "board") marks.fullAt = V.t;
    }
    return;
  }
  unpick();
  // Nothing of the party's here: whoever is waiting or fighting here has their card pinned; on bare table, cards are put away.
  if (!showStranger(run, b.x, b.y, true)) close();
}

/** The card for a figure that is not the party's to move: one waiting across the board, or anyone in a fight. */
function showStranger(run: Run, x: number, y: number, pinned: boolean): boolean {
  const found = strangerAt(run, x, y);
  if (!found) return false;
  if (pinned) pickCard(found.ref, found.box.x, found.box.y, found.box.w, found.box.h);
  else point(found.ref, found.box.x, found.box.y, found.box.w, found.box.h);
  return true;
}

/** Someone not the party's to move under a point: in a fight, anyone; while planning, one waiting across the board. */
function strangerAt(
  run: Run,
  x: number,
  y: number,
): { ref: string; box: { x: number; y: number; w: number; h: number } } | null {
  if (S.mode === "fight" || S.mode === "after") {
    const u = unitUnder(x, y);
    return u ? { ref: unitRef(u.unit.id), box: pageBox(u.x, u.y, framesOf(u.unit.kind).tall) } : null;
  }
  const foe = foeAt(run, x, y);
  if (!foe) return null;
  return {
    ref: foeRef(foe.seat),
    box: { ...boardToPage(x - 9, y - 22), w: 18 * artPx(), h: 30 * artPx() },
  };
}

/** What the pointer is on at a point of the table: an item a figure holds, a figure of the party's, or a stranger. */
function cardUnder(
  run: Run,
  x: number,
  y: number,
): { ref: string; box: { x: number; y: number; w: number; h: number } } | null {
  const held = heldUnder(run, x, y);
  if (held) {
    const top = boardToPage(held.x, held.y);
    const px = artPx();
    return { ref: itemRef(held.item), box: { x: top.x, y: top.y, w: held.w * px, h: held.h * px } };
  }
  const fighting = S.mode === "fight" || S.mode === "after";
  const own = fighting ? null : pawnAt(run, x, y);
  if (own) return { ref: pieceRef(own.id), box: pawnBox(own) };
  return strangerAt(run, x, y);
}

/** The mouse resting on a figure, or on an item one holds, says what it is, after a moment. */
function rest(run: Run, e: PointerEvent): void {
  if (e.target !== canvas) {
    if (restKey) {
      restKey = "";
      point(null, 0, 0);
    }
    return;
  }
  const b = toBoard(e.clientX, e.clientY);
  const under = cardUnder(run, b.x, b.y);
  const own = planning() && under?.ref.startsWith("piece:");
  if (canvas) canvas.style.cursor = own ? "grab" : under ? "help" : "default";
  const key = under?.ref ?? "";
  if (key === restKey) return;
  restKey = key;
  if (under) point(under.ref, under.box.x, under.box.y, under.box.w, under.box.h);
  else point(null, 0, 0);
}

function down(e: PointerEvent): void {
  unlock();
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const run = S.run;
  const target = e.target instanceof Element ? e.target : null;
  if (!run || !target || onCard(target)) return;
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
      // A finger kept on a thing asks for its card, pinned, without picking it up.
      const b = toBoard(mine.x, mine.y);
      const under = cardUnder(S.run, b.x, b.y);
      if (under) pickCard(under.ref, under.box.x, under.box.y, under.box.w, under.box.h);
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
  // A press on the table is the hand's to read: the cards do not put themselves away for it.
  surface(view);
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
    if (offer) void ask({ do: "buy", offer: Number(offer.dataset.offer) }, offer);
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
  const would = piece ? handing(piece, item) : null;
  const b = pawnBox(p);
  if (would?.can) show(dropRef(itemAt, id), b.x, b.y, b.w, b.h);
}
