/**
 * Where a thing comes from, on its card: the parts it is made from and every machine that makes it,
 * what a mix of it is broken or distilled from and by what (by which way out, where each sends one
 * thing), what it is grown from and in what, or the gatherer and the plots it lies in.
 */
import {
  GATHERING,
  gathers,
  GROW_OF,
  isRaw,
  type Item,
  type Kind,
  makersOf,
  makes,
  MIX_OF,
  mixPerMinute,
  mixShare,
  outsAs,
  RECIPE,
  wayNames,
} from "@sequoia-leaf/factory";
import type { Entry, Row } from "@sequoia-leaf/kit/card.ts";
import { perMinute } from "@sequoia-leaf/kit/say.ts";

import type { ItemPrint } from "./cards.ts";
import { itemRef, machineRef, plotRef } from "./refs.ts";

/** A machine that gives a thing of its mix, with how many one of grade 1 gives a minute, and the way out it leaves by where each sends one thing. */
function mixer(m: Kind, k: Item): Entry {
  const outs = outsAs(m, 0);
  const way = outs.findIndex((o) => o.only === k);
  return {
    ref: machineRef(m),
    note: perMinute(mixPerMinute(m, 1) * mixShare(m, k)),
    ...(way < 0 ? {} : { tag: `${wayNames(outs.length)[way] ?? ""} way out` }),
  };
}

/**
 * A thing's rows of where it comes from: what it is made from and in which machines, each with what
 * one of grade 1 makes a minute; for a thing a mix gives, what is broken or distilled for it and in
 * what, each with how many of it one of grade 1 gives a minute, first where its recipes only turn one
 * of the mix's things into another (creosote from pitch); or for a thing from the ground, who gathers
 * it and where it lies.
 */
export function madeRows(p: ItemPrint): Row[] {
  const k = p.item;
  const recipe = RECIPE[k];
  const mix = p.makers.map((m) => MIX_OF[m]).find((m) => m?.gives.includes(k));
  const mixers = mix ? p.makers.filter((m) => MIX_OF[m] === mix) : [];
  const mixed: Row[] = mix
    ? [
        { label: mix.madeFrom, things: [{ ref: itemRef(mix.from) }] },
        { label: "In", things: mixers.map((m) => mixer(m, k)) },
      ]
    : [];
  if (recipe) {
    const made: Row[] = [
      {
        label: "Made from",
        // A count only where it is more than 1.
        things: recipe.from.map((part, i) => ({
          ref: itemRef(part),
          ...((recipe.need[i] ?? 1) > 1 ? { count: `×${recipe.need[i]}` } : {}),
        })),
      },
      {
        label: "In",
        things: p.makers
          .filter((m) => !mixers.includes(m))
          .map((m) => ({ ref: machineRef(m), note: perMinute(makes(m, 1, recipe)) })),
      },
    ];
    return mix && recipe.from.every((part) => mix.gives.includes(part)) ? [...mixed, ...made] : [...made, ...mixed];
  }
  if (mix) return mixed;
  if (!isRaw(k)) return [];
  return [...grownRows(p), ...gatheredRows(p)];
}

/**
 * For a thing a piece grows (star crystal): what it is grown from, and the kinds that grow it, each
 * with what one of grade 1 nets a minute, named before it is researched; nothing for any other.
 */
function grownRows(p: ItemPrint): Row[] {
  const plan = makersOf(p.item).find((r) => GROW_OF[r.by]);
  const grow = plan ? GROW_OF[plan.by] : null;
  if (!plan || !grow) return [];
  return [
    { label: "Grown from", things: grow.takes.map((n) => ({ ref: itemRef(n) })) },
    {
      label: "In",
      things: p.makers
        .filter((m) => GROW_OF[m])
        .map((m) => ({ ref: machineRef(m), note: perMinute(makes(m, 1, plan)) })),
    },
  ];
}

/** For a thing from the ground: who gathers it, at its own pace, and where it lies. */
function gatheredRows(p: ItemPrint): Row[] {
  return [
    { label: "Gathered by", things: [{ ref: machineRef(GATHERING), note: perMinute(gathers(p.item, 1)) }] },
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
