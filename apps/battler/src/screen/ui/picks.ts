/**
 * Picks: three cards laid on the table to choose one from. The first figure to set out with, a
 * component after trouble, a boon now and then (with the one redraw). Nothing else can be done
 * until the pick is made, so the cards sit over the board.
 */
import { add, el } from "@sequoia-leaf/kit/dom.ts";

import {
  abilityShort,
  type BoonId,
  BOONS,
  boonShort,
  type Choice,
  choose,
  type ComponentId,
  COMPONENTS,
  type FigureId,
  FIGURES,
  itemAdds,
  itemName,
  redraw,
  roleLine,
  type Run,
  traitsOf,
} from "../../game/index.ts";
import { boonIcon, glyphPic, itemIcon, itemPic } from "../art/icons.ts";
import { portrait } from "../art/sprites.ts";
import { fly } from "../fx.ts";
import { combosWithHeld } from "../logic.ts";
import { signal } from "../signals.ts";
import { snd } from "../sounds.ts";
import { boardSpot } from "../stage.ts";
import { act, S } from "../state.ts";
import { pic, rich, traitTag } from "./cards.ts";
import { holdAcorns } from "./table.ts";

let key = "";

const TITLES: Readonly<Record<Choice["kind"], readonly [string, string]>> = {
  starter: ["Who sets out with you?", "One of these three. The rest you buy at the stall."],
  component: ["Something from the room", "A component. Two on one figure make an item."],
  boon: ["A boon", "One of these, for the rest of the raid."],
};

function starterCard(kind: FigureId): HTMLElement[] {
  const spec = FIGURES[kind];
  return [
    pic(portrait(kind), 3, "art"),
    el("b", "k-gold", { text: spec.name }),
    el("div", "k-d", { text: roleLine(spec.calling) }),
    el("div", "k-wrap", {}, ...traitsOf(kind).map((t) => traitTag(t))),
    el("b", "", { text: spec.ability?.name ?? "" }),
    rich(abilityShort(kind, 1)),
  ];
}
function componentCard(run: Run, item: ComponentId): HTMLElement[] {
  const combos = combosWithHeld(run, item);
  const parts = [
    pic(itemIcon(item), 3, "art"),
    el("b", "k-gold", { text: COMPONENTS[item].name }),
    rich(itemAdds(item).join(" · ")),
  ];
  for (const c of combos.slice(0, 3)) {
    parts.push(
      el(
        "div",
        "recipe",
        {},
        pic(itemIcon(c.with)),
        el("span", "k-dim", { text: "makes" }),
        pic(itemIcon(c.makes)),
        el("span", "k-s", { text: itemName(c.makes) }),
      ),
    );
  }
  return parts;
}
function boonCardParts(boon: BoonId): HTMLElement[] {
  const spec = BOONS[boon];
  return [
    pic(boonIcon(boon), 3, "art"),
    el("b", "k-gold", { text: spec.name }),
    el("div", "k-d", { text: spec.sort === "charm" ? "A charm" : "A boon" }),
    rich(boonShort(boon)),
  ];
}

/** Takes one of the cards: the rules settle it, and what was taken goes where it lives. */
function take(index: number, card: HTMLElement): void {
  const run = S.run;
  const choice = run?.choices[0];
  if (!run || !choice) return;
  card.classList.add("chosen");
  const from = boardSpot(card);
  const had = run.acorns;
  const done = act((r) => choose(r, index));
  if (!done?.ok) {
    card.classList.remove("chosen");
    return;
  }
  snd.choose();
  if (!from) return;
  const rack = (): { x: number; y: number } => boardSpot(document.getElementById("rack")) ?? from;
  for (const note of done.notes) {
    if (note.t === "component") fly(itemPic(note.item), from, rack(), { dur: 0.5, arc: 20, land: () => snd.give() });
    else if (note.t === "boon") fly(boonIcon(note.boon), from, rack(), { dur: 0.55, arc: 24, land: () => snd.give() });
    else if (note.t === "items") {
      note.items.forEach((item, i) =>
        fly(itemPic(item), from, rack(), { delay: 0.15 + i * 0.12, dur: 0.5, arc: 20, land: () => snd.give() }),
      );
    } else if (note.t === "acorns") {
      holdAcorns(had, 3);
      const purse = boardSpot(document.getElementById("acorns")) ?? from;
      for (let i = 0; i < note.amount; i++) {
        fly(glyphPic("acorn"), from, purse, {
          delay: 0.1 + i * 0.07,
          dur: 0.45,
          arc: 22,
          land: () => {
            snd.acorn(i);
            signal("acorn", 1);
          },
        });
      }
    }
  }
}

/** Shows the pick that is waiting, or puts the cards away. */
export function renderPicks(): void {
  const box = document.getElementById("picks");
  if (!box) return;
  const run = S.run;
  const choice = run && S.mode === "plan" ? run.choices[0] : undefined;
  if (!run || !choice) {
    key = "";
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  const now = `${run.seed}:${run.record.length}:${run.choices.length}:${choice.kind}:${choice.options.join()}`;
  if (now === key) return;
  key = now;
  box.hidden = false;
  box.dataset.kind = choice.kind;
  const [title, under] = TITLES[choice.kind];
  const cards = el("div", "cards", {});
  choice.options.forEach((option, i) => {
    const card = el("button", "k-card pick k-rise", { type: "button", "data-pick": i });
    card.style.animationDelay = `${i * 70}ms`;
    if (choice.kind === "starter") add(card, ...starterCard(choice.options[i] ?? "rock"));
    else if (choice.kind === "component") add(card, ...componentCard(run, choice.options[i] ?? "thorn"));
    else add(card, ...boonCardParts(choice.options[i] ?? "windfall"));
    card.addEventListener("click", () => take(i, card));
    card.setAttribute("aria-label", option);
    cards.append(card);
  });
  const head = el("div", "k-plaque head", {}, el("b", "k-title", { text: title }), el("span", "k-d", { text: under }));
  box.replaceChildren(head, cards);
  if (choice.kind === "boon") {
    const again = el(
      "button",
      `k-btn wood sm${choice.redraws > 0 ? "" : " off"}`,
      {
        type: "button",
        id: "redraw",
        onclick: () => {
          if (act((r) => redraw(r))?.ok) snd.rustle();
        },
      },
      choice.redraws > 0 ? "Show three others" : "No more to show",
    );
    box.append(again);
  }
  snd.card();
}
