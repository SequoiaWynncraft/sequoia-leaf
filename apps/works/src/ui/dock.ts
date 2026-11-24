/**
 * The tools along the bottom, and over them the line that says what is in hand with the buttons
 * that act on it: turn, undo, and (for a finger, which cannot hover) build and put away. With
 * Select in hand the line holds what is done to the marked pieces, and the yard's blueprints. With a
 * kind in hand that the yard may build above the first grade, the line holds a button for each
 * grade it may build: the numeral and the price of one; the one chosen is lit, and is what the
 * kind's slot shows and prices.
 *
 * A kind of piece or a tool is in the dock only once the yard may use it (`usable`, which asks
 * `locked`). The cart stop's slot says how many stand of how many may, and is off when no more may.
 */

import {
  BELT,
  BENCH,
  BOILER,
  boxOf,
  costOf,
  CRATE,
  DX,
  DY,
  GATHERER,
  highest,
  isGraded,
  type Kind,
  KIND_INFO,
  locked,
  MILL,
  numeral,
  type Piece,
  piecesOf,
  priceOf,
  PYLON,
  SORTER,
  STOP,
  stops,
  STUDY,
  TUNNEL,
  WHEEL,
  WORKSHOP,
} from "@sequoia-leaf/factory";
import { link } from "@sequoia-leaf/kit/card.ts";
import { amount, asking, asksAgain, el, icon, pressedTwice, shown } from "@sequoia-leaf/kit/dom.ts";
import { GOLD, GREEN, INK, WATER } from "@sequoia-leaf/kit/palette.ts";
import { tip } from "@sequoia-leaf/kit/tip.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";

import { PAINTS } from "../art/belts.ts";
import { type Art, bare } from "../art/index.ts";
import { WORKS_KEYS, type WorksAction } from "../keymap.ts";
import { builds, DRAWN, gradeInHand, S } from "../state.ts";
import {
  askSave,
  cancel,
  clearMark,
  confirm,
  dropBlueprint,
  flip,
  hold,
  piecesInHand,
  rotate,
  saveMark,
  setGrade,
  setTool,
  toolHooks,
  undo,
  upgradeCost,
  upgradeMark,
  usable,
} from "../tools.ts";
import { CATCHING_UP, catchingUp } from "../yard.ts";
import { machineRef } from "./card.ts";
import { $, button, fitted, iconButton, shows, when, type YardIcon, yardIcon } from "./parts.ts";

/** The tools in the order they sit in the dock, which is also the order of their keys (`tool` in `keymap.ts`): every kind this page draws. */
export const TOOLS: readonly Kind[] = DRAWN;

/** The tools the yard may build, in dock order. */
export const openTools = (): Kind[] => TOOLS.filter(usable);

/** Tools seen in the dock before, so that a new one can make an entrance. */
let known: Set<Kind | "select" | "paint"> | null = null;
let message = "";
let messageUntil = 0;

/** How many cart stops stand, of how many may: what the stop's slot says in place of a price. */
const stopsStand = (): { stand: number; may: number } => ({ stand: stops(S.world), may: S.world.open.stops });

function slotFor(art: Art, k: Kind, fresh: boolean): HTMLElement {
  // At the grade chosen for it: its picture, its price, and its card.
  const grade = gradeInHand(k);
  const cost = costOf(S.world, k, grade);
  const { stand, may } = stopsStand();
  // No more of a kind may stand: its slot is off, and says so when pressed.
  const full = k === STOP && stand >= may;
  const under =
    k === STOP
      ? el("span", "k-dim", { text: `${stand} of ${may}` })
      : el("span", cost === 0 ? "k-dim" : "k-gold", { text: cost === 0 ? "free" : String(cost) });
  const b = el(
    "button",
    `k-slot${S.tool === k ? " lit" : ""}${fresh ? " new" : ""}${S.nudge?.tool === k && S.tool !== k ? " nudged" : ""}${full ? " off" : ""}`,
    {
      type: "button",
      "aria-label": KIND_INFO[k]?.name ?? "",
      "aria-pressed": S.tool === k ? "true" : "false",
      "data-tool": String(k),
    },
    el("span", "art", {}, fitted(art.icon(k, grade), 20, 19)),
    under,
  );
  b.addEventListener("click", () => {
    if (full && S.tool !== k) {
      say(`${locked(S.world.open, { stops: stand + 1 }) ?? "No more may stand"}.`);
      return;
    }
    setTool(S.tool === k ? null : k);
  });
  // Clicking takes it up as the tool; pointing (or a finger kept on it) shows the machine's card.
  link(b, machineRef(k, grade), { acts: true });
  return b;
}

/** The slot of a tool that builds nothing: Select, the spade, the brush. Its tip names the key of `act`, and says `more`. */
function plain(
  tool: "select" | "remove" | "paint",
  name: string,
  pic: YardIcon,
  act: WorksAction,
  more?: string,
  fresh = false,
): HTMLElement {
  const b = el(
    "button",
    `k-slot${S.tool === tool ? " lit" : ""}${fresh ? " new" : ""}${S.nudge?.tool === tool && S.tool !== tool ? " nudged" : ""}`,
    { type: "button", "aria-label": name, "aria-pressed": S.tool === tool ? "true" : "false" },
    // No name under it: a name is wider than a slot. Its tip and the line above the toolbar say what it is.
    el("span", "art", {}, yardIcon(pic)),
  );
  b.addEventListener("click", () => {
    setTool(S.tool === tool ? null : tool);
  });
  tip(b, () => `${name} (${WORKS_KEYS.name(act)})`, more);
  return b;
}

function buildDock(art: Art): void {
  const dock = $("dock");
  const open = openTools();
  const first = known === null;
  const fresh = (t: Kind | "select" | "paint"): boolean => !first && !(known?.has(t) ?? true);
  const kids = open.map((k) => slotFor(art, k, fresh(k)));
  const tools = (["select", "paint"] as const).filter(usable);
  known = new Set([...open, ...tools]);
  const others = [
    ...(usable("select")
      ? [
          plain(
            "select",
            "Select",
            "select",
            "select",
            "Mark out an area to move, copy, remove or save as a blueprint.",
            fresh("select"),
          ),
        ]
      : []),
    plain("remove", "Remove", "spade", "remove", "Right-click does the same."),
    ...(usable("paint") ? [plain("paint", "Paint", "brush", "paint", undefined, fresh("paint"))] : []),
  ];
  dock.replaceChildren(...kids, ...others);
  // On a narrow screen, more than eight tools go in two even rows.
  const n = kids.length + others.length;
  dock.style.setProperty("--per", String(n <= 8 ? n : Math.ceil(n / 2)));
}

const price = (n: number): string => (n === 0 ? "free" : `${n.toLocaleString("en-US")} Coins`);

/** What the line says with Select in hand: of the pieces in hand, of the area marked, or how to mark one. */
function selectLine(f: boolean): { text: string; bad: boolean } {
  const g = S.group;
  if (g) {
    if (S.aim?.why) return { text: S.aim.why, bad: true };
    const moving = g.as === "move";
    const what = moving
      ? "Move"
      : `${g.as === "copy" ? "Copy" : "Blueprint"}, ${price(S.aim?.cost ?? priceOf(S.world, piecesInHand(g), true))}`;
    if (f) return { text: S.aim ? `${what}. Tap again, or Build.` : `${what}: tap where it goes.`, bad: false };
    return { text: `${what}: click to place it. ${WORKS_KEYS.name("rotate")} rotates it.`, bad: false };
  }
  if (S.saving) return { text: "Save it in which place?", bad: false };
  const m = S.mark;
  if (m) return { text: `${m.pieces.length} piece${m.pieces.length === 1 ? "" : "s"}, ${price(m.cost)}`, bad: false };
  if (S.corner) return { text: "Now tap the opposite corner.", bad: false };
  return { text: f ? "Tap two opposite corners of an area." : "Drag over pieces to select them.", bad: false };
}

/** What the line over the dock says just now. */
function handLine(): { text: string; bad: boolean } {
  if (catchingUp()) return { text: `${CATCHING_UP}.`, bad: false };
  if (message && performance.now() < messageUntil) return { text: message, bad: true };
  const tool = S.tool;
  const f = S.finger;
  if (tool === "select") return selectLine(f);
  if (tool === null)
    return {
      text: f ? "Tap a piece for its card." : "Pick a tool, or click a piece for its card.",
      bad: false,
    };
  if (tool === "remove") {
    if (S.aim?.why && (f || S.aim.why !== "Nothing to remove here")) return { text: S.aim.why, bad: true };
    return {
      text: f ? (S.aim ? "Tap again, or Remove." : "Tap a piece to remove it.") : "Click a piece to remove it.",
      bad: false,
    };
  }
  if (tool === "paint") return { text: `${f ? "Tap" : "Click"} a belt to colour its whole line.`, bad: false };
  const name = KIND_INFO[tool]?.name ?? "";
  if (S.run) {
    if (S.run.why) return { text: S.run.why, bad: true };
    const n = S.run.legs.length;
    return { text: `${n} belt${n === 1 ? "" : "s"}, ${S.run.cost === 0 ? "free" : `${S.run.cost} Coins`}`, bad: false };
  }
  if (S.aim?.why) return { text: S.aim.why, bad: true };
  // Over a piece of its kind of a lower grade, it raises that piece: the line says to what, and for how much.
  if (S.aim?.raises !== undefined && !S.from) {
    const what = `Raise to ${numeral(S.aim.grade ?? 1)}: ${price(S.aim.cost)}.`;
    return { text: f ? `${what} Tap again, or Raise.` : `${what} Click to raise it.`, bad: false };
  }
  if (tool === BELT) {
    if (!f) return { text: `Belt: drag to place a line. ${WORKS_KEYS.name("rotate")} rotates it.`, bad: false };
    return { text: S.from ? "Now tap where it ends." : "Tap where the line starts.", bad: false };
  }
  if (f) return { text: S.aim ? "Tap again, or Build." : `${name}: tap where it goes.`, bad: false };
  const flips = tool === SORTER ? `, ${WORKS_KEYS.name("flip")} flips it` : "";
  return { text: `${name}: click to place it. ${WORKS_KEYS.name("rotate")} rotates it${flips}.`, bad: false };
}

const DOT = new Map<number, string>([
  [GATHERER, GREEN[4]],
  [MILL, GOLD[1]],
  [BENCH, GOLD[1]],
  [WORKSHOP, GOLD[1]],
  [CRATE, "#a35d3b"],
  [STUDY, GOLD[1]],
  [PYLON, WATER[3]],
  [WHEEL, WATER[3]],
  [BOILER, WATER[3]],
]);

/** A blueprint's layout as a small picture on dark, a dot to a tile: belts pale, gatherers green, machines gold, power blue. */
function thumb(pieces: readonly Piece[]): HTMLCanvasElement {
  const box = boxOf(pieces);
  const { c, g } = makeCanvas(box.w + 2, box.h + 2);
  g.fillStyle = INK;
  g.fillRect(0, 0, c.width, c.height);
  for (const p of pieces) {
    g.fillStyle = DOT.get(p.kind) ?? "#cbb894";
    g.fillRect(p.x + 1, p.y + 1, 1, 1);
    if (p.kind === TUNNEL) g.fillRect(p.x + 1 + DX[p.dir] * (p.span + 1), p.y + 1 + DY[p.dir] * (p.span + 1), 1, 1);
  }
  return shown(c, box.w > 14 || box.h > 10 ? 0.5 : box.w > 6 || box.h > 4 ? 1 : 2);
}

/** A blueprint's place as the line over the dock shows it: empty, or what is kept there and what standing it costs now. */
type Place =
  | { readonly slot: number; readonly kept: false }
  | {
      readonly slot: number;
      readonly kept: true;
      readonly w: number;
      readonly h: number;
      readonly cost: number;
      readonly asking: boolean;
      /** The kept bytes, summed, so that a blueprint kept again over another is drawn again. */
      readonly sum: number;
    };

/** Everything the line over the dock shows, worked out from what is in hand, the yard and the purse: it is drawn again exactly when this differs. */
interface HandPrint {
  readonly line: { readonly text: string; readonly bad: boolean };
  readonly building: boolean;
  readonly finger: boolean;
  /** The grades the kind in hand may be built at: the numeral's grade, the price of one, and whether it is the one chosen. */
  readonly grades: readonly { readonly grade: number; readonly cost: number; readonly on: boolean }[];
  readonly kind: Kind | null;
  readonly gradesNudged: boolean;
  /** The brush's colours, and the one on it. */
  readonly tints: number | null;
  /** The places for blueprints, while Select has nothing marked or Save is asking; with Save asking, whether a press keeps the marked pieces there. */
  readonly places: readonly Place[];
  readonly saving: boolean;
  /** Move, Copy, Remove and Save, for an area marked; and Upgrade, with its price and whether it asks to be pressed again. */
  readonly acting: boolean;
  readonly save: boolean;
  readonly upgrade: { readonly cost: number; readonly asking: boolean } | null;
  readonly turn: boolean;
  /** Flip, for a sorter in hand. */
  readonly flip: boolean;
  readonly undo: boolean;
  /** A blueprint held, and whether its bin asks to be pressed again. */
  readonly bin: { readonly slot: number; readonly asking: boolean } | null;
  readonly cancel: boolean;
  /** For a finger: the gold button, what it says, and whether what is aimed cannot go. */
  readonly go: { readonly label: string; readonly bad: boolean } | null;
}

/** A quick sum of a blueprint's bytes. */
function sumOf(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (const v of bytes) h = Math.imul(h ^ v, 0x01000193);
  return h >>> 0;
}

function handPrint(): HandPrint {
  const h = S.hand;
  const tool = S.tool;
  const f = S.finger;
  const stage = h.is === "select" ? h.stage : null;
  const acting = stage?.is === "marked";
  const places: Place[] =
    stage !== null && (stage.is === "empty" || stage.is === "saving")
      ? Array.from({ length: S.world.open.blueprints }, (_, slot): Place => {
          const kept = S.world.blueprints[slot];
          if (!kept) return { slot, kept: false };
          const pieces = piecesOf(kept);
          const box = boxOf(pieces);
          const key = `blueprint-${slot}`;
          return {
            slot,
            kept: true,
            w: box.w,
            h: box.h,
            cost: priceOf(S.world, pieces, true),
            asking: asking(key),
            sum: sumOf(kept),
          };
        })
      : [];
  const top = builds(tool) && isGraded(tool) ? highest(S.world.open, tool) : 1;
  const grades =
    builds(tool) && top > 1
      ? Array.from({ length: top }, (_, k) => ({
          grade: k + 1,
          cost: costOf(S.world, tool, k + 1),
          on: gradeInHand(tool) === k + 1,
        }))
      : [];
  const raise = acting && locked(S.world.open, { use: "upgrade" }) === null ? upgradeCost() : 0;
  const g = S.group;
  const aiming = f && tool !== null && tool !== "paint" && (S.aim !== null || S.run !== null);
  return {
    line: handLine(),
    building: tool !== null,
    finger: f,
    grades,
    kind: builds(tool) ? tool : null,
    gradesNudged: S.nudge?.part === "grades",
    tints: tool === "paint" ? S.tint : null,
    places,
    saving: stage?.is === "saving",
    acting,
    save: acting && S.world.open.blueprints > 0,
    upgrade: raise > 0 ? { cost: raise, asking: asking("upgrade") } : null,
    turn: builds(tool) || g !== null,
    flip: tool === SORTER,
    undo: stage?.is !== "saving",
    bin: typeof g?.as === "number" ? { slot: g.as, asking: asking(`delete-${g.as}`) } : null,
    cancel: tool !== null,
    go: aiming
      ? {
          label: tool === "remove" ? "Remove" : !S.run && S.aim?.raises !== undefined ? "Raise" : "Build",
          bad: (S.run?.why ?? (S.run ? null : S.aim?.why)) != null,
        }
      : null,
  };
}

/**
 * One of the yard's places for a blueprint. A kept one shows its layout, its size in tiles and what
 * it costs to stand now, and is taken in hand by pressing it. While Save is asking, pressing a
 * place keeps the marked pieces there: at once in an empty one, on a second press over a kept one.
 */
function placeButton(p: Place, saving: boolean): HTMLElement {
  const { slot } = p;
  if (!p.kept)
    return button(saving ? "wood sm" : "wood sm off", ["Empty"], () => {
      if (S.saving) saveMark(slot);
    });
  const key = `blueprint-${slot}`;
  const kept = S.world.blueprints[slot];
  const facts = el(
    "span",
    "facts",
    {},
    el("span", "", { text: `${p.w}x${p.h}` }),
    el("span", p.cost === 0 ? "" : "k-gold", { text: p.cost === 0 ? "free" : p.cost.toLocaleString("en-US") }),
  );
  const face = p.asking || !kept ? ["Replace?"] : [thumb(piecesOf(kept)), facts];
  return button(p.asking ? "sm asking" : "wood sm print", face, () => {
    if (!S.saving) hold(slot);
    else if (pressedTwice(key, refreshDock)) saveMark(slot);
  });
}

/** One of the things done to a marked area, with its key (of `act`) in its tip. */
function action(name: string, act: WorksAction, on: () => void): HTMLElement {
  const b = button(name === "Remove" ? "coral sm" : "sm", [name], on);
  tip(b, () => `${name} (${WORKS_KEYS.name(act)})`);
  return b;
}

/** Rotate, and for a sorter in hand Flip, each with its key in its tip. */
function turning(p: HandPrint): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (p.turn) {
    const turn = iconButton("wood sm", yardIcon("turn"), "Rotate", rotate);
    tip(
      turn,
      () => `Rotate (${WORKS_KEYS.name("rotate")})`,
      "With no tool picked, it rotates the piece you last pointed at.",
    );
    out.push(turn);
  }
  if (p.flip) {
    const over = iconButton("wood sm", yardIcon("flip"), "Flip", flip);
    tip(over, () => `Flip (${WORKS_KEYS.name("flip")})`, "Sends the sorter's item out of its other side.");
    out.push(over);
  }
  return out;
}

/** The line over the dock, drawn from its print alone. */
function drawHand(p: HandPrint): void {
  const hand = $("hand");
  const kids: Node[] = p.places.map((place) => placeButton(place, p.saving));
  if (p.acting)
    kids.push(
      action("Move", "move", () => {
        hold("move");
      }),
      action("Copy", "paint", () => {
        hold("copy");
      }),
      action("Remove", "clear", clearMark),
      ...(p.save ? [button("sm", ["Save"], askSave)] : []),
    );
  // With "Upgrading an area" known, and something marked that can be raised: the whole price, asked twice.
  const upgrade = p.upgrade
    ? button(
        p.upgrade.asking ? "sm asking" : "sm",
        [asksAgain("upgrade", ["Upgrade", amount("coin", p.upgrade.cost)], "Press again")],
        () => {
          if (pressedTwice("upgrade", refreshDock)) upgradeMark();
        },
      )
    : null;
  if (upgrade) upgrade.dataset.act = "upgrade";
  // The grades a kind in hand may be built at: the numeral and the price of one, the chosen one lit.
  const kind = p.kind;
  const grades =
    kind === null
      ? []
      : p.grades.map(({ grade, cost, on }) => {
          const b = el(
            "button",
            `k-slot${on ? " lit" : ""}`,
            {
              type: "button",
              "aria-label": `${KIND_INFO[kind]?.name ?? ""} ${numeral(grade)}`,
              "aria-pressed": on ? "true" : "false",
              "data-grade": String(grade),
            },
            el("b", "", { text: numeral(grade) }),
            el("span", cost === 0 ? "k-s k-dim" : "k-s k-gold", { text: cost === 0 ? "free" : String(cost) }),
          );
          b.addEventListener("click", () => {
            setGrade(grade);
          });
          // Pointing (or a finger kept on it) shows what that grade is.
          link(b, machineRef(kind, grade), { acts: true });
          return b;
        });
  kids.push(...turning(p));
  if (p.undo) {
    const back = iconButton("wood sm undo", yardIcon("undo"), "Undo", () => {
      undo();
    });
    tip(back, () => `Undo (${WORKS_KEYS.name("undo")})`);
    kids.push(back);
  }
  if (p.bin) {
    const { slot, asking: again } = p.bin;
    const drop = (): void => {
      if (pressedTwice(`delete-${slot}`, refreshDock)) dropBlueprint(slot);
    };
    const bin = again
      ? button("sm asking", ["Delete?"], drop)
      : iconButton("wood sm", yardIcon("bin"), "Delete this blueprint", drop);
    tip(bin, "Delete this blueprint");
    kids.push(bin);
  }
  if (p.cancel) {
    const away = iconButton("wood sm", icon("close"), "Cancel", cancel);
    tip(away, () => `Cancel (${WORKS_KEYS.name("back")})`);
    kids.push(away);
  }
  if (p.go)
    kids.push(
      button(p.go.bad ? "sm off" : "sm", [icon("check"), p.go.label], () => {
        confirm();
      }),
    );
  // The brush's colours: a piece of belt in each, and one with none.
  const tints =
    p.tints === null
      ? []
      : [0, 1, 2, 3, 4, 5, 6].map((t) => {
          const name = PAINTS[t - 1]?.name ?? "No colour";
          const b = el(
            "button",
            `k-slot${p.tints === t ? " lit" : ""}`,
            { type: "button", "aria-label": name, "aria-pressed": p.tints === t ? "true" : "false" },
            fitted(bare(t), 10, 16),
          );
          b.addEventListener("click", () => {
            S.tint = t;
            refreshDock();
          });
          tip(b, name);
          return b;
        });
  hand.replaceChildren(
    el("span", p.line.bad ? "say bad" : "say", { text: p.line.text }),
    ...(tints.length > 0 ? [el("div", "tints", {}, ...tints)] : []),
    ...(grades.length > 0 ? [el("div", `grades${p.gradesNudged ? " nudged" : ""}`, {}, ...grades)] : []),
    ...(upgrade ? [el("div", "acts", {}, upgrade)] : []),
    el("div", p.acting ? "acts tight" : "acts", {}, ...kids),
  );
  hand.classList.toggle("building", p.building);
}

let dockKey: (() => void) | null = null;
let handKey: (() => void) | null = null;

export function initDock(art: Art): void {
  dockKey = when(
    () =>
      `${openTools().join()}|${usable("select")}|${usable("paint")}|${S.tool}|${S.nudge?.tool}|${openTools()
        .map((k) => `${gradeInHand(k)}:${costOf(S.world, k, gradeInHand(k))}`)
        .join()}|${usable(STOP) ? `${stopsStand().stand}/${stopsStand().may}` : ""}`,
    () => {
      buildDock(art);
    },
  );
  handKey = shows(handPrint, drawHand);
  toolHooks.changed = refreshDock;
  toolHooks.said = say;
  refreshDock();
}

export function refreshDock(): void {
  dockKey?.();
  handKey?.();
}

/** Says something on the line over the dock for a few seconds. */
export function say(text: string): void {
  if (!text) return;
  message = text;
  messageUntil = performance.now() + 2600;
  handKey?.();
}
