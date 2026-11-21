/** What the people of the town say, and how what they are doing is put on a card. Who they are comes from the guild. */

import type { Doing } from "./game.ts";

/** What people say while about an errand, by where they are. */
export const LINES: Readonly<Record<Exclude<Doing, "walk" | "raid" | "call" | "home"> | "any", readonly string[]>> = {
  treasury: ["just looking, Cinfy", "how much for the sun?", "put it on my tab", "ooh, shiny"],
  quests: ["ooh, a new one", "three raids? easy.", "who pinned this upside down", "erm. which one's mine"],
  market: ["is this haunted?", "fresh bread!", "I'll take two", "does it come in gold"],
  stall: ["best prices in the grove!", "no refunds. be nice.", "handmade! mostly!", "one careful owner"],
  works: ["the belt is so soothing", "clank. clank. clank.", "who took my planks", "it's making more planks"],
  table: ["ooh, bold move", "that crab is cheating", "no, the OTHER gnome", "who's winning?"],
  play: ["your move", "three of a kind!", "one more room", "rustle the stall"],
  pond: ["hello, crab 3", "where IS number 7", "I counted eight. again.", "they're plotting"],
  tree: ["one lantern a raid", "prettiest tree in the grove", "this one's mine, top left"],
  pole: ["glory to the grove", "we should take another", "nice banner"],
  garden: ["a gnome moved this mushroom", "smells like rain", "the ferns are loud tonight"],
  gate: ["ready?", "buffs up", "go go go", "no gg left behind"],
  fire: ["scooch over", "tell the gnome one again", "the fire's warm tonight", "one more raid? one more raid.", "meow"],
  bench: ["my feet hurt", "five more minutes", "nice evening"],
  any: ["erm", "be nice", "leafin' it up", "brb, snack", "has anyone seen crab 7?", "I should be asleep", "nice hat"],
};

export const CHEERS = [
  "gg!",
  "ggs!",
  "no gg left behind!",
  "glory to the grove!",
  "woo!",
  "let's gooo",
  "huge",
] as const;
export const GREETS = ["hi!", "oh hey!", "welcome back!", "hiya", "evening!", "you're here!"] as const;
export const DOING: Readonly<Record<Doing, string>> = {
  treasury: "Eyeing the gold",
  quests: "Reading the quest board",
  market: "Browsing the market",
  stall: "Minding a stall",
  works: "Watching the belt",
  table: "Watching a game",
  play: "Playing The Little Raid",
  pond: "Counting crabs",
  tree: "Admiring the lanterns",
  pole: "Looking up at the banner",
  garden: "Pottering in the garden",
  gate: "Mustering for a raid",
  fire: "Sitting by the fire",
  bench: "Resting on the bench",
  walk: "Out for a wander",
  raid: "Away on a raid",
  call: "Calling in at your camp",
  home: "At home",
};

/** What Cinfy says across the counter, and aloud. */
export const KEEPER = {
  hello: "Mind the gold. It's load-bearing.",
  doing: "Minding the gold. It is load-bearing.",
  short: ["More Leaf first. I'll be here.", "more Leaf, please"],
  taps: ["The gold is load-bearing.", "Leaf in, shiny out.", "No, you can't hold the sun."],
} as const;
