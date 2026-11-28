/** Where a thing comes from, on its card: the parts it is made from and every machine that makes it, what a mix of it is broken from and by what, or the gatherer and the plots it lies in. */
import { GATHERING, isRaw, makes, MIX_OF, mixPerMinute, mixShare, RECIPE } from "@sequoia-leaf/factory";
import type { Row } from "@sequoia-leaf/kit/card.ts";
import { perMinute } from "@sequoia-leaf/kit/say.ts";

import type { ItemPrint } from "./cards.ts";
import { itemRef, machineRef, plotRef } from "./refs.ts";

/**
 * A thing's rows of where it comes from: what it is made from and in which machines, each with what
 * one of grade 1 makes a minute; for a thing a mix gives, what is broken for it and in what, each with
 * how many of it one of grade 1 gives a minute; or for a thing from the ground, who gathers it and
 * where it lies.
 */
export function madeRows(p: ItemPrint): Row[] {
  const k = p.item;
  const recipe = RECIPE[k];
  const mix = p.makers.map((m) => MIX_OF[m]).find((m) => m?.gives.includes(k));
  if (!recipe && mix)
    return [
      { label: "Broken from", things: [{ ref: itemRef(mix.from) }] },
      {
        label: "In",
        things: p.makers.map((m) => ({ ref: machineRef(m), note: perMinute(mixPerMinute(m, 1) * mixShare(m, k)) })),
      },
    ];
  if (recipe)
    return [
      {
        label: "Made from",
        // A count only where it is more than 1.
        things: recipe.from.map((part, i) => ({
          ref: itemRef(part),
          ...((recipe.need[i] ?? 1) > 1 ? { count: `×${recipe.need[i]}` } : {}),
        })),
      },
      { label: "In", things: p.makers.map((m) => ({ ref: machineRef(m), note: perMinute(makes(m, 1, recipe)) })) },
    ];
  if (!isRaw(k)) return [];
  return [
    { label: "Gathered by", things: [{ ref: machineRef(GATHERING), note: perMinute(makes(GATHERING, 1, null)) }] },
    {
      label: "Lies in",
      things: p.found.map(([plot, tiles, yours]) => ({
        ref: plotRef(plot),
        note: `${tiles} tiles`,
        ...(yours ? { lit: true, tag: "yours" } : {}),
      })),
    },
  ];
}
