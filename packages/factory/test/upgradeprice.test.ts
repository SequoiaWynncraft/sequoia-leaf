/**
 * Every Upgrade is at the price the player was shown, as buying a plot and felling a redwood are: a
 * card's (one piece, one grade up), an area's and the whole yard's each say the whole price, and
 * Leaf refuses one whose price is not its own for the same command now, charging nothing. Played as
 * Leaf plays them: read off the wire (`readCommand`) and done (`play`).
 */
import { describe, expect, test } from "bun:test";

import { coinsText } from "@sequoia-leaf/core";

import * as F from "../src/index.ts";
import { bare4 } from "./grade4.ts";
import { must, upgrading } from "./yards.ts";

type Rec = Record<string, unknown>;

/** What a command off the wire did: the Coins it took from the purse, or why it was refused. */
function played(y: F.Yard, c: Rec): number | string {
  const read = F.readCommand({ tick: y.tick, ...c });
  if (!read) throw new Error(`${JSON.stringify(c)} does not read`);
  const did = F.play(y, read);
  if ("refused" in did) return did.why;
  return (did.coins ?? []).reduce((sum, ch) => sum + (ch.reason === "Earned in the Works" ? 0 : -ch.amount), 0);
}

/** A tunnel going in at (x, z) facing east under `span` tiles, at a grade, as the page lays one. */
const tunnel = (x: number, z: number, span: number, grade: number): Rec =>
  F.writeAct({ do: "lay", legs: [{ tunnel: true, x, y: z, dir: 0, span, grade }] });

/** The refusal of an Upgrade whose price has changed since it was shown. */
const changed = (now: number): string => `The price has changed: it is now ${coinsText(now)}`;

/** A bare yard with grade 4 known, nothing to hand, and the Coins it has kept: what a refused command must leave as it was. */
function yard(): F.Yard {
  const y = bare4(["gatherer4", "lines4", "upgrading"]);
  y.spare.fill(0);
  return y;
}

describe("an Upgrade at the price the player was shown", () => {
  test("a card's: its grade 3 tunnel under 5 tiles, quoted 384 Coins to grade 4, is a grade 3 tunnel under 7 by the time Leaf has it: refused, nothing charged", () => {
    const y = yard();
    must(y, tunnel(3, 8, 5, 3));
    const i = F.at(y, 3, 8);
    const card = upgrading(y, [i], { grade: 4, kind: "tunnel", from: 3 });
    expect(card.price).toBe(384);
    // Another tab takes it up and lays a longer one of the same grade going in on the same tile: the
    // card's names (a tunnel, at grade 3) still hold.
    must(y, { do: "remove", x: 3, y: 8 });
    must(y, tunnel(3, 8, 7, 3));
    const [till, coins] = [y.till, y.depot.slice()];
    expect(played(y, card)).toBe(changed(512));
    expect([y.grade[i], y.span[i], y.till, [...y.depot]]).toEqual([3, 7, till, [...coins]]);
    // At the price it shows now, it is raised for that.
    expect(played(y, { ...card, price: 512 })).toBe(512);
    expect([y.grade[i], y.grade[F.at(y, 11, 8)]]).toEqual([4, 4]);
  });

  test("an area's: a piece in it raised by another command first, so the area costs less: refused, nothing raised; at its new price, raised", () => {
    const y = yard();
    for (let x = 3; x <= 7; x++) must(y, { do: "build", kind: "belt", x, y: 8, dir: 0, grade: 3 });
    const tiles = F.within(y, 3, 8, 7, 8);
    const area = upgrading(y, tiles);
    const each = F.price(F.BELT, 4) - F.price(F.BELT, 3);
    expect(area.price).toBe(5 * each);
    expect(played(y, upgrading(y, [F.at(y, 5, 8)], { grade: 4, kind: "belt", from: 3 }))).toBe(each);
    const till = y.till;
    expect(played(y, area)).toBe(changed(4 * each));
    expect([tiles.map((t) => y.grade[t]), y.till]).toEqual([[3, 3, 4, 3, 3], till]);
    expect(played(y, { ...area, price: 4 * each })).toBe(4 * each);
    expect(tiles.map((t) => y.grade[t])).toEqual([4, 4, 4, 4, 4]);
  });

  test("the whole yard's: a belt it names replaced by a sorter after its price was shown, so the same tiles cost more: refused, nothing raised; at their new price, raised", () => {
    const y = yard();
    for (let x = 3; x <= 5; x++) must(y, { do: "build", kind: "belt", x, y: 8, dir: 0 });
    // Upgrade all names the tiles of the pieces it raises, as the page sends it.
    const all = upgrading(y, F.within(y, 0, 0, y.land.w - 1, y.land.h - 1));
    const belt = F.price(F.BELT, 4) - F.price(F.BELT, 1);
    const sorter = F.price(F.SORTER, 4) - F.price(F.SORTER, 1);
    expect(all.price).toBe(3 * belt);
    must(y, { do: "remove", x: 4, y: 8 });
    must(y, { do: "build", kind: "sorter", x: 4, y: 8, dir: 0 });
    expect(played(y, all)).toBe(changed(2 * belt + sorter));
    expect([3, 4, 5].map((x) => y.grade[F.at(y, x, 8)])).toEqual([1, 1, 1]);
    expect(played(y, { ...all, price: 2 * belt + sorter })).toBe(2 * belt + sorter);
    expect([3, 4, 5].map((x) => y.grade[F.at(y, x, 8)])).toEqual([4, 4, 4]);
  });

  test("with nothing changed, a price a Coin over or under its own is refused too, of each kind; with nothing to raise, it says so", () => {
    const y = yard();
    must(y, { do: "build", kind: "belt", x: 3, y: 8, dir: 0 });
    const tiles = [F.at(y, 3, 8)];
    for (const c of [upgrading(y, tiles), upgrading(y, tiles, { grade: 2, kind: "belt", from: 1 })]) {
      const price = Number(c.price);
      for (const off of [-1, 1]) expect(played(y, { ...c, price: price + off })).toBe(changed(price));
    }
    expect(y.grade[F.at(y, 3, 8)]).toBe(1);
    expect(played(y, upgrading(y, [F.at(y, 9, 9)]))).toBe("Nothing here can be raised");
  });
});
