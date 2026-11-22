/**
 * What has changed in the game, for the "News" tab on the quest board, newest first. A change a
 * player can see adds a note at the top, in the words of someone telling a friend, and nothing is
 * ever taken out of the middle.
 */

export interface Note {
  id: string;
  /** The day it went live, as `2026-11-22`. */
  day: string;
  title: string;
  lines: readonly string[];
}

export const NOTES: readonly Note[] = [
  {
    id: "works-splitters",
    day: "2026-11-22",
    title: "The Works: Splitters and buying",
    lines: [
      "A Splitter or a Joiner can be set straight onto a belt. A Splitter shows an arrow only towards a side that takes items, and never sends an item to a side with no belt.",
      "Buying a plot or a plan asks you to press again. A plot's card opens when you click the plot.",
    ],
  },
  {
    id: "camp-follows-you",
    day: "2026-11-22",
    title: "Your camp follows you",
    lines: [
      "Leaf now keeps your camp, your mail and your trophies, so they are the same on every device.",
      "Callers now come by Leaf's clock, whichever device you are on.",
    ],
  },
  {
    id: "new-look",
    day: "2026-11-22",
    title: "A new look",
    lines: [
      "Panels, buttons and cards are redrawn so the thing that matters stands out, with a font that is easier to read.",
    ],
  },
  {
    id: "visit-yards",
    day: "2026-11-22",
    title: "Visit other yards",
    lines: [
      "Choose someone in Who is about or in Top yards to see their card: what their yard has earned, and how far they are in The Little Raid.",
      "Visit yard opens their yard. You can look around. You cannot change anything.",
    ],
  },
  {
    id: "works-plain-words",
    day: "2026-11-22",
    title: "Plainer words in the Works",
    lines: [
      "The Works now uses the same plain words everywhere: place, rotate, remove, power made and power used. Standing orders are now called side orders.",
      "The Splitter and the Joiner look different now. A Splitter shows three arrows out. A Joiner shows three arrows in and one out.",
    ],
  },
  {
    id: "top-yards",
    day: "2026-11-22",
    title: "Top yards in the Works",
    lines: [
      "The cup button beside Orders lists the twenty yards that have earned the most Coins, with your own place.",
      "A yard is listed once it has earned its first Coin on Leaf.",
    ],
  },
  {
    id: "works-follows-you",
    day: "2026-11-22",
    title: "The Works follows you",
    lines: [
      "Leaf now keeps your yard, so it is the same on every device and works on while you are away.",
      "Its Coins reach your purse about once a minute. Setting a clock forward earns nothing.",
    ],
  },
  {
    id: "lit-on-phones",
    day: "2026-11-22",
    title: "The town stays lit on phones",
    lines: ["On some phones the ground and the sky could go dark after switching apps. That is fixed."],
  },
  {
    id: "seen-lately-everyone",
    day: "2026-11-22",
    title: "Who is about lists everyone who left",
    lines: [
      "Seen lately now shows everybody who was in the game in the last day, not only those whose character stays in town.",
      "Somebody who has just walked out shows there at once.",
    ],
  },
  {
    id: "works-words",
    day: "2026-11-22",
    title: "Clearer words in the Works",
    lines: [
      "Each piece now says plainly what it does.",
      "A Joiner takes from each line in turn. A plain belt takes whichever item arrives first.",
    ],
  },
  {
    id: "raid-follows-you",
    day: "2026-11-22",
    title: "The Little Raid follows you",
    lines: ["Leaf now keeps your raid and your Coins, so they are the same on every device."],
  },
  {
    id: "tap-to-leave",
    day: "2026-11-22",
    title: "Leave your camp with a tap",
    lines: ["Tap the Town sign, or the path past the posts."],
  },
  {
    id: "quick-return",
    day: "2026-11-22",
    title: "Quicker to come back",
    lines: [
      "After a drop the town is back in about a second.",
      "The people button shows who is about and who was here lately.",
    ],
  },
];
