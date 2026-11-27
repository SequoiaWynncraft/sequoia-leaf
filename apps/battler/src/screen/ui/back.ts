import { portrait } from "@sequoia-leaf/figures/sprites.ts";
/**
 * The card that picks a run of the Wilds back up. Carrying on with it from the front page shows this
 * before the table: where the run is in its wing, the wing's rule, the boss waiting, the deepest room
 * ever, and how the last room went; then Carry on, Watch it again (the run's last fight, which the
 * run keeps, while it is planning a room: `watchable`), or back to the front page. No timer: a run
 * never runs out.
 */
import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import { roomOf, type RunView } from "@sequoia-leaf/raid";

import { glyph } from "../art/icons.ts";
import { watchable } from "../screen.ts";
import { S, type Slot } from "../state.ts";
import { figPic, pic } from "./cards.ts";
import { courseName } from "./endless.ts";
import { ruleRow } from "./rulecards.ts";
import { backLines, bossOfWing } from "./wilds.ts";

/** Whether the card is up, over the front page. */
const BACK: { up: boolean } = { up: false };
/** The run of the Wilds laid out, if one is: the run whose card it is. */
export const wildsLaid = (): RunView | null => (S.laid.endless?.way.course.id === "wilds" ? S.laid.endless : null);
export const backUp = (): boolean => BACK.up && wildsLaid() !== null;
/** Puts the card up, or away. */
export const showBack = (up: boolean): void => {
  BACK.up = up;
};

/** What the card asks of the page. */
export interface BackAsks {
  carryOn: (slot: Slot) => void;
  watch: (slot: Slot) => void;
  redraw: () => void;
}

/** The card, for the run of the Wilds laid out. */
export function backCard(go: BackAsks, run: RunView): HTMLElement {
  // The member's deepest with the figures this run set out with: everyone's, or their own, kept apart.
  const lines = backLines(run, (run.way.figures.pool === "own" ? S.apart.deepest : S.almanac.deepest).wilds);
  const boss = bossOfWing(run.room);
  const { named } = roomOf(run);
  const back = (): void => {
    showBack(false);
    go.redraw();
  };
  return el(
    "section",
    "k-card mode back",
    { "aria-label": courseName("wilds") },
    el(
      "div",
      "mode-head",
      {},
      boss.kind ? figPic(portrait(boss.kind)) : null,
      el(
        "div",
        "k-col tight",
        {},
        el("h2", "k-title big", { text: courseName("wilds") }),
        el("p", "k-d", { text: lines.where }),
      ),
    ),
    el(
      "div",
      "mode-opts k-col",
      {},
      // The rules the run is under, each with its picture; else what is said about the next one.
      ...(named.length > 0 ? named.map((rule) => ruleRow(rule, "k-d")) : [el("p", "k-d", { text: lines.rule })]),
      ...[lines.boss, lines.best, lines.last].map((text) => (text ? el("p", "k-d", { text }) : null)),
    ),
    el(
      "div",
      "k-row back-foot",
      {},
      el("button", "k-btn wood", { type: "button", id: "back-front", onclick: back }, icon("back"), "Back"),
      watchable(run)
        ? el(
            "button",
            "k-btn blue",
            { type: "button", id: "back-watch", onclick: () => go.watch("endless") },
            pic(glyph("play")),
            "Watch it again",
          )
        : null,
      el(
        "button",
        "k-btn",
        { type: "button", id: "back-carry", onclick: () => go.carryOn("endless") },
        pic(glyph("play")),
        "Carry on",
      ),
    ),
  );
}
