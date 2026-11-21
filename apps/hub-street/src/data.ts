/**
 * Everything said and sold on the street, and the member's own purse. All of it is stand-in: no
 * server is asked anything. The handles are invented; nobody real is named.
 */
import type { PlaceId } from "./world.ts";

export const HANDLES = [
  "Mosswhistle",
  "Bramblewick",
  "Oatmoss",
  "Quillfeather",
  "Thimblerig",
  "Wobblecap",
  "Nettlekin",
  "Emberfoot",
  "Dewdrop",
] as const;

export const RANKS = ["Seedling", "Sapling", "Ranger", "Warden", "Elder"] as const;

export const LINES: readonly string[] = [
  "Evening!",
  "Good haul tonight.",
  "Smells like pine and victory.",
  "Anyone seen my other boot?",
  "I love it here.",
  "Raid at dusk? Raid at dusk.",
  "The lanterns are pretty tonight.",
  "I was promised snacks.",
  "Just one more quest…",
  "Who moved my stump?",
  "My Leaf is burning a hole in my pocket.",
  "Did we win? We won, right?",
  "Mind the roots.",
  "I'm not lost. I'm exploring.",
];

export const PLACE_LINES: Record<PlaceId, readonly string[]> = {
  camp: ["Which way is my tent again?", "Left. Probably left."],
  quests: ["Ooh, a new notice.", "Three raids? Easy.", "Who pinned a soup recipe here?"],
  treasury: ["Cinfy, do you take IOUs?", "One firefly jar, please.", "Ooh, shiny."],
  market: ["Is this scarf singed?", "How much for just the bucket?", "I'll take the poem."],
  fire: ["Budge up.", "Toasty.", "Sing the one about the boat!", "My marshmallow is on fire."],
  works: ["It goes clank. I like it.", "What does this lever do?", "So many gears."],
  pond: ["I count eleven. Again.", "One of them winked at me.", "Clack clack to you too.", "Where does it GO?"],
};

export const GREETINGS: readonly string[] = [
  "Welcome back!",
  "Hey, you made it!",
  "Look who's home!",
  "There you are!",
];
export const HELLOS: readonly string[] = ["Evening!", "Oh, hello!", "Hi hi!", "Hey you.", "Nice hat. Wait."];
export const CHEERS: readonly string[] = ["Huzzah!", "Let's go!", "For the grove!", "Woo!", "Yesss!", "That's us!"];
export const CINFY_LINES: readonly string[] = [
  "Evening! Fresh stock.",
  "No refunds. Only regrets.",
  "Leaf well spent is Leaf well spent.",
  "Careful, that one's shiny.",
  "Buy something, or admire quietly.",
];
export const CINFY_THANKS: readonly string[] = [
  "Pleasure doing business!",
  "A fine choice.",
  "Catch!",
  "It suits you.",
];
export const CINFY_NO: readonly string[] = [
  "Come back with more Leaf, friend.",
  "Ah. A little short.",
  "The raids pay well, I hear.",
];

export const RAIDS: readonly string[] = [
  "the Hollow of Echoes",
  "the Sunken Orchard",
  "the Lantern Mines",
  "Thornkeep",
  "the Glass Cellars",
  "the Drowned Bell",
];
export const TERRITORIES: readonly string[] = [
  "Mistwood Crossing",
  "Fernhollow",
  "Cinderbrook",
  "Old Root Gate",
  "Honeywater Ford",
  "Starling Rise",
  "Bracken Steps",
  "Owlwatch",
];

export type WareId = "jar" | "cap" | "lantern";
export interface Ware {
  readonly id: WareId;
  readonly name: string;
  readonly icon: string;
  readonly price: number;
  readonly blurb: string;
}
export const WARES: readonly Ware[] = [
  { id: "jar", name: "Firefly jar", icon: "jar", price: 40, blurb: "Three fireflies that follow you about." },
  { id: "cap", name: "Acorn cap", icon: "cap", price: 90, blurb: "A hat. It is an acorn. It suits you." },
  {
    id: "lantern",
    name: "A lantern in your name",
    icon: "lantern",
    price: 160,
    blurb: "Hung over the Treasury door for all to see.",
  },
];

export interface Quest {
  readonly id: string;
  readonly title: string;
  readonly need: number;
  readonly unit: string;
  readonly reward: number;
  /** Seconds until it closes, for a timed one; 0 for the others. */
  closes: number;
  have: number;
  claimed: boolean;
}

export interface Listing {
  readonly seller: string;
  readonly item: string;
  readonly icon: string;
  readonly price: number;
  readonly note: string;
  /** Which stall it lies on. */
  readonly stall: number;
  bought: boolean;
}

export const CRAB_NAMES: readonly string[] = [
  "the eldest",
  "sideways",
  "the loud one",
  "pinchy",
  "also pinchy",
  "the philosopher",
  "last seen somewhere",
  "the small one",
  "the other small one",
  "wears a pebble",
  "the tall one",
  "new here",
];

export interface FeedItem {
  readonly icon: string;
  readonly text: string;
  readonly at: number;
}

/** The member's own state on the street. One of them, changed in place. */
export const me = {
  name: "You",
  rank: "Warden",
  level: 64,
  xp: 0.62,
  leaf: 214,
  coins: 1280,
  owned: new Set<WareId>(),
  seated: false,
  raidsThisWeek: 7,
  quests: [
    {
      id: "raids",
      title: "Clear three raids with guild-mates",
      need: 3,
      unit: "",
      reward: 25,
      closes: 0,
      have: 3,
      claimed: false,
    },
    {
      id: "hold",
      title: "Help hold a territory for an hour",
      need: 60,
      unit: " min",
      reward: 40,
      closes: 0,
      have: 38,
      claimed: false,
    },
    {
      id: "lanterns",
      title: "Guild-wide: light twelve lanterns",
      need: 12,
      unit: "",
      reward: 15,
      closes: 4360,
      have: 10,
      claimed: false,
    },
  ] as Quest[],
  listings: [
    {
      seller: "Mosswhistle",
      item: "Hand-carved crab whistle",
      icon: "whistle",
      price: 30,
      note: "The crabs cannot hear it.",
      stall: 0,
      bought: false,
    },
    {
      seller: "Oatmoss",
      item: "Warm scarf, slightly singed",
      icon: "scarf",
      price: 12,
      note: "Fire-tested.",
      stall: 0,
      bought: false,
    },
    {
      seller: "Quillfeather",
      item: "A poem about you, to order",
      icon: "poem",
      price: 20,
      note: "A service. Rhymes extra.",
      stall: 1,
      bought: false,
    },
    {
      seller: "Wobblecap",
      item: "Bucket of green stones",
      icon: "bucket",
      price: 45,
      note: "Bucket not included.",
      stall: 1,
      bought: false,
    },
  ] as Listing[],
  /** Which crab is missing just now, counted from 1; and how many the member has found. */
  missing: 7,
  found: 0,
  feed: [] as FeedItem[],
};

export const AWAY = {
  raids: 3,
  leaf: 38,
  coins: 412,
  visitors: [0, 2] as readonly number[],
};
