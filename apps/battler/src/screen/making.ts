/**
 * Questions about items that the screen asks of a run, answered without touching the page: who on
 * the board wants an item, what a figure's card can get for it now, and what letting go of the
 * item in the hand would do. What would happen is asked of the rules themselves, on a copy, so the
 * page never says other than what Leaf will do.
 */
import {
  type BoonId,
  type Catalog,
  catalogOf,
  type ComponentId,
  countOn,
  type FinishedId,
  forgeItems,
  giveItem,
  GOOD_WITH,
  halvesOf,
  HOLDS,
  isComponentId,
  isEmblemId,
  isFinishedId,
  isItemId,
  isToolId,
  type ItemId,
  kindsOn,
  legal,
  type Note,
  type Piece,
  type PlanningCommand,
  type Predicted,
  type RackItem,
  type RunView,
  type Spot,
  spotOf,
  toolRefusal,
  useTongs,
} from "@sequoia-leaf/raid";

/** Whoever holds items: one of the party's figures, or a figure as it would be with nothing. */
export type Holder = Pick<Piece, "kind" | "items">;

/** The loose component a figure holds: the next component handed to it forges with that one. */
const looseOf = (holder: Holder): ComponentId | undefined => holder.items.find(isComponentId);
const isHalf = (cat: Catalog, item: FinishedId, part: ItemId | undefined): boolean =>
  halvesOf(cat, item).some((c) => c === part);

/** Whether a figure has a place for a finished item: a free one, or a loose half of it to forge it in. */
const roomFor = (cat: Catalog, holder: Holder, item: FinishedId): boolean =>
  holder.items.length < HOLDS || isHalf(cat, item, looseOf(holder));

/** Whether a figure wants a finished item: one of the three that suit it, which it does not hold and has a place for. */
export const wants = (cat: Catalog, holder: Holder, item: FinishedId): boolean =>
  GOOD_WITH[holder.kind].includes(item) && !holder.items.includes(item) && roomFor(cat, holder, item);

/**
 * The fielded figures that want an item, in the board's order: a finished item, or anything a
 * component makes. Nobody wants an emblem, and the bench wants nothing.
 */
export function wanters(run: Pick<RunView, "board" | "era">, item: RackItem): Piece[] {
  if (isToolId(item)) return [];
  const cat = catalogOf(run);
  const made = isFinishedId(item) ? [item] : cat.ids.finished.filter((id) => isHalf(cat, id, item));
  return run.board.flatMap((p) => (p && made.some((id) => wants(cat, p, id)) ? [p] : []));
}

// ---------- what a figure's card offers ----------

/**
 * A finished item on a figure's card. It can be had now by handing over one of a kind on the rack
 * (the item itself, `give`, or the half that forges with the half the figure holds, `make`), or by
 * forging two on the rack and handing the item over. Or it cannot: the figure holds it, has no
 * place for it, or these components are missing.
 */
export type Offer = { readonly item: FinishedId } & (
  | { readonly how: "give" | "make"; readonly give: ItemId }
  | { readonly how: "make"; readonly forge: readonly [ComponentId, ComponentId] }
  | { readonly how: "needs"; readonly needs: readonly ComponentId[] }
  | { readonly how: "held" | "full" }
);

/** Whether one of each of two kinds is on the rack (two, of one kind twice). */
const bothOn = (run: Pick<RunView, "rack">, a: ItemId, b: ItemId): boolean =>
  a === b ? countOn(run.rack, a) >= 2 : countOn(run.rack, a) > 0 && countOn(run.rack, b) > 0;

/** What a figure's card says of a finished item, given what the figure holds and what is on the rack. */
export function offerOf(run: Pick<RunView, "rack" | "era">, holder: Holder, item: FinishedId): Offer {
  const cat = catalogOf(run);
  if (holder.items.includes(item)) return { item, how: "held" };
  if (!roomFor(cat, holder, item)) return { item, how: "full" };
  const [a, b] = halvesOf(cat, item);
  const loose = looseOf(holder);
  const free = holder.items.length < HOLDS;
  // The item is on the rack already.
  if (free && countOn(run.rack, item) > 0) return { item, how: "give", give: item };
  // It holds one half: the other, handed over, forges with it.
  const other = loose === a ? b : loose === b ? a : undefined;
  if (other !== undefined && countOn(run.rack, other) > 0) return { item, how: "make", give: other };
  // Both halves are on the rack: forged there, then handed over.
  if (free && bothOn(run, a, b)) return { item, how: "make", forge: [a, b] };
  // What is at hand for it: the rack, and the half it holds.
  const at = new Map<ItemId, number>([a, b].map((part) => [part, countOn(run.rack, part)]));
  if (other !== undefined && loose !== undefined) at.set(loose, (at.get(loose) ?? 0) + 1);
  const needs = [a, b].filter((part) => {
    const n = at.get(part) ?? 0;
    at.set(part, n - 1);
    return n <= 0;
  });
  return { item, how: "needs", needs };
}
/** The three finished items that suit a figure, as its card offers them. */
export const offersFor = (run: Pick<RunView, "rack" | "era">, holder: Holder): Offer[] =>
  GOOD_WITH[holder.kind].map((item) => offerOf(run, holder, item));

/** Whether an offer can be had now. */
export const onOffer = (offer: Offer): boolean => offer.how === "give" || offer.how === "make";

/** The commands that get an offer for the figure at a spot, in order: none for one that cannot be had. */
export function commandsFor(offer: Offer, to: Spot): Predicted[] {
  if ("give" in offer) return [{ do: "give", item: offer.give, to }];
  if (!("forge" in offer)) return [];
  const [item, other] = offer.forge;
  return [
    { do: "forge", item, with: other },
    { do: "give", item: offer.item, to },
  ];
}

// ---------- an item in the hand ----------

/** What an item in the hand is aimed at: one of the party's figures, by its number, or a kind on the rack. */
export type Aim = { readonly piece: number } | { readonly rack: RackItem };

/** An aim in a word, to tell one from another: `piece:12`, `rack:thorn`; nothing for none. */
export const aimKey = (aim: Aim | null): string =>
  aim === null ? "" : "piece" in aim ? `piece:${aim.piece}` : `rack:${aim.rack}`;

/**
 * The command that lets one of a kind in the hand go on its aim: handed over, or a tool used, on a
 * figure; forged with one of the other kind on the rack. Null when the figure has gone, or for a
 * tool, or a tool's tile, on the rack.
 */
export function commandOf(run: RunView, item: RackItem, aim: Aim): PlanningCommand | null {
  if ("rack" in aim) return isItemId(item) && isItemId(aim.rack) ? { do: "forge", item: aim.rack, with: item } : null;
  const to = spotOf(run, aim.piece);
  if (!to) return null;
  if (item === "tongs") return { do: "tongs", to };
  if (item === "whetstone") return { do: "whetstone", to };
  return { do: "give", item, to };
}

/** The kinds on the rack one of a kind would forge with, each asked of the rules. */
export const pairsOf = (run: RunView, item: RackItem): ItemId[] =>
  isItemId(item)
    ? kindsOn(run.rack).flatMap((other) =>
        isItemId(other) && legal(run, { do: "forge", item: other, with: item }) ? [other] : [],
      )
    : [];

/**
 * What letting the item in the hand go on its aim would do: two items a recipe joins make an item
 * (on the figure that holds the other, or on the rack); the figure holds it, with so many of its
 * places full then; a tool's work; or nothing, for the reason the rules give.
 */
export type Drop = { readonly command: PlanningCommand } & (
  | { readonly does: "make"; readonly item: ItemId }
  /** Two items a recipe makes a boon of (two Knives: An Extra Chair), both used up. */
  | { readonly does: "boon"; readonly item: ItemId; readonly boon: BoonId }
  | { readonly does: "give"; readonly item: ItemId; readonly holds: number }
  /** The Tongs: what the figure holds, all back to the rack. */
  | { readonly does: "tongs"; readonly item: "tongs"; readonly items: readonly ItemId[] }
  /** A Whetstone: what each item becomes is Leaf's to draw, so only how many there are. */
  | { readonly does: "whetstone"; readonly item: "whetstone"; readonly holds: number }
  | { readonly does: "nothing"; readonly item: RackItem; readonly why: string }
);

/** How many items the figure at a spot holds that a Whetstone changes: its components and finished items. */
const pieceHolds = (run: RunView, to: Spot): number =>
  (to.on === "board" ? run.board[to.at] : run.bench[to.at])?.items.filter((i) => !isEmblemId(i)).length ?? 0;

/** What a tool let go on a figure would do: the Tongs as the rules say on a copy, a Whetstone only how many change. */
function toolDrop(run: RunView, command: Extract<PlanningCommand, { do: "tongs" | "whetstone" }>): Drop | null {
  const no = toolRefusal(run, command.do, command.to);
  if (no) return { does: "nothing", item: command.do, why: no.why, command };
  if (command.do === "whetstone")
    return { does: "whetstone", item: "whetstone", holds: pieceHolds(run, command.to), command };
  const done = useTongs(structuredClone(run), command.to);
  const took = done.ok ? done.notes.find((n) => n.t === "tongs") : undefined;
  return took?.t === "tongs" ? { does: "tongs", item: "tongs", items: took.items, command } : null;
}

/** A boon a recipe made, as the notes of a forge or a hand-over say it: both items used up; null for none. */
function boonDrop(notes: readonly Note[], command: PlanningCommand, item: ItemId): Drop | null {
  const made = notes.find((n) => n.t === "boon");
  return made?.t === "boon" ? { does: "boon", item, boon: made.boon, command } : null;
}

/** What letting go would do, asked of the rules on a copy; null where it would do nothing worth a tip. */
export function dropOf(run: RunView, item: RackItem, aim: Aim): Drop | null {
  const command = commandOf(run, item, aim);
  if (countOn(run.rack, item) === 0 || !command) return null;
  if (command.do === "tongs" || command.do === "whetstone") return toolDrop(run, command);
  if (command.do === "forge") return forgeDrop(structuredClone(run), command);
  return command.do === "give" ? giveDrop(structuredClone(run), command) : null;
}
/** Two on the rack forged, on a copy: the item they make, or the boon (two Knives). */
function forgeDrop(copy: RunView, command: Extract<PlanningCommand, { do: "forge" }>): Drop | null {
  const done = forgeItems(copy, command.item, command.with);
  if (!done.ok) return null;
  const made = done.notes.find((n) => n.t === "made");
  const boon = boonDrop(done.notes, command, command.item);
  return boon ?? (made?.t === "made" ? { does: "make", item: made.item, command } : null);
}
/** An item handed over, on a copy: what it makes there (an item or a boon), what the figure then holds, or why not. */
function giveDrop(copy: RunView, command: Extract<PlanningCommand, { do: "give" }>): Drop | null {
  const done = giveItem(copy, command.item, command.to);
  if (!done.ok) return { does: "nothing", item: command.item, why: done.why, command };
  const gave = done.notes.find((n) => n.t === "gave");
  const boon = boonDrop(done.notes, command, command.item);
  if (boon || gave?.t !== "gave") return boon;
  return gave.forged
    ? { does: "make", item: gave.forged, command }
    : { does: "give", item: command.item, holds: gave.holds.length, command };
}
