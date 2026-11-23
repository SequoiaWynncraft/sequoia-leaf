import { describe, expect, it } from "bun:test";

import { Copies } from "../src/play/copies.ts";

const copy = (text: string) => ({ text });

describe("the copies held past their lanes", () => {
  it("give a copy back once, taken out, and none for a state never held", () => {
    const copies = new Copies(100);
    const a = copy("aaaa");
    copies.put("a", a);

    expect(copies.take("a")).toBe(a);
    expect(copies.take("a")).toBeUndefined();
    expect(copies.take("b")).toBeUndefined();
    expect(copies.bytes).toBe(0);
  });

  it("let go of the copy used least lately once their text comes to more than the most", () => {
    const copies = new Copies(10);
    copies.put("a", copy("aaaa"));
    copies.put("b", copy("bbbb"));
    // Used again, `a` is held as the newest.
    const a = copies.take("a");
    if (a !== undefined) copies.put("a", a);
    copies.put("c", copy("cccc"));

    expect([copies.take("b"), copies.take("a")?.text, copies.take("c")?.text]).toEqual([undefined, "aaaa", "cccc"]);
  });

  it("hold a state's newer copy in place of its older, counted once", () => {
    const copies = new Copies(10);
    copies.put("a", copy("aaaa"));
    copies.put("a", copy("aaaaaa"));

    expect(copies.bytes).toBe(6);
    expect(copies.take("a")?.text).toBe("aaaaaa");
  });

  it("hold none that is larger than the most by itself", () => {
    const copies = new Copies(3);
    copies.put("a", copy("aaaa"));

    expect([copies.take("a"), copies.bytes]).toEqual([undefined, 0]);
  });
});
