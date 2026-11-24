/**
 * What is always in view over the yard: the power as two numbers and a bar, the node in hand (a
 * lesson, a project or the commission) and under it the research being studied, the buttons for the
 * yard's books, and the way back to town. The tier's screen has its button only once tier 1 is open,
 * and research only once the Study may be built. The last button is the depot's until the yard owns
 * a second plot, and from then the yard's (`views.ts`; on a phone it leads the row instead, so that
 * its count has room: `index.html`): the same sheet, with its map and its list of trouble, and on the
 * button how many pieces are in trouble. In a visit, only "Top yards" of the books, and in the node's
 * place a strip that says whose yard it is.
 */

import { GOALS, isFilled, power, TICK_MS, tierName } from "@sequoia-leaf/factory";
import { link } from "@sequoia-leaf/kit/card.ts";
import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import { outside } from "@sequoia-leaf/kit/net.ts";
import { leave } from "@sequoia-leaf/kit/shell.ts";
import { faceFor, facesCame } from "@sequoia-leaf/kit/skin.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { tip } from "@sequoia-leaf/kit/tip.ts";

import { WORKS_KEYS, type WorksAction } from "../keymap.ts";
import { S } from "../state.ts";
import { collect, keepScreen } from "../yard.ts";
import { nodeKind, wantsShort } from "./goal.ts";
import { openPanel, type PanelId, togglePanel } from "./panels.ts";
import { $, button, iconButton, pic, shows, when, type YardIcon, yardIcon } from "./parts.ts";
import { orderRef } from "./refs.ts";
import { studyStrip } from "./research.ts";
import { givenTo, nextUp, nextWords, researchOpen, studiable, takeable, tierOpen } from "./standing.ts";
import { hasViews, refreshWalk, wrongCount } from "./views.ts";

const books = new Map<PanelId, HTMLElement>();
/** What each book's button is called: the tier's, by the tier. */
const titles = new Map<PanelId, (tier: number) => string>();

/** Puts a small count on a button's corner, or takes it off. One of three digits or more is set small, to fit the corner. */
function set(b: HTMLElement, n: string | null): void {
  if (n) b.dataset.n = n;
  else delete b.dataset.n;
  b.classList.toggle("long", n !== null && n.length > 2);
}

function powerPlaque(): () => void {
  const host = $("power");
  const nums = el("span");
  const fill = el("i");
  const bar = el("div", "k-bar", {}, fill);
  host.append(yardIcon("bolt"), nums, bar);
  host.addEventListener("click", () => {
    togglePanel("power");
  });
  tip(host, "Power", () => {
    const p = power(S.world);
    return p.pace < 1
      ? `The yard uses ${p.demand} power and makes ${p.supply}. Every machine works at ${Math.floor(p.pace * 100)}% speed.`
      : `The yard uses ${p.demand} of the ${p.supply} power it makes.`;
  });
  return shows(
    () => {
      const p = power(S.world);
      return { demand: p.demand, supply: p.supply, pace: Math.floor(p.pace * 100) };
    },
    (p) => {
      const short = p.pace < 100;
      nums.textContent = short ? `${p.demand} / ${p.supply} · ${p.pace}%` : `${p.demand} / ${p.supply}`;
      host.setAttribute("aria-label", `Power ${nums.textContent}`);
      nums.classList.toggle("short", short);
      host.classList.toggle("short", short);
      bar.classList.toggle("coral", short);
      fill.style.setProperty("--v", `${Math.min(100, (p.demand / Math.max(1, p.supply)) * 100)}%`);
    },
  );
}

/**
 * The box in the corner: the node in hand, what it wants (each a picture, a bar and a count) and what
 * comes into hand after it; pressed, it opens Orders. With nothing in hand it says what comes next in
 * the tier screen's words (the goal waited on, with its lock; projects to take; or everything done),
 * and pressed, it opens the tier's screen, where that is. Orders filled and waiting to be handed over
 * are counted on the small line over its title, and while there are any, pressed, it opens Orders.
 */
function tracker(): () => void {
  const host = $("track");
  host.addEventListener("click", () => {
    const w = S.world;
    const ready = w.board.some((s) => isFilled(s.want, s.filled));
    togglePanel(w.hand === -1 && !ready && tierOpen() ? "tier" : "orders");
  });
  // Pointing (or a finger kept on it) shows the card of the node in hand, or of the goal waited on.
  link(host, orderRef("story"), { acts: true });
  return shows(
    () => {
      const w = S.world;
      return {
        hand: w.hand,
        next: w.hand === -1 ? nextUp() : null,
        ready: w.board.filter((s) => isFilled(s.want, s.filled)).length,
        wants: w.hand === -1 ? [] : givenTo(w.hand),
        after: GOALS[w.queue[0] ?? -1]?.title ?? null,
      };
    },
    (p) => {
      const next = p.next;
      const said = next ? nextWords(next) : null;
      const label = p.hand === -1 ? (said?.label ?? "") : nodeKind(p.hand);
      // What it wants, by the one part that lays such rows out: here each a picture, a bar and a count.
      const wanted = wantsShort(p.wants);
      host.replaceChildren(
        el(
          "div",
          "k-row",
          {},
          label === "" ? null : el("span", "k-label k-grow", { text: label }),
          p.ready > 0 ? el("span", "k-chip lit", { text: `${p.ready} to hand over` }) : null,
        ),
        el("div", "", { text: said?.title ?? GOALS[p.hand]?.title ?? "" }),
        ...(wanted ? [wanted.node] : []),
        ...(said === null
          ? []
          : [
              next?.is === "locked"
                ? el("span", "k-row", {}, icon("lock"), said.line)
                : el("span", next?.is === "done" ? "k-d" : "k-label", { text: said.line }),
            ]),
        ...(p.after === null ? [] : [el("span", "k-label then", { text: `Then: ${p.after}` })]),
      );
    },
  );
}

/**
 * What the books' buttons print: the counts on their corners (orders ready to hand over, projects
 * that may be taken, research that may be put in the line, pieces in trouble), which are there, and
 * which is open or nudged.
 */
export const booksPrint = () => ({
  ready: S.world.board.filter((s) => isFilled(s.want, s.filled)).length,
  open: takeable().length,
  study: studiable().length,
  // The tier's screen is there once there is more than lessons, and research once the Study may be built.
  tier: tierOpen() ? S.world.open.tier : null,
  research: researchOpen(),
  yard: hasViews(),
  // Looked for at most once a second, and not at all in a yard of one plot or in a visit.
  wrong: S.visiting ? 0 : wrongCount(),
  panel: S.panel,
  nudged: S.nudge?.part ?? null,
});

/** A name with a count said after it in words: "Research, 7 to study"; with no count, the name alone. */
const said = (name: string, n: number, words: string): string => (n > 0 ? `${name}, ${n} ${words}` : name);

/**
 * What each button with a count on its corner is called, the count said in words for whoever cannot
 * see the corner: "Research, 7 to study"; with no count, its name alone.
 */
export function bookNames(
  p: ReturnType<typeof booksPrint>,
  title: (id: PanelId) => string,
): Map<PanelId | "yard", string> {
  return new Map<PanelId | "yard", string>([
    ["orders", said(title("orders"), p.ready, "ready")],
    ["board", title("board")],
    ["tier", said(title("tier"), p.open, "to take")],
    ["research", said(title("research"), p.study, "to study")],
    ["depot", title("depot")],
    ["yard", said("The yard", p.wrong, "in trouble")],
  ]);
}

function bookButtons(): () => void {
  const host = $("books");
  const make = (
    id: PanelId,
    art: YardIcon,
    title: (tier: number) => string,
    act: WorksAction,
    about?: () => string,
  ) => {
    const b = iconButton("wood pip", yardIcon(art), title(S.world.open.tier), () => {
      togglePanel(id);
    });
    b.dataset.book = id;
    tip(b, () => `${title(S.world.open.tier)} (${WORKS_KEYS.name(act)})`, about);
    books.set(id, b);
    titles.set(id, title);
    if (!S.visiting || id === "board") host.append(b);
    return b;
  };
  const ordersBtn = make("orders", "orders", () => "Orders", "orders");
  make("board", "board", () => "Top yards", "board");
  const tierBtn = make("tier", "projects", tierName, "tier");
  const researchBtn = make("research", "research", () => "Research", "research");
  const depotBtn = make("depot", "depot", () => "The depot", "depot");
  // The same sheet once the yard owns a second plot, with its map and its list of trouble: the yard's button.
  const yardBtn = iconButton("wood pip bad", yardIcon("map"), "The yard", () => {
    togglePanel("depot");
  });
  tip(yardBtn, () => `The yard (${WORKS_KEYS.name("move")})`);
  if (!S.visiting) host.append(yardBtn);
  return shows(booksPrint, (p) => {
    set(ordersBtn, p.ready > 0 ? String(p.ready) : null);
    set(tierBtn, p.open > 0 ? String(p.open) : null);
    set(researchBtn, p.study > 0 ? String(p.study) : null);
    tierBtn.hidden = p.tier === null;
    researchBtn.hidden = !p.research;
    depotBtn.hidden = p.yard;
    yardBtn.hidden = !p.yard;
    set(yardBtn, p.wrong > 0 ? String(p.wrong) : null);
    const names = bookNames(p, (id) => titles.get(id)?.(p.tier ?? 0) ?? "");
    for (const [id, b] of books) {
      b.classList.toggle("down", p.panel === id);
      b.classList.toggle("nudged", p.nudged === id && p.panel !== id);
      b.setAttribute("aria-label", names.get(id) ?? "");
    }
    yardBtn.setAttribute("aria-label", names.get("yard") ?? "");
    yardBtn.classList.toggle("down", p.panel === "depot");
  });
}

/** Leaves for the town (with `camp`, on to that player's camp): what is in the till goes into the purse on the way out. */
export function toTown(camp?: string): void {
  collect();
  keepScreen();
  sfx.close();
  leave(camp);
}

/** The corner: back to town, and the gear for the settings menu (`settings.ts`). */
function corner(gear: HTMLElement): void {
  const host = $("corner");
  const back = iconButton("wood", yardIcon("town"), "Back to town", () => {
    toTown();
  });
  tip(
    back,
    "Back to town",
    () => `The yard keeps working for up to ${(S.world.open.away * TICK_MS) / 3_600_000} hours while you are away.`,
  );
  host.append(back, gear);
}

/** Opens the member's own yard, from a visit. */
export const myYard = (): void => outside.go(location.pathname);

/** In a visit: the owner's face, whose yard it is, and the way to the member's own. The yard's numbers are on its owner's card. */
function visitStrip(who: { readonly id: string; readonly name: string }): () => void {
  const host = $("visit");
  host.hidden = false;
  const mine = button("wood sm", ["My yard"], myYard);
  return when(
    () => String(facesCame()),
    () => {
      host.replaceChildren(
        el("span", "k-thing-pic", {}, pic(faceFor(who.id, who.name, true), 2)),
        el("b", "k-name who", { text: `${who.name}'s yard` }),
        mine,
      );
    },
  );
}

let parts: (() => void)[] = [];

export function initHud(gear: HTMLElement): void {
  parts = S.visiting
    ? [visitStrip(S.visiting), bookButtons()]
    : [powerPlaque(), tracker(), studyStrip(() => openPanel("research")), bookButtons()];
  corner(gear);
}

export function refreshHud(): void {
  for (const f of parts) f();
  // The bar that stays while a group of trouble is walked.
  refreshWalk();
}
