/**
 * What a room leaves to pick from when it is fought (`Room.picks`): components, and now and then
 * tools instead (`TOOL_ODDS`). Every draw is the run's own.
 */
import { below, pick, shuffled, type Stream } from "@sequoia-leaf/core";

import { type Catalog, catalogOf, type Era } from "./content/catalog.ts";
import { type ComponentId, drawnComponents, itemIn } from "./content/items.ts";
import { ECONOMY, type RoomKind } from "./content/rooms.ts";
import { TOOL_IDS, TOOL_ODDS, type ToolId } from "./content/tools.ts";
import { slotOf, type Way } from "./way.ts";

/** What a pick of components may offer: a component, or a tool. */
export type Pickable = ComponentId | ToolId;
/** A pick of components (or tools) waiting, as a run keeps it among its picks (`Choice`). */
export type ComponentPick = { kind: "component"; options: Pickable[] };
/** What of a run its picks are drawn from: its stream, its era and its way. */
type Drawing = Stream & { readonly era: Era; readonly way: Way };
/** What of a room its picks are worked out from (`Room`). */
type Leaving = {
  readonly at: number;
  readonly kind: RoomKind;
  readonly picks: { readonly won: number; readonly lost: number };
};

/** So many components on offer, all different, by the run's dice. */
export const componentOptions = (run: Drawing, count: number, cat: Catalog = catalogOf(run)): Pickable[] =>
  shuffled(run, drawnComponents(cat)).slice(0, count);
/** The components that turn up only after a boss is beaten (the Carving Knife), in a catalogue. */
const afterBoss = (cat: Catalog): ComponentId[] =>
  cat.ids.components.filter((id) => itemIn(cat, id).turnsUp === "boss");

/**
 * The picks of components a room leaves (`Room.picks`), with the tools it gives (`TOOL_ODDS`): in an
 * endless run past room 15, every tenth room's first pick is of tools instead (a sparring room, which
 * leaves none, leaves that one); else one boss room in two has a tool in place of one component of
 * its first pick, and one trouble room in ten has its pick of tools instead. The second pick after
 * a boss is beaten has each component that turns up there (the Carving Knife) as one of its options.
 * The dice are the run's; what may be drawn is the catalogue's (`cat`): the era of the fight a room
 * was settled from, never the clock's.
 */
export function roomPicks(run: Drawing, room: Leaving, won: boolean, cat: Catalog = catalogOf(run)): ComponentPick[] {
  const n = won ? room.picks.won : room.picks.lost;
  const count = won ? ECONOMY.componentsWon : ECONOMY.componentsLost;
  const picks = Array.from({ length: n }, (_, i): ComponentPick => {
    const there = won && room.kind === "boss" && i === 1 ? afterBoss(cat) : [];
    return { kind: "component", options: [...componentOptions(run, count - there.length, cat), ...there] };
  });
  const tools: ComponentPick = { kind: "component", options: [...TOOL_IDS] };
  const at = room.at + 1;
  if (slotOf(run.way) === "endless" && at > TOOL_ODDS.endlessPast && at % TOOL_ODDS.endlessEvery === 0)
    return [tools, ...picks.slice(1)];
  const first = picks[0];
  if (!first) return picks;
  if (room.kind === "trouble" && below(run, TOOL_ODDS.trouble) === 0) return [tools, ...picks.slice(1)];
  if (room.kind === "boss" && below(run, TOOL_ODDS.boss) === 0)
    first.options[below(run, first.options.length)] = pick(run, TOOL_IDS);
  return picks;
}
