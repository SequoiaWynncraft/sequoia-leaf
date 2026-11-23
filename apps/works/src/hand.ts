/**
 * What the member has in hand, as one value (`S.hand`), and the one function that moves it (`step`).
 * Each variant holds only what it can have: a kind of piece to build and where it is aimed; a run of
 * belt being dragged out with the mouse, or laid from two taps; the spade; the brush, with the lines
 * a drag going on has coloured; Select, at one of its stages; or nothing.
 *
 * A drag belongs to the hand: a run of belt, a stroke of the brush and an area being marked are each
 * a variant, with the press that began it. Whatever the hand is moved to ends the drag with it, so a
 * drag can go on only while the hand still holds it: a stroke cannot outlive the brush, and a run
 * cannot outlast a lost press. Escape (`back`) steps back one stage of whatever is in hand.
 *
 * What an aim, a run, a mark or the pieces held are is worked out from the yard by `tools.ts`, which
 * hands it in; nothing here reads the yard, the purse or the page.
 */

import { BELT, type Kind } from "@sequoia-leaf/factory";

import type { Aim, Group, Mark, Run, Tool } from "./state.ts";

/** A tile of the yard. */
export interface Tile {
  readonly x: number;
  readonly y: number;
}

/** Select's stages: nothing marked, an area being marked (from its first corner), an area marked, Save asking where, or pieces held. */
export type Stage =
  | { readonly is: "empty" }
  | { readonly is: "marking"; readonly corner: Tile; readonly mark: Mark | null; readonly pointer: number | null }
  | { readonly is: "marked"; readonly mark: Mark }
  | { readonly is: "saving"; readonly mark: Mark }
  | { readonly is: "holding"; readonly group: Group; readonly mark: Mark | null; readonly aim: Aim | null };

export type Hand =
  | { readonly is: "idle" }
  /** A kind of piece, aimed at a tile or not; `faced` is the tile it last took its facing from. */
  | { readonly is: "build"; readonly kind: Kind; readonly aim: Aim | null; readonly faced: number }
  /** A run of belt dragged out with the mouse (`pointer`), over the tiles it has passed. */
  | {
      readonly is: "beltDrag";
      readonly pointer: number;
      readonly path: readonly Tile[];
      readonly run: Run | null;
      readonly aim: Aim | null;
    }
  /** A run of belt laid from two taps: where the first tap said it starts, and once a second has said where it ends, the run. */
  | { readonly is: "beltTaps"; readonly from: Tile; readonly run: Run | null; readonly aim: Aim | null }
  | { readonly is: "remove"; readonly aim: Aim | null }
  /** The brush; while a drag colours lines, the press (`pointer`) and the stroke's number, which undoes it as one. */
  | {
      readonly is: "paint";
      readonly aim: Aim | null;
      readonly stroke: { readonly pointer: number; readonly id: number } | null;
    }
  | { readonly is: "select"; readonly stage: Stage };

export type HandEvent =
  /** A tool taken up, or with null put away. */
  | { readonly do: "pick"; readonly tool: Tool }
  /** Escape, or the dock's cancel. A finger's aim is put away before the tool is: a mouse's follows the pointer. */
  | { readonly do: "back"; readonly finger: boolean }
  /** The press that began a drag is lost (the window lost focus, the press was cancelled, the yard is being taken): the drag ends, doing nothing. */
  | { readonly do: "drop" }
  /** Where the thing in hand is aimed, as `tools.ts` worked it out; for a kind, the tile it last took its facing from. */
  | { readonly do: "aim"; readonly aim: Aim | null; readonly faced?: number }
  /** A drag with the belt begins on a tile; it passes over more (`path`, as `tools.ts` follows it), and its run is worked out. */
  | { readonly do: "drag"; readonly pointer: number; readonly path: readonly Tile[] }
  | { readonly do: "run"; readonly run: Run | null; readonly aim: Aim | null }
  /** A finger's run: where it starts, or (with null) none. */
  | { readonly do: "from"; readonly from: Tile | null }
  /** A run or a belt was laid, or failed to be: the belt stays in hand, aimed at nothing. */
  | { readonly do: "laid" }
  /** A stroke of the brush begun by a press (`pointer`), with its number; or ended. */
  | { readonly do: "stroke"; readonly pointer: number; readonly id: number }
  | { readonly do: "stroked" }
  /** Select: a first corner (a mouse's drag, `pointer`, or a finger's first tap), the area so far, and the area marked. */
  | { readonly do: "corner"; readonly corner: Tile; readonly pointer: number | null }
  | { readonly do: "marking"; readonly mark: Mark | null }
  | { readonly do: "marked"; readonly mark: Mark | null }
  /** Save pressed: the places are offered, or with it pressed again, put away. */
  | { readonly do: "save" }
  /** Pieces taken in hand (with the area they came from, for a move or a copy), or put down and let go. */
  | { readonly do: "hold"; readonly group: Group; readonly mark: Mark | null }
  | { readonly do: "group"; readonly group: Group; readonly aim: Aim | null }
  | { readonly do: "unhold" };

export const IDLE: Hand = { is: "idle" };

/** The hand that takes up a tool, aimed at nothing yet. */
function taken(tool: Tool): Hand {
  if (tool === null) return IDLE;
  if (tool === "remove") return { is: "remove", aim: null };
  if (tool === "paint") return { is: "paint", aim: null, stroke: null };
  if (tool === "select") return { is: "select", stage: { is: "empty" } };
  return { is: "build", kind: tool, aim: null, faced: -1 };
}

/** The belt in hand: where a run of it ends up, laid or not. A mouse's aim stays where the pointer is; a finger's is put away. */
const belt = (h: Extract<Hand, { is: "beltDrag" | "beltTaps" }>): Hand => ({
  is: "build",
  kind: BELT,
  aim: h.is === "beltTaps" ? null : h.aim,
  faced: -1,
});

/** Select at a stage. */
const at = (stage: Stage): Hand => ({ is: "select", stage });

/** One stage back from a stage of Select: pieces held are let go, Save stops asking, a mark is let go, then Select itself. */
function stageBack(s: Stage): Hand {
  switch (s.is) {
    case "holding":
      return at(s.mark ? { is: "marked", mark: s.mark } : { is: "empty" });
    case "saving":
      return at({ is: "marked", mark: s.mark });
    case "marked":
    case "marking":
      return at({ is: "empty" });
    case "empty":
      return IDLE;
  }
}

/**
 * The hand after an event. A run of belt, dragged or tapped out, comes back to the belt in hand
 * once it is done with. An event that means nothing to what is in hand leaves it as it is.
 */
export function step(h: Hand, e: HandEvent): Hand {
  switch (e.do) {
    case "pick":
      return taken(e.tool);
    case "back":
      switch (h.is) {
        case "idle":
          return h;
        case "beltDrag":
        case "beltTaps":
          return belt(h);
        case "paint":
          return h.stroke ? { ...h, stroke: null } : e.finger && h.aim ? { ...h, aim: null } : IDLE;
        case "build":
        case "remove":
          return e.finger && h.aim ? { ...h, aim: null } : IDLE;
        case "select":
          return stageBack(h.stage);
      }
      return h;
    case "drop":
      if (h.is === "beltDrag") return belt(h);
      if (h.is === "paint" && h.stroke) return { ...h, stroke: null };
      if (h.is === "select" && h.stage.is === "marking" && h.stage.pointer !== null)
        return at(h.stage.mark ? { is: "marked", mark: h.stage.mark } : { is: "empty" });
      return h;
    case "aim":
      if (h.is === "build") return { ...h, aim: e.aim, faced: e.faced ?? h.faced };
      if (h.is === "remove" || h.is === "paint" || h.is === "beltTaps") return { ...h, aim: e.aim };
      if (h.is === "select" && h.stage.is === "holding") return at({ ...h.stage, aim: e.aim });
      return h;
    case "drag":
      if (h.is === "build" && h.kind === BELT)
        return { is: "beltDrag", pointer: e.pointer, path: e.path, run: null, aim: h.aim };
      if (h.is === "beltDrag" && h.pointer === e.pointer) return { ...h, path: e.path };
      return h;
    case "run":
      if (h.is === "beltDrag" || h.is === "beltTaps") return { ...h, run: e.run, aim: e.aim };
      return h;
    case "from":
      if (e.from === null) return h.is === "beltTaps" ? belt(h) : h;
      if ((h.is === "build" && h.kind === BELT) || h.is === "beltTaps")
        return { is: "beltTaps", from: e.from, run: null, aim: null };
      return h;
    case "laid":
      return h.is === "beltDrag" || h.is === "beltTaps" ? belt(h) : h;
    case "stroke":
      return h.is === "paint" ? { ...h, stroke: { pointer: e.pointer, id: e.id } } : h;
    case "stroked":
      return h.is === "paint" ? { ...h, stroke: null } : h;
    case "corner":
      return h.is === "select" && h.stage.is !== "holding"
        ? at({ is: "marking", corner: e.corner, mark: null, pointer: e.pointer })
        : h;
    case "marking":
      return h.is === "select" && h.stage.is === "marking" ? at({ ...h.stage, mark: e.mark }) : h;
    case "marked":
      if (h.is !== "select") return h;
      if (h.stage.is === "holding") return e.mark ? at({ ...h.stage, mark: e.mark }) : h;
      return at(e.mark ? { is: "marked", mark: e.mark } : { is: "empty" });
    case "save":
      if (h.is !== "select") return h;
      if (h.stage.is === "marked") return at({ is: "saving", mark: h.stage.mark });
      if (h.stage.is === "saving") return at({ is: "marked", mark: h.stage.mark });
      return h;
    case "hold":
      return h.is === "select" ? at({ is: "holding", group: e.group, mark: e.mark, aim: null }) : h;
    case "group":
      return h.is === "select" && h.stage.is === "holding" ? at({ ...h.stage, group: e.group, aim: e.aim }) : h;
    case "unhold":
      return h.is === "select" && h.stage.is === "holding" ? stageBack(h.stage) : h;
  }
}

/** The tool in hand, as the dock and the keys name tools. */
export function toolOf(h: Hand): Tool {
  switch (h.is) {
    case "idle":
      return null;
    case "build":
      return h.kind;
    case "beltDrag":
    case "beltTaps":
      return BELT;
    case "remove":
      return "remove";
    case "paint":
      return "paint";
    case "select":
      return "select";
  }
}

/** Where the thing in hand is aimed, if anywhere. */
export function aimOf(h: Hand): Aim | null {
  if (h.is === "idle") return null;
  if (h.is === "select") return h.stage.is === "holding" ? h.stage.aim : null;
  return h.aim;
}

/** The run of belt shown before it is laid, if one is. */
export const runOf = (h: Hand): Run | null => (h.is === "beltDrag" || h.is === "beltTaps" ? h.run : null);

/** The area marked with Select, or being marked, if one is. */
export const markOf = (h: Hand): Mark | null => (h.is === "select" && h.stage.is !== "empty" ? h.stage.mark : null);

/** The pieces held with Select, if any are. */
export const groupOf = (h: Hand): Group | null =>
  h.is === "select" && h.stage.is === "holding" ? h.stage.group : null;
