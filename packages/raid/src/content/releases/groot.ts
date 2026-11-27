/**
 * The expansion's first release, open on merge: Graid, a new origin whose figures get back up in
 * their true form (`graid.ts`); Seqwawa, the guild's own tree as a five-acorn healer on everyone's
 * stall; Moss and Mender at 2/3/4, with Mender 4 turning overhealing into a shield. Worm, Moth,
 * Rock, Greg and Orphion are Graid from here, and Orphion a Sage. What the figures are called is
 * the base's: they had their names before this release changed anything.
 */
import type { Patch } from "../patch.ts";

export const GROOT: Patch = {
  release: "groot",
  figures: {
    add: {
      // It never moves and never attacks (its own trait, Rooted); its reach only says where it sits, at the back, behind the party it heals.
      seqwawa: {
        name: "Seqwawa",
        tier: 5,
        kin: "moss",
        calling: "mender",
        extra: ["rooted"],
        hp: 850,
        attack: 0,
        speed: 0,
        range: 4,
        armour: 40,
        ward: 40,
        mana: [20, 115],
        rooted: true,
        ability: {
          name: "No GG Left Behind",
          shape: "ally",
          text: "Every friend gets {heal} health back. The last friend to fall, if it fell in the last {window} seconds, gets back up with {back} health.",
          n: { heal: [140, 245, 560], back: [200, 350, 800], window: [3, 3, 3] },
          short: "Heals every ally {heal}. The last to fall in {window}s rises with {back}.",
        },
        quip: "Sits where the tree was. Was the tree.",
        prize: "Treant",
      },
    },
    change: {
      moth: { extra: ["graid"] },
      worm: { extra: ["graid"] },
      rock: { extra: ["graid"] },
      greg: { kin: "graid" },
      whitefox: { calling: "sage", extra: ["graid"] },
    },
  },
  traits: {
    add: {
      graid: {
        name: "Graid",
        sort: "kin",
        steps: [2, 3, 5],
        gist: "Gets back up as the raiders tell it.",
        text: [
          "The first Graid figure to fall each fight gets back up {wait} second later in its true form, with {health}% of its health. A Graid figure in its true form has {more}% more attack and ability power.",
          "Every Graid figure gets back up once a fight, {wait} second after it falls, in its true form, with {health}% of its health. A Graid figure in its true form has {more}% more attack and ability power.",
          "Every Graid figure gets back up once a fight, {wait} second after it falls, in its true form, with {health}% of its health and its mana bar at least {mana}% full. A Graid figure in its true form has {more}% more attack and ability power.",
        ],
        short: [
          "First Graid down rises in true form, {health}% health.",
          "Every Graid rises once in true form, {health}% health.",
          "Every Graid rises once: {health}% health, {mana}% mana.",
        ],
        n: { wait: [1, 1, 1], health: [15, 15, 30], every: [0, 1, 1], mana: [0, 0, 50], more: [10, 10, 10] },
      },
      rooted: {
        name: "Rooted",
        sort: "own",
        steps: [1],
        gist: "It was a tree first.",
        text: ["Does not move or attack, cannot be pushed or pulled, and gains {mana} mana a second."],
        short: ["Never moves or attacks; +{mana} mana a second."],
        n: { mana: [12] },
      },
    },
    change: {
      moss: {
        steps: [2, 3, 4],
        text: [
          "The whole party regrows {regrow}% of its health every second.",
          "The whole party regrows {regrow}% of its health every second.",
          "The whole party regrows {regrow}% of its health every second.",
        ],
        short: [
          "Party regrows {regrow}% health/s.",
          "Party regrows {regrow}% health/s.",
          "Party regrows {regrow}% health/s.",
        ],
        n: { regrow: [1.2, 2, 3] },
      },
      mender: {
        steps: [2, 3, 4],
        text: [
          "Menders' healing and shields count for {mending}% more.",
          "Menders' healing and shields count for {mending}% more.",
          "Menders' healing and shields count for {mending}% more. Their healing past a friend's full health becomes a shield for {lasts} seconds, up to {over}% of that friend's health.",
        ],
        short: [
          "Heals and shields +{mending}%.",
          "Heals and shields +{mending}%.",
          "Heals, shields +{mending}%; overheal shields up to {over}%.",
        ],
        n: { mending: [20, 30, 35], over: [0, 0, 15], lasts: [0, 0, 4] },
      },
    },
  },
};
