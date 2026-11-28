/**
 * Up The Tree (5 January 2027): the four red pandas, the Possum and the woodpecker. A new origin,
 * Canopy, whose figures start the fight up the tree and drop to their seats with a shield and mana:
 * Vi (the dev), Flop, Bhlue (the hacker), Ace and Leetanns, and Unc as a third trait. Leetanns, the
 * banner's headliner, is the set's own red panda with every tool there is, and the only Crafter: a
 * component every third fight it fights. Feather gets two more steps, Slinger a third. A Good Branch
 * is Canopy's emblem.
 *
 * The banner closes on 19 January, where the next release opens (`up-the-tree-ends`, which brings
 * nothing).
 *
 * Vi, Flop and Bhlue are a little stronger than their tier, made for a thinner stall; with the five
 * it retires (`RAID-SETS.md`) the bots still clear the trail within the base's band
 * (`review/balance.ts`, beside it with `era=gaz-stall`). Leetanns is on everyone's
 * stall while its banner is open, so it sits between Vesta and Greg at one star (`review/swap.ts`).
 */
import type { BoonSpec } from "../boons.ts";
import { emblem } from "../items.ts";
import type { Patch } from "../patch.ts";

/** What every emblem adds of its own since Groot Night. */
const EMBLEM = { health: 10 } as const;

/** A Good Branch, as a charm boon: the emblem, with its health, and the trait it grants. */
const branch: BoonSpec = {
  name: "A Good Branch",
  sort: "charm",
  gives: "canopycharm",
  text: `An emblem for one figure to hold, with +${EMBLEM.health}% health: it is a Canopy as well, and counts as one more Canopy.`,
  short: `Gives an emblem: +${EMBLEM.health}% health, a Canopy too.`,
  n: {},
  quip: "Holds, mostly.",
};

export const UP_THE_TREE: Patch = {
  release: "up-the-tree",
  figures: {
    // Out of normal mode from this release: the Grooters after two sets (Peep, Munch, Clutch), Brew, the
    // last Ember, and Orphion, whose seat Unc takes.
    retire: ["peep", "kettle", "munch", "clutch", "whitefox"],
    add: {
      // The dev, and an LHZ: gives a cast back to whichever friend cast last.
      vi: {
        name: "Vi",
        tier: 1,
        kin: "canopy",
        calling: "chorus",
        extra: ["lhz"],
        hp: 320,
        attack: 32,
        speed: 0.75,
        range: 4,
        armour: 15,
        ward: 20,
        mana: [0, 60],
        ability: {
          name: "Hot Reload",
          shape: "ally",
          text: "The friend who used an ability most recently gets {mana} mana back. Never itself, and never another Vi.",
          n: { mana: [50, 70, 100] },
          short: "Ally who cast last: +{mana} mana.",
        },
        quip: "It works on its branch.",
        prize: "Leafkin",
      },
      // Falls over on purpose, gets up, and everyone near has to hit it.
      flop: {
        name: "Flop",
        tier: 2,
        kin: "canopy",
        calling: "bulwark",
        extra: [],
        hp: 560,
        attack: 34,
        speed: 0.6,
        range: 1,
        armour: 30,
        ward: 25,
        mana: [30, 80],
        ability: {
          name: "Plays Dead",
          shape: "self",
          text: "Falls over for {down} seconds, where nothing reaches it. It gets up with {heal}% of its health back, and every enemy within two hexes has to attack it for {taunt} seconds.",
          n: { down: [2, 2, 2], heal: [40, 50, 60], taunt: [2, 2, 3] },
          short: "Hides {down}s, then heals {heal}%. Taunts within 2 for {taunt}s.",
        },
        quip: "Fine. Completely fine.",
        prize: "Sapling",
      },
      // The hacker: a shield on its row, and each one's first enemy ability blocked.
      bhlue: {
        name: "Bhlue",
        tier: 3,
        kin: "canopy",
        calling: "mender",
        extra: [],
        hp: 520,
        attack: 34,
        speed: 0.65,
        range: 2,
        armour: 25,
        ward: 30,
        mana: [30, 90],
        ability: {
          name: "Firewall",
          shape: "ally",
          text: "Every friend in its row gets a shield of {shield} for {lasts} seconds, and for those seconds the first enemy ability to hit each of them is blocked.",
          n: { shield: [180, 310, 560], lasts: [4, 4, 4] },
          short: "Row: shield {shield} for {lasts}s. Blocks first enemy ability.",
        },
        quip: "Not again.",
        prize: "Sprite",
        stands: "row",
      },
      // Its attacks are aces: each card's suit picks its target.
      ace: {
        name: "Ace",
        tier: 4,
        kin: "canopy",
        calling: "slinger",
        extra: [],
        hp: 500,
        attack: 54,
        speed: 0.85,
        range: 4,
        armour: 20,
        ward: 20,
        mana: [0, 80],
        ability: {
          name: "Full Deck",
          shape: "bolt",
          text: "Throws all four at once, each to the target its suit picks: {damage} physical damage, or for hearts that much health back.",
          n: { damage: [110, 190, 345] },
          short: "4 cards, {damage} physical each; hearts heal.",
        },
        quip: "Pick a card. It picked you.",
        prize: "Dryad",
      },
      // The ranged carry at five acorns.
      unc: {
        name: "Unc",
        tier: 5,
        kin: "feather",
        calling: "slinger",
        extra: ["canopy"],
        hp: 620,
        attack: 70,
        speed: 0.85,
        range: 4,
        armour: 25,
        ward: 25,
        mana: [0, 80],
        ability: {
          name: "Knock On Wood",
          shape: "bolt",
          text: "Drums for {lasts} seconds: {pecks} pecks at its target, {damage} physical damage each. If the target falls, the rest go to the enemy nearest where it fell.",
          n: { pecks: [8, 8, 10], lasts: [3, 3, 3], damage: [82, 145, 320] },
          short: "{pecks} pecks over {lasts}s, {damage} physical each.",
        },
        quip: "Back in its day this was all tree.",
        prize: "Treant",
      },
      // The headliner, the set's own: every tool there is, in turn.
      leetanns: {
        name: "Leetanns",
        tier: 5,
        kin: "canopy",
        calling: "fang",
        extra: ["crafter"],
        hp: 920,
        attack: 82,
        speed: 0.8,
        range: 1,
        armour: 40,
        ward: 30,
        mana: [0, 60],
        ability: {
          name: "Gathering Run",
          shape: "bolt",
          text: "Swings the next tool in turn. Axe: {chop} physical damage to its target, pushed {push} hex. Pickaxe: {mine} physical damage to its target, and its armour is halved for {lasts} seconds. Rod: hooks the enemy furthest away that can be pulled onto a free hex beside it. Scythe: {reap} physical damage to every enemy touching it, and it heals for {leech}% of what lands.",
          n: {
            chop: [380, 665, 1520],
            push: [1, 1, 2],
            mine: [380, 665, 1520],
            lasts: [5, 5, 5],
            reap: [290, 510, 1160],
            leech: [50, 50, 50],
          },
          short: "Axe, pickaxe, rod, scythe in turn.",
        },
        quip: "Has worn out every tool the gnomes make. Twice.",
        prize: "Yggdrasil",
      },
    },
  },
  traits: {
    add: {
      canopy: {
        name: "Canopy",
        sort: "kin",
        steps: [3, 5],
        gist: "Starts up the tree.",
        text: [
          "Canopy figures start the fight up in the branches, where nothing reaches them. After {up} seconds they drop to their seats with a shield worth {shield}% of their health and {mana} mana.",
          "Canopy figures start the fight up in the branches, where nothing reaches them. After {up} seconds they drop to their seats with a shield worth {shield}% of their health and a full mana bar.",
        ],
        short: [
          "Up the tree {up}s, then shield {shield}%, +{mana} mana.",
          "Up the tree {up}s, then shield {shield}%, full mana.",
        ],
        n: { up: [2, 2], shield: [20, 35], mana: [30, 0], full: [0, 1] },
      },
      crafter: {
        name: "Crafter",
        sort: "own",
        steps: [1],
        gist: "Makes what the raid needs. Nobody asked.",
        text: ["After every {every} fights fought on the board, a component is added to your rack."],
        short: ["Every {every} fights on the board: a component."],
        n: { every: [3] },
      },
    },
    change: {
      feather: {
        steps: [2, 3, 4, 5],
        text: [
          "Feather figures attack {quicken}% faster after every attack, up to {stacks} times over.",
          "Feather figures attack {quicken}% faster after every attack, up to {stacks} times over.",
          "Feather figures attack {quicken}% faster after every attack, up to {stacks} times over.",
          "Feather figures attack {quicken}% faster after every attack, up to {stacks} times over.",
        ],
        short: [
          "+{quicken}% attack speed per attack, {stacks} times.",
          "+{quicken}% attack speed per attack, {stacks} times.",
          "+{quicken}% attack speed per attack, {stacks} times.",
          "+{quicken}% attack speed per attack, {stacks} times.",
        ],
        n: { quicken: [4, 6, 8, 11], stacks: [10, 10, 10, 10] },
      },
      slinger: {
        steps: [2, 4, 6],
        text: [
          "Slingers reach {reach} hex further, and each attack on the same target does {focus}% more than the last, up to {most} times over.",
          "Slingers reach {reach} hex further, and each attack on the same target does {focus}% more than the last, up to {most} times over.",
          "Slingers reach {reach} hex further, and each attack on the same target does {focus}% more than the last, up to {most} times over.",
        ],
        short: [
          "+{reach} reach, +{focus}% per hit on one target.",
          "+{reach} reach, +{focus}% per hit on one target.",
          "+{reach} reach, +{focus}% per hit on one target.",
        ],
        n: { reach: [1, 1, 1], focus: [7, 13, 20], most: [6, 6, 6] },
      },
    },
  },
  items: { add: { canopycharm: emblem("canopy", "A Good Branch", "Holds, mostly.", EMBLEM) } },
  boons: { add: { canopycharm: branch } },
};
