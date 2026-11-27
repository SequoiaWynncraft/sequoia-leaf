import { framesOf } from "@sequoia-leaf/figures/sprites.ts";
/**
 * The member's hand: picking figures up and putting them down, with a mouse or a finger. Anything
 * may be dragged (a figure about the board and bench or onto the stall to sell it, an offer off
 * the stall, an item onto a figure or onto a component on the rack), and anything may be done by
 * tapping instead: tap a thing, then tap where it goes. An item's aim, carried over or tapped, shows
 * what letting go there would do (`ui/drop.ts`): carried, letting go does it; tapped, the tip's
 * button does. Resting the pointer on a figure, or keeping a finger on it, says what it is; a
 * mouse's click on one of the party's opens its card beside the board.
 *
 * The hand only works out what was meant and asks the rules to do it. What it is doing is one value
 * (`gesture.ts`): a thing tapped, or a thing carried by one pointer, which no other pointer moves or
 * lets go of; `scene.ts` draws the marks worked out from it (`handMarks`).
 */
import {
  canvasCard,
  close,
  deck,
  hold,
  onCard,
  pick as pickCard,
  point,
  show,
  surface,
  type Via,
} from "@sequoia-leaf/kit/card.ts";
import { LONG_PRESS } from "@sequoia-leaf/kit/press.ts";
import { unlock } from "@sequoia-leaf/kit/sound.ts";
import type { RunView, Spot } from "@sequoia-leaf/raid";

import { unitUnder } from "./fightview.ts";
import { BENCH_H, BENCH_X, BENCH_Y, GAP } from "./geometry.ts";
import { type Gesture, type HandEvent, handStep, type Held, IDLE, type Marks, marksOf, tapOf } from "./gesture.ts";
import { type Aim, aimKey, commandOf } from "./making.ts";
import { hop, type Pawn, pawnAt, pawns, spotAt, spotOfPawn, spotXY } from "./pawns.ts";
import { boardFull, foeAt, heldUnder } from "./scene.ts";
import { snd } from "./sounds.ts";
import { artPx, boardToPage, toBoard, V } from "./stage.ts";
import { doNow, onNotes, S } from "./state.ts";
import { dropRef, foeRef, itemRef, pieceRef, unitRef } from "./ui/cards.ts";
import { hearMade, paintRack, rackSlot, registerDrop, seenNow } from "./ui/drop.ts";
import { aimShop, fillShopHint, hearFed, shopCommand } from "./ui/feedtarget.ts";

/** One pointer's press: what was under it, where, whether it has moved or asked what the thing is. */
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

/** What each pointer pressed: two thumbs on the stall at once are two presses. */
const presses = new Map<number, Press>();
/** What the hand is doing: nothing, a thing tapped, or a thing carried by one pointer. */
let gesture: Gesture = IDLE;
let canvas: HTMLCanvasElement | null = null;
/** What the resting mouse is on, as a card's reference. */
let restKey = "";

/** Whether figures may be moved about just now: planning, with nothing waiting to be chosen. */
export const planning = (): boolean =>
  S.screen.at === "plan" && S.run?.stage.phase === "plan" && S.run.stage.picks.length === 0;

const placeOfPawn = (id: number): Spot | null => spotOfPawn(pawns.get(id));
const sameSpot = (a: Spot, b: Spot): boolean => a.on === b.on && a.at === b.at;

/** A box on the page, for a card to sit beside. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a pawn is on the page, as a box for a card to sit beside. */
function pageBox(x: number, y: number, tall: number): Box {
  const top = boardToPage(x - 9, y - tall - 8);
  const px = artPx();
  return { x: top.x, y: top.y, w: 18 * px, h: (tall + 12) * px };
}

/** Moves the hand on, and the page's look with it: something carried, a figure over the stall to sell. */
function hand(ev: HandEvent): void {
  gesture = handStep(gesture, ev);
  const carried = gesture.at === "dragging" ? gesture : null;
  document.body.classList.toggle("dragging", carried !== null);
  document.body.classList.toggle("selling", carried?.held.what === "pawn");
  document.body.classList.toggle("sell-hot", carried?.held.what === "pawn" && carried.shop);
}

let marked: { g: Gesture; run: RunView | null; seen: string; marks: Marks } | null = null;
/**
 * What the table shows of the hand, worked out again only when the hand, the run or what the page
 * says besides (`seenNow`) has changed; the rack is marked with it then. An item in the hand whose
 * place on the rack now holds something else is put down first.
 */
export function handMarks(): Marks {
  const held = gesture.at === "idle" ? null : gesture.held;
  if (held?.what === "item" && S.run?.items[held.at] !== held.item) unpick();
  const seen = seenNow(S.run);
  const key = `${aimKey(seen.aim)}|${seen.item ?? ""}`;
  if (marked?.g !== gesture || marked.run !== S.run || marked.seen !== key) {
    marked = { g: gesture, run: S.run, seen: key, marks: marksOf(gesture, S.run, seen) };
    paintRack(S.run, marked.marks);
  }
  return marked.marks;
}

/** Puts down whatever was tapped or carried, and the card that went with it. */
export function unpick(): void {
  const was = gesture.at === "dragging";
  hand({ e: "clear" });
  if (was) {
    show(null);
    hold(false);
  }
  close(canvasCard);
}

/** A box on the page round a pawn, for its card. */
const pawnBox = (p: Pawn): Box => pageBox(p.x, p.y, framesOf(p.kind).tall);

/** The whole board and bench on the page, and on to the window's right edge: a card beside it goes to its left, clear of the rack. */
function boardBox(): Box {
  const top = boardToPage(BENCH_X, -GAP);
  return { x: top.x, y: top.y, w: window.innerWidth - top.x, h: (BENCH_Y + BENCH_H + GAP) * artPx() };
}

/** Where the aim of an item in the hand is on the page: a figure, or a place on the rack. */
function aimBox(aim: Aim): Box | null {
  if ("piece" in aim) {
    const p = pawns.get(aim.piece);
    return p ? pawnBox(p) : null;
  }
  const r = rackSlot(aim.rack)?.getBoundingClientRect();
  return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
}

/**
 * Pins a card to a box on the page: asked for by keyboard, the card takes the focus. With `side`
 * (a place on the rack) it goes beside it, so the rest of the rack stays in reach.
 */
function pin(ref: string, box: Box, via: Via, side = false): void {
  if (via !== "key" && !side) pickCard(ref, box.x, box.y, box.w, box.h);
  else deck.press(ref, box, via, canvasCard, side);
}

/**
 * Takes a thing in the hand by a tap. Its card is pinned for a mouse only, beside the rack or the
 * board, never over where the next tap goes: a finger's would be a sheet over the board, and a
 * finger kept on the thing asks for it instead; by keyboard, the card that came with the focus is
 * enough, and a pinned one would keep the keyboard from the next component.
 */
function pick(held: Held, via: Via = "touch"): void {
  unpick();
  hand({ e: "pick", held });
  if (held.what === "pawn") {
    snd.lift();
    if (via === "mouse") pin(pieceRef(held.id), boardBox(), via);
  } else if (held.what === "item") {
    const box = aimBox({ rack: held.at });
    if (box && via === "mouse") pin(itemRef(held.item, held.at), box, via, true);
    snd.tap();
  }
}

/**
 * Pins the tip of the item in the hand on its aim: what letting go there would do, and the button
 * that does it. Tapped again with the tip up, the aim lets the item go there, as the button does.
 */
function aimTip(at: number, aim: Aim, via: Via): void {
  const run = S.run;
  const ref = dropRef(at, aim);
  if (run && deck.pinned() === ref) {
    const command = commandOf(run, at, aim);
    unpick();
    if (command) doNow(command);
    return;
  }
  const box = aimBox(aim);
  if (box) pin(ref, box, via, "rack" in aim);
  snd.tap();
}

/** A tap on a place of the rack: the item there is picked up or put down, or the one in the hand is aimed at it. */
function tapItem(held: Extract<Held, { what: "item" }>, via: Via): void {
  const does = tapOf(gesture, handMarks().pairs, { rack: held.at });
  if (does === "down") unpick();
  else if (does === "aim" && gesture.at === "picked" && gesture.held.what === "item")
    aimTip(gesture.held.at, { rack: held.at }, via);
  else pick(held, via);
}

/** Carries a thing off with a pointer (`-1` for one moved from outside), from a point of the board. */
function startDrag(run: RunView, held: Held, pointer: number, at: { x: number; y: number }): void {
  close();
  hold(true);
  fillShopHint(run, held.what === "pawn" ? placeOfPawn(held.id) : null);
  hand({ e: "clear" });
  hand({ e: "carry", pointer, held, x: at.x, y: at.y });
  snd.lift();
}

/**
 * What an item in the hand is over at a point of the page: a component on the rack it pairs with,
 * or one of the party's figures. Anywhere else, letting go does nothing.
 */
function aimAt(run: RunView, e: PointerEvent): Aim | null {
  const slot = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("#rack [data-item]");
  if (slot) {
    const rack = Number(slot.dataset.item);
    return handMarks().pairs.includes(rack) ? { rack } : null;
  }
  const b = toBoard(e.clientX, e.clientY);
  const p = pawnAt(run, b.x, b.y);
  return p ? { piece: p.id } : null;
}

/** The pointer carrying something has moved: it goes with it, and an item says what letting go on its aim would do. */
function whileDragging(run: RunView, e: PointerEvent, carried: Extract<Gesture, { at: "dragging" }>): void {
  const b = toBoard(e.clientX, e.clientY);
  const shop = document.elementFromPoint(e.clientX, e.clientY)?.closest("#shop") != null;
  const aim = carried.held.what === "item" ? aimAt(run, e) : null;
  hand({ e: "move", pointer: carried.pointer, x: b.x, y: b.y, over: shop ? null : spotAt(b.x, b.y), aim, shop });
  aimShop(e, shop);
  if (carried.held.what !== "item" || aimKey(aim) === aimKey(carried.aim)) return;
  const box = aim ? aimBox(aim) : null;
  if (aim && box) show(dropRef(carried.held.at, aim), box.x, box.y, box.w, box.h, "rack" in aim);
  else show(null);
}

/** The pointer carrying something has let go of it. */
function drop(run: RunView, e: PointerEvent, held: Held): void {
  const b = toBoard(e.clientX, e.clientY);
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const overShop = under?.closest("#shop") != null;
  const spot = overShop ? null : spotAt(b.x, b.y);
  // Asked while the item is still in the hand: what it pairs with goes when it is put down.
  const aim = held.what === "item" ? aimAt(run, e) : null;
  unpick();
  if (held.what === "pawn") {
    const p = pawns.get(held.id);
    const from = placeOfPawn(held.id);
    if (!p || !from) return;
    // It comes down from where the hand let go of it.
    p.x = b.x;
    p.y = b.y + 6;
    if (overShop) {
      const done = doNow(shopCommand(from));
      if (!done?.ok) hop(p, spotXY(from), 0.2, 6);
      return;
    }
    const done = spot && !sameSpot(spot, from) ? doNow({ do: "move", from, to: spot }) : undefined;
    if (done?.ok) return;
    if (done && spot?.on === "board") boardFull.at = V.t;
    hop(p, spotXY(from), 0.2, 6);
    // Held off while Leaf answers (null): the refusal sound has said so.
    if (done !== null) snd.place();
    return;
  }
  if (held.what === "offer") {
    // Let go over the stall it goes back, but over its own offer it was a tap that drifted, and buys.
    if (!overShop || under?.closest(`[data-offer="${held.at}"]`)) buyTo(held.at, spot);
    return;
  }
  // Let go on a figure it is handed over, and on a component it pairs with the two are forged; anywhere else, nothing.
  const command = aim ? commandOf(run, held.at, aim) : null;
  if (command) doNow(command);
}

/** Buys an offer, and if a place was meant, puts the figure there. */
function buyTo(offer: number, spot: Spot | null): void {
  const done = doNow({ do: "buy", offer });
  if (!done?.ok || !spot) return;
  const bought = done.notes.find((n) => n.t === "bought");
  const merged = done.notes.some((n) => n.t === "merged");
  if (bought?.t !== "bought" || !bought.to || merged || sameSpot(bought.to, spot)) return;
  const moved = doNow({ do: "move", from: bought.to, to: spot });
  if (moved && !moved.ok && spot.on === "board") boardFull.at = V.t;
}

/** Whether a press was the mouse's or a finger's, as the cards say it. */
const viaOf = (e: PointerEvent): Via => (e.pointerType === "mouse" ? "mouse" : "touch");

/** A tap on the thing that was pressed. */
function tap(run: RunView, held: Held | null, e: PointerEvent): void {
  const b = toBoard(e.clientX, e.clientY);
  const picked = gesture.at === "picked" ? gesture.held : null;
  const via = viaOf(e);
  if (held?.what === "offer") {
    unpick();
    doNow({ do: "buy", offer: held.at });
    return;
  }
  if (held?.what === "item") {
    tapItem(held, via);
    return;
  }
  if (held?.what === "pawn") {
    const here = placeOfPawn(held.id);
    if (!here) return;
    if (picked?.what === "item") {
      aimTip(picked.at, { piece: held.id }, via);
      return;
    }
    const from = picked?.what === "pawn" ? placeOfPawn(picked.id) : null;
    const same = picked?.what === "pawn" && picked.id === held.id;
    unpick();
    // A finger's tap on another figure changes their places. A mouse drags for that: its click on another opens that one.
    if (from && !same && via === "touch") doNow({ do: "move", from, to: here });
    else if (!same) pick(held, via);
    return;
  }
  // A tap on the bare table: put the tapped thing there, or ask about whoever is waiting.
  const spot = spotAt(b.x, b.y);
  if (picked?.what === "pawn" && spot) {
    const from = placeOfPawn(picked.id);
    unpick();
    if (from) {
      const done = doNow({ do: "move", from, to: spot });
      if (done && !done.ok && spot.on === "board") boardFull.at = V.t;
    }
    return;
  }
  unpick();
  // Nothing of the party's here: whoever is waiting or fighting here has their card pinned; on bare table, cards are put away.
  if (!showStranger(run, b.x, b.y, true)) close();
}

/** The card for a figure that is not the party's to move: one waiting across the board, or anyone in a fight. */
function showStranger(run: RunView, x: number, y: number, pinned: boolean): boolean {
  const found = strangerAt(run, x, y);
  if (!found) return false;
  if (pinned) pickCard(found.ref, found.box.x, found.box.y, found.box.w, found.box.h);
  else point(found.ref, found.box.x, found.box.y, found.box.w, found.box.h);
  return true;
}

/** Someone not the party's to move under a point: in a fight, anyone; while planning, one waiting across the board. */
function strangerAt(
  run: RunView,
  x: number,
  y: number,
): { ref: string; box: { x: number; y: number; w: number; h: number } } | null {
  if (S.screen.at === "fight" || S.screen.at === "after") {
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
  run: RunView,
  x: number,
  y: number,
): { ref: string; box: { x: number; y: number; w: number; h: number } } | null {
  const held = heldUnder(run, x, y);
  if (held) {
    const top = boardToPage(held.x, held.y);
    const px = artPx();
    return { ref: itemRef(held.item), box: { x: top.x, y: top.y, w: held.w * px, h: held.h * px } };
  }
  const fighting = S.screen.at === "fight" || S.screen.at === "after";
  const own = fighting ? null : pawnAt(run, x, y);
  if (own) return { ref: pieceRef(own.id), box: pawnBox(own) };
  return strangerAt(run, x, y);
}

/** The mouse resting on a figure, or on an item one holds, says what it is, after a moment. */
function rest(run: RunView, e: PointerEvent): void {
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
    const p = planning() ? pawnAt(run, b.x, b.y) : null;
    if (p) held = { what: "pawn", id: p.id };
  } else {
    // Anything else on the page: a button does its own work; the tapped thing is put down.
    if (gesture.at === "picked" && !target.closest("#shop, #rack")) unpick();
    return;
  }
  const touch = e.pointerType !== "mouse";
  const press: Press = { held, x: e.clientX, y: e.clientY, touch, moved: false, asked: false, timer: 0 };
  presses.set(e.pointerId, press);
  if (touch) {
    // A finger kept still is asking what the thing is, not using it.
    const onTable = target === canvas;
    press.timer = window.setTimeout(() => {
      if (presses.get(e.pointerId) !== press || press.moved || !S.run) return;
      press.asked = true;
      if (!onTable) return;
      // A finger kept on a thing asks for its card, pinned, without picking it up.
      const b = toBoard(press.x, press.y);
      const under = cardUnder(S.run, b.x, b.y);
      if (under) pickCard(under.ref, under.box.x, under.box.y, under.box.w, under.box.h);
    }, LONG_PRESS);
  }
}

function moveTo(e: PointerEvent): void {
  const run = S.run;
  if (!run) return;
  const press = presses.get(e.pointerId);
  if (press && !press.moved) {
    const far = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    if (far > (press.touch ? 9 : 5)) {
      press.moved = true;
      window.clearTimeout(press.timer);
      // One thing is carried at a time: a second finger moving off what it pressed carries nothing.
      if (press.held && !press.asked && gesture.at !== "dragging")
        startDrag(run, press.held, e.pointerId, toBoard(e.clientX, e.clientY));
    }
  }
  if (gesture.at === "dragging") {
    if (gesture.pointer === e.pointerId) whileDragging(run, e, gesture);
  } else if (!press && e.pointerType === "mouse") rest(run, e);
}

function up(e: PointerEvent): void {
  const run = S.run;
  const was = presses.get(e.pointerId);
  presses.delete(e.pointerId);
  if (!was) return;
  window.clearTimeout(was.timer);
  if (was.touch) lifted.at = e.timeStamp;
  if (!run) return;
  // The pointer carrying something puts it down; any other pointer lifted meanwhile does nothing.
  if (gesture.at === "dragging") {
    if (gesture.pointer === e.pointerId) drop(run, e, gesture.held);
    return;
  }
  if (was.asked || was.moved) return;
  if (was.held || e.target === canvas) tap(run, was.held, e);
}

/** When a finger last lifted off something it pressed on the table or the rack, by the events' clock. */
const lifted = { at: -1e9 };

/**
 * A click on the page. One that ends a finger's tap on the table or the rack, and lands on the card
 * that tap has just put up (a sheet now under the finger), is that tap's, not a press on the card:
 * it is dropped. By keyboard (Enter, no pointer), an offer is bought and a place on the rack tapped.
 */
function clicked(e: MouseEvent): void {
  if (e.detail !== 0 && e.timeStamp - lifted.at < 400 && onCard(e.target)) {
    e.stopPropagation();
    e.preventDefault();
    return;
  }
  if (e.detail !== 0 || !planning() || !(e.target instanceof Element)) return;
  const offer = e.target.closest<HTMLElement>("[data-offer]");
  if (offer) doNow({ do: "buy", offer: Number(offer.dataset.offer) });
  const at = Number(e.target.closest<HTMLElement>("#rack [data-item]")?.dataset.item ?? -1);
  const item = S.run?.items[at];
  if (item !== undefined) tapItem({ what: "item", at, item }, "key");
}

/** Calls off one pointer's press, or with none named every one, and what it was carrying. */
function cancel(id?: number): void {
  for (const [at, press] of presses) {
    if (id !== undefined && id !== at) continue;
    window.clearTimeout(press.timer);
    presses.delete(at);
  }
  const carrying = gesture.at === "dragging" && (id === undefined || gesture.pointer === id);
  if (carrying) unpick();
}

/** Puts down whatever is picked or carried, as Escape does (`main.ts`). Says whether there was anything. */
export function letGoHand(): boolean {
  const held = gesture.at !== "idle" || presses.size > 0;
  cancel();
  unpick();
  return held;
}

/** What the hand asks of the page: whether it is paused (the settings menu is up over the table). */
export const handHooks: { paused: () => boolean } = { paused: () => false };

/** Starts listening to the mouse and to fingers. */
export function openHand(view: HTMLCanvasElement): void {
  canvas = view;
  // A press on the table is the hand's to read: the cards do not put themselves away for it.
  surface(view);
  // While the settings menu is up, a press on it is not the table's.
  window.addEventListener("pointerdown", (e) => {
    if (!handHooks.paused()) down(e);
  });
  window.addEventListener("pointermove", moveTo);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", (e) => cancel(e.pointerId));
  window.addEventListener("blur", () => cancel());
  window.addEventListener("keydown", () => {
    unlock();
  });
  // An offer is a button too: the keyboard buys it, and Enter on a place on the rack is a tap on it.
  // Before anything else hears a click, so that one a finger's tap ends on a card it put up is dropped.
  document.addEventListener("click", clicked, true);
  // The tip of an item in the hand: its button lets the item go, and it is in the hand no more.
  registerDrop(unpick);
  onNotes(hearMade);
  onNotes(hearFed);
}

/** For looking at the table from outside: picks a figure up as a finger would, or lets go. */
export function grab(id: number | null, at?: { x: number; y: number }): void {
  const run = S.run;
  unpick();
  if (!run || id === null) return;
  const where = at ?? { x: 0, y: 0 };
  startDrag(run, { what: "pawn", id }, -1, where);
  if (at) hand({ e: "move", pointer: -1, x: at.x, y: at.y, over: spotAt(at.x, at.y), aim: null, shop: false });
}
/** For looking from outside: taps one of the party's figures. */
export function tapPawn(id: number): void {
  if (S.run) pick({ what: "pawn", id });
}
/** For looking from outside: holds an item over its aim, one of the party's figures or a place on the rack. */
export function hover(itemAt: number, aim: Aim): void {
  const run = S.run;
  const item = run?.items[itemAt];
  const box = aimBox(aim);
  if (!run || item === undefined || !box) return;
  unpick();
  const at = toBoard(box.x + box.w / 2, box.y + box.h / 2);
  startDrag(run, { what: "item", at: itemAt, item }, -1, at);
  hand({ e: "move", pointer: -1, x: at.x, y: at.y, over: null, aim, shop: false });
  show(dropRef(itemAt, aim), box.x, box.y, box.w, box.h, "rack" in aim);
}
