/**
 * Groot Night, the Nest's banner (8 December 2026). A new origin, Grooter, whose hits crack armour
 * and ward: Peep, Munch and Clutch (the Nest the gnomes carved as a bird's nest), and the
 * Commodore, a member's figure who calls four more members as his grooters. A new class, Chorus,
 * for mana by the second: Twig, Brew and Drizzle carry it as a third trait, and Crab #31. Crab #8,
 * a Sneak who takes no place on the board (Stowaway). Crab's top step at 7 with six members,
 * Sneak's first hits a little softer, the four emblems the banner brings, and +10% health on every
 * emblem.
 *
 * It retires as many figures from normal mode as it brings (`RAID-SETS.md`), so the stall has as
 * many a cost as before and copies come round as often: Peep, Munch and Crab #31 have their tier's
 * numbers, as `RAID-BANNERS.md` gave them. Crab keeps its opener at 2. The bots clear the trail
 * about as often as before (`review/balance.ts`, beside it with `era=gaz-stall`).
 */
import type { BoonSpec } from "../boons.ts";
import { charm, EMBLEM } from "../charms.ts";
import { emblem, type ItemId, type ItemSpec, NO_STATS } from "../items.ts";
import type { Patch } from "../patch.ts";

/** A charm the base brought, as Groot Night words it: the same, with its emblem's health. */
function worded(gives: ItemId, trait: string): Partial<BoonSpec> {
  const { text, short } = charm(gives, "", trait, "");
  return { text, short };
}
/** The health every emblem the base brought has from Groot Night. */
const STATS: Partial<ItemSpec> = { stats: { ...NO_STATS, ...EMBLEM } };

export const GROOT_NIGHT: Patch = {
  release: "groot-night",
  figures: {
    // Out of normal mode from this release (`RAID-SETS.md`): Flint, Toast, Shrub, Reed and Vesta, one a
    // figure it brings, cost for cost. Ember leaves but Brew, Chorus's two-acorn figure.
    retire: ["emberkit", "cindernewt", "bushgnome", "heron", "hearthcat"],
    add: {
      // Goes for whoever is hardest to crack.
      peep: {
        name: "Peep",
        tier: 1,
        kin: "grooter",
        calling: "slinger",
        extra: [],
        hp: 220,
        attack: 24,
        speed: 0.8,
        range: 4,
        armour: 15,
        ward: 10,
        mana: [0, 60],
        ability: {
          name: "Hat Off",
          shape: "bolt",
          text: "Takes its hat off and throws it at the enemy in its reach with the most armour: {damage} physical damage, and that enemy has {crack} less armour and ward for the rest of the fight.",
          n: { damage: [60, 105, 190], crack: [10, 14, 20] },
          short: "{damage} physical to the most armoured in reach. Cracks {crack} armour and ward.",
        },
        quip: "Halfway out. Staying there.",
        prize: "Leafkin",
      },
      // Keeps time for the roll call, and the party's mana coming.
      crab31: {
        name: "Crab #31",
        tier: 3,
        kin: "crab",
        calling: "chorus",
        extra: [],
        hp: 420,
        attack: 30,
        speed: 0.7,
        range: 2,
        armour: 25,
        ward: 25,
        mana: [20, 80],
        ability: {
          name: "Clack",
          shape: "ally",
          text: "Clacks its pebbles: the {count} friends nearest it with a mana bar gain {mana} mana, and it gets a shield of {shield} for {lasts} seconds.",
          n: { count: [2, 2, 3], mana: [25, 35, 50], shield: [120, 210, 380], lasts: [4, 4, 4] },
          short: "{count} nearest allies +{mana} mana. Shield {shield} for {lasts}s.",
        },
        quip: "Taps one foot. Has done since spring.",
        prize: "Sprite",
        stands: "mana",
      },
      // Eats you shell and all: three bites, each at whoever it is after then.
      munch: {
        name: "Munch",
        tier: 3,
        kin: "grooter",
        calling: "fang",
        extra: [],
        hp: 520,
        attack: 46,
        speed: 0.75,
        range: 1,
        armour: 30,
        ward: 20,
        mana: [0, 60],
        ability: {
          name: "Shell And All",
          shape: "bolt",
          text: "Bites its target {bites} times in {lasts} second: {damage} physical damage a bite, and each bite takes {crack} armour and ward off it for the rest of the fight.",
          n: { bites: [3, 3, 3], lasts: [1, 1, 1], damage: [55, 95, 170], crack: [6, 8, 12] },
          short: "{bites} bites over {lasts}s, {damage} physical each. Each cracks {crack} armour and ward.",
        },
        quip: "Eats the shell first.",
        prize: "Sprite",
      },
      // The Nest, carved as a nest. With as many Hatchlings up as it may have, it keeps its mana.
      clutch: {
        name: "Clutch",
        tier: 4,
        kin: "grooter",
        calling: "bulwark",
        extra: [],
        hp: 800,
        attack: 40,
        speed: 0.55,
        range: 1,
        armour: 45,
        ward: 40,
        mana: [30, 90],
        ability: {
          name: "Mind The Eggs",
          shape: "summon",
          text: "An egg rolls out and hatches on a free hex beside it: a Hatchling with {health} health and {attack} attack joins the fight, at most {most} at a time.",
          n: { health: [180, 320, 580], attack: [28, 50, 90], most: [3, 3, 3] },
          short: "Hatchling: {health} health, {attack} attack. {most} at most.",
        },
        quip: "It is a nest. It walked here.",
        prize: "Druid",
      },
      // A four-acorn figure's numbers at every star, because it takes no place on the board.
      crab8: {
        name: "Crab #8",
        tier: 5,
        kin: "crab",
        calling: "sneak",
        extra: ["stowaway"],
        hp: 540,
        attack: 60,
        speed: 0.8,
        range: 1,
        armour: 30,
        ward: 25,
        mana: [0, 60],
        ability: {
          name: "Was Never Here",
          shape: "leap",
          text: "Goes into its shell for {hides} second, where nothing reaches it, then comes up beside the enemy with the least health: {damage} physical damage. If that enemy falls, it does it again at once, up to {again} more.",
          n: { hides: [1, 1, 1], damage: [240, 420, 760], again: [1, 1, 2] },
          short: "Hides {hides}s, then {damage} physical to lowest health. Again on a kill, up to {again} more.",
        },
        quip: "On every list. In no seat.",
        prize: "Treant",
        chairs: 0,
      },
      // A member's figure, shown as the Commodore (the banner `shows` its title): never the member's name.
      // Light himself, his grooters doing the work: on everyone's stall while his banner is open, so between Vesta and
      // Greg at one star, as gaz is (`review/swap.ts`).
      commodore: {
        name: "Commodore",
        tier: 5,
        kin: "grooter",
        calling: "chorus",
        extra: [],
        hp: 480,
        attack: 36,
        speed: 0.75,
        range: 4,
        armour: 20,
        ward: 20,
        mana: [35, 100],
        ability: {
          name: "Any grooters in chat?",
          shape: "summon",
          text: "Rings for the grooters, and {wait} seconds later up to {most} of them stand on free hexes within 2 of the Commodore, each the next in turn, with {health} health and {attack} attack. Any grooter standing then is healed to full.",
          n: { health: [300, 440, 830], attack: [47, 70, 130], most: [3, 3, 3], wait: [0.8, 0.8, 0.8] },
          short: "Calls {most} grooters: {health} health, {attack} attack. Heals those still up to full.",
        },
        quip: "Calls the roll. Calls the raid.",
        prize: "Yggdrasil",
        stands: "room",
      },
    },
    // Chorus as a third trait.
    change: { finch: { extra: ["chorus"] }, kettle: { extra: ["chorus"] }, drizzlefrog: { extra: ["chorus"] } },
  },
  traits: {
    add: {
      grooter: {
        name: "Grooter",
        sort: "kin",
        steps: [2, 3, 4],
        gist: "Knows where the shell is thin.",
        text: [
          "Each attack or ability hit by a Grooter figure, or by what it summons, takes {crack} armour and {crack} ward off its target for the rest of the fight, up to {most} of each.",
          "Each attack or ability hit by a Grooter figure, or by what it summons, takes {crack} armour and {crack} ward off its target for the rest of the fight, up to {most} of each.",
          "Each attack or ability hit by a Grooter figure, or by what it summons, takes {crack} armour and {crack} ward off its target for the rest of the fight, up to {most} of each.",
        ],
        short: [
          "Hits crack {crack} armour and ward, up to {most}.",
          "Hits crack {crack} armour and ward, up to {most}.",
          "Hits crack {crack} armour and ward, up to {most}.",
        ],
        n: { crack: [4, 6, 8], most: [30, 50, 80] },
      },
      chorus: {
        name: "Chorus",
        sort: "calling",
        steps: [2, 3, 4],
        gist: "Keeps the mana coming.",
        text: [
          "The whole party gains {party} mana a second, and Chorus figures {own} instead.",
          "The whole party gains {party} mana a second, and Chorus figures {own} instead.",
          "The whole party gains {party} mana a second, and Chorus figures {own} instead.",
        ],
        short: [
          "Party +{party} mana a second; Chorus +{own}.",
          "Party +{party} mana a second; Chorus +{own}.",
          "Party +{party} mana a second; Chorus +{own}.",
        ],
        n: { party: [1, 2, 3], own: [2, 4, 6] },
      },
      stowaway: {
        name: "Stowaway",
        sort: "own",
        steps: [1],
        gist: "Takes no seat.",
        text: ["Takes none of your places on the board. A second Crab #8 does."],
        short: ["Takes no place on the board; a second one does."],
        n: {},
      },
    },
    change: {
      crab: {
        // The opener at 2 as before; the top step at 7, with six crabs and one of them free.
        steps: [2, 4, 7],
        text: [
          "Roll call: when the fight starts, a Crab #?? joins beside your crabs, with as many stars as your best crab.",
          "Roll call: when the fight starts, a Big Crab #?? joins beside your crabs, with as many stars as your best crab.",
          "Roll call: when the fight starts, a Big Crab #?? and two Crab #?? join beside your crabs, with as many stars as your best crab.",
        ],
        short: ["A Crab #?? joins.", "A Big Crab #?? joins.", "A Big Crab #?? and two Crab #?? join."],
        n: { big: [0, 1, 1], small: [1, 0, 2] },
      },
      // Five Sneaks now, and one of them takes no place.
      sneak: { n: { hits: [2, 3], extra: [35, 60] } },
    },
  },
  items: {
    add: {
      grootercharm: emblem("grooter", "Grooter Ping", "It has been pinged.", EMBLEM),
      choruscharm: emblem("chorus", "Tin Whistle", "One note. Everyone knows it.", EMBLEM),
      // A holder with no true form gets back up as itself.
      graidcharm: emblem("graid", "Party Finder", "Looking for one more.", EMBLEM),
      sneakcharm: emblem("sneak", "False Moustache", "Nobody you know.", EMBLEM),
    },
    change: {
      embercharm: STATS,
      mosscharm: STATS,
      mistcharm: STATS,
      burrowcharm: STATS,
      feathercharm: STATS,
      crabcharm: STATS,
      gnomecharm: STATS,
    },
  },
  boons: {
    add: {
      grootercharm: charm("grootercharm", "Grooter Ping", "Grooter", "It has been pinged."),
      choruscharm: charm("choruscharm", "Tin Whistle", "Chorus", "One note. Everyone knows it."),
      graidcharm: charm("graidcharm", "Party Finder", "Graid", "Looking for one more."),
      sneakcharm: charm("sneakcharm", "False Moustache", "Sneak", "Nobody you know."),
    },
    change: {
      embercharm: worded("embercharm", "Ember"),
      mosscharm: worded("mosscharm", "Moss"),
      mistcharm: worded("mistcharm", "Mist"),
      burrowcharm: worded("burrowcharm", "Burrow"),
      feathercharm: worded("feathercharm", "Feather"),
      crabcharm: worded("crabcharm", "Crab"),
      gnomecharm: worded("gnomecharm", "Gnome"),
    },
  },
};
