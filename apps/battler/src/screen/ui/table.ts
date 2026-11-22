/**
 * The interface round the table, built from the kit's pieces: the purse and the track along the
 * top, the traits the party has, the rack of items, and the stall along the bottom with the acorns,
 * the level and the buttons. It is drawn again from the run whenever something changes; nothing
 * here decides anything, it only shows and asks.
 */
import { link } from "@sequoia-leaf/kit/card.ts";
import { add, amount, el, icon, replay } from "@sequoia-leaf/kit/dom.ts";
import { folkName } from "@sequoia-leaf/kit/mark.ts";
import { balance, leafShown, watch } from "@sequoia-leaf/kit/purse.ts";
import { isMuted } from "@sequoia-leaf/kit/sound.ts";
import { tip } from "@sequoia-leaf/kit/tip.ts";

import { regularNamed } from "../../game/content/rooms.ts";
import {
  BOONS,
  ECONOMY,
  fieldCap,
  fielded,
  type FigureId,
  FIGURES,
  type ItemId,
  MAX_LEVEL,
  pieces,
  priceOf,
  ROOMS,
  type Run,
  rustleCost,
  tally,
  topStep,
  type TraitId,
  TRAITS,
  traitsNow,
  traitsOf,
} from "../../game/index.ts";
import { boonIcon, glyph, itemIcon, roomIcon, traitIcon } from "../art/icons.ts";
import { portrait } from "../art/sprites.ts";
import { rimTop, stumpOf } from "../art/table.ts";
import { fightEvents, fightUnits } from "../fightview.ts";
import type { Speed } from "../keep.ts";
import { light } from "../light.ts";
import { canBuy, opening, savings, steppedUp, stepsOf } from "../logic.ts";
import { artPx, place, V } from "../stage.ts";
import { S } from "../state.ts";
import { acorns, boonRef, figPic, figureRef, itemRef, pic, traitRef, unitRef } from "./cards.ts";
import { forgetLight, paintLight } from "./lit.ts";
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
  sound: () => void;
  frontPage: () => void;
  /** Opens the last fight's sheet again, or puts it away. */
  lastFight: () => void;
  /** A trait has just switched on, or on harder. */
  traitOn: (trait: TraitId, step: number) => void;
}

/**
 * Numbers held back from the run's own while a ceremony counts them out: the acorns in the purse
 * until each one lands, and the rest until the takings reach them. `null` shows the run's number.
 */
export const shown: {
  acorns: number | null;
  resolve: number | null;
  xp: number | null;
  level: number | null;
  /** When to stop waiting for acorns still in the air. */
  settleAt: number;
} = { acorns: null, resolve: null, xp: null, level: null, settleAt: 0 };

let asks: Asks | null = null;
let stallKey = "";
let rackKey = "";
let traitKey = "";
let trackKey = "";
let steps: Map<TraitId, number> | null = null;
let stepsFor: Run | null = null;

const byId = (id: string): HTMLElement | null => document.getElementById(id);

/** Builds everything round the table, once. */
export function buildTable(a: Asks): void {
  asks = a;
  const hud = el("div", "", { id: "hud" });
  const purse = el("div", "k-plaque", { id: "purse" });
  const track = el("div", "k-plaque", { id: "track" });
  const resolve = el("button", "k-plaque", { id: "resolve", type: "button" });
  tip(
    resolve,
    "Resolve",
    () =>
      `A lost room costs ${ECONOMY.lossBase}, and 1 more for each enemy left standing, up to ${ECONOMY.lossMost}. At 0 the raid is over.`,
  );
  const help = el(
    "button",
    "k-btn wood icon sm",
    { type: "button", "aria-label": "How to play", onclick: a.help },
    pic(glyph("help")),
  );
  tip(help, "How to play");
  const sound = el("button", "k-btn wood icon sm", {
    id: "sound",
    type: "button",
    "aria-label": "Sound",
    onclick: a.sound,
  });
  tip(sound, "Sound");
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
  tip(last, "Last fight", "Who did what in the last fight, again.");
  add(hud, purse, track, last, resolve, el("div", "", { id: "corner" }, help, sound, door));

  const rustle = el("button", "k-btn wood", { id: "rustle", type: "button", onclick: a.rustle });
  tip(rustle, "Rustle", () => `New figures on the stall. One a room is free; after that it costs ${ECONOMY.rustle}.`);
  const hold = el(
    "button",
    "k-btn wood",
    { id: "holdbtn", type: "button", onclick: a.hold },
    pic(glyph("pin")),
    el("span", "wide-only", { text: "Hold" }),
  );
  tip(hold, "Hold the stall", "Keeps these figures on the stall for the next room.");
  const acornsBtn = el("button", "", { id: "acorns", type: "button" });
  link(acornsBtn, "acorns:");
  const level = el("button", "", { id: "level", type: "button" });
  link(level, "level:");
  const levelUp = el("button", "k-btn wood", { id: "levelup", type: "button", onclick: a.levelUp });
  tip(levelUp, "Level up", () => `${ECONOMY.xpCost} acorns for ${ECONOMY.xpBought} experience.`);
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
      el("div", "", { id: "says" }),
      el("div", "", { id: "traits" }),
      el("div", "k-panel", { id: "shop" }, plan, fightbar, el("div", "k-over", { id: "sellhint" })),
    ),
  );
  watch(() => renderPurse());
  renderPurse();
}

function renderPurse(): void {
  const purse = byId("purse");
  if (!purse) return;
  const p = balance();
  // A guest's purse has only the Coins.
  purse.replaceChildren(...(leafShown() ? [amount("leaf", p.leaf)] : []), amount("coin", p.coins));
}

/** A line of news at the table: a refusal, in the rules' own words. */
export function toast(text: string, tone: "coral" | "gold" | "leaf" = "coral"): void {
  const says = byId("says");
  if (!says) return;
  while (says.children.length > 2) says.firstElementChild?.remove();
  const line = el("div", `k-toast ${tone === "gold" ? "" : tone}`.trim(), { text, role: "status" });
  says.append(line);
  window.setTimeout(() => line.remove(), 2200);
}

function renderTrack(run: Run): void {
  const track = byId("track");
  if (!track) return;
  const key = `${run.seed}:${run.room}:${run.phase}:${run.record.map((r) => r.result[0]).join("")}`;
  if (key === trackKey) return;
  trackKey = key;
  track.replaceChildren();
  ROOMS.forEach((room, i) => {
    const record = run.record.findLast((r) => r.room === i);
    const here = i === run.room && run.phase !== "over";
    const state = record ? (record.result === "win" ? "won" : record.result === "loss" ? "lost" : "drawn") : "";
    const pip = el(
      "button",
      `k-slot pip ${room.kind} ${here && !(record?.result === "win") ? "here lit" : state}${i > 0 && ROOMS[i - 1]?.wing !== room.wing ? " wing" : ""}`.trim(),
      { type: "button", "aria-label": `Room ${i + 1}` },
      pic(roomIcon(room.kind)),
    );
    link(pip, `room:${i}`);
    track.append(pip);
  });
}

function renderResolve(run: Run): void {
  const node = byId("resolve");
  if (!node) return;
  const n = shown.resolve ?? run.resolve;
  const was = node.dataset.n;
  node.replaceChildren(icon("heart"), el("b", n <= 5 ? "k-coral" : "", { text: String(n) }));
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

function renderTraits(run: Run): void {
  const box = byId("traits");
  if (!box) return;
  const states = traitsNow(run);
  const key = states.map((t) => `${t.trait}${t.count}`).join();
  // A step that has gone up since the last look is an event: the chip lights and the figures answer.
  if (stepsFor === run && steps && S.mode === "plan") {
    for (const up of steppedUp(steps, run)) asks?.traitOn(up.trait, up.step);
  }
  const lit = stepsFor === run && steps ? steppedUp(steps, run).map((u) => u.trait) : [];
  steps = stepsOf(run);
  stepsFor = run;
  if (key === traitKey && lit.length === 0) return;
  traitKey = key;
  const wanted = new Set(states.map((t) => t.trait));
  for (const [trait, chip] of chips) if (!wanted.has(trait)) chip.remove();
  states.forEach((state, i) => {
    const spec = TRAITS[state.trait];
    const next = spec.steps.find((need) => need > state.count) ?? spec.steps[spec.steps.length - 1] ?? 1;
    const top = state.step >= topStep(state.trait);
    const chip = chipFor(state.trait);
    chip.classList.toggle("lit", state.step > 0);
    chip.classList.toggle("top", top);
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

function renderRack(run: Run): void {
  const rack = byId("rack");
  if (!rack) return;
  const key = `${run.items.join()}|${run.boons.join()}`;
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
        { type: "button", "data-item": at, "aria-label": item },
        pic(itemIcon(item)),
      );
      // Tapping an item picks it up to give it; a finger kept on it asks what it is.
      link(slot, itemRef(item, at), { acts: true });
      items.append(slot);
    });
    rack.append(items);
  }
  if (run.boons.length > 0) {
    const boons = el("div", "k-plaque boons", {});
    for (const boon of run.boons) {
      const slot = el("button", "k-slot boon", { type: "button", "aria-label": BOONS[boon].name }, pic(boonIcon(boon)));
      link(slot, boonRef(boon));
      boons.append(slot);
    }
    rack.append(boons);
  }
}

/** How many of a figure the party owns at one star: two means the next one makes three. */
const twins = (run: Run, kind: FigureId): number => pieces(run).filter((p) => p.kind === kind && p.stars === 1).length;

function renderStall(run: Run): void {
  const stall = byId("stall");
  if (!stall) return;
  const key = run.stall
    .map((kind, i) => `${kind}:${priceOf(run, i)}:${canBuy(run, i) ? 1 : 0}:${kind ? twins(run, kind) : 0}`)
    .join();
  if (key === stallKey) return;
  stallKey = key;
  stall.replaceChildren();
  stall.style.setProperty("--n", String(run.stall.length));
  run.stall.forEach((kind, i) => {
    if (!kind) {
      stall.append(el("div", "k-slot offer gone", {}));
      return;
    }
    const spec = FIGURES[kind];
    const price = priceOf(run, i);
    const have = twins(run, kind);
    const owned = pieces(run).some((p) => p.kind === kind);
    const card = el(
      "button",
      `k-card offer t${spec.tier}${canBuy(run, i) ? "" : " cant"}${have >= 2 ? " lit" : ""}`,
      { type: "button", "data-offer": i, "aria-label": `${spec.name}, ${price} acorns` },
      el("div", "art", {}, figPic(portrait(kind))),
      el("div", "name", { text: spec.name }),
      el(
        "div",
        "foot",
        {},
        el("span", `k-cur${price < spec.tier ? " cut" : ""}`, {}, icon("acorn"), String(price)),
        el("span", "signs", {}, ...traitsOf(kind).map((t) => pic(traitIcon(t)))),
      ),
      owned
        ? el("span", `have${have >= 2 ? " ready" : ""}`, { text: have >= 2 ? "3!" : have === 1 ? "2" : "+" })
        : null,
    );
    // Tapping an offer buys it; a finger kept on it asks what it is.
    link(card, figureRef(kind), { acts: true });
    stall.append(card);
  });
  paintLight();
}

function renderPurseSide(run: Run): void {
  const node = byId("acorns");
  const level = byId("level");
  if (!node || !level) return;
  const n = shown.acorns ?? run.acorns;
  const s = savings(run);
  const piles = el("span", "piles", {});
  const held = Math.min(s.most, Math.floor(n / s.per));
  for (let i = 0; i < s.most; i++) piles.append(el("i", i < held ? "pile on" : "pile"));
  const was = node.dataset.n;
  node.replaceChildren(
    el("span", "k-cur big", {}, icon("acorn"), String(n)),
    piles,
    el("span", "k-d interest", { text: held > 0 ? `+${held} a room` : `${s.per - (n % s.per)} to save` }),
  );
  node.dataset.n = String(n);
  if (was !== undefined && Number(was) < n) replay(node, "k-bump");

  const lv = shown.level ?? run.level;
  const xp = shown.xp ?? run.xp;
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
    bar,
    el("span", "k-d", { text: need > 0 ? `${xp}/${need}` : "top" }),
    el("span", "k-d fielded", {}, pic(glyph("figure")), `${fielded(run)}/${fieldCap(run)}`),
  );
  level.dataset.n = String(lv);
  if (wasLv !== undefined && Number(wasLv) < lv) replay(level, "k-bump");
}

function renderActs(run: Run): void {
  const rustle = byId("rustle");
  const hold = byId("holdbtn");
  const levelUp = byId("levelup");
  const setOut = byId("setout");
  if (!rustle || !hold || !levelUp || !setOut) return;
  const cost = rustleCost(run);
  rustle.replaceChildren(
    pic(glyph("rustle")),
    cost === 0 ? el("span", "", { text: run.rustles > 1 ? `Free x${run.rustles}` : "Free" }) : acorns(cost),
  );
  rustle.classList.toggle("off", run.acorns < cost);
  hold.setAttribute("aria-pressed", String(run.held));
  hold.classList.toggle("down", run.held);
  levelUp.replaceChildren(pic(glyph("up")), acorns(ECONOMY.xpCost));
  levelUp.classList.toggle("off", run.level >= MAX_LEVEL || run.acorns < ECONOMY.xpCost);
  setOut.classList.toggle("off", fielded(run) === 0);
}

function renderFightBar(run: Run): void {
  panelTally?.across(run.foe.who);
  for (const tab of document.querySelectorAll<HTMLElement>("#speeds [data-speed]")) {
    tab.setAttribute("aria-selected", String(Number(tab.dataset.speed) === S.prefs.speed));
  }
}

/**
 * Who is across the table, on a small plate beside them: a regular with the town's mark, "Greg
 * brought Mist Fangs"; the forest's own trouble by its name.
 */
function renderFoe(run: Run): void {
  const foe = byId("foe");
  if (!foe) return;
  // While a fight's sheet is up the room that is over is what is talked about, not the one coming.
  foe.hidden = S.mode === "front" || S.mode === "over" || S.mode === "after";
  if (regularNamed(run.foe.who)) {
    foe.replaceChildren(
      el("div", "brought", {}, folkName(opening(run.foe.who), "k-pix"), el("span", "k-read", { text: run.foe.title })),
    );
  } else {
    foe.replaceChildren(el("b", "k-name", { text: run.foe.who }));
    if (run.foe.title) foe.append(el("span", "k-d", { text: run.foe.title }));
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
    foe.style.translate = "none";
    return;
  }
  // On a narrow window: over their head, in the last of the sky.
  foe.style.left = `${Math.round(cx * px)}px`;
  foe.style.top = `${Math.round(Math.max((rimTop(p) - 44) * px, under))}px`;
  foe.style.translate = "-50% 0";
}

/** Draws the interface again from the run. */
export function renderTable(): void {
  document.body.dataset.mode = S.mode;
  const sound = byId("sound");
  sound?.replaceChildren(icon(isMuted() ? "mute" : "sound"));
  const run = S.run;
  document.body.classList.toggle("no-run", !run);
  if ((!run || S.mode === "front" || S.mode === "over") && (light.kept !== null || light.pointed !== null))
    forgetLight();
  if (!run) return;
  document.body.dataset.picking = run.choices.length > 0 && S.mode === "plan" ? "yes" : "no";
  renderTrack(run);
  const last = byId("lastfight");
  if (last) last.hidden = S.mode !== "plan" || run.last === null || run.choices.length > 0;
  renderResolve(run);
  renderTraits(run);
  renderRack(run);
  renderStall(run);
  renderPurseSide(run);
  renderActs(run);
  renderFightBar(run);
  renderFoe(run);
}

/** Forgets what was drawn, so that the next drawing starts clean: for a new run. */
export function forgetTable(): void {
  stallKey = "";
  rackKey = "";
  traitKey = "";
  trackKey = "";
  forgetLight();
  steps = null;
  stepsFor = null;
  shown.acorns = null;
  shown.resolve = null;
  shown.xp = null;
  shown.level = null;
}

/** An acorn has landed in the purse: one more shows. */
export function acornLanded(): void {
  const run = S.run;
  if (!run || shown.acorns === null) return;
  shown.acorns = Math.min(run.acorns, shown.acorns + 1);
  if (shown.acorns >= run.acorns) shown.acorns = null;
  renderPurseSide(run);
}
/** Holds the purse at a number while acorns fly to it; they are counted in as they land. */
export function holdAcorns(at: number, seconds = 2.4): void {
  shown.acorns = at;
  shown.settleAt = V.t + seconds;
}
/** The tally of the fight on the table, in the lower panel while it plays. */
let panelTally: TallyView | null = null;
function renderTally(): void {
  const units = fightUnits();
  panelTally?.show(
    units,
    tally(
      fightEvents(),
      units.map((u) => u.id),
    ),
  );
}
let talliedAt = -9;

/** Every moment: gives up waiting for acorns that never landed, and keeps the fight's count fresh. */
export function stepTable(): void {
  if (shown.acorns !== null && V.t > shown.settleAt) {
    shown.acorns = null;
    if (S.run) renderPurseSide(S.run);
  }
  if (S.mode === "fight" && V.t - talliedAt > 0.35) {
    talliedAt = V.t;
    renderTally();
  }
}

/** Lights a trait's chip for a moment. */
export function wakeChip(trait: string): void {
  const chip = document.querySelector<HTMLElement>(`#traits [data-trait="${trait}"]`);
  if (chip) replay(chip, "woke");
}
