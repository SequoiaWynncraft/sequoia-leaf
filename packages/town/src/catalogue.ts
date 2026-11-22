/**
 * What is for sale, and for how much: the market's stalls (camp things for Coins), and what a
 * member may leave at somebody else's camp. Leaf takes a stall's price when a thing is bought
 * (`game.ts`); the town page shows the same table.
 */

/** A camp thing and what it costs at a stall, in Coins. */
export interface Stock {
  thing: string;
  price: number;
}

/** One of the market's stalls: who keeps it, and the camp things it sells for Coins. Nothing ever sells out. */
export interface Stall {
  id: string;
  by: string;
  name: string;
  /** What the keeper says when something goes. */
  words: readonly string[];
  stock: readonly Stock[];
}

/** What each stall sells, as a thing and its price in Coins. Everything is always on sale. */
const stock = (...list: readonly (readonly [string, number])[]): Stock[] =>
  list.map(([thing, price]) => ({ thing, price }));

/** The market's stalls, each kept by one of the town's own (`folk.ts`). */
export const STALLS: readonly Stall[] = [
  {
    id: "lamps",
    by: "Sootpaw",
    name: "Lamps and oddments",
    words: ["no refunds. meow.", "one careful owner", "it's probably not haunted"],
    stock: stock(
      ["lantern-post", 450],
      ["paper-lantern", 300],
      ["candle-stump", 180],
      ["firefly-lamp", 550],
      ["glowcap", 600],
      ["moth-lantern", 700],
      ["brazier", 750],
      ["fairy-lights", 900],
      ["rock", 25],
      ["barrel", 350],
      ["gnome", 280],
      ["gnome-fishing", 325],
      ["gnome-napping", 325],
      ["crab-statue", 475],
      ["wind-chime", 400],
      ["birdhouse", 300],
      ["bird-bath", 500],
      ["cook-pot", 450],
      ["music-box", 850],
      ["telescope", 1300],
      ["well", 1600],
      ["my-stall", 2000],
    ),
  },
  {
    id: "seats",
    by: "Bramblewick",
    name: "Seats, rugs and flags",
    words: ["carried it here myself!", "good choice. sat on it all morning.", "mind the splinters"],
    stock: stock(
      ["stump", 150],
      ["cushion", 220],
      ["log-seat", 300],
      ["bench", 550],
      ["rocker", 800],
      ["picnic", 1100],
      ["hammock", 1200],
      ["rug-moss", 200],
      ["rug-woven", 375],
      ["pennant", 250],
      ["windsock", 350],
      ["bunting", 450],
      ["weathervane", 600],
      ["guild-banner", 650],
    ),
  },
  {
    id: "plants",
    by: "Tindra",
    name: "Plants, fences and paths",
    words: ["water it. or don't. it's hardy.", "I grew that one!", "it likes being talked to"],
    stock: stock(
      ["flower-pot", 120],
      ["potted-fern", 150],
      ["pumpkin", 180],
      ["sunflower", 200],
      ["toadstool", 220],
      ["berry-bush", 280],
      ["worm-pot", 325],
      ["flower-bed", 350],
      ["sapling", 400],
      ["fairy-ring", 450],
      ["stepping-stones", 35],
      ["plank-path", 35],
      ["log-fence", 50],
      ["picket", 55],
      ["stone-wall", 70],
      ["doormat", 220],
      ["woodpile", 180],
      ["arch", 550],
    ),
  },
];

/** What a member may leave at somebody's camp. */
export const PRESENTS = ["pinecone", "painted-pebble", "acorn-jar"] as const;

/** The crab that is never at roll call. */
export const LOST_CRAB = 7;
