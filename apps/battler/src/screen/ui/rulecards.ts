import { portrait } from "@sequoia-leaf/figures/sprites.ts";
/**
 * The Wilds' rules on the table (`wilds.ts` has the words): a rule's card on the pick and the boss
 * beside the two cards, the rule's line in a fight played under it, and the line said when figures
 * move off hexes that closed. The two lines never share a place: the moved-off line is planning's,
 * among the table's toasts, and gone once a fight starts; the rule's line is the fight's, on a line
 * of its own just above the stall, and while it is up the toasts stand above it.
 */
import { el } from "@sequoia-leaf/kit/dom.ts";
import { type Release, scope } from "@sequoia-leaf/kit/scope.ts";
import { type RaidNote, ROOM_RULES, type RuleId } from "@sequoia-leaf/raid";

import { ruleShown } from "../closed.ts";
import { onChange, S } from "../state.ts";
import { pic } from "./cards.ts";
import { bossOfWing, ruleSaid, shiftedLine } from "./wilds.ts";

/** A rule's card on the pick: its name and its sentence. */
export const ruleCard = (rule: RuleId): HTMLElement[] => [
  el("b", "k-gold", { text: ROOM_RULES[rule].name }),
  el("p", "k-d", { text: ROOM_RULES[rule].text }),
];

/** Beside the cards, the boss the wing ends with, so both can be judged against it. */
export function bossAhead(room: number): HTMLElement {
  const boss = bossOfWing(room);
  return el(
    "div",
    "k-plaque ahead",
    {},
    boss.kind ? pic(portrait(boss.kind), 2) : null,
    el(
      "div",
      "k-col tight",
      {},
      el("span", "k-dim", { text: `Boss in room ${boss.room}` }),
      el("b", "", { text: boss.name }),
    ),
  );
}

/**
 * In a fight played under a rule, the rule as one line, just above the stall over the bench, which
 * nothing uses while the figures fight (`#rule` in `raid.css`). While planning, the room's card says
 * it and the board shows its hexes.
 */
export function ruleSign(): HTMLElement {
  const sign = el("div", "k-plaque", { id: "rule", hidden: true });
  onChange(() => {
    const shown = S.run && S.screen.at === "fight" ? ruleShown(S.run) : null;
    sign.hidden = shown === null;
    if (shown) sign.textContent = shown.named.map(ruleSaid).join(" ");
    placeRule();
    showShifted();
  });
  return sign;
}
/** While the rule's line is up, the toasts stand above it (`--rule-band`): nothing else draws into its line. */
export function placeRule(): void {
  const sign = document.getElementById("rule");
  const up = sign !== null && !sign.hidden;
  document.body.toggleAttribute("data-rule", up);
  if (up) document.body.style.setProperty("--rule-band", `${sign.offsetHeight}px`);
}

/** How long the moved-off line stays, as long as any of the table's toasts. */
const SAID_MS = 2200;
const lines = scope();
/** The moved-off line: waiting for planning (the takings' sheet may be up when it comes), up, and when it goes. */
const SHIFTED: { waiting: string | null; line: HTMLElement | null; gone: Release | null } = {
  waiting: null,
  line: null,
  gone: null,
};
function dropShifted(): void {
  SHIFTED.gone?.();
  SHIFTED.line?.remove();
  SHIFTED.line = null;
  SHIFTED.gone = null;
}
/** Puts the moved-off line up once the room is being planned; takes it down, and any still waiting, once a fight starts. */
function showShifted(): void {
  if (S.screen.at === "fight") {
    SHIFTED.waiting = null;
    dropShifted();
    return;
  }
  const text = SHIFTED.waiting;
  const says = document.getElementById("says");
  if (S.screen.at !== "plan" || text === null || !says) return;
  SHIFTED.waiting = null;
  dropShifted();
  const line = el("div", "k-toast shifted", { text });
  says.append(line);
  SHIFTED.line = line;
  SHIFTED.gone = lines.after(SAID_MS, dropShifted);
}

/** Figures moved off hexes a rule closed are said in one line, while planning (`showShifted`). */
export function sayShifted(notes: readonly RaidNote[]): void {
  const text = S.run ? shiftedLine(notes, S.run) : null;
  if (text === null) return;
  SHIFTED.waiting = text;
  showShifted();
}
