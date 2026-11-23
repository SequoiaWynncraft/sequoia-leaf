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
import { builds, DRAWN, gradeInHand, S, type Tool } from "../state.ts";
import {
  askSave,
  cancel,
  clearMark,
  confirm,
  dropBlueprint,
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
import { CATCHING_UP, catchingUp, yardReads } from "../yard.ts";
import { machineRef } from "./card.ts";
import { $, button, fitted, when, type YardIcon, yardIcon } from "./parts.ts";

/** The tools in the order they sit in the dock, which is also the order of the number keys: every kind this page draws. */
export const TOOLS: readonly Kind[] = DRAWN;
export const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="];

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

/** The slot of a tool that builds nothing: Select, the spade, the brush. `key` is its key, `more` the rest of its tip. */
function plain(
  tool: "select" | "remove" | "paint",
  name: string,
  pic: YardIcon,
  key: string,
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
  tip(b, `${name} (${key})`, more);
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
            "F",
            "Mark out an area to move, copy, remove or save as a blueprint.",
            fresh("select"),
          ),
        ]
      : []),
    plain("remove", "Remove", "spade", "E", "Right-click does the same."),
    ...(usable("paint") ? [plain("paint", "Paint", "brush", "C", undefined, fresh("paint"))] : []),
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
    return { text: `${what}: click to place it. R rotates it.`, bad: false };
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
    if (!f) return { text: "Belt: drag to place a line. R rotates it.", bad: false };
    return { text: S.from ? "Now tap where it ends." : "Tap where the line starts.", bad: false };
  }
  if (f) return { text: S.aim ? "Tap again, or Build." : `${name}: tap where it goes.`, bad: false };
  return { text: `${name}: click to place it. R rotates it.`, bad: false };
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

/**
 * One of the yard's places for a blueprint. A kept one shows its layout, its size in tiles and what
 * it costs to stand now, and is taken in hand by pressing it. While Save is asking, pressing a
 * place keeps the marked pieces there: at once in an empty one, on a second press over a kept one.
 */
function place(slot: number): HTMLElement {
  const kept = S.world.blueprints[slot];
  const key = `blueprint-${slot}`;
  if (!kept)
    return button(S.saving ? "wood sm" : "wood sm off", ["Empty"], () => {
      if (S.saving) saveMark(slot);
    });
  const print = piecesOf(kept);
  const box = boxOf(print);
  const cost = priceOf(S.world, print, true);
  const facts = el(
    "span",
    "facts",
    {},
    el("span", "", { text: `${box.w}x${box.h}` }),
    el("span", cost === 0 ? "" : "k-gold", { text: cost === 0 ? "free" : cost.toLocaleString("en-US") }),
  );
  return button(asking(key) ? "sm asking" : "wood sm print", asking(key) ? ["Replace?"] : [thumb(print), facts], () => {
    if (!S.saving) hold(slot);
    else if (pressedTwice(key, buildHand)) saveMark(slot);
  });
}

/** One of the things done to a marked area, with its key in its tip. */
function action(name: string, key: string, on: () => void): HTMLElement {
  const b = button(name === "Remove" ? "coral sm" : "sm", [name], on);
  tip(b, `${name} (${key})`);
  return b;
}

function buildHand(): void {
  const hand = $("hand");
  const tool = S.tool;
  const line = handLine();
  const aiming = S.finger && tool !== null && tool !== "paint" && (S.aim !== null || S.run !== null);
  const kids: Node[] = [];
  const g = S.group;
  const marking = tool === "select" && !g;
  /** The four actions on a marked area: with them the buttons sit closer, to fit a phone's width. */
  const acting = marking && S.mark !== null && !S.saving;
  // As many places for blueprints as the yard has unlocked, and none before.
  if (marking && !S.corner && (S.saving || !S.mark))
    kids.push(...Array.from({ length: S.world.open.blueprints }, (_, slot) => place(slot)));
  else if (acting) {
    kids.push(
      action("Move", "M", () => {
        hold("move");
      }),
      action("Copy", "C", () => {
        hold("copy");
      }),
      action("Remove", "Del", clearMark),
      ...(S.world.open.blueprints > 0 ? [button("sm", ["Save"], askSave)] : []),
    );
  }
  // With "Upgrading an area" known, and something marked that can be raised: the whole price, asked twice.
  const raise = acting && locked(S.world.open, { use: "upgrade" }) === null ? upgradeCost() : 0;
  const upgrade =
    raise > 0
      ? button(
          asking("upgrade") ? "sm asking" : "sm",
          [asksAgain("upgrade", ["Upgrade", amount("coin", raise)], "Press again")],
          () => {
            if (pressedTwice("upgrade", buildHand)) upgradeMark();
          },
        )
      : null;
  if (upgrade) upgrade.dataset.act = "upgrade";
  // The grades a kind in hand may be built at: the numeral and the price of one, the chosen one lit.
  const top = builds(tool) && isGraded(tool) ? highest(S.world.open, tool) : 1;
  const grades =
    builds(tool) && top > 1
      ? Array.from({ length: top }, (_, k) => {
          const grade = k + 1;
          const cost = costOf(S.world, tool, grade);
          const on = gradeInHand(tool) === grade;
          const b = el(
            "button",
            `k-slot${on ? " lit" : ""}`,
            {
              type: "button",
              "aria-label": `${KIND_INFO[tool]?.name ?? ""} ${numeral(grade)}`,
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
          link(b, machineRef(tool, grade), { acts: true });
          return b;
        })
      : [];
  const turn = button("wood icon sm", [yardIcon("turn")], rotate);
  tip(turn, "Rotate (R)", "With no tool picked, it rotates the piece you last pointed at.");
  const back = button("wood icon sm undo", [yardIcon("undo")], () => {
    undo();
  });
  tip(back, "Undo (Z)");
  if (builds(tool) || g) kids.push(turn);
  if (!S.saving) kids.push(back);
  if (typeof g?.as === "number") {
    const slot = g.as;
    const key = `delete-${slot}`;
    const bin = button(asking(key) ? "sm asking" : "wood icon sm", [asking(key) ? "Delete?" : yardIcon("bin")], () => {
      if (pressedTwice(key, buildHand)) dropBlueprint(slot);
    });
    tip(bin, "Delete this blueprint");
    kids.push(bin);
  }
  if (tool !== null) {
    const away = button("wood icon sm", [icon("close")], cancel);
    tip(away, "Cancel (Esc)");
    kids.push(away);
  }
  if (aiming) {
    const bad = (S.run?.why ?? (S.run ? null : S.aim?.why)) != null;
    const raising = !S.run && S.aim?.raises !== undefined;
    const go = button(
      bad ? "sm off" : "sm",
      [icon("check"), tool === "remove" ? "Remove" : raising ? "Raise" : "Build"],
      () => {
        confirm();
      },
    );
    kids.push(go);
  }
  // The brush's colours: a piece of belt in each, and one with none.
  const tints =
    tool === "paint"
      ? [0, 1, 2, 3, 4, 5, 6].map((t) => {
          const name = PAINTS[t - 1]?.name ?? "No colour";
          const b = el(
            "button",
            `k-slot${S.tint === t ? " lit" : ""}`,
            { type: "button", "aria-label": name, "aria-pressed": S.tint === t ? "true" : "false" },
            fitted(bare(t), 10, 16),
          );
          b.addEventListener("click", () => {
            S.tint = t;
            refreshDock();
          });
          tip(b, name);
          return b;
        })
      : [];
  hand.replaceChildren(
    el("span", line.bad ? "say bad" : "say", { text: line.text }),
    ...(tints.length > 0 ? [el("div", "tints", {}, ...tints)] : []),
    ...(grades.length > 0 ? [el("div", `grades${S.nudge?.part === "grades" ? " nudged" : ""}`, {}, ...grades)] : []),
    ...(upgrade ? [el("div", "acts", {}, upgrade)] : []),
    el("div", acting ? "acts tight" : "acts", {}, ...kids),
  );
  hand.classList.toggle("building", tool !== null);
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
  handKey = when(() => {
    const l = handLine();
    const tool = S.tool;
    // With Select in hand, also what is marked or held, and (by the yard's own count of changes) the blueprints.
    const select =
      tool === "select"
        ? `${S.mark !== null}|${S.corner !== null}|${S.group?.as}|${S.saving}|${yardReads()}.${S.world.rev}|${asking("upgrade")}`
        : "";
    // With a graded kind in hand, the grades it may be built at, the one chosen, and what one costs now.
    const graded =
      builds(tool) && isGraded(tool)
        ? `${highest(S.world.open, tool)}|${gradeInHand(tool)}|${yardReads()}.${S.world.rev}`
        : "";
    return `${tool}|${S.tint}|${S.finger}|${S.aim !== null}|${S.run !== null}|${l.text}|${(S.run?.why ?? S.aim?.why) != null}|${select}|${graded}|${S.nudge?.part}`;
  }, buildHand);
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

/** The tool a number key picks. */
export function toolForKey(key: string): Tool | undefined {
  const n = KEYS.indexOf(key);
  return n < 0 ? undefined : openTools()[n];
}
