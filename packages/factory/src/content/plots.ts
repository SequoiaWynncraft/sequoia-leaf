/**
 * The land, plot by plot. Nine plots of sixteen tiles by twelve make a map three plots wide and
 * three tall, with the yard in the middle. Each plot is drawn here as rows of letters, one letter
 * a tile, so the map can be read off the page and drawn from the same data.
 *
 *   .  clear ground          d  deadfall        s  stone        o  ore
 *   c  clay                  a  sand            r  resin
 *   ~  the stream            T  a redwood (nothing is built on one)        D  the depot
 */

export const PLOT_W = 16;
export const PLOT_H = 12;

export const PLOT_IDS = ["yard", "meadow", "bank", "stream", "grove", "seam", "quarry", "hollow", "pond"] as const;
export type PlotName = (typeof PLOT_IDS)[number];

export interface PlotInfo {
  readonly id: PlotName;
  readonly name: string;
  /** Where it sits on the map, in plots: column and row, 0 to 2. */
  readonly col: number;
  readonly row: number;
  /** Coins to open it. The yard itself is free. */
  readonly price: number;
  /** Why anyone would want it. */
  readonly why: string;
  readonly rows: readonly string[];
}

export const PLOTS: readonly PlotInfo[] = [
  {
    id: "hollow",
    name: "Windfall Hollow",
    col: 0,
    row: 0,
    price: 3000,
    why: "Great drifts of deadfall: fuel for a row of boilers, and planks without end.",
    rows: [
      "................",
      "..TT....ddd.....",
      "..TT...ddddd....",
      ".......dddd.....",
      "...d....dd......",
      "..ddd.......dd..",
      "..dddd.....dddd.",
      "...dd......ddd..",
      "............d...",
      ".....TT.........",
      ".....TT....dd...",
      "................",
    ],
  },
  {
    id: "grove",
    name: "Resin Grove",
    col: 1,
    row: 0,
    price: 1000,
    why: "Old stumps weeping resin, for lamp oil.",
    rows: [
      "................",
      "...TT.....rr....",
      "...TT....rrr....",
      "..........rr....",
      "..rr............",
      ".rrr.....TT.....",
      "..rr.....TT..rr.",
      "............rrr.",
      ".....dd......r..",
      "....ddd.........",
      ".....d..........",
      "................",
    ],
  },
  {
    id: "seam",
    name: "The Far Seam",
    col: 2,
    row: 0,
    price: 2600,
    why: "A second, richer ore seam and more stone, on the far side of the stream.",
    rows: [
      "....~~..........",
      "....~~....ooo...",
      "....~~...ooooo..",
      "....~~...oooo...",
      "....~~....oo....",
      ".....~~.........",
      ".....~~....ss...",
      ".....~~...ssss..",
      "....~~.....ss...",
      "....~~..oo......",
      "....~~.oooo.....",
      "....~~..oo......",
    ],
  },
  {
    id: "bank",
    name: "The Clay Bank",
    col: 0,
    row: 1,
    price: 500,
    why: "Clay, for pots.",
    rows: [
      "................",
      "..cc............",
      ".cccc.....TT....",
      ".ccccc....TT....",
      "..cccc..........",
      "...cc...........",
      "................",
      "..........cc....",
      ".........cccc...",
      ".........ccc....",
      "..TT............",
      "..TT............",
    ],
  },
  {
    id: "yard",
    name: "The Yard",
    col: 1,
    row: 1,
    price: 0,
    why: "The cleared ground behind the workshop, with the depot in the middle of it.",
    rows: [
      ".............ooo",
      ".............ooo",
      "..dd..........oo",
      ".dddd...........",
      "..dd............",
      ".......DDD......",
      ".......DDD......",
      ".......DDD......",
      "................",
      "sss.........ddd.",
      "sss.........dd..",
      "ss..............",
    ],
  },
  {
    id: "stream",
    name: "Stream Bend",
    col: 2,
    row: 1,
    price: 900,
    why: "Sand on both banks for glass, and the stream itself, to turn waterwheels.",
    rows: [
      "....~~..........",
      "....~~...aa.....",
      ".aa..~~..aaa....",
      ".aaa.~~...aa....",
      "..aa..~~........",
      "......~~........",
      "......~~...TT...",
      "..a...~~...TT...",
      ".aaa.~~.........",
      ".aa..~~....aaa..",
      ".....~~...aaaa..",
      ".....~~....aa...",
    ],
  },
  {
    id: "quarry",
    name: "The Old Quarry",
    col: 0,
    row: 2,
    price: 2200,
    why: "More stone than the yard could ever use, and a little ore.",
    rows: [
      "................",
      ".....sss........",
      "....sssss.......",
      "....ssssss......",
      ".....ssss.......",
      "......ss....oo..",
      "...........ooo..",
      "..ss........o...",
      ".ssss...........",
      "..sss.....TT....",
      "..........TT....",
      "................",
    ],
  },
  {
    id: "meadow",
    name: "Long Meadow",
    col: 1,
    row: 2,
    price: 300,
    why: "Open ground: room to lay things out properly, and a drift of deadfall.",
    rows: [
      "................",
      "................",
      "...dd...........",
      "..dddd..........",
      "...dd.......d...",
      "...........ddd..",
      "............dd..",
      "................",
      "................",
      "......TT........",
      "......TT........",
      "................",
    ],
  },
  {
    id: "pond",
    name: "The Millpond",
    col: 2,
    row: 2,
    price: 5000,
    why: "The stream slows into a pond: a long bank for waterwheels, with sand and clay beside it.",
    rows: [
      ".....~~.........",
      ".....~~.....aa..",
      "....~~~~...aaa..",
      "...~~~~~~...a...",
      "...~~~~~~~......",
      "...~~~~~~~......",
      "....~~~~~~..cc..",
      ".....~~~~..ccc..",
      ".......~~...cc..",
      ".......~~.......",
      "..aa...~~.......",
      ".aaa...~~.......",
    ],
  },
];
