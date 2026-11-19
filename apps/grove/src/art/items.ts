import { type Sprite, sprite } from "./sprite.ts";

// Things in and around the grove, drawn by hand.

/** Leaf, the currency, drawn like the leaf players already know from the Sequoia mod. */
export const LEAF = sprite([
  "......oo.",
  "....ooHHo",
  "...oHhhFo",
  "..oHhFFGo",
  ".ohhFFGo.",
  "ohFFGGo..",
  "oFGGoo...",
  "oBo......",
  "B........",
]);

/**
 * A sequoia cone. Real sequoia cones stay shut for decades and open in the heat
 * of a fire, which is how they are opened here: by the campfire.
 */
export const CONE_SHUT = sprite([
  ".....oo.....",
  "....oKKo....",
  "...oRrBBo...",
  "..oRrBrBbo..",
  ".oRrBRrBrbo.",
  ".oRBrRBrBbo.",
  ".orBRrBrBbo.",
  ".oRrBrRBbbo.",
  "..orBRBrbo..",
  "..orBrBbbo..",
  "...obBbbo...",
  "....obbo....",
  ".....oo.....",
]);

/** The cone warming: its scales glow at the edges. */
export const CONE_WARM = sprite([
  ".....oo.....",
  "....oKKo....",
  "...oRYBBo...",
  "..oRrBYBbo..",
  ".oRYBRrBYbo.",
  ".oRBrRBYBbo.",
  ".oYBRrBrBYo.",
  ".oRrBYRBbbo.",
  "..orBRBYbo..",
  "..oYBrBbbo..",
  "...obBYbo...",
  "....obbo....",
  ".....oo.....",
]);

/** The cone open, scales splayed, a seed of light at its heart. */
export const CONE_OPEN = sprite([
  "..o..oo..o..",
  ".oRo.oKo.oRo",
  ".oRBooKooBRo",
  "..oRBoooBRo.",
  "oo.oByyyBo.o",
  "oRBoyxxxyoBR",
  ".oRByxxxyBRo",
  "oo.oByyyBo.o",
  "..oRBoooBRo.",
  ".oRBo.o.oBRo",
  ".oRo..o..oRo",
  "..o..obo..o.",
  ".....oo.....",
]);

export const CAMPFIRE = [
  sprite([
    "......y.......",
    ".....yY.......",
    "....yYAy......",
    "...yYAAYy.....",
    "...YAaaAY.y...",
    "..yAaaaaAYY...",
    "..YAaYYaaAy...",
    ".oKYAaaaAYKo..",
    "oKKKoKKoKKKKo.",
    ".ooBBooBBoo...",
    "oooooooooooo..",
  ]),
  sprite([
    ".......y......",
    "......Yy......",
    ".....yAYy.....",
    "...y.YAAY.....",
    "...YyAaaAY....",
    "...YAaaaaAy...",
    "..yAaaYYaAY...",
    ".oKYAaaaAYKo..",
    "oKKKoKKoKKKKo.",
    ".ooBBooBBoo...",
    "oooooooooooo..",
  ]),
] as const;

export const WATERING_CAN = sprite([
  "....oooo.......",
  "...oq..qo......",
  "...o....o......",
  ".ooooooooo...oo",
  "oqQQQQQQqPo.oqo",
  "oqQqqqqqqPooqo.",
  "oqqqqqqqqPPqo..",
  "oqqqqqqqqPpo...",
  "oPPPPPPPPpo....",
  ".oooooooooo....",
]);

export const SHEARS = sprite([
  "oo.....oo",
  "oQo...oQo",
  ".oQo.oQo.",
  "..oQoQo..",
  "...oqo...",
  "..oKoKo..",
  ".oKo.oKo.",
  "oaao.oaao",
  "oaao.oaao",
  ".oo...oo.",
]);

/** A paper lantern for the grove at night. */
export const LANTERN = sprite([
  "...oo...",
  "...oo...",
  "..oKKo..",
  ".oyyyyo.",
  "oyYxxYyo",
  "oYyxxyYo",
  "oyYyyYyo",
  ".oYYYYo.",
  "..oKKo..",
  "...oo...",
]);

export const MUSHROOMS = sprite([
  "..ooo.......",
  ".oAxAo......",
  "oAAAAAo.ooo.",
  "oaaaaaooAxAo",
  ".oocoo.oAAAo",
  "..oco..oaaao",
  "..oco...oco.",
  "MnoconM.ocon",
]);

export const BIRDHOUSE = sprite([
  "....oo....",
  "...oaao...",
  "..oaAAao..",
  ".oaAAAAao.",
  "oaaaaaaaao",
  ".oCCkkCCo.",
  ".oCkookCo.",
  ".oCkookCo.",
  ".oCCCCCCo.",
  ".ooooooooo",
  "....oKo...",
  "....oKo...",
]);

export const WIND_CHIME = sprite([
  "....oo....",
  "..ooKKoo..",
  ".oKKKKKKo.",
  "..o.o.o...",
  "..o.o.o...",
  ".oQoQ.oQo.",
  ".oqoqooqo.",
  ".oqo.o.qo.",
  "..o..oo...",
  ".....oVo..",
  ".....oo...",
]);

/** A low wooden stand the bonsai sits on. */
export const STAND = sprite([
  "ooooooooooooooooooooooooooooooooooooooo",
  "oCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCo",
  "okkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkko",
  "oKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKo",
  "ooooooooooooooooooooooooooooooooooooooo",
  "..oKko...........................oKko..",
  "..oKko...........................oKko..",
  "..oKko...........................oKko..",
  "..oKko...........................oKko..",
  "..oooo...........................oooo..",
]);

/** A shepherd's hook to hang a lantern or a chime from. */
export const HOOK_POST = sprite([
  "..oooo...",
  ".oKKKKo..",
  "oKo..oKo.",
  "oKo...o..",
  "oKo......",
  ...Array.from({ length: 30 }, () => "oKo......"),
  "oKo......",
  "MnM......",
]);

export const DECORATIONS: readonly { id: string; name: string; sprite: Sprite; price: number }[] = [
  { id: "lantern", name: "Paper lantern", sprite: LANTERN, price: 600 },
  { id: "mushrooms", name: "Puffcap ring", sprite: MUSHROOMS, price: 350 },
  { id: "birdhouse", name: "Birdhouse", sprite: BIRDHOUSE, price: 900 },
  { id: "chime", name: "Glass wind chime", sprite: WIND_CHIME, price: 1_200 },
];
