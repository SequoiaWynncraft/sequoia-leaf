import { portrait } from "@sequoia-leaf/figures/sprites.ts";
/**
 * Picks: three cards laid on the table to choose one from. The first figure to set out with, a
 * component after trouble, a boon now and then (with the one redraw). Nothing else can be done
 * until the pick is made, so the cards sit over the board.
 */
import { link, thing } from "@sequoia-leaf/kit/card.ts";
import { add, el, icon } from "@sequoia-leaf/kit/dom.ts";
import {
  abilityShort,
  type BoonId,
  BOONS,
  boonShort,
  type Choice,
  type ComponentId,
  COMPONENTS,
  type FigureId,
  FIGURES,
  itemAdds,
  picksOf,
  pieces,
  roleLine,
  type RunView,
  TRAITS,
  traitsOf,
} from "@sequoia-leaf/raid";

import { boonIcon, glyphPic, itemIcon, itemPic, traitIcon } from "../art/icons.ts";
import { fly } from "../fx.ts";
import { signal } from "../signals.ts";
import { snd } from "../sounds.ts";
import { boardSpot } from "../stage.ts";
import { ask, S } from "../state.ts";
import { boonRef, figureRef, itemRef, makesLines, pic, rich, traitRef } from "./cards.ts";

let key = "";

/** A pick's title, and under it only what the cards cannot show. */
const TITLES: Readonly<Record<Choice["kind"], readonly [string, string | null]>> = {
  starter: ["Who sets out with you?", null],
  component: ["Something from the room", "Two components on one figure make an item."],
  boon: ["A boon", "For the rest of the raid."],
};

/** A picture on a pick that explains itself when pointed at; a tap on it chooses, as anywhere on the card. */
function art(c: HTMLCanvasElement, ref: string): HTMLElement {
  const box = el("span", "art", {}, pic(c, 3));
  link(box, ref, { acts: true });
  return box;
}

function starterCard(kind: FigureId): HTMLElement[] {
  const spec = FIGURES[kind];
  return [
    art(portrait(kind), figureRef(kind)),
    el("b", "k-gold", { text: spec.name }),
    el("div", "k-dim", { text: roleLine(kind) }),
    el(
      "div",
      "k-wrap",
      {},
      ...traitsOf(kind).map((t) => {
        const chip = el("span", "k-chip", {}, pic(traitIcon(t)), TRAITS[t].name);
        link(chip, traitRef(t), { acts: true });
        return chip;
      }),
    ),
    el("b", "", { text: spec.ability?.name ?? "" }),
    rich(abilityShort(kind, 1)),
  ];
}
/**
 * A component on offer: what it adds, and what it makes with each of the others, as the other
 * half's picture, an arrow and the finished item. The ones whose other half the party already
 * holds come first, lit and tagged "have", so the pick that finishes an item is plain.
 */
function componentCard(run: RunView, item: ComponentId): HTMLElement[] {
  const lines = makesLines(item, run).map((line) =>
    el(
      "div",
      `makes${line.lit ? " lit" : ""}`,
      {},
      line.from ? thing(line.from, { bare: true }) : null,
      el("span", "k-dim", { text: "→" }),
      thing(line.ref, line.tag ? { tag: line.tag } : {}),
    ),
  );
  return [
    art(itemIcon(item), itemRef(item)),
    el("b", "k-gold", { text: COMPONENTS[item].name }),
    rich(itemAdds(item).join(" · ")),
    el("div", "makeslist", {}, ...lines),
  ];
}
function boonCardParts(boon: BoonId): HTMLElement[] {
  const spec = BOONS[boon];
  return [
    art(boonIcon(boon), boonRef(boon)),
    el("b", "k-gold", { text: spec.name }),
    el("div", "k-dim", { text: spec.sort === "charm" ? "A charm" : "A boon" }),
    rich(boonShort(boon)),
  ];
}

/** Asks Leaf for three other boons. */
async function redrawn(button: Element | null): Promise<void> {
  if ((await ask({ do: "redraw" }, button))?.ok) snd.rustle();
}

/** Takes one of the cards: Leaf settles it, and what was taken goes where it lives. */
async function take(index: number, card: HTMLElement): Promise<void> {
  const run = S.run;
  const choice = run ? picksOf(run)[0] : undefined;
  if (!run || !choice) return;
  card.classList.add("chosen");
  const from = boardSpot(card);
  const done = await ask({ do: "choose", option: index }, card);
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

/** Puts the cards down to look at the table, or picks them up again; the pick still waits either way. */
function hideButton(box: HTMLElement): HTMLElement {
  const button = el("button", "k-btn blue sm", { type: "button", id: "pickhide" });
  const face = (down: boolean): void => button.replaceChildren(icon(down ? "up" : "down"), down ? "Show" : "Hide");
  face(false);
  button.addEventListener("click", () => {
    const down = !box.classList.contains("down");
    box.classList.toggle("down", down);
    face(down);
    snd.tap();
  });
  return button;
}

/** Shows the pick that is waiting, or puts the cards away. */
export function renderPicks(): void {
  const box = document.getElementById("picks");
  if (!box) return;
  const run = S.run;
  const choice = run && S.screen.at === "plan" ? picksOf(run)[0] : undefined;
  if (!run || !choice) {
    key = "";
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  // What the party holds too: a component's lines light the halves it already has.
  const held = `${run.items.join()}|${pieces(run)
    .map((p) => p.items.join())
    .join(";")}`;
  const now = `${S.runs}:${run.record.length}:${picksOf(run).length}:${choice.kind}:${choice.options.join()}:${held}`;
  if (now === key) return;
  key = now;
  box.hidden = false;
  box.classList.remove("down");
  box.dataset.kind = choice.kind;
  const [title, under] = TITLES[choice.kind];
  const cards = el("div", "cards", {});
  choice.options.forEach((_, i) => {
    const card = el("button", "k-card pick k-rise", { type: "button", "data-pick": i });
    card.style.animationDelay = `${i * 70}ms`;
    if (choice.kind === "starter") add(card, ...starterCard(choice.options[i] ?? "rock"));
    else if (choice.kind === "component") add(card, ...componentCard(run, choice.options[i] ?? "thorn"));
    else add(card, ...boonCardParts(choice.options[i] ?? "windfall"));
    card.addEventListener("click", () => void take(i, card));
    // Named by what it is; the links inside it stay stops, so a keyboard can read what each is before choosing.
    card.setAttribute("aria-label", card.querySelector(".k-gold")?.textContent ?? "");
    cards.append(card);
  });
  const head = el(
    "div",
    "k-plaque head",
    {},
    el("b", "k-title", { text: title }),
    under ? el("span", "k-d", { text: under }) : null,
  );
  const again =
    choice.kind === "boon"
      ? el(
          "button",
          `k-btn wood sm${choice.redraws > 0 ? "" : " off"}`,
          {
            type: "button",
            id: "redraw",
            onclick: (e: Event) => void redrawn(e.currentTarget instanceof Element ? e.currentTarget : null),
          },
          choice.redraws > 0 ? "Show three others" : "No more to show",
        )
      : null;
  box.replaceChildren(head, cards, el("div", "k-row foot", {}, again, hideButton(box)));
  snd.card();
}
