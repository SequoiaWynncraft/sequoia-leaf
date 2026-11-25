import {
  exact,
  leafForLevel,
  type QuestObjective,
  type QuestSlot,
  type QuestTemplate,
  type RuleChange,
  type Rules,
  whole,
} from "@sequoia-leaf/core";

/** A Discord embed, as much of one as the rate card uses. */
export interface Embed {
  readonly title: string;
  readonly description: string;
  readonly color: number;
  readonly fields: readonly EmbedField[];
  readonly footer: { readonly text: string };
  /** When the rates last changed, as an ISO time. Discord shows it beside the footer. */
  readonly timestamp?: string;
}

export interface EmbedField {
  readonly name: string;
  readonly value: string;
}

/** How many of the latest changes the card lists. */
const CHANGES_SHOWN = 5;

/** Sequoia's green. */
const COLOR = 0x4f9d5d;

/**
 * A raid member's share of the party's season rating by the gambits they took,
 * from three down to none, as Wynncraft awards it. Leaf pays per point of it.
 */
const SHARE_BY_GAMBITS = [110, 80, 60, 50] as const;

const TIER_NAMES: readonly (readonly [string, string])[] = [
  ["bronze", "Bronze"],
  ["silver", "Silver"],
  ["gold", "Gold"],
  ["platinum", "Platinum"],
  ["diamond", "Diamond"],
  ["obsidian", "Obsidian"],
  ["mythril", "Mythril"],
];

const LADDER_NAMES: Readonly<Record<string, string>> = { "raid:": "Raid milestones", "war:": "War milestones" };

const HOUR_MS = 60 * 60 * 1000;

/** An objective in a rate card's words, any raid kind standing in for the one a quest names. */
function objective(goal: QuestObjective): string {
  switch (goal.type) {
    case "raids":
      return goal.raid === undefined ? `${goal.count} raids` : `${goal.count} of one raid`;
    case "wars":
      return `${goal.count} wars`;
    case "season_rating":
      return `${whole(goal.amount)} season rating`;
  }
}

/** One line per kind of quest in a slot: quests that differ only in which raid they name share a line. */
function questLines(templates: readonly QuestTemplate[], slot: QuestSlot): string[] {
  const lines = templates
    .filter((template) => template.slot === slot)
    .map(
      (template) =>
        `• ${template.objectives.map(objective).join(" or ")}: **${whole(template.reward.leaf)}** Leaf, ${whole(template.reward.xp)} XP`,
    );
  return [...new Set(lines)];
}

function questField(name: string, intro: string, lines: readonly string[]): EmbedField[] {
  return lines.length === 0 ? [] : [{ name, value: [intro, ...lines].join("\n") }];
}

/** A UTC day, `YYYY-MM-DD`, as "21 Nov". */
function day(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * The rate card Leaf keeps in Discord: what everything pays and costs under
 * `rules`, and the latest of `changes`. It is made from the rules Leaf runs
 * with, so it always says what Leaf really pays.
 */
export function rateCard(rules: Rules, changes: readonly RuleChange[]): Embed {
  const { earning, quests, levels, achievements } = rules;
  const raidLeaf = SHARE_BY_GAMBITS.map((share) => whole(Math.floor(share * earning.leafPerRaidSeasonRating)));
  const xpNote = achievements.grantsXp ? "" : " No XP.";

  const fields: EmbedField[] = [
    {
      name: "Raids",
      value:
        `**${raidLeaf.join(" / ")}** Leaf for 3 / 2 / 1 / 0 gambits: ${exact(earning.leafPerRaidSeasonRating)} Leaf per point of your share of the raid's season rating. ` +
        "When the mod didn't see your gambits, the party's rating is split evenly.",
    },
    {
      name: "Wars",
      value:
        `**${exact(earning.leafPerWarPoint)}** Leaf per war point in FFA wars and snipes, ` +
        `**${exact(earning.leafPerClaimWarPoint)}** per war point when we take back our own claim.`,
    },
    ...questField(
      "Daily quests",
      `One a day, up to ${quests.dailyChargeCap} banked, so missing days costs nothing. One of:`,
      questLines(quests.templates, "daily"),
    ),
    ...questField("Weekly quest", "Monday to Monday (UTC). One of:", questLines(quests.templates, "weekly")),
    ...(quests.timed === undefined
      ? []
      : questField(
          "Timed quest",
          `A new one every ${quests.timed.everyMs / HOUR_MS} hours (UTC), open for ${quests.timed.openMs / HOUR_MS}, the same for the whole guild. One of:`,
          questLines(quests.templates, "timed"),
        )),
    ...questField(
      "Repeatable quest",
      "Finish one and the next begins. One of:",
      questLines(quests.templates, "repeatable"),
    ),
    ...achievements.ladders.map((ladder) => ({
      name: LADDER_NAMES[ladder.prefix] ?? `${ladder.prefix} milestones`,
      value:
        TIER_NAMES.flatMap(([id, name]) => {
          const leaf = ladder.leafByMilestone.get(id);
          return leaf === undefined ? [] : [`${name} **${whole(leaf)}**`];
        }).join(" · ") + `.${xpNote}`,
    })),
    {
      name: "Levels",
      value:
        `Raids and wars give as much XP as Leaf, quests the XP they list. Level 2 takes ${whole(levels.firstLevelXp)} XP and each level after it ${whole(levels.xpGrowthPerLevel)} more. ` +
        `Each level pays Leaf: ${whole(leafForLevel(2, levels))} for level 2, ${whole(levels.leafGrowthPerLevel)} more for each one after (${whole(leafForLevel(10, levels))} for level 10).`,
    },
    ...(quests.reroll === undefined
      ? []
      : [
          {
            name: "Quest swaps",
            value: `Swap a ${quests.reroll.slots.join(" or ")} quest you don't fancy: ${quests.reroll.freePerDay} free a day for each, then **${whole(quests.reroll.leaf)}** Leaf a swap.`,
          },
        ]),
    ...(changes.length === 0
      ? []
      : [
          {
            name: "Recent changes",
            value: changes
              .slice(0, CHANGES_SHOWN)
              .map((change) => `**${day(change.date)}**: ${change.text}`)
              .join("\n"),
          },
        ]),
  ];

  const latest = changes[0];
  return {
    title: "Leaf rates",
    description: "What Leaf pays right now. This message updates itself whenever the rates change.",
    color: COLOR,
    fields,
    footer: { text: "Last changed" },
    ...(latest === undefined ? {} : { timestamp: `${latest.date}T00:00:00.000Z` }),
  };
}
