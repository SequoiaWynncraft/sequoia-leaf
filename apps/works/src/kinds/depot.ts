/**
 * The depot on the page: nine tiles of the yard's middle, drawn as one building (`scene.ts`, as land);
 * its card opens the orders, the tier and what has come in, and says what the depot pays.
 */
import { DEPOT_SHARE } from "@sequoia-leaf/factory";

import type { KindPage } from "./kind.ts";

export const depot: KindPage = {
  picture: ({ depot: pic }) => pic,
  standing: {
    more: (_art, p, hands) => [
      { label: "Orders", on: () => hands.panel("orders") },
      ...(p.tier !== null ? [{ label: `Tier ${p.tier}`, on: () => hands.panel("tier") }] : []),
      { label: "Items", on: () => hands.panel("depot") },
    ],
    blocks: () => [{ body: `Each thing that arrives pays ${DEPOT_SHARE * 100}% of its worth.` }],
  },
};
