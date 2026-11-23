/**
 * The yard's moments: what happens in the yard itself when the node in hand is finished, when a
 * standing order is filled, and when one is handed over. Things in the world move; nothing is only
 * a notice.
 */

import { goalNamed, isFilled, isNode, item, ITEM_INFO, type News, NODES, type Standing } from "@sequoia-leaf/factory";
import { CREAM, GOLD } from "@sequoia-leaf/kit/palette.ts";
import { tell } from "@sequoia-leaf/kit/shell.ts";
import { hash, type Pt } from "@sequoia-leaf/kit/util.ts";

import { flights, send, speak, toss, type Walker, walker, walkers } from "./actors.ts";
import { TILE } from "./art/belts.ts";
import { MARGIN } from "./art/ground.ts";
import type { Art } from "./art/index.ts";
import { PIPWICK_HAT } from "./art/machines.ts";
import { burst, sparkle } from "./fx.ts";
import { layout } from "./layout.ts";
import { yardSfx } from "./sound.ts";
import { S, toPage } from "./state.ts";
import { banner, coinsFrom, feed } from "./ui/notes.ts";
import { doNow } from "./yard.ts";

/** The gnome who comes for an order himself, when it is his. */
const PIPWICK = "Pipwick";
/** The yard's own gnome, who carries story orders out to town, and his hat. */
const HAND = { name: "the yard's gnome", hat: 3 };
const THANKS = [
  "Thank you!",
  "Lovely. Thank you!",
  "That's the lot? Wonderful.",
  "Just what was wanted.",
  "Much obliged!",
];

/** The depot's doorstep and the two sides of the gate, in the yard's pixels. */
function spots(): { door: Pt; inside: Pt; outside: Pt; away: Pt } {
  const w = S.world;
  const L = layout(w, S.rev);
  const door = { x: w.land.depot[0] * TILE + 8, y: (w.land.depot[1] + 2) * TILE + 3 };
  return {
    door,
    inside: { x: L.gate.x, y: L.gate.y - 5 },
    outside: { x: L.gate.x, y: L.gate.y + 9 },
    // Not past the edge of the picture, when the gate stands at the map's southern edge.
    away: { x: L.gate.x, y: L.gate.y + MARGIN.b - 8 },
  };
}

/**
 * Who comes for an order: always a gnome. Pipwick for his own, in his blue hat; for anybody (or
 * anywhere) else, one of the town's gnomes, sent on their behalf.
 */
function comer(order: Standing): { name: string; hat: number; sent: boolean } {
  if (order.from === PIPWICK) return { name: PIPWICK, hat: PIPWICK_HAT, sent: false };
  return { name: "A gnome", hat: Math.floor(hash(order.id, 7, 3) * 4), sent: true };
}

/** Where the nth to arrive stands to wait, outside the gate. */
const waitAt = (n: number): Pt => {
  const s = spots();
  return { x: s.outside.x + (n % 2 ? -1 : 1) * Math.ceil(n / 2) * 13, y: s.outside.y + (n > 0 ? 3 : 0) };
};

/** Somebody comes to the gate for every filled order on the board, and waits there for as long as it takes. */
export function callers(): void {
  const w = S.world;
  for (const order of w.board) {
    if (!isFilled(order.want, order.filled)) continue;
    if (walkers.some((p) => p.order === order.id)) continue;
    const waiting = walkers.filter((p) => p.order >= 0 && !p.gone).length;
    const who = comer(order);
    const s = spots();
    const p = walker(who.name, who.hat, { x: s.away.x + (waiting % 2 ? -8 : 8), y: s.away.y }, order.id);
    send(p, [waitAt(waiting)], () => {
      p.dir = 3;
      speak(p, who.sent ? `For ${order.from.replace(/^The /, "the ")}.` : "Is it ready?", 3.2);
    });
  }
  // Anybody still waiting for an order that is no longer on the board goes home.
  for (const p of walkers)
    if (p.order >= 0 && !p.gone && !p.carrying && !w.board.some((o) => o.id === p.order)) leaveBy(p);
}

function leaveBy(p: Walker): void {
  const s = spots();
  p.order = -1;
  send(p, [{ x: p.x, y: s.away.y }], () => {
    p.gone = true;
  });
}

/** The caller a point in the yard is on, if any. */
export function callerAt(x: number, y: number): Walker | null {
  return walkers.find((p) => p.order >= 0 && !p.gone && Math.abs(p.x - x) < 8 && y > p.y - 18 && y < p.y + 4) ?? null;
}

/**
 * Hands a filled standing order over, by its id: a crate comes out of the depot's door to whoever
 * is waiting, they are glad of it, the Coins fly to the purse, and they carry it off through the gate.
 */
export function handOver(id: number): boolean {
  const w = S.world;
  const order = w.board.find((o) => o.id === id);
  if (!order || !isFilled(order.want, order.filled)) return false;
  callers();
  const p = walkers.find((q) => q.order === order.id);
  if ("refused" in doNow({ do: "handOver", order: id })) return false;
  const pay = order.pay;
  yardSfx.handOver();
  feed(`Handed over: ${order.title}.`, "gold");
  const s = spots();
  if (!p) {
    coinsFrom(toPage(s.door.x, s.door.y - 12), pay);
    return true;
  }
  p.order = -1;
  const hands = { x: p.x, y: p.y - 16 };
  toss({ x: s.door.x, y: s.door.y - 12 }, hands, () => {
    p.carrying = true;
    p.hop = 0.28;
    speak(p, THANKS[Math.floor(hash(order.id, 9, 3) * THANKS.length)] ?? "Thank you!", 2.2);
    burst(p.x, p.y - 18, 8, [GOLD[2], CREAM], 30);
    coinsFrom(toPage(p.x, p.y - 16), pay);
    window.setTimeout(() => {
      p.speed = 30;
      send(p, [{ x: p.x, y: s.away.y }], () => {
        p.gone = true;
      });
    }, 900);
  });
  return true;
}

/** What the screen makes of the yard's news. */
export function onNews(art: Art, news: readonly News[]): void {
  const w = S.world;
  for (const n of news) {
    if (n.kind === "done") {
      const g = goalNamed(n.goal);
      if (g === null) continue;
      // Research known is said in passing; a node finished is a moment.
      if (!isNode(g)) {
        yardSfx.ready();
        feed(`${n.title} is known.`, "gold");
        continue;
      }
      const gift = NODES[g]?.gift;
      yardSfx.order();
      banner(art, g, w.hand === -1 ? null : w.hand);
      // The yard's hand carries the last crate out of the door, down the path and through the gate.
      const s = spots();
      const p = walker(HAND.name, HAND.hat, { x: s.door.x, y: s.door.y - 4 });
      p.carrying = true;
      p.speed = 42;
      speak(p, "Off it goes!", 1.8);
      send(p, [s.door, s.inside, s.away], () => {
        p.gone = true;
      });
      sparkle(s.door.x, s.door.y - 14, 14, 10);
      coinsFrom(toPage(s.door.x, s.door.y - 14), n.pay);
      tell({ town: "news", text: gift ? gift.line : `The Works filled "${n.title}".`, tone: "gold" });
    } else if (n.kind === "filled") {
      yardSfx.ready();
      const order = w.board.find((o) => o.id === n.id);
      feed(
        `${n.title}: filled. ${order ? comer(order).name : "Somebody"} is coming to the gate to collect it.`,
        "gold",
      );
      callers();
    }
  }
}

/** The two things that take the whole yard, and what has ever come in of each, to notice the first of each. */
const CAPSTONES = [item("beacon"), item("crab")] as const;
let firsts: number[] | null = null;

/** Tells the town the first time a Beacon or a clockwork crab is made. */
export function capstones(): void {
  const w = S.world;
  const now = CAPSTONES.map((k) => w.depot[k] ?? 0);
  if (firsts) {
    CAPSTONES.forEach((k, n) => {
      if (firsts?.[n] !== 0 || (now[n] ?? 0) <= 0) return;
      const name = (ITEM_INFO[k]?.name ?? "").toLowerCase();
      const s = spots();
      sparkle(s.door.x, s.door.y - 20, 24, 14);
      feed(`The yard has made its first ${name}.`, "gold");
      tell({ town: "news", text: `The Works made its first ${name}.`, tone: "gold" });
    });
  }
  firsts = now;
}

/** Forgets what was noticed: the yard has been swapped for another. */
export function forget(): void {
  firsts = null;
  walkers.length = 0;
  flights.length = 0;
}
