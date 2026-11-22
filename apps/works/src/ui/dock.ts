/**
 * The tools along the bottom, and over them the line that says what is in hand with the buttons
 * that act on it: turn, undo, and (for a finger, which cannot hover) build and put away.
 */

import { link } from "@sequoia-leaf/kit/card.ts";
import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import { tip } from "@sequoia-leaf/kit/tip.ts";
import { costOf, KIND, type Kind } from "@sequoia-leaf/yard";

import { PAINTS } from "../art/belts.ts";
import { type Art, bare } from "../art/index.ts";
import { builds, S, type Tool } from "../state.ts";
import { cancel, confirm, rotate, setTool, toolHooks, undo } from "../tools.ts";
import { machineRef } from "./card.ts";
import { $, button, fitted, when, type YardIcon, yardIcon } from "./parts.ts";

/** The tools in the order they sit in the dock, which is also the order of the number keys. */
export const TOOLS: readonly Kind[] = [
  "belt",
  "gatherer",
  "mill",
  "bench",
  "workshop",
  "splitter",
  "joiner",
  "tunnel",
  "crate",
  "pylon",
  "wheel",
  "boiler",
];
export const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="];

/** The tools the yard may build, in dock order. */
export const openTools = (): Kind[] => TOOLS.filter((k) => S.world.open.kinds.has(k));

/** Tools seen in the dock before, so that a new one can make an entrance. */
let known: Set<Kind> | null = null;
let message = "";
let messageUntil = 0;

function slotFor(art: Art, kind: Kind, fresh: boolean): HTMLElement {
  const cost = costOf(S.world, kind);
  const b = el(
    "button",
    `k-slot${S.tool === kind ? " lit" : ""}${fresh ? " new" : ""}${S.nudgeTool === kind && S.tool !== kind ? " nudged" : ""}`,
    { type: "button", "aria-label": KIND[kind].name, "aria-pressed": S.tool === kind ? "true" : "false" },
    el("span", "art", {}, fitted(art.icon(kind), 20, 19)),
    el("span", cost === 0 ? "k-dim" : "k-gold", { text: cost === 0 ? "free" : String(cost) }),
  );
  b.addEventListener("click", () => {
    setTool(S.tool === kind ? null : kind);
  });
  // Clicking takes it up as the tool; pointing (or a finger kept on it) shows the machine's card.
  link(b, machineRef(kind), { acts: true });
  return b;
}

/** A tool that builds nothing: the spade, the brush. */
function plain(tool: "remove" | "paint", name: string, pic: YardIcon): HTMLElement {
  const b = el(
    "button",
    `k-slot${S.tool === tool ? " lit" : ""}`,
    { type: "button", "aria-label": name, "aria-pressed": S.tool === tool ? "true" : "false" },
    el("span", "art", {}, yardIcon(pic)),
    el("span", "k-dim", { text: name }),
  );
  b.addEventListener("click", () => {
    setTool(S.tool === tool ? null : tool);
  });
  return b;
}

function buildDock(art: Art): void {
  const dock = $("dock");
  const open = openTools();
  const first = known === null;
  const kids = open.map((k) => slotFor(art, k, !first && !(known?.has(k) ?? true)));
  known = new Set(open);
  const spade = plain("remove", "Remove", "spade");
  tip(spade, "Remove (E)", "Right-click does the same.");
  const brush = plain("paint", "Paint", "brush");
  tip(brush, "Paint (C)");
  dock.replaceChildren(...kids, spade, brush);
  // On a narrow screen, more than eight tools go in two even rows.
  const n = kids.length + 2;
  dock.style.setProperty("--per", String(n <= 8 ? n : Math.ceil(n / 2)));
}

/** What the line over the dock says just now. */
function handLine(): { text: string; bad: boolean } {
  if (message && performance.now() < messageUntil) return { text: message, bad: true };
  const tool = S.tool;
  const f = S.finger;
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
  const name = KIND[tool].name;
  if (S.run) {
    if (S.run.why) return { text: S.run.why, bad: true };
    const n = S.run.legs.length;
    return { text: `${n} belt${n === 1 ? "" : "s"}, ${S.run.cost === 0 ? "free" : `${S.run.cost} Coins`}`, bad: false };
  }
  if (S.aim?.why) return { text: S.aim.why, bad: true };
  if (tool === "belt") {
    if (!f) return { text: "Belt: drag to place a line. R rotates it.", bad: false };
    return { text: S.from ? "Now tap where it ends." : "Tap where the line starts.", bad: false };
  }
  if (f) return { text: S.aim ? "Tap again, or Build." : `${name}: tap where it goes.`, bad: false };
  return { text: `${name}: click to place it. R rotates it.`, bad: false };
}

function buildHand(): void {
  const hand = $("hand");
  const tool = S.tool;
  const line = handLine();
  const aiming = S.finger && tool !== null && tool !== "paint" && (S.aim !== null || S.run !== null);
  const kids: Node[] = [];
  const turn = button("wood icon sm", [yardIcon("turn")], rotate);
  tip(turn, "Rotate (R)", "With no tool picked, it rotates the piece you last pointed at.");
  const back = button("wood icon sm", [yardIcon("undo")], () => {
    undo();
  });
  tip(back, "Undo (Z)");
  if (builds(tool)) kids.push(turn);
  kids.push(back);
  if (tool !== null) {
    const away = button("wood icon sm", [icon("close")], cancel);
    tip(away, "Cancel (Esc)");
    kids.push(away);
  }
  if (aiming) {
    const bad = (S.run?.why ?? (S.run ? null : S.aim?.why)) != null;
    const go = button(bad ? "sm off" : "sm", [icon("check"), tool === "remove" ? "Remove" : "Build"], () => {
      confirm();
    });
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
    el("div", "acts", {}, ...kids),
  );
  hand.classList.toggle("building", tool !== null);
}

let dockKey: (() => void) | null = null;
let handKey: (() => void) | null = null;

export function initDock(art: Art): void {
  dockKey = when(
    () =>
      `${openTools().join()}|${S.tool}|${S.nudgeTool}|${openTools()
        .map((k) => costOf(S.world, k))
        .join()}`,
    () => {
      buildDock(art);
    },
  );
  handKey = when(() => {
    const l = handLine();
    return `${S.tool}|${S.tint}|${S.finger}|${S.aim !== null}|${S.run !== null}|${l.text}|${(S.run?.why ?? S.aim?.why) != null}`;
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
