/**
 * Everything a camp can hold: what each thing is called, what kind it is, how much ground it
 * takes and what it does. How each is drawn is in `campart.ts`, what happens when it is touched is
 * in `campscene.ts`, and where it is sold and for how much is the guild's to say (`guild.ts`).
 */

export const KINDS = ["home", "seats", "lights", "flags", "plants", "fences", "oddments", "trophies"] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_NAMES: Readonly<Record<Kind, string>> = {
  home: "The camp itself",
  seats: "Seats",
  lights: "Lights",
  flags: "Flags",
  plants: "Plants",
  fences: "Fences and paths",
  oddments: "Oddments",
  trophies: "Trophies",
};

export interface Thing {
  id: string;
  name: string;
  kind: Kind;
  /** A line about it, for whoever points at it. */
  about: string;
  /** What touching it does, in a few words; empty if it only shivers. */
  does: string;
  /** How many squares of ground it takes, across and deep, before any turning. */
  w: number;
  d: number;
  /** Lies on the ground: it is walked over, and other things may stand on it. */
  flat: boolean;
  /** Which of its squares stop a walker: all of them, only the two at its ends, or none. */
  solid: "all" | "ends" | "none";
  /** `flip` mirrors it; `quarter` lays it the other way. */
  turns: "none" | "flip" | "quarter";
  /** How many may sit on it. */
  seats: number;
  /** How far its light reaches, in art pixels; 0 if it gives none. */
  light: number;
  /** The camp cannot do without it: it may be moved but not put away. */
  rooted: boolean;
}

type Extra = Partial<Pick<Thing, "flat" | "solid" | "turns" | "seats" | "light" | "rooted">>;

function thing(
  id: string,
  name: string,
  kind: Kind,
  w: number,
  d: number,
  about: string,
  does: string,
  extra: Extra = {},
): Thing {
  const flat = extra.flat ?? false;
  return {
    id,
    name,
    kind,
    about,
    does,
    w,
    d,
    flat,
    solid: flat ? "none" : "all",
    turns: "none",
    seats: 0,
    light: 0,
    rooted: false,
    ...extra,
  };
}

export const THINGS: readonly Thing[] = [
  // What every camp begins with.
  thing("cabin", "Cabin", "home", 9, 3, "Yours. The door sticks a little.", "Opens your own things.", {
    rooted: true,
    light: 40,
  }),
  thing(
    "fire-ring",
    "Fire ring",
    "home",
    3,
    2,
    "Stones in a ring, and a fire that never needs feeding.",
    "Flares up.",
    {
      light: 60,
    },
  ),
  thing("mailbox", "Mailbox", "home", 1, 1, "Notes and small presents from guild-mates.", "Opens your letters.", {
    rooted: true,
    light: 22,
  }),
  thing(
    "signpost",
    "Signpost",
    "home",
    1,
    1,
    "Points down the trail to everybody else's camp.",
    "Lists who to visit.",
    {
      rooted: true,
    },
  ),
  thing(
    "trophy-shelf",
    "Trophy shelf",
    "home",
    3,
    1,
    "Everything you have won, where visitors can see it.",
    "Rattles.",
  ),

  // Seats.
  thing("log-seat", "Log seat", "seats", 4, 1, "Room for two, three if they like each other.", "Sit down.", {
    seats: 2,
    turns: "quarter",
  }),
  thing("stump", "Stump stool", "seats", 1, 1, "Somebody counted the rings. Forty-one.", "Sit down.", { seats: 1 }),
  thing("bench", "Garden bench", "seats", 3, 1, "It has a back. Luxury.", "Sit down.", { seats: 2 }),
  thing("hammock", "Hammock", "seats", 4, 1, "Slung between two posts. Mind the first step.", "Sways.", { seats: 1 }),
  thing("cushion", "Patchwork cushion", "seats", 1, 1, "Sewn from four old cloaks.", "Sit down.", {
    seats: 1,
    flat: true,
  }),
  thing("rocker", "Rocking chair", "seats", 1, 1, "It creaks in a friendly way.", "Rocks.", {
    seats: 1,
    turns: "flip",
  }),
  thing("picnic", "Picnic table", "seats", 3, 2, "There is always one crumb on it.", "Rattles the plates.", {
    seats: 2,
  }),

  // Lights.
  thing("lantern-post", "Lantern post", "lights", 1, 1, "Like the ones in town.", "Lights, or goes out.", {
    light: 36,
    turns: "flip",
  }),
  thing(
    "paper-lantern",
    "Paper lantern",
    "lights",
    1,
    1,
    "On a stick. It changes colour if asked.",
    "Changes colour.",
    {
      light: 26,
    },
  ),
  thing("candle-stump", "Candle stump", "lights", 1, 1, "Three candles, one always shorter.", "Lights, or goes out.", {
    light: 20,
  }),
  thing("firefly-lamp", "Firefly lamp", "lights", 1, 1, "They come and go as they please.", "Lets a few out.", {
    light: 24,
  }),
  thing("brazier", "Stone brazier", "lights", 1, 1, "Warm hands, cold nose.", "Flares up.", { light: 40 }),
  thing("glowcap", "Glowcap", "lights", 1, 1, "A mushroom that has decided to be a lamp.", "Pulses.", { light: 28 }),
  thing("fairy-lights", "String of lights", "lights", 5, 1, "Two poles and a string of bulbs.", "Runs a ripple.", {
    solid: "ends",
    light: 30,
    turns: "quarter",
  }),
  thing(
    "moth-lantern",
    "Moth's lantern",
    "lights",
    1,
    1,
    "Moth is not for sale. Moth comes with it.",
    "Moth flutters.",
    {
      light: 28,
    },
  ),

  // Flags and banners.
  thing("pennant", "Pennant", "flags", 1, 1, "A little flag on a tall pole.", "Changes colour.", { turns: "flip" }),
  thing("guild-banner", "Guild banner", "flags", 1, 1, "The guild's sun, on a stand.", "Flutters.", {}),
  thing("bunting", "Bunting", "flags", 5, 1, "Little flags on a line.", "Ripples.", {
    solid: "ends",
    turns: "quarter",
  }),
  thing("windsock", "Windsock", "flags", 1, 1, "Says which way the wind is. It is that way.", "Fills.", {
    turns: "flip",
  }),
  thing("weathervane", "Crab weathervane", "flags", 1, 1, "Points wherever the crab likes.", "Spins.", {}),

  // Plants and mushrooms.
  thing("flower-pot", "Flower pot", "plants", 1, 1, "Something pink, doing well.", "Sheds a petal."),
  thing("potted-fern", "Potted fern", "plants", 1, 1, "Loud for a fern.", "Rustles."),
  thing("toadstool", "Great toadstool", "plants", 1, 1, "Red, with spots. Do not lick it.", "Bounces."),
  thing("fairy-ring", "Fairy ring", "plants", 3, 2, "Mushrooms in a circle. Nobody planted them.", "Twinkles.", {
    flat: true,
  }),
  thing("sunflower", "Sunflower", "plants", 1, 1, "Follows the sun. At dusk it follows you.", "Nods."),
  thing("berry-bush", "Berry bush", "plants", 2, 1, "Two ripe ones. There are always two.", "Drops a berry."),
  thing("sapling", "Redwood sapling", "plants", 1, 1, "In a tub. Give it nine hundred years.", "Rustles."),
  thing("pumpkin", "Pumpkin", "plants", 1, 1, "Round. Pleased with itself.", "Wobbles."),
  thing("flower-bed", "Flower bed", "plants", 2, 1, "A box of whatever came up.", "Sheds petals."),
  thing("worm-pot", "Worm's pot", "plants", 1, 1, "Worm lives here. Worm is shy.", "Worm looks out."),

  // Fences and paths.
  thing("picket", "Picket fence", "fences", 2, 1, "Keeps nothing in. Looks tidy.", "Knocks.", { turns: "quarter" }),
  thing("log-fence", "Rail fence", "fences", 2, 1, "Two rails and a post.", "Knocks.", { turns: "quarter" }),
  thing("stone-wall", "Low wall", "fences", 2, 1, "Dry stone. Something lives in it.", "Knocks.", { turns: "quarter" }),
  thing("arch", "Garden arch", "fences", 3, 1, "A way in, wherever you would like one.", "Creaks.", { solid: "ends" }),
  thing("stepping-stones", "Stepping stones", "fences", 2, 1, "Three flat stones.", "Clicks.", {
    flat: true,
    turns: "quarter",
  }),
  thing("plank-path", "Plank path", "fences", 2, 1, "Boards laid over the wet bit.", "Thumps.", {
    flat: true,
    turns: "quarter",
  }),
  thing("doormat", "Crab doormat", "fences", 2, 1, "It says CLACK. Wipe your feet.", "Clacks.", { flat: true }),

  // Oddments.
  thing("well", "Wishing well", "oddments", 2, 2, "It wishes you well.", "Takes a wish."),
  thing("telescope", "Telescope", "oddments", 1, 1, "Pointed at the bit of sky between the trees.", "Finds a star.", {
    turns: "flip",
  }),
  thing("my-stall", "A stall of your own", "oddments", 5, 1, "Open for business. Nobody is buying.", "Rings the bell."),
  thing("gnome", "Gnome", "oddments", 1, 1, "It was looking at you.", "Looks the other way.", { turns: "flip" }),
  thing("gnome-fishing", "Fishing gnome", "oddments", 1, 1, "Has not caught anything. Has not given up.", "Casts.", {
    turns: "flip",
  }),
  thing("gnome-napping", "Napping gnome", "oddments", 1, 1, "Do not wake the gnome.", "Snores.", {}),
  thing("crab-statue", "Crab statue", "oddments", 1, 1, "Carved from memory. The claws are too big.", "Clacks."),
  thing("barrel", "Barrel", "oddments", 1, 1, "Probably empty.", "Something looks out."),
  thing("wind-chime", "Wind chime", "oddments", 1, 1, "Five notes, all of them nice.", "Rings."),
  thing("music-box", "Music box", "oddments", 1, 1, "It only knows one tune. It is a good tune.", "Plays its tune."),
  thing("bird-bath", "Bird bath", "oddments", 1, 1, "A wren uses it. The wren does not share.", "Splashes."),
  thing("rug-woven", "Woven rug", "oddments", 3, 2, "Red and gold, a little faded.", "Soft underfoot.", {
    flat: true,
    turns: "quarter",
  }),
  thing("rug-moss", "Moss rug", "oddments", 2, 2, "It is just moss. It is very good moss.", "Soft underfoot.", {
    flat: true,
  }),
  thing("rock", "Rock", "oddments", 1, 1, "Rock.", "Rock."),
  thing("birdhouse", "Birdhouse", "oddments", 1, 1, "One careful owner.", "Somebody chirps."),
  thing("cook-pot", "Cook pot", "oddments", 1, 1, "Stew. It has always been stew.", "Bubbles.", { light: 18 }),
  thing("woodpile", "Woodpile", "oddments", 2, 1, "Stacked by somebody who cares.", "Knocks."),

  // The Treasury's fine pieces.
  thing("fox-statue", "The white fox", "oddments", 1, 1, "Marble, with gold on the antlers.", "The antlers shine.", {
    light: 22,
    turns: "flip",
  }),
  thing("fountain", "Moonwater fountain", "oddments", 2, 2, "It runs uphill a little, at the top.", "Leaps.", {
    light: 26,
  }),
  thing("glass-lantern", "Stained-glass lantern", "lights", 1, 1, "Four panes, four colours.", "Turns a pane.", {
    light: 34,
  }),
  thing("sun-banner", "Sunset banner", "flags", 1, 1, "Gold thread on plum. It catches the last light.", "Flutters.", {
    light: 16,
  }),
  thing("crab-throne", "Crab throne", "seats", 2, 1, "A seat with claws for arms.", "Sit down.", { seats: 1 }),

  // Small presents, which cannot be bought.
  thing("pinecone", "A very good pinecone", "oddments", 1, 1, "Chosen with care.", "Rolls a little."),
  thing("painted-pebble", "Painted pebble", "oddments", 1, 1, "Somebody painted a crab on it.", "Clicks."),
  thing("acorn-jar", "Jar of acorns", "oddments", 1, 1, "For later.", "Rattles."),
  thing("tiny-cairn", "Tiny cairn", "oddments", 1, 1, "Three stones, balanced.", "Falls down and gets back up."),
  thing("crab-drawing", "Drawing of a crab", "oddments", 1, 1, "On a little easel. It would not sit still.", "Flaps."),
  thing(
    "gnome-traveller",
    "Travelling gnome",
    "oddments",
    1,
    1,
    "It has a suitcase. It is not leaving.",
    "Tips its hat.",
    {
      turns: "flip",
    },
  ),

  // Won in the games, never bought.
  thing(
    "trophy-oldbramble",
    "Old Bramble, carved",
    "trophies",
    1,
    1,
    "For beating Old Bramble in The Little Raid.",
    "",
  ),
  thing("trophy-hoardmagpie", "The Magpie, carved", "trophies", 1, 1, "For beating The Magpie With The Hoard.", ""),
  thing("trophy-bigcrab", "The Crab Nobody Counted", "trophies", 1, 1, "For finishing The Little Raid.", ""),
  thing("model-crab", "Clockwork crab, a model", "trophies", 1, 1, "For building one in the Works.", ""),
  thing("model-beacon", "Beacon, a model", "trophies", 1, 1, "For building one in the Works.", ""),
];

const BY_ID = new Map(THINGS.map((t) => [t.id, t]));

/** A thing by its name in the record, if there is such a thing. */
export const thingOf = (id: string): Thing | null => BY_ID.get(id) ?? null;

export const isThing = (id: unknown): id is string => typeof id === "string" && BY_ID.has(id);

/** How many ways round a thing can be set down. */
export const turnsOf = (t: Thing): number => (t.turns === "none" ? 1 : 2);

/** The ground a thing takes when turned so: across, then deep. */
export function footprint(t: Thing, turn: number): readonly [number, number] {
  return t.turns === "quarter" && turn % 2 === 1 ? [t.d, t.w] : [t.w, t.d];
}
