/**
 * What is always in view over the yard: the power as two numbers and a bar, the node in hand (a
 * lesson, a project or the commission), the buttons for the yard's books, and the way back to town.
 * Projects has its button only once tier 1 is open. The last button is the depot's until the yard
 * owns a second plot, and from then the yard's (`views.ts`; on a phone it leads the row instead, so
 * that its count has room: `index.html`): the same sheet, with its map and its list of trouble, and on
 * the button how many pieces are in trouble. In a visit, only "Top yards" of the books, and in the
 * node's place a strip that says whose yard it is.
 */

import { ALL_ITEMS, GOALS, isFilled, NODES, power, TICK_MS } from "@sequoia-leaf/factory";
import { link } from "@sequoia-leaf/kit/card.ts";
import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import { outside } from "@sequoia-leaf/kit/net.ts";
import { leave } from "@sequoia-leaf/kit/shell.ts";
import { faceFor, facesCame } from "@sequoia-leaf/kit/skin.ts";
import { isMuted, setMuted, sfx } from "@sequoia-leaf/kit/sound.ts";
import { tip } from "@sequoia-leaf/kit/tip.ts";

import type { Art } from "../art/index.ts";
import { S } from "../state.ts";
import { collect, keepScreen } from "../yard.ts";
import { orderRef } from "./card.ts";
import { handLabel } from "./notes.ts";
import { type PanelId, projectsOpen, takeable, togglePanel } from "./panels.ts";
import { $, button, pic, shows, wantRows, when, type YardIcon, yardIcon } from "./parts.ts";
import { hasViews, refreshWalk, wrongCount } from "./views.ts";

const books = new Map<PanelId, HTMLElement>();

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
      nums.classList.toggle("short", short);
      host.classList.toggle("short", short);
      bar.classList.toggle("coral", short);
      fill.style.setProperty("--v", `${Math.min(100, (p.demand / Math.max(1, p.supply)) * 100)}%`);
    },
  );
}

function tracker(art: Art): () => void {
  const host = $("track");
  host.addEventListener("click", () => {
    togglePanel("orders");
  });
  // Tapping opens the orders; pointing (or a finger kept on it) shows the order's card.
  link(host, orderRef("story"), { acts: true });
  return shows(
    () => {
      const w = S.world;
      const o = w.hand === -1 ? undefined : GOALS[w.hand];
      const got = w.hand === -1 ? null : (w.got[w.hand] ?? null);
      return {
        label: handLabel(),
        from: w.hand === -1 ? null : (NODES[w.hand]?.from ?? null),
        title: o?.title ?? null,
        ready: w.board.filter((s) => isFilled(s.want, s.filled)).length,
        wants: o
          ? ALL_ITEMS.filter((k) => (o.want[k] ?? 0) > 0).map(
              (k) => [k, Math.min(got?.[k] ?? 0, o.want[k] ?? 0), o.want[k] ?? 1] as const,
            )
          : [],
      };
    },
    (p) => {
      host.replaceChildren(
        el(
          "div",
          "k-row",
          {},
          el("span", "k-label k-grow", { text: p.from ? `${p.label} · ${p.from}` : p.label }),
          p.ready > 0 ? el("span", "k-chip lit", { text: `${p.ready} to hand over` }) : null,
        ),
        el("div", "", { text: p.title ?? "No project in hand" }),
        ...wantRows(art, p.wants),
      );
    },
  );
}

function bookButtons(): () => void {
  const host = $("books");
  const make = (id: PanelId & YardIcon, title: string, key: string, about?: () => string): HTMLElement => {
    const b = el("button", "k-btn wood icon pip", { type: "button", "aria-label": title }, yardIcon(id));
    b.addEventListener("click", () => {
      togglePanel(id);
    });
    tip(b, `${title} (${key})`, about);
    books.set(id, b);
    if (!S.visiting || id === "board") host.append(b);
    return b;
  };
  const ordersBtn = make("orders", "Orders", "O");
  make("board", "Top yards", "T");
  const projectsBtn = make("projects", "Projects", "P", () => "Deliveries for the guild. Each unlocks something.");
  const depotBtn = make("depot", "The depot", "I");
  // The same sheet once the yard owns a second plot, with its map and its list of trouble: the yard's button.
  const yardBtn = el(
    "button",
    "k-btn wood icon pip bad",
    { type: "button", "aria-label": "The yard" },
    yardIcon("map"),
  );
  yardBtn.addEventListener("click", () => {
    togglePanel("depot");
  });
  tip(yardBtn, "The yard (M)");
  if (!S.visiting) host.append(yardBtn);
  return shows(
    () => ({
      ready: S.world.board.filter((s) => isFilled(s.want, s.filled)).length,
      open: takeable().length,
      // Projects is there only once there are projects: from tier 1 on, and not in a visit.
      projects: projectsOpen(),
      yard: hasViews(),
      // Looked for at most once a second, and not at all in a yard of one plot or in a visit.
      wrong: S.visiting ? 0 : wrongCount(),
      panel: S.panel,
    }),
    (p) => {
      set(ordersBtn, p.ready > 0 ? String(p.ready) : null);
      set(projectsBtn, p.open > 0 ? String(p.open) : null);
      projectsBtn.hidden = !p.projects;
      depotBtn.hidden = p.yard;
      yardBtn.hidden = !p.yard;
      set(yardBtn, p.wrong > 0 ? String(p.wrong) : null);
      for (const [id, b] of books) b.classList.toggle("down", p.panel === id);
      yardBtn.classList.toggle("down", p.panel === "depot");
    },
  );
}

/** Leaves for the town (with `camp`, on to that player's camp): what is in the till goes into the purse on the way out. */
export function toTown(camp?: string): void {
  collect();
  keepScreen();
  sfx.close();
  leave(camp);
}

function corner(): void {
  const host = $("corner");
  const back = el("button", "k-btn wood icon", { type: "button", "aria-label": "Back to town" }, yardIcon("town"));
  back.addEventListener("click", () => {
    toTown();
  });
  tip(
    back,
    "Back to town",
    () => `The yard keeps working for up to ${(S.world.open.away * TICK_MS) / 3_600_000} hours while you are away.`,
  );
  const mute = el("button", "k-btn wood icon", { type: "button", "aria-label": "Sound" });
  const draw = (): void => {
    mute.replaceChildren(icon(isMuted() ? "mute" : "sound"));
  };
  mute.addEventListener("click", () => {
    setMuted(!isMuted());
    draw();
    sfx.tap();
  });
  tip(mute, "Sound");
  draw();
  host.append(back, mute);
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

export function initHud(art: Art): void {
  parts = S.visiting ? [visitStrip(S.visiting), bookButtons()] : [powerPlaque(), tracker(art), bookButtons()];
  corner();
}

export function refreshHud(): void {
  for (const f of parts) f();
  // The bar that stays while a group of trouble is walked.
  refreshWalk();
}
