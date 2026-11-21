/**
 * What a thing is and what it is doing: said in a line when it is pointed at, and in a card with
 * its recipe, what it holds and what can be done about it when it is clicked or tapped.
 */

import { amount, el, icon, replay } from "@sequoia-leaf/kit/dom.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { tip, tipOff } from "@sequoia-leaf/kit/tip.ts";

import type { Art } from "../art/index.ts";
import {
  aim,
  at,
  BUFFER,
  FUEL,
  ITEM,
  type Item,
  ITEMS,
  KIND,
  MADE_BY,
  plotState,
  rate,
  type Raw,
  setOpen,
  setRecipe,
  status,
  tipOut,
} from "../sim/index.ts";
import { yardSfx } from "../sound.ts";
import { S, touched } from "../state.ts";
import { buyLand, pickFrom, takeAway, turnAt } from "../tools.ts";
import { coins } from "../yard.ts";
import { togglePanel } from "./panels.ts";
import { $, button, fitted, pic, slot, when } from "./parts.ts";

const GROUND: Record<Raw, readonly [string, string]> = {
  deadfall: [
    "Deadfall",
    "Fallen branches off the forest floor. A gatherer here picks them up; a mill saws them into planks.",
  ],
  stone: ["A stone outcrop", "A gatherer here picks up stone; a mill fires it into bricks."],
  ore: ["An ore seam", "A gatherer here picks up ore; a mill smelts it into ingots."],
  clay: ["A clay bank", "A gatherer here digs clay; a mill fires it into pots."],
  sand: ["Sand", "A gatherer here shovels sand; a mill melts it into glass."],
  resin: ["Old stumps weeping resin", "A gatherer here collects resin; a mill presses it into lamp oil."],
};

/** What is on a tile, in a name and a line: for a tip, and for the head of its card. */
export function describe(x: number, y: number): readonly [string, string] | null {
  const w = S.world;
  const i = at(w, x, y);
  if (i < 0) return null;
  const plot = w.land.plots[w.land.plot[i] ?? -1];
  if (plot && !w.plots.includes(plot.id)) {
    const { state } = plotState(w, plot.id);
    return [
      plot.name,
      state === "for sale"
        ? `For sale at ${plot.price.toLocaleString("en-US")} Coins. ${plot.why}`
        : `Not for sale yet. ${plot.why}`,
    ];
  }
  const b = w.cells[i];
  if (b) {
    const st = status(w, i);
    return [KIND[b.kind].name, st?.line ?? KIND[b.kind].what];
  }
  const raw = w.land.deposit[i];
  if (raw) return GROUND[raw];
  if (w.land.water[i] === 1)
    return [
      "The stream",
      "Nothing is built on it. A waterwheel on its bank turns for nothing, and a tunnel goes under.",
    ];
  if (w.land.trunk[i] === 1)
    return ["A redwood", "Nothing here fells a living tree. Belts go round it, or under its roots by tunnel."];
  return null;
}

let theArt: Art | null = null;
let refresh: (() => void) | null = null;

/** Called when a card opens, with the tile it is about and the part of the page it covers. */
export const cardHooks: { opened: (x: number, y: number, box: DOMRect) => void } = { opened: () => {} };

export function initCard(art: Art): void {
  theArt = art;
}

export function closeCard(): void {
  if (S.picked < 0 && $("card").hidden) return;
  S.picked = -1;
  $("card").hidden = true;
  refresh = null;
  tipOff();
}

/** What lies in the ground of a plot, as words: "26 tiles of clay". */
function lies(plotIndex: number): string {
  const w = S.world;
  const counts = new Map<Raw, number>();
  let bank = 0;
  w.land.deposit.forEach((d, i) => {
    if (w.land.plot[i] !== plotIndex) return;
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
    if (w.land.water[i] === 1) bank++;
  });
  const parts = [...counts].map(([raw, n]) => `${n} tiles of ${ITEM[raw].many}`);
  if (bank > 0) parts.push("the stream");
  return parts.length > 0 ? parts.join(", ") : "open ground";
}

function thing(art: Art, item: Item, n: number | null): HTMLElement {
  const s = el("div", "k-slot", { title: ITEM[item].name }, pic(art.item(item), 1));
  if (n !== null) s.append(el("b", n === 0 ? "k-dim" : "", { text: String(n) }));
  tip(s, ITEM[item].name, n === null ? "" : `Holding ${n}.`);
  return s;
}

function draw(art: Art, i: number): void {
  const w = S.world;
  const card = $("card");
  const x = i % w.land.w;
  const y = Math.floor(i / w.land.w);
  const said = describe(x, y);
  const b = w.cells[i];
  const plot = w.land.plots[w.land.plot[i] ?? -1];
  if (!said) {
    closeCard();
    return;
  }
  const close = el(
    "button",
    "k-btn wood icon sm",
    { type: "button", "aria-label": "Close", onclick: closeCard },
    icon("close"),
  );
  const kids: (Node | null)[] = [];

  if (plot && !w.plots.includes(plot.id)) {
    // Land the yard does not own: what is on it, and what it would cost.
    const { state, why } = plotState(w, plot.id);
    kids.push(
      el(
        "div",
        "k-row top",
        {},
        slot(icon("star", 2), 24),
        el("div", "k-grow", {}, el("div", "k-title", { text: plot.name }), el("div", "k-d", { text: plot.why })),
        close,
      ),
      el("div", "k-d", { text: `In the ground: ${lies(w.land.plots.indexOf(plot))}.` }),
    );
    if (state === "for sale") {
      const buy = button(
        coins() >= plot.price ? "wide" : "wide off",
        [icon("coin"), `Buy for ${plot.price.toLocaleString("en-US")}`],
        (btn) => {
          if (!buyLand(plot.id)) replay(btn, "shake");
          else closeCard();
        },
      );
      kids.push(buy);
    } else kids.push(el("div", "k-d k-coral", { text: `${why ?? "Not for sale yet"}.` }));
  } else if (!b) {
    kids.push(
      el(
        "div",
        "k-row top",
        {},
        el("div", "k-grow", {}, el("div", "k-title", { text: said[0] }), el("div", "k-d", { text: said[1] })),
        close,
      ),
    );
  } else {
    const st = status(w, i);
    const maker = b.kind === "mill" || b.kind === "bench" || b.kind === "workshop" ? b.kind : null;
    const makes = maker !== null;
    kids.push(
      el(
        "div",
        "k-row top",
        {},
        slot(fitted(art.icon(b.kind), 22, 22), 26),
        el(
          "div",
          "k-grow",
          {},
          el("div", "k-title", { text: KIND[b.kind].name }),
          el("div", st?.trouble ? "k-d trouble" : "k-d", { text: st?.line ?? KIND[b.kind].what }),
        ),
        close,
      ),
    );
    // What goes in, what comes out, and how fast.
    const r = aim(b);
    const per = rate(w, i);
    if (b.kind === "gatherer") {
      const raw = w.land.deposit[i];
      if (raw)
        kids.push(
          el(
            "div",
            "recipe",
            {},
            thing(art, raw, null),
            el("span", "k-dim", { text: per > 0 ? `${Math.round(per)} a minute` : "" }),
          ),
        );
    } else if (makes && r) {
      kids.push(
        el(
          "div",
          "recipe",
          {},
          ...r.from.map((k) => thing(art, k, b.buf[k] ?? 0)),
          el("span", "k-dim", { text: "→" }),
          thing(art, r.out, null),
          el("span", "k-dim k-grow", { text: per > 0 ? `up to ${Math.round(per)} a minute` : "" }),
        ),
      );
    } else if (b.kind === "crate" || b.kind === "boiler") {
      const held = ITEMS.filter((k) => (b.buf[k] ?? 0) > 0);
      if (held.length > 0)
        kids.push(
          el(
            "div",
            "recipe",
            {},
            ...held.map((k) => thing(art, k, b.buf[k] ?? 0)),
            el("span", "k-dim", { text: b.kind === "boiler" ? `of ${FUEL}` : `of ${w.rates.crate}` }),
          ),
        );
    } else if (b.item !== null) kids.push(el("div", "recipe", {}, thing(art, b.item, null)));

    // A machine that can make more than one thing can be told to make just the one.
    if (maker) {
      const recipes = MADE_BY[maker];
      const any = el(
        "button",
        `k-slot${b.recipe === null ? " lit" : ""}`,
        { type: "button", "aria-label": "Whatever arrives" },
        icon("more"),
      );
      any.addEventListener("click", () => {
        setRecipe(S.world, x, y, null);
        sfx.tap();
        touched();
      });
      tip(any, "Whatever arrives", "It makes whatever the things it is brought add up to.");
      kids.push(
        el(
          "div",
          "pins",
          {},
          any,
          ...recipes.map((rec) => {
            const pin = el(
              "button",
              `k-slot${b.recipe === rec.out ? " lit" : ""}`,
              { type: "button", "aria-label": ITEM[rec.out].name },
              pic(art.item(rec.out), 1),
            );
            pin.addEventListener("click", () => {
              setRecipe(S.world, x, y, b.recipe === rec.out ? null : rec.out);
              sfx.tap();
              touched();
            });
            tip(
              pin,
              `Only ${ITEM[rec.out].many}`,
              `From ${rec.from.map((k) => ITEM[k].many).join(" and ")}. It will take in nothing else.`,
            );
            return pin;
          }),
        ),
      );
    }

    const acts: HTMLElement[] = [];
    const spare = st?.spare ?? null;
    if (b.count > 0 && (b.kind === "crate" || spare !== null || st?.state === "idle")) {
      const out = button(spare ? "sm" : "wood sm", [spare ? `Tip out the ${ITEM[spare].many}` : "Tip it out"], () => {
        const gone = tipOut(S.world, x, y, spare);
        if (gone > 0) yardSfx.take();
        touched();
      });
      tip(
        out,
        "Tip out",
        spare
          ? `It is full of ${ITEM[spare].many} and can take no more, so nothing behind them can get in. Tipping them out frees it; giving each part its own belt keeps it free.`
          : "Empties what it holds. What is tipped out is lost.",
      );
      acts.push(out);
    }
    if (b.kind === "crate") {
      const lid = button("wood sm", [b.open ? "Shut it" : "Open it"], () => {
        setOpen(S.world, x, y, !b.open);
        sfx.clack();
        touched();
      });
      tip(lid, b.open ? "Shut" : "Open", "Shut, it takes things in and lets nothing out, and so saves them up.");
      acts.push(lid);
    }
    if (b.kind === "depot") {
      acts.push(
        button("wood sm", ["Orders"], () => {
          togglePanel("orders");
        }),
        button("wood sm", ["Plans"], () => {
          togglePanel("plans");
        }),
        button("wood sm", ["Books"], () => {
          togglePanel("depot");
        }),
      );
    } else {
      if (b.kind !== "tunnel" && b.kind !== "pylon" && b.kind !== "wheel" && b.kind !== "boiler") {
        const t = button("wood sm", ["Turn"], () => {
          turnAt(x, y);
        });
        tip(t, "Turn (R)", "A quarter turn to the right. It costs nothing.");
        acts.push(t);
      }
      const more = button("wood sm", ["Another"], () => {
        pickFrom(x, y);
        closeCard();
      });
      tip(
        more,
        "Another (Q)",
        `Takes up the ${KIND[b.kind].name.toLowerCase()} as the tool in hand, facing the same way.`,
      );
      const refund = b.free ? 0 : KIND[b.kind].cost;
      const away = button("coral sm", ["Take away", refund > 0 ? amount("coin", `+${refund}`) : null], () => {
        takeAway(x, y);
        closeCard();
      });
      tip(
        away,
        "Take away",
        b.free
          ? "It goes back to hand, and can be stood again for nothing."
          : "All it cost comes back. What it is holding is lost.",
      );
      acts.push(more, away);
    }
    kids.push(el("div", "k-wrap", {}, ...acts));
    if (st?.state === "starved" && st.spare)
      kids.push(
        el("div", "k-d", {
          text: `A bench takes things in at its back and both sides. Bring ${ITEM[st.spare].many} in one way and ${(st.missing ?? []).map((k) => ITEM[k].many).join(" and ")} another, and it cannot fill up with the wrong one.`,
        }),
      );
  }
  card.replaceChildren(...kids.filter((k): k is Node => k !== null));
}

/** Opens the card for whatever is on a tile; closes it if there is nothing to say. */
export function openCard(x: number, y: number): boolean {
  const art = theArt;
  const w = S.world;
  const i = at(w, x, y);
  if (!art || i < 0 || !describe(x, y)) {
    closeCard();
    return false;
  }
  tipOff();
  const first = S.picked !== i;
  S.picked = i;
  const card = $("card");
  refresh = when(
    () => {
      const b = S.world.cells[i];
      const st = b ? status(S.world, i) : null;
      const held = b ? ITEMS.map((k) => b.buf[k] ?? 0).join("") : "";
      return `${S.rev}|${b?.kind}|${b?.dir}|${st?.line}|${held}|${b?.recipe}|${b?.open}|${b?.item}|${Math.floor(coins() / 50)}|${BUFFER}`;
    },
    () => {
      draw(art, i);
    },
  );
  refresh();
  if (S.picked !== i) return false;
  card.hidden = false;
  if (first) {
    replay(card, "k-rise");
    sfx.tap();
    // The thing the card is about stays in view over it.
    cardHooks.opened(x, y, card.getBoundingClientRect());
  }
  return true;
}

export function refreshCard(): void {
  if (S.picked >= 0) refresh?.();
}
