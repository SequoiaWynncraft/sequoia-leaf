/**
 * What the page shows of the second way to set out, with the figures the member has pulled: the
 * choice between the two ways on the front page, the sign over the table saying which way the raid
 * in hand is, and a figure's level wherever it is written. A level is always a small green "Lv 3",
 * never a star.
 */
import { meetMembers } from "@sequoia-leaf/figures/member.ts";
import type { Block } from "@sequoia-leaf/kit/card.ts";
import { type Choice, choices } from "@sequoia-leaf/kit/choices.ts";
import { el } from "@sequoia-leaf/kit/dom.ts";
import {
  type FigureId,
  figuresFor,
  isFigureId,
  levelBoost,
  levelOf,
  LEVELS,
  type RunView,
  stallOdds,
  type UnitKind,
} from "@sequoia-leaf/raid";

import { snd } from "../sounds.ts";
import { changed, onChange, S } from "../state.ts";

/** What each way of setting out is called: with every figure, or with those the member has pulled. */
const wayName = (own: boolean): string => (own ? "Your figures" : "All figures");
const NOT_COUNTED = "Not counted for the board or the almanac.";

/** The way picked on the front page to set out by. */
const picked = { own: false };
/** How many figures the member has pulled. */
const pulled = (): number => Object.keys(S.roster).length;
/**
 * The figures there are for this member: the twenty-eight, and each banner's member they have
 * pulled. What "of 28 figures" counts, the almanac's tiles, and who a trait's card lists.
 */
export const figuresHere = (): readonly FigureId[] => figuresFor(S.roster);
/** Asks who each banner's member is, and draws the page again each time one is better known. */
export const meetMember = (): Promise<void> => meetMembers(changed);
/** Whether the front page sets out with the member's own figures: never for a member who has pulled none. */
export const setsOutOwn = (): boolean => picked.own && pulled() > 0;

const WAYS: readonly Choice<"all" | "own">[] = [
  { id: "all", name: wayName(false) },
  { id: "own", name: wayName(true) },
];

/** A part of the page held in its place but not shown: unseen, and out of the keyboard's way. */
export const unshown = (shown: boolean): Record<string, string> => (shown ? {} : { "aria-hidden": "true", inert: "" });

/**
 * The front page's part on how to set out, under the trails: for a member who has pulled a figure,
 * the two ways to choose from and what the chosen one is (both held in one place, so that choosing
 * moves nothing); for anyone else the one line about the one way there is. While the raid laid out
 * has fought no room (`keep`), nothing is chosen.
 */
export function waysOf(keep: boolean, redraw: () => void): (HTMLElement | null)[] {
  const fair = (shown = true): HTMLElement =>
    el("p", "k-read fair", { text: "Everyone plays with the same figures here.", ...unshown(shown) });
  if (keep) return [pulled() > 0 ? null : fair()];
  if (pulled() === 0) return [fair()];
  const ways = choices(WAYS, {
    kind: "radio",
    name: "Figures",
    chosen: setsOutOwn() ? "own" : "all",
    choose: (id) => {
      picked.own = id === "own";
      snd.tap();
      redraw();
    },
  });
  const about = el(
    "div",
    "k-col tight k-read",
    unshown(setsOutOwn()),
    el("b", "", { text: `You have ${pulled()} of ${figuresHere().length} figures.` }),
    el("span", "", {
      text: `In these raids you are offered every 1-acorn figure to buy with acorns, and other figures only if you have pulled them at the Grove. Each copy of a figure you have pulled after the first is 1 level: ${LEVELS.boost}% more health and attack, up to level ${LEVELS.most}.`,
    }),
    el("span", "", { text: NOT_COUNTED }),
  );
  return [ways.el, el("div", "stack", {}, fair(!setsOutOwn()), about)];
}

/** Which way a raid is, before the line about it on the front page: said to a member who has both ways. */
export const wayPrefix = (run: RunView): string => (run.own || pulled() > 0 ? `${wayName(run.own !== null)}. ` : "");

/** The end page's second column when a run brought nothing new: for a run with the member's own figures, why. */
export const nothingNew = (run: RunView): HTMLElement[] => [
  el("div", "k-label", { text: run.own ? wayName(true) : "New in the almanac" }),
  el("span", "k-dim", { text: run.own ? NOT_COUNTED : "Nothing this time." }),
];

/** After the almanac's count of figures met: how many the member has pulled, if any. */
export const pulledLine = (): string => (pulled() > 0 ? ` ${pulled()} pulled.` : "");

/** The sign in the top bar saying which way the raid in hand is, kept as the table changes. */
export function waySign(): HTMLElement {
  const sign = el("span", "k-plaque hung k-leafy", { id: "way", hidden: true });
  onChange(() => {
    const run = S.run;
    sign.hidden = !run || (!run.own && pulled() === 0);
    if (run) sign.textContent = wayName(run.own !== null);
  });
  return sign;
}

/** A level as a small tag; none for level 0, but among the figures pulled (`pulled`). */
export const levelTag = (level: number | undefined, among = false): HTMLElement | null =>
  level !== undefined && (among || level > 0) ? el("span", "lv k-leafy", { text: `Lv ${level}` }) : null;
/** The tag of a figure's level in a run. */
export const runTag = (run: RunView, kind: UnitKind): HTMLElement | null =>
  levelTag(isFigureId(kind) ? levelOf(run, kind) : 0);
/** The tag of a figure among those the member has pulled, in the almanac. */
export const pulledTag = (kind: UnitKind): HTMLElement | null =>
  levelTag(isFigureId(kind) ? S.roster[kind] : undefined, true);

/** What a card is told of the figure it shows, as far as its level goes. */
interface Shown {
  readonly level?: number;
  readonly lore?: boolean;
  readonly run?: RunView | null;
}
/**
 * A figure's level on its card: the level its numbers are raised by (the one the card is told, else
 * its level in the run; none in the almanac, whose numbers are everybody's), the tag for the head,
 * and the line saying what the level gives (in the almanac, of the level the member has pulled it to).
 */
export function levelOnCard(kind: UnitKind, shown: Shown): { level: number; tag: HTMLElement | null; blocks: Block[] } {
  const figure = isFigureId(kind) ? kind : null;
  const pulledTo = figure ? (S.roster[figure] ?? 0) : 0;
  const inRun = figure && shown.run ? levelOf(shown.run, figure) : 0;
  const level = shown.lore ? pulledTo : (shown.level ?? inRun);
  const where = shown.lore ? " in a raid with your figures" : "";
  return {
    level: shown.lore ? 0 : level,
    tag: levelTag(level),
    blocks: level > 0 ? [{ body: `Level ${level}: ${levelBoost(level)}% more health and attack${where}.` }] : [],
  };
}

/** What a reroll brings at a run's level: each cost that can come, from one acorn up, with its share of a hundred. */
function oddsShares(run: Pick<RunView, "own" | "level">): { cost: number; share: string }[] {
  const odds = stallOdds(run);
  const total = Math.max(
    1,
    odds.reduce((a, b) => a + b, 0),
  );
  return odds.flatMap((w, i) => (w > 0 ? [{ cost: i + 1, share: `${Math.round((w * 100) / total)}%` }] : []));
}
/** The same as a row for the level's plaque, each share in its cost's colour; and as the numbers of the level's card. */
export const oddsRow = (run: Pick<RunView, "own" | "level">): HTMLElement =>
  el("span", "odds", {}, ...oddsShares(run).map(({ cost, share }) => el("span", `t${cost}`, { text: share })));
export const oddsStats = (run: RunView): { label: string; value: string }[] =>
  oddsShares(run).map(({ cost, share }) => ({ label: `${cost}-acorn figures`, value: share }));
