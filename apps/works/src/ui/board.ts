/**
 * "Top yards": the twenty yards that have earned the most Coins, all time, as Leaf keeps them
 * (`GET /v1/game/play/works/standings`), and the member's own place if they are not among them.
 * Each owner is shown as "Who is about" shows them: their face, their name, and "Guest" for a guest.
 * Read when the panel opens, and each minute while it is open. Choosing one shows their card
 * (`person`), with "Visit yard" and "Visit camp" for anybody else's.
 */

import { WORKS_STATS } from "@sequoia-leaf/factory/stats.ts";
import { link } from "@sequoia-leaf/kit/card.ts";
import { amount, el } from "@sequoia-leaf/kit/dom.ts";
import { member, where } from "@sequoia-leaf/kit/live.ts";
import { ask, outside } from "@sequoia-leaf/kit/net.ts";
import { type Board, known, people, readBoard, type Row } from "@sequoia-leaf/kit/person.ts";
import { waitingLook } from "@sequoia-leaf/kit/play.ts";
import { faceFor, facesCame } from "@sequoia-leaf/kit/skin.ts";
import { RAID_STATS } from "@sequoia-leaf/raid/stats.ts";

import type { Art } from "../art/index.ts";
import { toTown } from "./hud.ts";
import { button, pic, when } from "./parts.ts";

/** How often the board is read again while it is open. */
const EVERY_MS = 60_000;

/**
 * Registers the cards of the people on the board: "Visit yard" opens anybody else's yard who has
 * one, and "Visit camp" leaves for the town on to anybody else's camp.
 */
export function initBoard(myId: string): void {
  people({
    stats: { works: WORKS_STATS, raid: RAID_STATS },
    actions: (p) =>
      p.id === myId
        ? []
        : [
            ...(p.games?.works?.placed
              ? [{ label: "Visit yard", on: () => outside.go(`?of=${encodeURIComponent(p.id)}`) }]
              : []),
            ...(p.games?.town?.placed ? [{ label: "Visit camp", on: () => toTown(p.id) }] : []),
          ],
  });
}

/** One line of the board, standing for its owner. */
function line(r: Row): HTMLElement {
  const said = `${r.guest ? "Guest · " : ""}Tier ${r.also.tier ?? 0}`;
  const face = faceFor(r.id, r.name, where().mode === "live");
  const row = el(
    "div",
    r.you ? "k-card lit board-row" : "board-row",
    {},
    el("span", "place", { text: String(r.place) }),
    el("span", "k-thing-pic", {}, pic(face, 2)),
    el("span", "who", {}, el("b", "k-thing-name member", { text: r.name }), el("span", "k-dim", { text: said })),
    amount("coin", r.score),
  );
  known({ id: r.id, name: r.name, line: said, face });
  // The card goes beside the list, not over it.
  link(row, `person:${r.id}`, { side: true });
  return row;
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
          el("div", "k-dim", { text: "The board could not be read." }),
          button("wood sm", ["Try again"], () => void read()),
        );
        return;
      }
      const me = member();
      const { top, you } = shown;
      const own =
        you === null
          ? el("div", "k-dim", { text: "Earn your first Coin to be listed." })
          : top.some((r) => r.you) || !me
            ? null
            : line({ ...you, id: me.id, name: me.name, guest: me.guest, you: true });
      list.replaceChildren(...top.map(line), ...(own ? [...(top.length > 0 ? [el("div", "k-rule")] : []), own] : []));
    },
  );
  return () => {
    if (Date.now() - readAt >= EVERY_MS) void read();
    draw();
  };
}
