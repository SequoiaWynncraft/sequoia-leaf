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
