import { describe, expect, test } from "bun:test";

import { forget, hopOf, keep, letGo, type Light, litTrait, point, toggle, unpoint } from "./light.ts";

const fresh = (): Light => ({ pointed: null, kept: null, since: -9 });

describe("which trait is lit", () => {
  test("pointing lights a trait for as long as the pointer stays", () => {
    const l = fresh();
    expect(point("ember", 1, l)).toBe(true);
    expect(litTrait(l)).toBe("ember");
    expect(l.since).toBe(1);
    expect(unpoint("ember", 2, l)).toBe(true);
    expect(litTrait(l)).toBe(null);
  });
  test("clicking keeps it after the pointer goes, until it is clicked again", () => {
    const l = fresh();
    point("moss", 1, l);
    expect(toggle("moss", 1.1, l)).toBe(true);
    unpoint("moss", 2, l);
    expect(litTrait(l)).toBe("moss");
    // Moving off the chip changed nothing that is lit, so the figures do not hop again.
    expect(l.since).toBe(1);
    expect(toggle("moss", 3, l)).toBe(false);
    expect(litTrait(l)).toBe(null);
  });
  test("pointing at another trait shows it while pointing, then the kept one comes back", () => {
    const l = fresh();
    toggle("crab", 1, l);
    point("gnome", 2, l);
    expect(litTrait(l)).toBe("gnome");
    unpoint("gnome", 3, l);
    expect(litTrait(l)).toBe("crab");
    expect(l.since).toBe(3);
  });
  test("a click elsewhere or Escape lets the kept one go; a new run forgets both", () => {
    const l = fresh();
    toggle("fang", 1, l);
    expect(letGo(2, l)).toBe(true);
    expect(litTrait(l)).toBe(null);
    toggle("fang", 3, l);
    point("sage", 4, l);
    forget(5, l);
    expect(l).toEqual({ pointed: null, kept: null, since: 5 });
  });
  test("a chip on a card always keeps its trait, even the one kept already", () => {
    const l = fresh();
    toggle("ember", 1, l);
    keep("ember", 2, l);
    expect(litTrait(l)).toBe("ember");
    keep("fang", 3, l);
    expect(l.kept).toBe("fang");
  });
  test("a tap on a phone is a click with no pointing: it lights and keeps", () => {
    const l = fresh();
    expect(toggle("sneak", 1, l)).toBe(true);
    expect(litTrait(l)).toBe("sneak");
  });
  test("leaving a chip that is not the pointed one changes nothing", () => {
    const l = fresh();
    point("ember", 1, l);
    expect(unpoint("moss", 2, l)).toBe(false);
    expect(litTrait(l)).toBe("ember");
  });
  test("a lit figure hops once, the next a little later", () => {
    expect(hopOf(1, 1, 0)).toBe(0);
    expect(hopOf(1, 1.14, 0)).toBeGreaterThan(3.9);
    expect(hopOf(1, 1.14, 2)).toBeLessThan(hopOf(1, 1.14, 0));
    expect(hopOf(1, 1.5, 0)).toBe(0);
  });
});
