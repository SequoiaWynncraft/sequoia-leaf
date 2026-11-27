/**
 * What the page shows of the second way to set out, with the figures the member has pulled: the
 * choice between the two ways on the front page, the sign over the table saying which way the raid
 * in hand is, and a figure's level wherever it is written. A level is always a small green "Lv 3",
 * never a star.
 */
import { wearPeople } from "@sequoia-leaf/figures/member.ts";
import { PEOPLE } from "@sequoia-leaf/figures/people.ts";
import type { Block } from "@sequoia-leaf/kit/card.ts";
import { type Choice, choices } from "@sequoia-leaf/kit/choices.ts";
import { el } from "@sequoia-leaf/kit/dom.ts";
import {
  available,
  catalogAt,
  catalogOf,
  type Era,
  type FigureId,
  isFigureId,
  levelBoost,
  levelOf,
  LEVELS,
  type RunView,
  stallOdds,
  type TraitId,
  type UnitKind,
  wayOn,
  wayWords,
} from "@sequoia-leaf/raid";

import { snd } from "../sounds.ts";
import { changed, onChange, S } from "../state.ts";

/** What each way of setting out is called, as to its figures (`wayWords`): every figure, or those the member has pulled. */
const wayName = (own: boolean): string => wayWords(wayOn({ id: "trail", trail: 0 }, own ? {} : null)).figures;
/** Whether a run set out with the member's own figures. */
const isOwn = (run: RunView): boolean => run.way.figures.pool === "own";
const NOT_COUNTED = "Not counted for the board or the almanac.";
/** What a run with the member's own figures off a trail counts for. */
const OWN_BOARDS = "Not counted for the almanac. Your deepest room goes on the boards for your figures.";
/** What a run with the member's own figures counts for: on a trail nothing, on an endless way its own boards. */
export const countedLine = (endless: boolean): string => (endless ? OWN_BOARDS : NOT_COUNTED);

/** The way picked on the front page to set out by. */
const picked = { own: false };
/** How many figures the member has pulled. */
const pulled = (): number => Object.keys(S.roster).length;
/**
 * The figures there are for this member, as Leaf's era has them: everyone's, and each banner's
 * headliner they have pulled. What "of 28 figures" counts, the almanac's tiles, and who a trait's
 * card lists.
 */
export const figuresHere = (era: Era = S.era): readonly FigureId[] =>
  available(catalogAt(era), { for: "almanac", roster: S.roster });
/** The figures for the table on screen: in the era of its run (a seat's is its sitting's), or of Leaf's view with none. */
export const figuresAt = (run: Pick<RunView, "era"> | null): readonly FigureId[] => figuresHere(run?.era);
/** The almanac's traits: those open in the era of Leaf's view, in their own order. */
export const traitsHere = (): readonly TraitId[] => catalogOf(S).ids.traits;
/** Everyone's figures, as Leaf's era has them: what the almanac counts fielded among. */
export const everyonesFigures = (): readonly FigureId[] => available(catalogOf(S), { for: "almanac", roster: {} });
/** Wears each banner's people as the page's store hears who they are, and draws the page again each time one is better known. */
export const meetMember = (): void => wearPeople(PEOPLE, changed);
/** Whether the member can choose whose figures to set out with: once they have pulled one. */
export const choosesFigures = (): boolean => pulled() > 0;
/** Whether the front page sets out with the member's own figures: never for a member who has pulled none. */
export const setsOutOwn = (): boolean => picked.own && pulled() > 0;

const WAYS: readonly Choice<"all" | "own">[] = [
  { id: "all", name: wayName(false) },
  { id: "own", name: wayName(true) },
];

/** A part of the page held in its place but not shown: unseen, and out of the keyboard's way. */
export const unshown = (shown: boolean): Record<string, string> => (shown ? {} : { "aria-hidden": "true", inert: "" });

/**
 * The front page's part on how to set out: for a member who has pulled a figure, the two ways to
 * choose from (`choice`) and what the chosen one is (`said`, both held in one place, so that choosing
 * moves nothing); for anyone else the one line about the one way there is. While the raid laid out
 * has fought no room (`keep`), nothing is chosen. The same choice is on the trails' card and the
 * endless ways' (`endless`: what a run with the member's own figures counts for there). Apart, so a
 * card holds the choice first, in the same place on each, and the words last, where the room kept
 * for the longer is no gap.
 */
export function waysOf(
  keep: boolean,
  redraw: () => void,
  endless = false,
): { choice: HTMLElement | null; said: HTMLElement | null } {
  const fair = (shown = true): HTMLElement =>
    el("p", "k-read fair", { text: "Everyone plays with the same figures here.", ...unshown(shown) });
  if (keep) return { choice: null, said: pulled() > 0 ? null : fair() };
  if (pulled() === 0) return { choice: null, said: fair() };
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
    el("span", "", { text: countedLine(endless) }),
  );
  return { choice: ways.el, said: el("div", "stack", {}, fair(!setsOutOwn()), about) };
}

/** Which way a raid is, before the line about it on the front page: said to a member who has both ways. */
export const wayPrefix = (run: RunView): string => (isOwn(run) || pulled() > 0 ? `${wayName(isOwn(run))}. ` : "");

/** The end page's second column when a run brought nothing new: for a run with the member's own figures, why. */
export const nothingNew = (run: RunView): HTMLElement[] => [
  el("div", "k-label", { text: isOwn(run) ? wayName(true) : "New in the almanac" }),
  el("span", "k-dim", { text: isOwn(run) ? countedLine(run.way.course.id !== "trail") : "Nothing this time." }),
];

/** After the almanac's count of figures met: how many the member has pulled, if any. */
export const pulledLine = (): string => (pulled() > 0 ? ` ${pulled()} pulled.` : "");

/** The sign in the top bar saying which way the raid in hand is, kept as the table changes. */
export function waySign(): HTMLElement {
  const sign = el("span", "k-plaque hung k-leafy", { id: "way", hidden: true });
  onChange(() => {
    const run = S.run;
    sign.hidden = !run || (!isOwn(run) && pulled() === 0);
    if (run) sign.textContent = wayName(isOwn(run));
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
function oddsShares(run: Pick<RunView, "way" | "level" | "era">): { cost: number; share: string }[] {
  const odds = stallOdds(run);
  const total = Math.max(
    1,
    odds.reduce((a, b) => a + b, 0),
  );
  return odds.flatMap((w, i) => (w > 0 ? [{ cost: i + 1, share: `${Math.round((w * 100) / total)}%` }] : []));
}
/** The same as a row for the level's plaque, each share in its cost's colour; and as the numbers of the level's card. */
export const oddsRow = (run: Pick<RunView, "way" | "level" | "era">): HTMLElement =>
  el("span", "odds", {}, ...oddsShares(run).map(({ cost, share }) => el("span", `t${cost}`, { text: share })));
export const oddsStats = (run: RunView): { label: string; value: string }[] =>
  oddsShares(run).map(({ cost, share }) => ({ label: `${cost}-acorn figures`, value: share }));
