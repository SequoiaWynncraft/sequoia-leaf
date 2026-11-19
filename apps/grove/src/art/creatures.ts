import type { RarityId } from "./palette.ts";
import { type Sprite, sprite } from "./sprite.ts";

// The Grove's Sprites: small forest spirits that hatch from sequoia cones and
// live in your grove. Each is drawn by hand at 16 pixels, with big dark eyes
// and a glint, outlined in plum rather than black.

export interface Creature {
  readonly id: string;
  readonly name: string;
  readonly rarity: RarityId;
  readonly blurb: string;
  /** Two frames of an idle bob. */
  readonly frames: readonly [Sprite, Sprite];
}

const MOSSLING_A = sprite([
  ".......hH.......",
  "......hFFh......",
  ".......Fg.......",
  "....ooooooo.....",
  "..ooMnnnnnMoo...",
  ".oMnnnnnnnnnMo..",
  "oMnnzxnnnzxnnMo.",
  "oMnnzznnnzznnMo.",
  "oMnsnnnoonnsnMo.",
  "oMMnnnnnnnnnMMo.",
  ".oMMMMMMMMMMMo..",
  "..ooooooooooo...",
]);

const MOSSLING_B = sprite([
  "................",
  ".......hH.......",
  "......hFFh......",
  ".......Fg.......",
  "...ooooooooo....",
  ".ooMnnnnnnnMoo..",
  "oMnnzxnnnzxnnMo.",
  "oMnnzznnnzznnMo.",
  "oMnsnnnoonnsnMo.",
  "oMMnnnnnnnnnMMo.",
  ".oMMMMMMMMMMMo..",
  "..ooooooooooo...",
]);

const CONELET_A = sprite([
  ".....oooo.......",
  "....oRrrBo......",
  "...oRrBrBbo.....",
  "..oRBrRBrBbo....",
  "..oRrBRrBrbo....",
  "..oRzxrBzxbo....",
  "..oRzzBrzzbo....",
  "..orBsBBsBbo....",
  "...orBBBBbo.....",
  "....obbbbo......",
  "....o.oo.o......",
  "...oo....oo.....",
]);

const CONELET_B = sprite([
  "................",
  ".....oooo.......",
  "....oRrrBo......",
  "...oRrBrBbo.....",
  "..oRBrRBrBbo....",
  "..oRzxrBzxbo....",
  "..oRzzBrzzbo....",
  "..orBsBBsBbo....",
  "...orBBBBbo.....",
  "....obbbbo......",
  "...oo.oo.oo.....",
  "................",
]);

const PUFFCAP_A = sprite([
  "....oooooo......",
  "..ooAAxAAAoo....",
  ".oAAxAAAAxAAo...",
  "oAAAAAAxAAAAAo..",
  "oaAxAAAAAAAAao..",
  "oaaaaaaaaaaaao..",
  ".oooccccccooo...",
  "...occzxczxco...",
  "...occzzczzco...",
  "...ocsccccsco...",
  "...occcCCccco...",
  "....oooooooo....",
]);

const PUFFCAP_B = sprite([
  "................",
  "....oooooo......",
  "..ooAAxAAAoo....",
  ".oAAxAAAAxAAo...",
  "oAAAAAAxAAAAAo..",
  "oaaaaaaaaaaaao..",
  ".oooccccccooo...",
  "...occzxczxco...",
  "...occzzczzco...",
  "...ocsccccsco...",
  "...occcCCccco...",
  "....oooooooo....",
]);

const FERNFOX_A = sprite([
  ".o....o.........",
  "oAo..oAo........",
  "oAAooAAo.....hh.",
  "oAAAAAAAo...hFFh",
  "oAzxAAzxAo..hFF.",
  "oAzzAAzzAo.hFFh.",
  ".oAsAoAsAo.hFh..",
  "..oAAccAAoohF...",
  "..oAccccAAAFh...",
  "..oAAccAAAAo....",
  "..oAo.oAo.o.....",
  "..oo...oo.......",
]);

const FERNFOX_B = sprite([
  ".o....o......hh.",
  "oAo..oAo....hFFh",
  "oAAooAAo....hFF.",
  "oAAAAAAAo..hFFh.",
  "oAzxAAzxAo.hFh..",
  "oAzzAAzzAo.hF...",
  ".oAsAoAsAoohF...",
  "..oAAccAAoFh....",
  "..oAccccAAAo....",
  "..oAAccAAAAo....",
  "..oAo.oAo.o.....",
  "..oo...oo.......",
]);

const GLIMMERWING_A = sprite([
  ".oo........oo...",
  "oyYo..oo..oYyo..",
  "oyyYo.oo.oYyyo..",
  "oyYyYooooYyYyo..",
  ".oyyYoKKoYyyo...",
  "..oyYozxoYyo....",
  "..oyYoKKoYyo....",
  ".oyyYoKKoYyyo...",
  "oyYYo.oo.oYYyo..",
  ".oo...oo...oo...",
]);

const GLIMMERWING_B = sprite([
  "................",
  "................",
  "..oo..oo..oo....",
  ".oyYooooooYyo...",
  "oyyYYoKKoYYyyo..",
  "oyYyYozxoYyYyo..",
  ".oyyYoKKoYyyo...",
  "..oYYoKKoYYo....",
  "...oo.oo.oo.....",
  "......oo........",
]);

const GROOTLING_A = sprite([
  "....oooo........",
  "...oFFFFo.......",
  "..oFhzxFFo......",
  "..oFFzzFFo......",
  "..oFFFFFso......",
  "...oFFFFo.......",
  "....oFFo.oooo...",
  "...oFFFooFFFFo..",
  "..oFFgFFFFggFFo.",
  "..oFgFFoooFFgFo.",
  "...oFFo...oFFo..",
  "....oo.....oo...",
]);

const GROOTLING_B = sprite([
  "................",
  "....oooo........",
  "...oFFFFo.......",
  "..oFhzxFFo......",
  "..oFFzzFFo......",
  "..oFFFFFso......",
  "...oFFFFo.oooo..",
  "...oFFFFooFFFFo.",
  "..oFFgFFFFggFFo.",
  "..oFgFFoooFFgFo.",
  "...oFFo...oFFo..",
  "....oo.....oo...",
]);

const STAG_ROWS = [
  ".o.o.o..........",
  ".oyoyo..........",
  "..oyyo.o.o......",
  "...oyo.oyo......",
  "..ooxxooyo......",
  ".oxzxxxoo.......",
  "oxxxxxWWo.......",
  ".oosxxWo........",
  "...oxxxoooooooo.",
  "...oxxxxxxxxxxWo",
  "...oWxxxxxxxxWWo",
  "....oWxxxxxxWWo.",
  "....oxo.ox.oxo..",
  "....oxo.ox.oxo..",
  "....oQo.oQ.oQo..",
  "....oo..oo.oo...",
];
const STAG_A = sprite(STAG_ROWS);
const STAG_B = sprite(["................", ...STAG_ROWS.slice(0, -1)]);

export const CREATURES: readonly Creature[] = [
  {
    id: "mossling",
    name: "Mossling",
    rarity: "leafkin",
    blurb: "Naps on anything soft. Usually your tree.",
    frames: [MOSSLING_A, MOSSLING_B],
  },
  {
    id: "conelet",
    name: "Conelet",
    rarity: "sapling",
    blurb: "A sequoia cone that never quite opened. Very proud of it.",
    frames: [CONELET_A, CONELET_B],
  },
  {
    id: "puffcap",
    name: "Puffcap",
    rarity: "sprite",
    blurb: "Grows a little taller every time it rains.",
    frames: [PUFFCAP_A, PUFFCAP_B],
  },
  {
    id: "fernfox",
    name: "Fernfox",
    rarity: "dryad",
    blurb: "Its tail is a fern. It knows. It is very smug about it.",
    frames: [FERNFOX_A, FERNFOX_B],
  },
  {
    id: "grootling",
    name: "Grootling",
    rarity: "druid",
    blurb: "Followed a raid party home from the Nest. Do not feed after midnight.",
    frames: [GROOTLING_A, GROOTLING_B],
  },
  {
    id: "glimmerwing",
    name: "Glimmerwing",
    rarity: "treant",
    blurb: "Only comes out at golden hour. Leaves a trail of light.",
    frames: [GLIMMERWING_A, GLIMMERWING_B],
  },
  {
    id: "stag",
    name: "The White Stag",
    rarity: "yggdrasil",
    blurb: "Seen at the edge of the grove when the Great Sequoia blooms.",
    frames: [STAG_A, STAG_B],
  },
];
