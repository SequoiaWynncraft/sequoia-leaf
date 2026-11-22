/**
 * What has changed in the game, for the "News" tab on the quest board, newest first. A change a
 * player can see adds a note at the top, in the words of someone telling a friend, and nothing is
 * ever taken out of the middle.
 */

export interface Note {
  id: string;
  /** When it went live, by the world's clock: `2026-11-22T19:09Z`. An old note has only its day, `2026-11-22`. */
  at: string;
  title: string;
  lines: readonly string[];
}

export const NOTES: readonly Note[] = [
  {
    id: "nothing-stuck",
    at: "2026-11-22T20:20Z",
    title: "Nothing stuck on the screen",
    lines: [
      "A tip or card no longer stays on the screen when the panel under it changes.",
      "The price signs in the Works stand clear of the fences, so no post goes through them.",
    ],
  },
  {
    id: "belt-colours",
    at: "2026-11-22T20:19Z",
    title: "The Works: belt colours",
    lines: [
      "The Works has a Paint tool. Click a belt to colour its whole line, in one of six colours.",
      "A belt laid from a coloured line takes its colour.",
    ],
  },
  {
    id: "treasury-requests",
    at: "2026-11-22T20:03Z",
    title: "Requests at the Treasury",
    lines: [
      "The Treasury now sells a paid aspect request and a paid tome request, 3,000 Leaf each, for members with 7 days in the guild.",
      "A paid request is served before the free ones. The free requests in Discord are as before.",
    ],
  },
  {
    id: "taps-land",
    at: "2026-11-22T19:55Z",
    title: "Taps that count",
    lines: [
      "In The Little Raid, buying and levelling up happen as you tap, so you can place a figure straight after buying it. While a reroll, a pick or setting out waits on the guild's server, the stall dims and taps on it do nothing.",
      "Every open card has a close button, and picking up a figure no longer opens its card over the board.",
    ],
  },
  {
    id: "fire-seen",
    at: "2026-11-22T19:54Z",
    title: "The campfire is shared",
    lines: [
      "At the campfire, Add a log and the emotes are now seen by everyone in town, not only on your own screen.",
      "Holding Space no longer saves up hops: a key held down is one press.",
    ],
  },
  {
    id: "one-face",
    at: "2026-11-22T19:47Z",
    title: "One font for the game",
    lines: [
      "Names, numbers, labels and lists are now in the Minecraft font everywhere. Only sentences keep the plain font.",
      "A person's card lists their numbers game by game, and no longer flickers when you first point at someone.",
    ],
  },
  {
    id: "visit-camps",
    at: "2026-11-22T19:35Z",
    title: "Visit other camps",
    lines: [
      "Choose someone in Who is about and choose Visit camp, or pick a camp at your own camp's signpost.",
      "You can walk around their camp. You cannot change anything.",
    ],
  },
  {
    id: "stand-apart",
    at: "2026-11-22T19:09Z",
    title: "Room to stand",
    lines: [
      "If the page reloads within 10 minutes, you start where you stood, not at the gate.",
      "Players standing on the same spot are drawn a step apart, so you can see and tap each one.",
    ],
  },
  {
    id: "works-splitters",
    at: "2026-11-22T19:02Z",
    title: "The Works: Splitters and buying",
    lines: [
      "A Splitter or a Joiner can be set straight onto a belt. A Splitter shows an arrow only towards a side that takes items, and never sends an item to a side with no belt.",
      "Buying a plot or a plan asks you to press again. A plot's card opens when you click the plot.",
    ],
  },
  {
    id: "camp-follows-you",
    at: "2026-11-22T18:03Z",
    title: "Your camp follows you",
    lines: [
      "Leaf now keeps your camp, your mail and your trophies, so they are the same on every device.",
      "Callers now come by Leaf's clock, whichever device you are on.",
    ],
  },
  {
    id: "new-look",
    at: "2026-11-22T17:43Z",
    title: "A new look",
    lines: [
      "Panels, buttons and cards are redrawn so the thing that matters stands out, with a font that is easier to read.",
    ],
  },
  {
    id: "visit-yards",
    at: "2026-11-22T16:29Z",
    title: "Visit other yards",
    lines: [
      "Choose someone in Who is about or in Top yards to see their card: what their yard has earned, and how far they are in The Little Raid.",
      "Visit yard opens their yard. You can look around. You cannot change anything.",
    ],
  },
  {
    id: "works-plain-words",
    at: "2026-11-22T16:22Z",
    title: "Plainer words in the Works",
    lines: [
      "The Works now uses the same plain words everywhere: place, rotate, remove, power made and power used. Standing orders are now called side orders.",
      "The Splitter and the Joiner look different now. A Splitter shows three arrows out. A Joiner shows three arrows in and one out.",
    ],
  },
  {
    id: "top-yards",
    at: "2026-11-22T15:19Z",
    title: "Top yards in the Works",
    lines: [
      "The cup button beside Orders lists the twenty yards that have earned the most Coins, with your own place.",
      "A yard is listed once it has earned its first Coin on Leaf.",
    ],
  },
  {
    id: "works-follows-you",
    at: "2026-11-22T15:09Z",
    title: "The Works follows you",
    lines: [
      "Leaf now keeps your yard, so it is the same on every device and works on while you are away.",
      "Its Coins reach your purse about once a minute. Setting a clock forward earns nothing.",
    ],
  },
  {
    id: "seen-lately-everyone",
    at: "2026-11-22T15:05Z",
    title: "Who is about lists everyone who left",
    lines: [
      "Seen lately now shows everybody who was in the game in the last day, not only those whose character stays in town.",
      "Somebody who has just walked out shows there at once.",
    ],
  },
  {
    id: "lit-on-phones",
    at: "2026-11-22",
    title: "The town stays lit on phones",
    lines: ["On some phones the ground and the sky could go dark after switching apps. That is fixed."],
  },
  {
    id: "works-words",
    at: "2026-11-22",
    title: "Clearer words in the Works",
    lines: [
      "Each piece now says plainly what it does.",
      "A Joiner takes from each line in turn. A plain belt takes whichever item arrives first.",
    ],
  },
  {
    id: "raid-follows-you",
    at: "2026-11-22",
    title: "The Little Raid follows you",
    lines: ["Leaf now keeps your raid and your Coins, so they are the same on every device."],
  },
  {
    id: "tap-to-leave",
    at: "2026-11-22",
    title: "Leave your camp with a tap",
    lines: ["Tap the Town sign, or the path past the posts."],
  },
  {
    id: "quick-return",
    at: "2026-11-22",
    title: "Quicker to come back",
    lines: [
      "After a drop the town is back in about a second.",
      "The people button shows who is about and who was here lately.",
    ],
  },
];
