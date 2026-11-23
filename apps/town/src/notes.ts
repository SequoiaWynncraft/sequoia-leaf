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
    id: "one-town",
    at: "2026-11-22T23:55Z",
    title: "Everyone sees the same town",
    lines: [
      "Pipwick, Fika, Sootpaw and the crabs are in the same place doing the same thing for everyone in town.",
      "Crab No. 7 hides in one place for 60 seconds, then in another. Everyone in town can find it there, once each: it runs off from whoever taps it.",
    ],
  },
  {
    id: "works-smoother",
    at: "2026-11-22T23:44Z",
    title: "The Works: zoom out further",
    lines: [
      "The Works zooms out until the whole yard is on screen.",
      "Large yards run smoother, most of all in Firefox.",
    ],
  },
  {
    id: "touches-seen",
    at: "2026-11-22T23:15Z",
    title: "Everyone sees what you tap",
    lines: [
      "Tap a lamp post, a sign, a trunk, a mushroom, the water, a crab, the lights or the fire, and everyone in town sees it. They hear it too if it is on their screen.",
      "Lamps, flowers and crabs stir when other players walk past them, not only you.",
    ],
  },
  {
    id: "the-grove",
    at: "2026-11-22T23:07Z",
    title: "The Grove: pulls",
    lines: [
      "The Grove stands on the lawn between the Treasury and the market. A pull costs 1,000 Leaf and draws a prize: a thing for your camp or a look for the raid's table.",
      "A free pull arrives every 24 hours. Prizes lists every prize and its chance, and the Seeds each pull gives buy a prize you choose.",
    ],
  },
  {
    id: "board-rerolls",
    at: "2026-11-22T22:52Z",
    title: "Quest board: kinds and rerolls",
    lines: [
      "Each quest on the board says whether it is daily, weekly or timed and when it ends, and one you can finish with raids or wars shows both counts.",
      "You can reroll a daily or weekly on the board too, as in the mod. One reroll of each per UTC day is free, then each costs 100 Leaf.",
    ],
  },
  {
    id: "time-played",
    at: "2026-11-22T22:41Z",
    title: "Time played",
    lines: [
      "A person's card shows how long they have played each game, and all games together.",
      "It counts from this update on. Play before it is not counted.",
    ],
  },
  {
    id: "nobody-inside",
    at: "2026-11-22T22:36Z",
    title: "Nobody inside anybody",
    lines: [
      "After a reload, members at the Works or the raid table are already standing there. They no longer all walk in through the gate on top of each other.",
      "Members walking the same way walk side by side, and whoever walks goes round whoever is standing. Tap a spot where someone stands or sits and you stop beside them.",
    ],
  },
  {
    id: "timber-and-shingle",
    at: "2026-11-22T22:20Z",
    title: "Timber and shingle",
    lines: [
      "Panels have a timber frame with brass corners, tabs are wooden, notes hang on a nail and the signs along the top hang on ropes.",
    ],
  },
  {
    id: "gate-card",
    at: "2026-11-22T21:52Z",
    title: "The signpost to your camp",
    lines: [
      "In town, the signpost and the gate now open your camp's card, with Go home on it. Walking on through the gate still goes straight there.",
      "The Works' cat is called Fika.",
    ],
  },
  {
    id: "splitter-ways",
    at: "2026-11-22T21:45Z",
    title: "The Works: shut a splitter's way",
    lines: [
      "A splitter's card shows its 3 ways out. Click or tap one to shut it or open it. A splitter sends no items to a shut way.",
      "A splitter with 2 ways out now sends 1 item to each in turn. Before, one way got 2 of every 3.",
    ],
  },
  {
    id: "works-area",
    at: "2026-11-22T21:06Z",
    title: "The Works: Select and blueprints",
    lines: [
      "The Works has a Select tool: mark out an area, then move, copy or remove every piece in it at once.",
      "A yard keeps 3 blueprints. Save a marked area as one, and build it again anywhere for the price of its pieces.",
    ],
  },
  {
    id: "works-orders-list",
    at: "2026-11-22T21:00Z",
    title: "The Works: orders hold still",
    lines: [
      "Filled side orders are listed first, with Hand over at the top of each. After you hand one over, the next filled order's button is in the same spot.",
      "The list no longer jumps: a new order takes the last place. Swap asks you to press again if items were already delivered to the order.",
    ],
  },
  {
    id: "seen-in-town",
    at: "2026-11-22T20:25Z",
    title: "Easier to find people in town",
    lines: [
      "Nobody waits behind the tree by the Works any more.",
      "A tap finds someone walking more easily. Who is about keeps its order while it is open: new people go to the end, and people who left stay listed, dimmed.",
    ],
  },
  {
    id: "nothing-stuck",
    at: "2026-11-22T20:12Z",
    title: "Nothing stuck on the screen",
    lines: [
      "A tip or card no longer stays on the screen when the panel under it changes.",
      "The price signs in the Works stand clear of the fences, so no post goes through them.",
    ],
  },
  {
    id: "belt-colours",
    at: "2026-11-22T20:11Z",
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
