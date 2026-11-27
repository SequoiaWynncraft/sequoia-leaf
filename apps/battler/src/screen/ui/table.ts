import { nameOf, portrait, portraitRoom } from "@sequoia-leaf/figures/sprites.ts";
/**
 * The interface round the table, built from the kit's pieces: the purse and the track along the
 * top, the traits the party has, the rack of items, and the stall along the bottom with the acorns,
 * the level and the buttons. It is drawn again from the run whenever something changes; nothing
 * here decides anything, it only shows and asks.
 */
import { link } from "@sequoia-leaf/kit/card.ts";
import { add, amount, el, icon, replay } from "@sequoia-leaf/kit/dom.ts";
import { folkName } from "@sequoia-leaf/kit/mark.ts";
import { balance, watch } from "@sequoia-leaf/kit/purse.ts";
import { tip } from "@sequoia-leaf/kit/tip.ts";
import {
  boonIn,
  catalogOf,
  ECONOMY,
  fieldCap,
  fielded,
  figureIn,
  type ItemId,
  itemName,
  MAX_LEVEL,
  picksOf,
  pieces,
  priceOf,
  type RunView,
  rustleCost,
  tally,
  type TraitId,
  traitIn,
  traitsNow,
  traitsOf,
} from "@sequoia-leaf/raid";
import { nowCalled, regularOf } from "@sequoia-leaf/raid/content/rooms.ts";

import { boonIcon, glyph, itemIcon, traitIcon } from "../art/icons.ts";
import { rimTop, stumpOf } from "../art/table.ts";
import { fightCatalog, fightEvents, fightUnits } from "../fightview.ts";
import type { Speed } from "../keep.ts";
import { light } from "../light.ts";
import { acrossName, canBuy, savings, TraitWatch } from "../logic.ts";
import { facing, shownCounts } from "../screen.ts";
import { artPx, place, V } from "../stage.ts";
import { busy, catalogFor, S } from "../state.ts";
import { acorns, boonRef, figPic, figureRef, itemRef, pic, traitRef, unitRef } from "./cards.ts";
import { rackDrawn, stallDrawn, traitsDrawn, twins } from "./drawn.ts";
import { forgetLight, paintLight } from "./lit.ts";
import { oddsRow, runTag, waySign } from "./own.ts";
import { chairsTag, forgetTrack, renderTrack, trackPlaque } from "./rooms.ts";
import { type TallyView, tallyView } from "./tally.ts";

/** What the buttons ask for. The table only asks; whoever built it answers. */
export interface Asks {
  rustle: () => void;
  hold: () => void;
  levelUp: () => void;
  setOut: () => void;
  speed: (s: Speed) => void;
  skipFight: () => void;
  help: () => void;
  /** A gear for the settings menu. */
  gear: () => HTMLElement;
  frontPage: () => void;
  /** Opens the last fight's sheet again, or puts it away. */
  lastFight: () => void;
  /** A trait has just switched on, or on harder. */
  traitOn: (trait: TraitId, step: number) => void;
}

let asks: Asks | null = null;
let stallKey = "";
let rackKey = "";
let traitKey = "";
/** The run's trait steps from the last drawing, by the run's number, to tell one that has just gone up. */
const traitSteps = new TraitWatch();

const byId = (id: string): HTMLElement | null => document.getElementById(id);

/** An amount of acorns in words, for a control's name. */
const acornsSaid = (n: number): string => `${n} acorn${n === 1 ? "" : "s"}`;

/** Builds everything round the table, once. */
export function buildTable(a: Asks): void {
  asks = a;
  const hud = el("div", "", { id: "hud" });
  const purse = el("div", "k-plaque hung", { id: "purse" });
  const track = trackPlaque();
  const resolve = el("button", "k-plaque hung", { id: "resolve", type: "button" });
  tip(
    resolve,
    "Health",
    () =>
      `A lost room costs ${ECONOMY.lossBase} health, and 1 more for each enemy left standing, up to ${ECONOMY.lossMost}. At 0 the raid is over.`,
  );
  const help = el(
    "button",
    "k-btn wood icon sm",
    { type: "button", "aria-label": "How to play", onclick: a.help },
    pic(glyph("help")),
  );
  tip(help, "How to play");
  const sound = a.gear();
  sound.classList.add("sm");
  const door = el(
    "button",
    "k-btn wood icon sm",
    { id: "door", type: "button", "aria-label": "The front page", onclick: a.frontPage },
    pic(glyph("door")),
  );
  tip(door, "Step back from the board", "Your raid is kept as it is.");
  const last = el(
    "button",
    "k-btn wood sm",
    { id: "lastfight", type: "button", onclick: a.lastFight, hidden: true },
    pic(glyph("swords")),
    el("span", "", { text: "Last fight" }),
  );
  add(hud, purse, track, waySign(), last, resolve, el("div", "", { id: "corner" }, help, sound, door));

  const rustle = el("button", "k-btn wood", { id: "rustle", type: "button", onclick: a.rustle });
  tip(rustle, "Reroll", () => `New figures on the stall. 1 a room is free; after that each costs ${ECONOMY.rustle}.`);
  const hold = el(
    "button",
    "k-btn wood",
    { id: "holdbtn", type: "button", "aria-label": "Hold the stall", onclick: a.hold },
    pic(glyph("pin")),
    el("span", "wide-only", { text: "Hold" }),
  );
  tip(hold, "Hold the stall", "Keeps these figures on the stall for the next room.");
  const acornsBtn = el("button", "", { id: "acorns", type: "button" });
  link(acornsBtn, "acorns:");
  const level = el("button", "", { id: "level", type: "button" });
  link(level, "level:");
  const levelUp = el(
    "button",
    "k-btn wood",
    { id: "levelup", type: "button", "aria-label": `Buy XP, ${acornsSaid(ECONOMY.xpCost)}`, onclick: a.levelUp },
    pic(glyph("up")),
    el("span", "wide-only", { text: "Buy XP" }),
    acorns(ECONOMY.xpCost),
  );
  tip(levelUp, "Buy XP", () => `${ECONOMY.xpBought} XP for ${ECONOMY.xpCost} acorns.`);
  const setOut = el(
    "button",
    "k-btn",
    { id: "setout", type: "button", onclick: a.setOut },
    pic(glyph("swords")),
    "Set out",
  );
  const plan = el(
    "div",
    "",
    { id: "plan" },
    rustle,
    hold,
    el("div", "", { id: "stall" }),
    acornsBtn,
    level,
    levelUp,
    setOut,
  );

  const speeds = el("div", "k-tabs", { id: "speeds", role: "tablist" });
  for (const s of [1, 2, 4] as const) {
    add(
      speeds,
      el("button", "k-btn sm", { type: "button", role: "tab", "data-speed": s, onclick: () => a.speed(s) }, `${s}x`),
    );
  }
  const skip = el(
    "button",
    "k-btn wood",
    { id: "skip", type: "button", "aria-label": "Skip", onclick: a.skipFight },
    pic(glyph("skip")),
    el("span", "wide-only", { text: "Skip" }),
  );
  tip(skip, "Skip to the end", "The fight comes out the same.");
  panelTally = tallyView(unitRef, "panel");
  const fightbar = el(
    "div",
    "",
    { id: "fightbar" },
    el("div", "", { id: "tally" }, panelTally.el),
    el("div", "controls", {}, panelTally.switcher, panelTally.tabs, el("div", "k-row speedrow", {}, speeds, skip)),
  );

  add(
    document.body,
    hud,
    el("div", "k-tip", { id: "foe", hidden: true }),
    el("div", "", { id: "rack" }),
    el(
      "div",
      "",
      { id: "bottom" },
      // The one polite live region: a refusal or a line of news is read out once.
      el("div", "", { id: "says", role: "status", "aria-atomic": "false" }),
      el("div", "", { id: "traits" }),
      el("div", "k-panel", { id: "shop" }, plan, fightbar, el("div", "k-over", { id: "sellhint" })),
    ),
  );
  watch(() => renderPurse());
  renderPurse();
}

/** Leaf from the guild's ledger, and the Coins Leaf holds for the member (the kit's purse). */
export function renderPurse(): void {
  const purse = byId("purse");
  if (!purse) return;
  purse.replaceChildren(amount("leaf", balance().leaf), amount("coin", balance().coins));
}

/** A line of news at the table: a refusal, in the rules' own words. */
export function toast(text: string, tone: "coral" | "gold" | "leaf" = "coral"): void {
  const says = byId("says");
  if (!says) return;
  while (says.children.length > 2) says.firstElementChild?.remove();
  const line = el("div", `k-toast ${tone === "gold" ? "" : tone}`.trim(), { text });
  says.append(line);
  window.setTimeout(() => line.remove(), 2200);
}

function renderResolve(run: RunView): void {
  const node = byId("resolve");
  if (!node) return;
  const n = shownCounts(S.screen, run).resolve;
  const was = node.dataset.n;
  node.replaceChildren(icon("heart"), el("b", n <= 5 ? "k-coral" : "", { text: String(n) }));
  node.setAttribute("aria-label", `Health ${n}`);
  node.dataset.n = String(n);
  if (was !== undefined && was !== String(n)) replay(node, "k-bump");
}

/** The strip's chips, one for each trait, kept from one drawing to the next so the pointer on one is not lost. */
const chips = new Map<TraitId, HTMLButtonElement>();
function chipFor(trait: TraitId): HTMLButtonElement {
  let chip = chips.get(trait);
  if (!chip) {
    chip = el("button", "k-chip trait", { type: "button", "data-trait": trait, "aria-pressed": "false" });
    // Its card goes to its side, so the rest of the strip stays in view.
    link(chip, traitRef(trait), { side: true });
    chips.set(trait, chip);
  }
  return chip;
}

function renderTraits(run: RunView): void {
  const box = byId("traits");
  if (!box) return;
  const states = traitsNow(run);
  const key = traitsDrawn(run, states);
  // A step that has gone up since the last look is an event: the chip lights and the figures answer.
  const ups = traitSteps.look(run, S.runs);
  if (S.screen.at === "plan") {
    for (const up of ups) asks?.traitOn(up.trait, up.step);
  }
  const lit = ups.map((u) => u.trait);
  if (key === traitKey && lit.length === 0) return;
  traitKey = key;
  const wanted = new Set(states.map((t) => t.trait));
  for (const [trait, chip] of chips) if (!wanted.has(trait)) chip.remove();
  states.forEach((state, i) => {
    const spec = traitIn(catalogOf(run), state.trait);
    const next = spec.steps.find((need) => need > state.count) ?? spec.steps[spec.steps.length - 1] ?? 1;
    const chip = chipFor(state.trait);
    chip.classList.toggle("lit", state.step > 0);
    chip.classList.toggle("top", state.step >= spec.steps.length);
    // On a phone the chip shows no name: it is said all the same.
    chip.setAttribute("aria-label", `${spec.name} ${state.count}/${next}`);
    chip.replaceChildren(
      pic(traitIcon(state.trait)),
      el("b", "", { text: `${state.count}/${next}` }),
      el("span", "name", { text: spec.name }),
    );
    // Moved only when out of place: a chip under the pointer stays where it is.
    if (box.children[i] !== chip) box.insertBefore(chip, box.children[i] ?? null);
    if (lit.includes(state.trait)) replay(chip, "woke");
  });
  paintLight();
}

function renderRack(run: RunView): void {
  const rack = byId("rack");
  if (!rack) return;
  const key = rackDrawn(run);
  if (key === rackKey) return;
  rackKey = key;
  rack.replaceChildren();
  rack.classList.toggle("empty", run.items.length === 0 && run.boons.length === 0);
  if (run.items.length > 0) {
    const items = el("div", "k-plaque items", {});
    run.items.forEach((item: ItemId, at) => {
      const slot = el(
        "button",
        "k-slot item",
        { type: "button", "data-item": at, "aria-label": itemName(catalogOf(run), item) },
        pic(itemIcon(item)),
      );
      // Tapping an item picks it up to give it; a finger kept on it asks what it is. Its card goes beside the rack.
      link(slot, itemRef(item, at), { acts: true, side: true });
      items.append(slot);
    });
    rack.append(items);
  }
  if (run.boons.length > 0) {
    const boons = el("div", "k-plaque boons", {});
    for (const boon of run.boons) {
      const { name } = boonIn(catalogOf(run), boon);
      const slot = el("button", "k-slot boon", { type: "button", "aria-label": name }, pic(boonIcon(boon)));
      link(slot, boonRef(boon));
      boons.append(slot);
    }
    rack.append(boons);
  }
}

/** The stall whose width is watched, and the watcher. */
let stallWatched: HTMLElement | null = null;
let stallWatcher: ResizeObserver | null = null;

function renderStall(run: RunView): void {
  const stall = byId("stall");
  if (!stall) return;
  const key = stallDrawn(run);
  const cat = catalogOf(run);
  if (key === stallKey) return;
  stallKey = key;
  if (stallWatched !== stall && typeof ResizeObserver === "function") {
    // A stall made narrower (the purse beside it grew, the window shrank) asks again whether its names fit.
    stallWatcher?.disconnect();
    // On the next frame, outside the watcher's own delivery: fitting can change the stall's height.
    stallWatcher = new ResizeObserver(() => requestAnimationFrame(() => fitNames(stall)));
    stallWatcher.observe(stall);
    stallWatched = stall;
  }
  stall.replaceChildren();
  stall.style.setProperty("--n", String(run.stall.length));
  run.stall.forEach((kind, i) => {
    if (!kind) {
      stall.append(el("div", "k-slot offer gone", {}));
      return;
    }
    const spec = figureIn(cat, kind);
    const price = priceOf(run, i);
    const have = twins(run, kind);
    const owned = pieces(run).some((p) => p.kind === kind);
    const card = el(
      "button",
      `k-card offer t${spec.tier}${canBuy(run, i) ? "" : " cant"}${have >= 2 ? " lit" : ""}`,
      { type: "button", "data-offer": i, "aria-label": `${nameOf(cat, kind)}, ${acornsSaid(price)}` },
      el("div", "art", { style: `height: calc(var(--u) * ${portraitRoom()} * var(--fs))` }, figPic(portrait(kind))),
      el("div", "name", { text: nameOf(cat, kind) }),
      el(
        "div",
        "foot",
        {},
        el("span", `k-cur${price < spec.tier ? " cut" : ""}`, {}, icon("acorn"), String(price)),
        el("span", "signs", {}, ...traitsOf(cat, kind).map((t) => pic(traitIcon(t)))),
      ),
      owned
        ? el("span", `have${have >= 2 ? " ready" : ""}`, { text: have >= 2 ? "3!" : have === 1 ? "2" : "+" })
        : null,
      runTag(run, kind),
    );
    // Tapping an offer buys it; a finger kept on it asks what it is.
    link(card, figureRef(kind), { acts: true });
    stall.append(card);
  });
  fitNames(stall);
  paintLight();
}

function renderPurseSide(run: RunView): void {
  const node = byId("acorns");
  const level = byId("level");
  if (!node || !level) return;
  const shown = shownCounts(S.screen, run);
  const n = shown.acorns;
  const s = savings(run);
  const piles = el("span", "piles", {});
  const held = Math.min(s.most, Math.floor(n / s.per));
  for (let i = 0; i < s.most; i++) piles.append(el("i", i < held ? "pile on" : "pile"));
  const was = node.dataset.n;
  const streak = Math.abs(run.streak) >= 2 ? run.streak : 0;
  const mark =
    streak === 0
      ? null
      : el(
          "span",
          `streak ${streak > 0 ? "won" : "lost"}`,
          {},
          pic(glyph(streak > 0 ? "flame" : "frost")),
          String(Math.abs(streak)),
        );
  node.replaceChildren(
    el("span", "count", {}, el("span", "k-cur big", {}, icon("acorn"), String(n)), mark),
    piles,
    el("span", "k-dim interest", { text: held > 0 ? `+${held} a room` : `+1 at ${s.per}` }),
  );
  node.setAttribute("aria-label", acornsSaid(n));
  node.dataset.n = String(n);
  if (was !== undefined && Number(was) < n) replay(node, "k-bump");

  const lv = shown.level;
  const xp = shown.xp;
  const need = lv >= MAX_LEVEL ? 0 : (ECONOMY.levelXp[lv - 1] ?? 0);
  const bar = el(
    "div",
    "k-bar leaf",
    {},
    el("i", "", { style: `--v:${need > 0 ? Math.round((xp / need) * 100) : 100}%` }),
  );
  const wasLv = level.dataset.n;
  level.replaceChildren(
    el("b", "", { text: `Level ${lv}` }),
    chairsTag(run),
    bar,
    el("span", "k-dim", { text: need > 0 ? `${xp}/${need}` : "top" }),
    el("span", "k-dim fielded", {}, pic(glyph("figure")), `${fielded(run)}/${fieldCap(run)}`),
    // What a reroll can bring at this level, each tier in its colour, cheapest first.
    oddsRow({ ...run, level: lv }),
  );
  level.setAttribute("aria-label", need > 0 ? `Level ${lv}, ${xp}/${need} XP` : `Level ${lv}`);
  level.dataset.n = String(lv);
  if (wasLv !== undefined && Number(wasLv) < lv) replay(level, "k-bump");
}

/**
 * Fills a button again only when what it says has changed: with a mouse, a press on a button whose
 * insides are replaced before it is let go makes no click.
 */
function face(node: HTMLElement, says: string, ...kids: Node[]): void {
  if (node.dataset.says === says) return;
  node.dataset.says = says;
  node.replaceChildren(...kids);
}

function renderActs(run: RunView): void {
  const rustle = byId("rustle");
  const hold = byId("holdbtn");
  const levelUp = byId("levelup");
  const setOut = byId("setout");
  if (!rustle || !hold || !levelUp || !setOut) return;
  const cost = rustleCost(run);
  const free = run.rustles > 1 ? `Free x${run.rustles}` : "Free";
  face(
    rustle,
    cost === 0 ? free : String(cost),
    pic(glyph("rustle")),
    el("span", "wide-only", { text: "Reroll" }),
    cost === 0 ? el("span", "", { text: free }) : acorns(cost),
  );
  rustle.setAttribute("aria-label", `Reroll, ${cost === 0 ? free.toLowerCase() : acornsSaid(cost)}`);
  rustle.classList.toggle("off", run.acorns < cost);
  hold.setAttribute("aria-pressed", String(run.held));
  hold.classList.toggle("down", run.held);
  levelUp.classList.toggle("off", run.level >= MAX_LEVEL || run.acorns < ECONOMY.xpCost);
  setOut.classList.toggle("off", fielded(run) === 0);
}

function renderFightBar(run: RunView): void {
  panelTally?.across(run.foe);
  for (const tab of document.querySelectorAll<HTMLElement>("#speeds [data-speed]")) {
    tab.setAttribute("aria-selected", String(Number(tab.dataset.speed) === S.prefs.speed));
  }
}

/**
 * Who is across the table, on a small plate beside them: a regular with the town's mark, "Greg
 * brought Mist Fangs"; the forest's own trouble, and another member's board, by its name.
 */
function renderFoe(run: RunView): void {
  const foe = byId("foe");
  if (!foe) return;
  // While a fight's sheet is up the room that is over is what is talked about, not the one coming.
  foe.hidden = S.screen.at === "front" || S.screen.at === "over" || S.screen.at === "after";
  if (regularOf(run.foe)) {
    foe.replaceChildren(
      el("div", "brought", {}, folkName(acrossName(run.foe), "k-pix"), el("span", "", { text: run.foe.title })),
    );
  } else {
    foe.replaceChildren(el("b", "k-name", { text: acrossName(run.foe) }));
    if (run.foe.title) foe.append(el("span", "k-dim", { text: nowCalled(run.foe.title) }));
  }
  placeFoe();
}
/** Puts that plate where the far side of the table is, for the size of the window. */
export function placeFoe(): void {
  const foe = byId("foe");
  if (!foe) return;
  const p = place();
  const { cx } = stumpOf(p);
  const px = artPx();
  const under = (byId("hud")?.getBoundingClientRect().bottom ?? 0) + 4;
  if (p.w > 330) {
    // Beside whoever is sitting across the table.
    foe.style.left = `${Math.round((cx + 16) * px)}px`;
    foe.style.top = `${Math.round(Math.max((rimTop(p) - 16) * px, under))}px`;
    foe.style.maxWidth = "";
    return;
  }
  // On a narrow window: over their head, in the last of the sky, and clear of the rack along the right.
  const rack = byId("rack")?.getBoundingClientRect();
  const right = (rack && rack.width > 0 ? rack.left : window.innerWidth) - 8;
  foe.style.maxWidth = `${right - 8}px`;
  const w = foe.offsetWidth;
  foe.style.left = `${Math.round(Math.max(8, Math.min(cx * px - w / 2, right - w)))}px`;
  foe.style.top = `${Math.round(Math.max((rimTop(p) - 44) * px, under))}px`;
}

/** Draws the interface again from the run. */
export function renderTable(): void {
  document.body.dataset.mode = S.screen.at;
  const run = S.run;
  document.body.classList.toggle("no-run", !run);
  if ((!run || S.screen.at === "front" || S.screen.at === "over") && (light.kept !== null || light.pointed !== null))
    forgetLight();
  if (!run) return;
  const picking = picksOf(run).length > 0 && S.screen.at === "plan";
  document.body.dataset.picking = picking ? "yes" : "no";
  // While a pick waits, the stall can do nothing: the keyboard passes it by too.
  const plan = byId("plan");
  if (plan) plan.inert = picking;
  renderTrack(run);
  const last = byId("lastfight");
  if (last) last.hidden = S.screen.at !== "plan" || run.last === null || picksOf(run).length > 0;
  renderResolve(run);
  renderTraits(run);
  renderRack(run);
  renderStall(run);
  renderPurseSide(run);
  renderActs(run);
  renderFightBar(facing(S.screen, run));
  renderFoe(facing(S.screen, run));
}

/** Forgets what was drawn, so that the next drawing starts clean: for a new run. */
export function forgetTable(): void {
  stallKey = "";
  rackKey = "";
  traitKey = "";
  forgetTrack();
  forgetLight();
  traitSteps.forget();
}
/** The tally of the fight on the table, in the lower panel while it plays. */
let panelTally: TallyView | null = null;
function renderTally(): void {
  const units = fightUnits();
  panelTally?.show(
    fightCatalog() ?? catalogFor(S.run),
    units,
    tally(
      fightEvents(),
      units.map((u) => u.id),
    ),
  );
}
let talliedAt = -9;

/** Every moment: keeps the fight's count fresh, and dims the stall while Leaf is busy. */
export function stepTable(): void {
  const waiting = busy() ? "yes" : "no";
  if (document.body.dataset.busy !== waiting) document.body.dataset.busy = waiting;
  if (S.screen.at === "fight" && V.t - talliedAt > 0.35) {
    talliedAt = V.t;
    renderTally();
  }
}

/** Lights a trait's chip for a moment. */
export function wakeChip(trait: string): void {
  const chip = document.querySelector<HTMLElement>(`#traits [data-trait="${trait}"]`);
  if (chip) replay(chip, "woke");
}

/** When a name has a word wider than its card, every name on the stall is set in the small style, as a phone sets them. */
function fitNames(stall: HTMLElement): void {
  stall.classList.remove("tight");
  const names = [...stall.querySelectorAll<HTMLElement>(".offer .name")];
  if (names.some((name) => name.scrollWidth > name.clientWidth)) stall.classList.add("tight");
}
