/**
 * What is always in view over the yard: the power as two numbers and a bar, the order in hand, the
 * buttons for the yard's books, and the way back to town. In a visit, only "Top yards" of the books,
 * and in the order's place a strip that says whose yard it is.
 */

import { link } from "@sequoia-leaf/kit/card.ts";
import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import { outside } from "@sequoia-leaf/kit/net.ts";
import { leave } from "@sequoia-leaf/kit/shell.ts";
import { faceFor, facesCame } from "@sequoia-leaf/kit/skin.ts";
import { isMuted, setMuted, sfx } from "@sequoia-leaf/kit/sound.ts";
import { tip } from "@sequoia-leaf/kit/tip.ts";
import { AWAY_MOST_MS, isFilled, PLANS, planState, power, SHIFT, storyOrder } from "@sequoia-leaf/yard";

import type { Art } from "../art/index.ts";
import { S } from "../state.ts";
import { coins, collect, keepScreen } from "../yard.ts";
import { orderRef } from "./card.ts";
import { storyLabel } from "./notes.ts";
import { type PanelId, togglePanel } from "./panels.ts";
import { $, button, pic, wantRows, when, type YardIcon, yardIcon } from "./parts.ts";

const books = new Map<PanelId, HTMLElement>();

/** Puts a small count on a button's corner, or takes it off. */
function set(b: HTMLElement, n: string | null): void {
  if (n) b.dataset.n = n;
  else delete b.dataset.n;
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
      ? `The yard uses ${p.demand} power and makes ${p.supply}. Every machine works at ${Math.round(p.pace * 100)}% speed.`
      : `The yard uses ${p.demand} of the ${p.supply} power it makes.`;
  });
  return when(
    () => {
      const p = power(S.world);
      return `${p.demand}/${p.supply}`;
    },
    () => {
      const p = power(S.world);
      nums.textContent =
        p.pace < 1 ? `${p.demand} / ${p.supply} · ${Math.round(p.pace * 100)}%` : `${p.demand} / ${p.supply}`;
      nums.classList.toggle("short", p.pace < 1);
      host.classList.toggle("short", p.pace < 1);
      bar.classList.toggle("coral", p.pace < 1);
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
  return when(
    () => {
      const w = S.world;
      const o = storyOrder(w);
      const got = o ? Object.values(w.filled).join() : "";
      return `${w.story}|${got}|${w.board.map((s) => (isFilled(s.want, s.filled) ? 1 : 0)).join("")}`;
    },
    () => {
      const w = S.world;
      const o = storyOrder(w);
      const ready = w.board.filter((s) => isFilled(s.want, s.filled)).length;
      host.replaceChildren(
        el(
          "div",
          "k-row",
          {},
          el("span", "k-label k-grow", { text: o ? `${storyLabel()} · ${o.from}` : storyLabel() }),
          ready > 0 ? el("span", "k-chip lit", { text: `${ready} to hand over` }) : null,
        ),
        el("div", "", { text: o ? o.title : "Story complete" }),
        ...(o ? wantRows(art, o.want, w.filled) : []),
      );
    },
  );
}

function bookButtons(): () => void {
  const host = $("books");
  const make = (
    id: PanelId & YardIcon,
    title: string,
    key: string,
    about?: () => string,
    green = false,
  ): HTMLElement => {
    const b = el(
      "button",
      green ? "k-btn leaf icon pip" : "k-btn wood icon pip",
      { type: "button", "aria-label": title },
      yardIcon(id),
    );
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
  const plansBtn = make("plans", "Plans", "P", () => "Improvements to buy with Coins.");
  make("depot", "The depot", "I", () => "What the depot has taken in, and what the yard earns per hour.");
  make(
    "shift",
    "A second shift",
    "L",
    () => `Everything works twice as fast for ${SHIFT.minutes} minutes. Costs ${SHIFT.leaf} Leaf.`,
    true,
  );
  return when(
    () => {
      const w = S.world;
      const ready = w.board.filter((s) => isFilled(s.want, s.filled)).length;
      const buyable = PLANS.filter((p) => planState(w, p.id).state === "for sale" && coins() >= p.price).length;
      return `${ready}|${buyable}|${S.panel}`;
    },
    () => {
      const w = S.world;
      const ready = w.board.filter((s) => isFilled(s.want, s.filled)).length;
      const buyable = PLANS.filter((p) => planState(w, p.id).state === "for sale" && coins() >= p.price).length;
      set(ordersBtn, ready > 0 ? String(ready) : null);
      set(plansBtn, buyable > 0 ? String(buyable) : null);
      for (const [id, b] of books) b.classList.toggle("down", S.panel === id);
    },
  );
}

function corner(): void {
  const host = $("corner");
  const back = el("button", "k-btn wood icon", { type: "button", "aria-label": "Back to town" }, yardIcon("town"));
  back.addEventListener("click", () => {
    // What is in the till goes into the purse on the way out.
    collect();
    keepScreen();
    sfx.close();
    leave();
  });
  tip(back, "Back to town", `The yard keeps working for up to ${AWAY_MOST_MS / 3_600_000} hours while you are away.`);
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
}
