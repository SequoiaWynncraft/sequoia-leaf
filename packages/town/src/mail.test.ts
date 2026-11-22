import { describe, expect, test } from "bun:test";

import { newCamp } from "./camp.ts";
import { BOX, isLetter, letter, open, post, roomInBox, tidied, waiting } from "./mail.ts";

describe("the mailbox", () => {
  test("a letter waits until it is read and its present taken", () => {
    const box = [letter("a", "Pipwick", "hello"), letter("b", "Tindra", "for you", "flower-pot")];
    expect(waiting(box)).toBe(2);
    for (const l of box) l.read = true;
    expect(waiting(box)).toBe(1);
    const [, second] = box;
    if (second) second.taken = true;
    expect(waiting(box)).toBe(0);
    expect(tidied(box)).toEqual([]);
  });

  test("the same letter is not delivered twice", () => {
    const box = [letter("a", "Pipwick", "hello")];
    expect(post(box, letter("a", "Pipwick", "hello again"))).toBe(false);
    expect(post(box, letter("b", "Pipwick", "hello again"))).toBe(true);
    expect(box.length).toBe(2);
  });

  test("a full box makes room by dropping what has been dealt with, oldest first", () => {
    const box = Array.from({ length: 12 }, (_v, i) => letter(`l${i}`, "Wrenly", "a note"));
    const third = box[3];
    if (third) third.read = true;
    post(box, letter("new", "Wrenly", "another"));
    expect(box.length).toBe(12);
    expect(box.some((l) => l.id === "l3")).toBe(false);
    expect(box.every(open)).toBe(true);
    post(box, letter("newer", "Wrenly", "and another"));
    expect(box[0]?.id).toBe("l1");
  });

  test("a box full of presents throws none away: the next letter is not left", () => {
    const camp = newCamp();
    camp.letters = Array.from({ length: BOX }, (_v, i) => letter(`g${i}`, "Tindra", "for you", "toadstool"));
    const ids = camp.letters.map((l) => l.id);
    expect(roomInBox(camp.letters)).toBe(false);
    expect(post(camp.letters, letter("late", "Pipwick", "and this", "cushion"))).toBe(false);
    expect(camp.letters.map((l) => l.id)).toEqual(ids);
    // Reading one is not enough; taking its present out makes room.
    const first = camp.letters[0];
    if (first) first.read = true;
    expect(roomInBox(camp.letters)).toBe(false);
    if (first) first.taken = true;
    expect(post(camp.letters, letter("late", "Pipwick", "and this", "cushion"))).toBe(true);
    expect(camp.letters).toHaveLength(BOX);
    expect(camp.letters.filter((l) => l.gift !== "" && !l.taken)).toHaveLength(BOX);
  });

  test("an unread note with nothing inside makes room before any present", () => {
    const box = Array.from({ length: BOX }, (_v, i) =>
      letter(`g${i}`, "Tindra", "for you", i === 5 ? "" : "acorn-jar"),
    );
    expect(post(box, letter("late", "Pipwick", "hello"))).toBe(true);
    expect(box.some((l) => l.id === "g5")).toBe(false);
    expect(box.filter((l) => l.gift !== "")).toHaveLength(BOX - 1);
  });

  test("only a real letter is a letter", () => {
    expect(isLetter(letter("a", "Old Barkley", "sit. the fire likes company."))).toBe(true);
    expect(isLetter({ ...letter("a", "Pipwick", "x"), gift: "the moon" })).toBe(false);
    expect(isLetter({ ...letter("a", "Pipwick", "x"), from: "<b>" })).toBe(false);
    expect(isLetter({ id: "a" })).toBe(false);
  });
});
