/**
 * Penguin Month, the penguins' banner (22 December 2026). A new origin, Huddle, whose figures that
 * start the fight touching share one shield: Dibs, Jet, Flurry, Larp as a third trait, and Yule,
 * the set's own healer, who puts friends in a bubble. Pomp, a gnome with a trumpet, Chorus's fifth.
 * Gnome stays at 2 and 4, with three Gnomes in the set (`RAID-SETS.md`). Sage gains a third step at
 * 6 and Chorus a fourth at 5. A sixth component, the Carving Knife, which turns up only after a boss
 * and makes a class emblem with any other component, or An Extra Chair with a second Knife.
 */
import { charm, EMBLEM } from "../charms.ts";
import { type ComponentId, emblem, type ItemSpec, NO_STATS } from "../items.ts";
import type { Patch } from "../patch.ts";
import type { TraitId } from "../traits.ts";

/** An emblem the Knife makes with a component: it grants a class and keeps the component's stat. */
const wooden = (grants: TraitId, name: string, half: readonly [ComponentId, ComponentId], quip: string): ItemSpec => ({
  ...emblem(grants, name, quip),
  made: half,
});

export const PENGUIN_MONTH: Patch = {
  release: "penguin-month",
  figures: {
    // Out of normal mode from this release: Hodge, Glorp, Drizzle, Eaves and Dose, each as the figure that
    // takes its job arrives (Dibs, Jet, Larp, Pomp, and Flurry's seat).
    retire: ["barrowgnome", "glorp", "drizzlefrog", "fogowl", "apothecary"],
    add: {
      // Shields itself and whoever is most hurt beside it.
      dibs: {
        name: "Dibs",
        tier: 1,
        kin: "huddle",
        calling: "bulwark",
        extra: [],
        hp: 310,
        attack: 20,
        speed: 0.6,
        range: 1,
        armour: 25,
        ward: 25,
        mana: [20, 70],
        ability: {
          name: "Budge Up",
          shape: "ally",
          text: "Pats a snow bank up: a shield of {shield} for {lasts} seconds on itself and on the most hurt friend touching it.",
          n: { shield: [90, 160, 285], lasts: [4, 4, 4] },
          short: "Shield {shield} for {lasts}s on itself. Same on the most hurt beside it.",
        },
        quip: "Got here first. Saved the spot.",
        prize: "Leafkin",
        stands: "touching",
      },
      // The first Sneak at two acorns.
      jet: {
        name: "Jet",
        tier: 2,
        kin: "huddle",
        calling: "sneak",
        extra: [],
        hp: 320,
        attack: 36,
        speed: 0.85,
        range: 1,
        armour: 20,
        ward: 15,
        mana: [0, 50],
        ability: {
          name: "Belly First",
          shape: "line",
          text: "Slides in a straight line through its target: {damage} physical damage to every enemy on the line, and ice there for {lasts} seconds, where enemies are {slow}% slower.",
          n: { damage: [100, 175, 315], slow: [30, 30, 30], lasts: [3, 3, 3] },
          short: "{damage} physical along a line. Ice there: {slow}% slower for {lasts}s.",
        },
        quip: "Faster this way.",
        prize: "Sapling",
        stands: "touching",
      },
      larp: {
        name: "Larp",
        tier: 3,
        kin: "gnome",
        calling: "slinger",
        extra: ["huddle"],
        hp: 380,
        attack: 40,
        speed: 0.75,
        range: 4,
        armour: 20,
        ward: 20,
        mana: [0, 60],
        ability: {
          name: "Snowball Fight",
          shape: "bolt",
          text: "Throws {balls} snowballs, each at a different enemy in its reach where it can: {damage} physical damage each.",
          n: { balls: [4, 4, 5], damage: [55, 95, 170] },
          short: "{balls} snowballs, {damage} physical each.",
        },
        quip: "Is a penguin. Ask it.",
        prize: "Sprite",
        stands: "touching",
      },
      // The first Sage at four acorns.
      flurry: {
        name: "Flurry",
        tier: 4,
        kin: "huddle",
        calling: "sage",
        extra: [],
        hp: 600,
        attack: 40,
        speed: 0.7,
        range: 4,
        armour: 20,
        ward: 30,
        mana: [20, 90],
        ability: {
          name: "Shake It",
          shape: "ring",
          text: "Shakes the globe: snow falls for {lasts} seconds on the enemy in its reach with the most enemies touching it and on the hexes touching that one: {damage} magic damage a second there, and enemies there are {slow}% slower.",
          n: { damage: [60, 105, 190], slow: [25, 25, 25], lasts: [4, 4, 4] },
          short: "Snow for {lasts}s: {damage} magic a second, {slow}% slower.",
        },
        quip: "Shake it. Go on.",
        prize: "Druid",
        stands: "touching",
      },
      // No penguin: a Gnome, and Chorus's fifth.
      pomp: {
        name: "Pomp",
        tier: 4,
        kin: "gnome",
        calling: "chorus",
        extra: [],
        hp: 560,
        attack: 36,
        speed: 0.7,
        range: 4,
        armour: 20,
        ward: 25,
        mana: [40, 90],
        ability: {
          name: "Fanfare",
          shape: "ally",
          text: "Every friend in its row gains {mana} mana and attacks {haste}% faster for {lasts} seconds.",
          n: { mana: [30, 45, 70], haste: [25, 35, 50], lasts: [4, 4, 4] },
          short: "Friends in its row: +{mana} mana, {haste}% faster for {lasts}s.",
        },
        quip: "Loud. On purpose.",
        prize: "Dryad",
        stands: "row",
      },
      // The set's own: drawn by the set, and on everyone's stall while its banner is open.
      yule: {
        name: "Yule",
        tier: 5,
        kin: "huddle",
        calling: "mender",
        extra: [],
        hp: 720,
        attack: 30,
        speed: 0.7,
        range: 4,
        armour: 30,
        ward: 35,
        mana: [50, 80],
        ability: {
          name: "Bubble Bath",
          shape: "ally",
          text: "Puts the most hurt friend in a bubble for {lasts} seconds: nothing can hurt them and they do nothing. They come out with {heal} health back and a full mana bar. Each later use bubbles 1 more friend, up to {most}.",
          n: { lasts: [2, 2, 2], heal: [520, 900, 2000], most: [3, 3, 4] },
          short: "Bubbles the most hurt for {lasts}s, 1 more each cast. Then +{heal} health and full mana.",
        },
        quip: "Runs the bath. Does not get in.",
        prize: "Yggdrasil",
        stands: "touching",
      },
    },
  },
  traits: {
    add: {
      huddle: {
        name: "Huddle",
        sort: "kin",
        steps: [2, 4, 5],
        gist: "Stands together.",
        text: [
          "Huddle figures that start the fight touching share one shield, worth {share}% of their health added together. One touching no other has none.",
          "Huddle figures that start the fight touching share one shield, worth {share}% of their health added together. One touching no other has none.",
          "Huddle figures that start the fight touching share one shield, worth {share}% of their health added together. 6 seconds after it breaks, it comes back once, worth {back}% of the health of those still up.",
        ],
        short: [
          "Touching Huddles share a {share}% shield.",
          "Touching Huddles share a {share}% shield.",
          "Shared {share}% shield, back once 6s after it breaks.",
        ],
        n: { share: [25, 35, 35], back: [0, 0, 35], wait: [6, 6, 6] },
      },
    },
    change: {
      sage: {
        steps: [2, 4, 6],
        text: [
          "Sages' abilities are {power}% stronger, and each of their attacks gives {mana} more mana.",
          "Sages' abilities are {power}% stronger, and each of their attacks gives {mana} more mana.",
          "Sages' abilities are {power}% stronger, and each of their attacks gives {mana} more mana.",
        ],
        short: [
          "Abilities +{power}%, +{mana} mana a hit.",
          "Abilities +{power}%, +{mana} mana a hit.",
          "Abilities +{power}%, +{mana} mana a hit.",
        ],
        n: { power: [25, 55, 90], mana: [3, 5, 7] },
      },
      chorus: {
        steps: [2, 3, 4, 5],
        text: [
          "The whole party gains {party} mana a second, and Chorus figures {own} instead.",
          "The whole party gains {party} mana a second, and Chorus figures {own} instead.",
          "The whole party gains {party} mana a second, and Chorus figures {own} instead.",
          "The whole party gains {party} mana a second, and Chorus figures {own} instead.",
        ],
        short: [
          "Party +{party} mana a second; Chorus +{own}.",
          "Party +{party} mana a second; Chorus +{own}.",
          "Party +{party} mana a second; Chorus +{own}.",
          "Party +{party} mana a second; Chorus +{own}.",
        ],
        n: { party: [1, 2, 3, 4], own: [2, 4, 6, 8] },
      },
    },
  },
  items: {
    add: {
      knife: {
        sort: "component",
        name: "Carving Knife",
        stats: NO_STATS,
        text: "Makes an emblem with any other component: the component's class, and its stat.",
        short: "Makes an emblem with any other component.",
        n: {},
        quip: "The gnomes will not say whose it is.",
        turnsUp: "boss",
      },
      huddlecharm: emblem("huddle", "Guild Onesie", "The old uniform. One size.", EMBLEM),
      woodentooth: wooden("fang", "Wooden Tooth", ["knife", "thorn"], "Sharper than the real one."),
      woodensling: wooden("slinger", "Wooden Sling", ["knife", "plume"], "Comes with one pebble."),
      woodenspectacles: wooden("sage", "Wooden Spectacles", ["knife", "glowcap"], "For reading the rules."),
      woodenbuckler: wooden("bulwark", "Wooden Buckler", ["knife", "bark"], "Told to stand in front."),
      woodenspoon: wooden("mender", "Wooden Spoon", ["knife", "chestnut"], "For the tonic."),
    },
  },
  boons: {
    add: {
      huddlecharm: charm("huddlecharm", "Guild Onesie", "Huddle", "The old uniform. One size."),
    },
    // Two Knives make it: the boon as it was, and a recipe of its own.
    change: { extrachair: { made: ["knife", "knife"] } },
  },
};
