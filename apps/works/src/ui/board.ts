/**
 * "Top yards": the twenty yards that have earned the most Coins, all time, as Leaf keeps them
 * (`GET /v1/game/play/works/standings`), and the member's own place if they are not among them.
 * Each owner is shown as "Who is about" shows them: their face, their name, and "Guest" for a guest.
 * Read when the panel opens, and each minute while it is open.
 */

import { amount, el } from "@sequoia-leaf/kit/dom.ts";
import { member, where } from "@sequoia-leaf/kit/live.ts";
import { ask, isRecord } from "@sequoia-leaf/kit/net.ts";
import { waitingLook } from "@sequoia-leaf/kit/play.ts";
import { faceFor, facesCame } from "@sequoia-leaf/kit/skin.ts";
import { STORY } from "@sequoia-leaf/yard";

import type { Art } from "../art/index.ts";
import { button, pic, when } from "./parts.ts";

/** A yard on the board: its place, its owner, the Coins it has earned and the story orders done. */
export interface Placed {
  place: number;
  score: number;
  story: number;
}
export type Row = Placed & { id: string; name: string; guest: boolean; you: boolean };
export interface Board {
  top: Row[];
  /** The member's own place among everyone, or null before their yard has earned a Coin. */
  you: Placed | null;
}

/** How often the board is read again while it is open. */
const EVERY_MS = 60_000;

const whole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function placedOf(v: unknown): Placed | null {
  if (!isRecord(v) || !whole(v.place) || !whole(v.score) || !isRecord(v.also)) return null;
  const story = v.also.story;
  return whole(story) ? { place: v.place, score: v.score, story } : null;
}

function rowOf(v: unknown): Row | null {
  const placed = placedOf(v);
  if (!placed || !isRecord(v) || typeof v.id !== "string" || typeof v.name !== "string") return null;
  return { ...placed, id: v.id, name: v.name, guest: v.guest === true, you: v.you === true };
}

/** The board from Leaf's answer, or null for one that makes no sense. */
export function readBoard(v: unknown): Board | null {
  if (!isRecord(v) || !Array.isArray(v.top)) return null;
  const top = v.top.map(rowOf);
  const you = v.you === null ? null : placedOf(v.you);
  if (top.some((r) => r === null) || (v.you !== null && you === null)) return null;
  return { top: top.filter((r) => r !== null), you };
}

/** One line of the board. */
function line(r: Row): HTMLElement {
  return el(
    "div",
    r.you ? "k-card lit board-row" : "board-row",
    {},
    el("span", "place", { text: String(r.place) }),
    el("span", "k-thing-pic", {}, pic(faceFor(r.id, r.name, where().mode === "live"), 2)),
    el(
      "span",
      "who",
      {},
      el("span", "k-thing-name", { text: r.name }),
      el("span", "k-d", { text: `${r.guest ? "Guest · " : ""}Story ${r.story} of ${STORY.length}` }),
    ),
    amount("coin", r.score.toLocaleString("en-US")),
  );
}

export function board(_art: Art, body: HTMLElement): () => void {
  let shown: Board | "unread" | null = null;
  let readAt = -Infinity;
  const list = el("div", "board");
  body.append(list);
  const read = async (): Promise<void> => {
    readAt = Date.now();
    const a = await waitingLook(list, ask("/v1/game/play/works/standings"));
    shown = (a.status === 200 ? readBoard(a.body) : null) ?? "unread";
  };
  const draw = when(
    () => `${facesCame()}|${JSON.stringify(shown)}`,
    () => {
      if (shown === null) return;
      if (shown === "unread") {
        list.replaceChildren(
          el("div", "k-d", { text: "The board could not be read." }),
          button("wood sm", ["Try again"], () => void read()),
        );
        return;
      }
      const me = member();
      const { top, you } = shown;
      const outside =
        you === null
          ? el("div", "k-d", { text: "Earn your first Coin to be listed." })
          : top.some((r) => r.you) || !me
            ? null
            : line({ ...you, id: me.id, name: me.name, guest: me.guest, you: true });
      list.replaceChildren(
        ...top.map(line),
        ...(outside ? [...(top.length > 0 ? [el("div", "k-rule")] : []), outside] : []),
      );
    },
  );
  return () => {
    if (Date.now() - readAt >= EVERY_MS) void read();
    draw();
  };
}
