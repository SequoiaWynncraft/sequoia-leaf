/**
 * The cards of what lies on the rack that are not the items' own: a tool's (`item:tongs`), and on the
 * card of any kind on the rack, the button that melts one of it for acorns: the keyboard's and a
 * finger's way to the stall's Melt target (`hand.ts`).
 */
import type { Action, Description } from "@sequoia-leaf/kit/card.ts";
import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import { meltValue, type RackItem, type RunView, type ToolId, TOOLS } from "@sequoia-leaf/raid";

import { itemIcon } from "../art/icons.ts";
import { doNow } from "../state.ts";

/** A tool: what it does, and how it is used. */
export function toolDesc(id: ToolId): Description {
  const spec = TOOLS[id];
  return {
    name: spec.name,
    icon: itemIcon(id),
    brief: spec.text,
    tag: "A tool",
    blocks: [{ body: spec.text }, { body: el("i", "k-dim quip", { text: spec.quip }) }],
  };
}

/** The card of a kind on the rack (its tile's, while planning), with the button that melts one of it for acorns. */
export function withMelt(desc: Description, run: RunView | null, id: RackItem, onRack: boolean): Description {
  if (!run || !onRack || run.stage.phase !== "plan") return desc;
  const melting: Action = {
    label: "Melt",
    look: "wood sm wide",
    after: el("span", "k-cur", {}, icon("acorn"), `+${meltValue(id)}`),
    on: () => doNow({ do: "melt", item: id }),
  };
  return { ...desc, actions: [...(desc.actions ?? []), melting] };
}
