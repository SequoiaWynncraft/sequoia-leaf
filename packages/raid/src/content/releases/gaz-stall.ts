/**
 * The first banner's headliner on everyone's stall, open on merge: from this era, while its banner
 * is open, every way with everyone's figures sells it at five acorns, its regulars bring it and its
 * carousel has it (`Figure.everyones`), with no level. The eras before this one are live at no
 * moment, so their stored runs keep it to whoever pulled it. A run with the member's own figures
 * sells it only to whoever pulled it, at its level. Made for a prize, it was stronger than everyone's other five-acorn figures; here it sits
 * among them, between Vesta and Greg (`review/swap.ts`): a shorter stun, less damage, and less mana
 * to start a fight with out of a larger bar.
 */
import type { Patch } from "../patch.ts";

export const GAZ_STALL: Patch = {
  release: "gaz-stall",
  figures: {
    change: {
      "banner-1": {
        mana: [30, 90],
        // An ability is replaced whole: only its numbers differ from the base's.
        ability: {
          name: "I heard you weren't graiding.",
          shape: "bolt",
          text: "Picks the enemy who has taken the least damage so far, wherever they are, and stuns them for {stun} seconds. If several have taken the same, it picks the one who has dealt the least. One second later, {damage} magic damage to them and to every enemy touching them.",
          n: { stun: [1.5, 2, 3], damage: [370, 640, 1450] },
          short: "Stuns enemy with least damage taken {stun}s. 1s later, {damage} magic to them and those touching.",
        },
      },
    },
  },
};
