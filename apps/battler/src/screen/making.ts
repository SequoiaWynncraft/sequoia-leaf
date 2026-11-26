/**
 * Questions about items that the screen asks of a run, answered without touching the page: who on
 * the board wants an item, what a figure's card can get for it now, and what letting go of the
 * item in the hand would do. What would happen is asked of the rules themselves, on a copy, so the
 * page never says other than what Leaf will do.
 */
import {
  type ComponentId,
  FINISHED,
  FINISHED_IDS,
  type FinishedId,
  forgeItems,
  giveItem,
  GOOD_WITH,
  HOLDS,
  isComponentId,
  isFinishedId,
  type ItemId,
  legal,
  type Piece,
  type Predicted,
  type RunView,
  type Spot,
  spotOf,
} from "@sequoia-leaf/raid";

/** Whoever holds items: one of the party's figures, or a figure as it would be with nothing. */
export type Holder = Pick<Piece, "kind" | "items">;

/** The loose component a figure holds: the next component handed to it forges with that one. */
const looseOf = (holder: Holder): ComponentId | undefined => holder.items.find(isComponentId);
const isHalf = (item: FinishedId, part: ItemId | undefined): boolean => FINISHED[item].made.some((c) => c === part);

/** Whether a figure has a place for a finished item: a free one, or a loose half of it to forge it in. */
const roomFor = (holder: Holder, item: FinishedId): boolean =>
  holder.items.length < HOLDS || isHalf(item, looseOf(holder));

/** Whether a figure wants a finished item: one of the three that suit it, which it does not hold and has a place for. */
export const wants = (holder: Holder, item: FinishedId): boolean =>
  GOOD_WITH[holder.kind].includes(item) && !holder.items.includes(item) && roomFor(holder, item);

/**
 * The fielded figures that want an item, in the board's order: a finished item, or anything a
 * component makes. Nobody wants an emblem, and the bench wants nothing.
 */
export function wanters(run: Pick<RunView, "board">, item: ItemId): Piece[] {
  const made = isFinishedId(item) ? [item] : FINISHED_IDS.filter((id) => isHalf(id, item));
  return run.board.flatMap((p) => (p && made.some((id) => wants(p, id)) ? [p] : []));
}

// ---------- what a figure's card offers ----------

/**
 * A finished item on a figure's card. It can be had now by handing over a place on the rack (the
 * item itself, `give`, or the half that forges with the half the figure holds, `make`), or by
 * forging two places on the rack and handing the item over. Or it cannot: the figure holds it, has
 * no place for it, or these components are missing.
 */
export type Offer = { readonly item: FinishedId } & (
  | { readonly how: "give" | "make"; readonly give: number }
  | { readonly how: "make"; readonly forge: readonly [number, number] }
  | { readonly how: "needs"; readonly needs: readonly ComponentId[] }
  | { readonly how: "held" | "full" }
);

/** What a figure's card says of a finished item, given what the figure holds and what is on the rack. */
export function offerOf(run: Pick<RunView, "items">, holder: Holder, item: FinishedId): Offer {
  if (holder.items.includes(item)) return { item, how: "held" };
  if (!roomFor(holder, item)) return { item, how: "full" };
  const [a, b] = FINISHED[item].made;
  const loose = looseOf(holder);
  const free = holder.items.length < HOLDS;
  // The item is on the rack already.
  const made = free ? run.items.indexOf(item) : -1;
  if (made >= 0) return { item, how: "give", give: made };
  // It holds one half: the other, handed over, forges with it.
  const other = loose === a ? b : loose === b ? a : undefined;
  const half = other === undefined ? -1 : run.items.indexOf(other);
  if (half >= 0) return { item, how: "make", give: half };
  // Both halves are on the rack: forged there, then handed over.
  const first = run.items.indexOf(a);
  const second = run.items.findIndex((c, at) => c === b && at !== first);
  if (free && first >= 0 && second >= 0) return { item, how: "make", forge: [first, second] };
  // What is at hand for it: the rack, and the half it holds.
  const have: (ItemId | undefined)[] = [...run.items, other === undefined ? undefined : loose];
  const needs = [a, b].filter((part) => {
    const at = have.indexOf(part);
    if (at >= 0) have.splice(at, 1);
    return at < 0;
  });
  return { item, how: "needs", needs };
}
/** The three finished items that suit a figure, as its card offers them. */
export const offersFor = (run: Pick<RunView, "items">, holder: Holder): Offer[] =>
  GOOD_WITH[holder.kind].map((item) => offerOf(run, holder, item));

/** Whether an offer can be had now. */
export const onOffer = (offer: Offer): boolean => offer.how === "give" || offer.how === "make";

/**
 * The commands that get an offer for the figure at a spot, in order: none for one that cannot be
 * had. Where the forged item lands on the rack is asked of the rules.
 */
export function commandsFor(run: RunView, offer: Offer, to: Spot): Predicted[] {
  if ("give" in offer) return [{ do: "give", item: offer.give, to }];
  if (!("forge" in offer)) return [];
  const [item, other] = offer.forge;
  const done = forgeItems(structuredClone(run), item, other);
  const made = done.ok ? done.notes.find((n) => n.t === "made") : undefined;
  if (made?.t !== "made") return [];
  return [
    { do: "forge", item, with: other },
    { do: "give", item: made.at, to },
  ];
}

// ---------- an item in the hand ----------

/** What an item in the hand is aimed at: one of the party's figures, by its number, or another place on the rack. */
export type Aim = { readonly piece: number } | { readonly rack: number };

/** An aim in a word, to tell one from another: `piece:12`, `rack:3`; nothing for none. */
export const aimKey = (aim: Aim | null): string =>
  aim === null ? "" : "piece" in aim ? `piece:${aim.piece}` : `rack:${aim.rack}`;

/** The command that lets the item at a place on the rack go on its aim; null when the figure has gone. */
export function commandOf(run: RunView, at: number, aim: Aim): Predicted | null {
  // On the rack the finished item takes the place it was let go on.
  if ("rack" in aim) return { do: "forge", item: aim.rack, with: at };
  const to = spotOf(run, aim.piece);
  return to ? { do: "give", item: at, to } : null;
}

/** The places on the rack the item at a place would forge with. */
export const pairsOf = (run: RunView, at: number): number[] =>
  run.items.flatMap((_, rack) => (legal(run, { do: "forge", item: rack, with: at }) ? [rack] : []));

/**
 * What letting the item in the hand go on its aim would do: two components become a finished item
 * (on the figure that holds the other, or on the rack); the figure holds it, with so many of its
 * places full then; or nothing, for the reason the rules give.
 */
export type Drop = { readonly command: Predicted } & (
  | { readonly does: "make"; readonly item: FinishedId }
  | { readonly does: "give"; readonly item: ItemId; readonly holds: number }
  | { readonly does: "nothing"; readonly item: ItemId; readonly why: string }
);

/** What letting go would do, asked of the rules on a copy; null where it would do nothing worth a tip. */
export function dropOf(run: RunView, at: number, aim: Aim): Drop | null {
  const item = run.items[at];
  const command = commandOf(run, at, aim);
  if (item === undefined || !command) return null;
  const copy = structuredClone(run);
  if (command.do === "forge") {
    const done = forgeItems(copy, command.item, command.with);
    const made = done.ok ? done.notes.find((n) => n.t === "made") : undefined;
    return made?.t === "made" ? { does: "make", item: made.item, command } : null;
  }
  if (command.do !== "give") return null;
  const done = giveItem(copy, command.item, command.to);
  if (!done.ok) return { does: "nothing", item, why: done.why, command };
  const gave = done.notes.find((n) => n.t === "gave");
  if (gave?.t !== "gave") return null;
  return gave.forged
    ? { does: "make", item: gave.forged, command }
    : { does: "give", item, holds: gave.holds.length, command };
}
