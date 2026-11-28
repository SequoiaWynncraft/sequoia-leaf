/**
 * What the machines that make things by recipes share on the page (the mill, the bench, the
 * workshop): what a card says one makes a minute and can make, and the buttons that tell it one
 * thing to make.
 */
import { type Item, ITEM_INFO, type Kind, MADE_BY, makes } from "@sequoia-leaf/factory";
import type { Action, Row, Stat } from "@sequoia-leaf/kit/card.ts";
import { icon } from "@sequoia-leaf/kit/dom.ts";
import { perMinute } from "@sequoia-leaf/kit/say.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";

import type { Art } from "../art/index.ts";
import type { Hands, MachinePrint, StandingPrint } from "../ui/cards.ts";
import { partsWords } from "../ui/parts.ts";
import { itemRef } from "../ui/refs.ts";
import type { KindPage } from "./kind.ts";

const many = (k: Item): string => ITEM_INFO[k]?.many ?? "";

/**
 * What a machine makes a minute at a grade: from its slowest recipe to its quickest, said as by
 * recipe where they differ. A machine standing says its own, of what it is making (`cards.ts`).
 */
export function makesA(k: Kind, grade: number): Stat {
  const often = (MADE_BY[k] ?? []).map((r) => makes(k, grade, r));
  const [least, most] = [Math.min(...often), Math.max(...often)];
  return { label: least === most ? "Makes" : "Makes, by recipe", value: perMinute([least, most]) };
}

/** What a machine can make, of what is open. */
const canMake = (p: MachinePrint): Row[] => [
  { label: "Can make", things: p.recipes.map((r) => ({ ref: itemRef(r) })) },
];

/** The buttons that tell a machine one thing to make, or anything. */
function recipes(art: Art, p: StandingPrint, hands: Hands): Action[] {
  const { x, y } = p;
  const pick = (item: Item | null): void => {
    hands.act({ do: "recipe", x, y, item });
    sfx.tap();
  };
  return [
    {
      label: "Any recipe",
      look: "slot",
      icon: icon("more"),
      lit: p.set === null,
      hint: "Any recipe",
      about: "It makes whichever item its inputs combine into.",
      on: () => pick(null),
    },
    ...p.machine.recipes.map((out): Action => ({
      label: `Only ${many(out)}`,
      look: "slot",
      icon: art.item(out),
      lit: p.set === out,
      hint: `Only ${many(out)}`,
      about: `From ${partsWords(out)}. It takes in no other item.`,
      on: () => pick(p.set === out ? null : out),
    })),
  ];
}

/** What every machine is on the page but its picture, its drawing, its map colour and its place in the dock. */
export const MACHINE = {
  pointer: "holding",
  pace: makesA,
  rows: canMake,
  standing: { actions: recipes },
  faces: true,
} as const satisfies Partial<KindPage>;
