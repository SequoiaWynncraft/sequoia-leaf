/**
 * Who lives in the town: its creatures and its keepers. None of them is a member and none is ever
 * drawn in a player's skin. Each is one of the town's own sprites (a cat, a glorp, the fox, a gnome
 * in a coloured hat), says what it is where a member's card says a rank, and wherever it is named
 * carries the town's mark (the kit's `mark.ts`). Real members come only from the guild, and the
 * crabs live in the pond (both the town page's). Who calls at a camp and what they bring is here
 * too, for the rules (`game.ts`).
 */

/** Which of the town's own sprites somebody is drawn as. */
export type FolkKind = "gnome" | "cat" | "glorp" | "fox";

export type FolkId = "cinfy" | "sootpaw" | "bramblewick" | "tindra" | "pipwick" | "mossback" | "embertoe" | "fox";

/** What somebody does with their evening in town. */
export type Job =
  /** Behind the Treasury's counter. */
  | "counter"
  /** Keeping one of the market's stalls (by its place in the row); `naps` keeps it asleep, mostly. */
  | { stall: number; naps: boolean }
  /** Out and about: counting the crabs, reading the board, minding the gate. */
  | "errands"
  /** Sitting by the fire. */
  | "fire"
  /** Between the fire and the Works' door. */
  | "between"
  /** Never in town: only ever seen calling at a camp. */
  | "calls";

/** Where Pipwick goes on an errand, and what it is called on a card. */
export type Errand = "crabs" | "board" | "gate";

export interface Townsperson {
  id: FolkId;
  name: string;
  /** What it is, said where a member's card says their rank. */
  what: string;
  kind: FolkKind;
  /** Which coat, colour or hat: a cat's coat, a glorp's colour, a gnome's hat (see `folkart.ts`). */
  hue: number;
  /** How high its voice is, for the blips when it speaks. */
  voice: number;
  job: Job;
  /** What it says to itself while busy, and to somebody passing. */
  chatter: readonly string[];
  greets: readonly string[];
  /** What it says when the guild has something to cheer about, or somebody waves. */
  cheers: readonly string[];
  waves: readonly string[];
}

/** A gnome's hats, as `folkart.ts` draws them. */
export const HAT = { red: 0, gold: 1, blue: 2, green: 3 } as const;
/** A cat's coats and a glorp's colours, as the camp's pets come in them (`campart.ts`). */
export const COAT = { ginger: 0, black: 1 } as const;
export const GLORP = { green: 2 } as const;

const GNOME_HI = ["hi!", "oh hey!", "evening!", "you're back!"] as const;
const GNOME_CHEER = ["huzzah!", "glory to the grove!", "woo!", "gg!"] as const;
const CAT_HI = ["mrrp.", "meow.", "mrrp?"] as const;
const CAT_CHEER = ["meow!", "mrrp!!", "MEOW."] as const;

export const FOLK: readonly Townsperson[] = [
  {
    id: "cinfy",
    name: "Cinfy",
    what: "Keeper of the Treasury",
    kind: "gnome",
    hue: HAT.gold,
    voice: 520,
    job: "counter",
    chatter: [],
    greets: ["Mind the gold."],
    cheers: ["Good for business!", "That's my guild."],
    waves: ["o/", "Hello. Buy something."],
  },
  {
    id: "sootpaw",
    name: "Sootpaw",
    what: "The town's cat, and a stallkeeper",
    kind: "cat",
    hue: COAT.black,
    voice: 880,
    job: { stall: 0, naps: true },
    chatter: ["no refunds. meow.", "one careful owner", "it's probably not haunted", "meow", "zzz. mrrp."],
    greets: CAT_HI,
    cheers: CAT_CHEER,
    waves: ["...", "mrrp.", "*one slow blink*"],
  },
  {
    id: "bramblewick",
    name: "Bramblewick",
    what: "Stallkeeper, and a gnome",
    kind: "gnome",
    hue: HAT.red,
    voice: 340,
    job: { stall: 1, naps: false },
    chatter: [
      "carried it here myself!",
      "good choice. sat on it all morning.",
      "mind the splinters",
      "every seat tested. by me.",
      "the rugs are fresh. mostly.",
    ],
    greets: GNOME_HI,
    cheers: GNOME_CHEER,
    waves: ["o/", "hi hi!", "\\o/"],
  },
  {
    id: "tindra",
    name: "Tindra",
    what: "Stallkeeper, and a gnome",
    kind: "gnome",
    hue: HAT.green,
    voice: 680,
    job: { stall: 2, naps: false },
    chatter: [
      "water it. or don't. it's hardy.",
      "I grew that one!",
      "it likes being talked to",
      "I did the corners twice.",
      "the ferns are loud tonight",
    ],
    greets: GNOME_HI,
    cheers: GNOME_CHEER,
    waves: ["o/", "heya!", "\\o/"],
  },
  {
    id: "pipwick",
    name: "Pipwick",
    what: "A gnome on errands",
    kind: "gnome",
    hue: HAT.blue,
    voice: 760,
    job: "errands",
    chatter: ["busy busy", "erm", "has anyone seen crab 7?", "be nice", "leafin' it up"],
    greets: GNOME_HI,
    cheers: GNOME_CHEER,
    waves: ["o/", "hi hi!", "\\o/"],
  },
  {
    id: "mossback",
    name: "Mossback",
    what: "A glorp, of the fire",
    kind: "glorp",
    hue: GLORP.green,
    voice: 300,
    job: "fire",
    chatter: ["glorp.", "glorp.", "glorp?", "...glorp."],
    greets: ["glorp!"],
    cheers: ["glorp!!", "GLORP."],
    waves: ["glorp."],
  },
  {
    id: "embertoe",
    name: "Fika",
    what: "The Works' cat",
    kind: "cat",
    hue: COAT.ginger,
    voice: 420,
    job: "between",
    chatter: [
      "the belt is warm. meow.",
      "clank. clank. meow.",
      "warm by the fire. warmer by the Works.",
      "I can fix that. meow.",
      "mind the brazier. it bites.",
      "someone took my planks",
    ],
    greets: CAT_HI,
    cheers: CAT_CHEER,
    waves: ["mrrp.", "*tail up*"],
  },
  {
    id: "fox",
    name: "Orphion",
    what: "A white fox with golden antlers",
    kind: "fox",
    hue: 0,
    voice: 640,
    job: "calls",
    chatter: ["*sniff*", "*sniff sniff*", "..."],
    greets: ["*yip*"],
    cheers: ["*yip yip*"],
    waves: ["*a small bow*"],
  },
];

/** One of the town's own, by its name; nothing for anybody else. */
export const folkNamed = (name: string): Townsperson | null => FOLK.find((t) => t.name === name) ?? null;

/** Whether a name is one of the town's own. */
export const isFolk = (name: string): boolean => folkNamed(name) !== null;

export function folk(id: FolkId): Townsperson {
  const t = FOLK.find((f) => f.id === id);
  if (!t) throw new Error(`nobody called ${id}`);
  return t;
}

/** A name at the start of a sentence. */
export const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** What Cinfy says across the counter, and aloud. */
export const KEEPER = {
  hello: "Mind the gold. It's load-bearing.",
  doing: "Minding the gold. It is load-bearing.",
  /** What Cinfy says when a request is bought: at the counter, and out loud. */
  filed: ["Into the ledger it goes.", "filed!"],
  taps: ["The gold is load-bearing.", "Leaf in, shiny out.", "No, you can't hold the sun."],
} as const;

/** What Pipwick says on each errand. */
export const ERRAND_LINES: Readonly<Record<Errand, readonly string[]>> = {
  crabs: [
    "one, two... seven? no.",
    "I counted eight. again.",
    "where IS number 7",
    "hello, crab 3",
    "they're plotting",
  ],
  board: ["ooh, a new one", "who pinned this upside down", "three raids? not for a gnome.", "erm. which one's mine"],
  gate: ["the gate is minded.", "halt! oh. it's you.", "nobody in, nobody out. except you.", "good gate. good gate."],
};

/** What a townsperson's card says it is doing, by what it is about. */
export const DOING = {
  counter: KEEPER.doing,
  stall: "Minding the stall",
  asleep: "Asleep on the stall",
  crabs: "Counting the crabs",
  board: "Reading the quest board",
  gate: "Minding the gate",
  fire: "Sitting by the fire",
  works: "Keeping the Works' door warm",
  walk: "Going somewhere, purposefully",
  call: "Calling in at your camp",
} as const;
export type Doing = keyof typeof DOING;

/** The townsfolk who call at a member's camp, now and then. */
export type Caller = "pipwick" | "embertoe" | "mossback" | "fox";
export const CALLERS: readonly Caller[] = ["pipwick", "embertoe", "mossback", "fox"];
export const isCaller = (id: FolkId): id is Caller => CALLERS.some((c) => c === id);

/** What each caller says at a camp: coming in, sitting by the fire, going. */
export const AT_CAMP: Readonly<
  Record<
    Caller,
    { hello: readonly string[]; chat: readonly string[]; bye: readonly string[]; thanks: readonly string[] }
  >
> = {
  pipwick: {
    hello: ["knock knock.", "evening! room by the fire?", "errand! well. a visit."],
    chat: [
      "I counted your logs. two. good logs.",
      "your crabs are plotting something.",
      "Cinfy says hi. Cinfy also says pay up.",
      "who let the gnome in? oh. me.",
      "something in that barrel winked at me.",
    ],
    bye: ["more errands. night!", "off I go. be nice to Orphion.", "gn. glory to the grove."],
    thanks: ["oh! hello to you too.", "hi hi hi!", "a wave! for me!"],
  },
  embertoe: {
    hello: ["mrrp.", "smelled the fire. came over. meow."],
    chat: ["this is the best fire. I checked.", "your cabin smells like cedar. meow.", "*purrs at the fire*"],
    bye: ["back to the Works. meow.", "mrrp. night."],
    thanks: ["*purrs*", "mrrp!", "*headbutts your hand*"],
  },
  mossback: {
    hello: ["glorp."],
    chat: ["glorp.", "glorp?", "...glorp."],
    bye: ["glorp. glorp."],
    thanks: ["glorp!", "*wobbles, delighted*"],
  },
  fox: {
    hello: ["*yip*"],
    chat: ["*sniff*", "*curls up by the fire*", "..."],
    bye: ["*a small bow*"],
    thanks: ["*a small happy spin*", "*yip!*"],
  },
};

/** The notes each caller leaves, in its own voice, when nobody is in. */
export const NOTES: Readonly<Record<Caller, readonly string[]>> = {
  pipwick: [
    "Came by. You were out. I fed the fire.",
    "I counted your logs. Two. Good logs.",
    "Knocked. The cabin said nothing. Rude.",
    "Left this where the gnome couldn't get it. I am the gnome.",
  ],
  embertoe: [
    "Sat by your fire until it went out. Warm. Meow.",
    "Something small looked at me from your barrel. I looked back. Meow.",
  ],
  mossback: ["glorp.", "glorp. (left you this.)"],
  fox: ["(A pawprint, very neat.)", "(Two pawprints, and a feather.)"],
};

/** Small presents the callers bring. */
export const GIFTS = [
  "pinecone",
  "painted-pebble",
  "acorn-jar",
  "tiny-cairn",
  "crab-drawing",
  "gnome-traveller",
  "flower-pot",
  "candle-stump",
  "pumpkin",
] as const;

/**
 * What somebody of the town did while the member was away: a line for the arrival letter, and the
 * letter (and present, if any) it left in the mailbox, in its own voice.
 */
export interface AwayCall {
  who: FolkId;
  /** The line for the arrival letter, after the name. */
  did: string;
  note: string;
  gift: string;
}

/** Who calls before the member's first visit, and what they leave. */
export const FIRST_CALL: AwayCall = {
  who: "tindra",
  did: "left a mushroom by your gate.",
  note: "A mushroom for your gate. It's the good kind. Welcome home!",
  gift: "toadstool",
};

export const WHILE_AWAY: readonly AwayCall[] = [
  {
    who: "sootpaw",
    did: "left a mushroom by your gate.",
    note: "A mushroom. It was looking at me, so now it can look at you. Meow.",
    gift: "toadstool",
  },
  {
    who: "pipwick",
    did: "waved down your path.",
    note: "I waved down your path. You weren't in. I waved anyway.",
    gift: "",
  },
  { who: "mossback", did: "glorped by your fire.", note: "glorp?", gift: "" },
  {
    who: "embertoe",
    did: "kept your seat by the fire warm.",
    note: "Saved you a seat by the fire in town. Here's one for yours. Meow.",
    gift: "cushion",
  },
  {
    who: "tindra",
    did: "watered the fern by your gate.",
    note: "Water it. Or don't. It's hardy. I did the pot twice.",
    gift: "potted-fern",
  },
  {
    who: "fox",
    did: "left a pawprint on your step.",
    note: "(A pawprint, very neat. A pinecone beside it.)",
    gift: "pinecone",
  },
];
