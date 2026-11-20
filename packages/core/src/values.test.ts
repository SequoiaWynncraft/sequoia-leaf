import { describe, expect, it } from "bun:test";

import { isLeaf, leaf, MAX_LEAF } from "./leaf.ts";
import { isEntryKind, isEntryOrigin } from "./ledger.ts";
import { parsePlayerId, playerId } from "./player.ts";

describe("leaf", () => {
  it("accepts whole positive amounts up to the maximum", () => {
    expect<number>(leaf(1)).toBe(1);
    expect<number>(leaf(MAX_LEAF)).toBe(MAX_LEAF);
  });

  for (const value of [0, -1, 1.5, MAX_LEAF + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`rejects ${value}`, () => {
      expect(isLeaf(value)).toBe(false);
      expect(() => leaf(value)).toThrow(RangeError);
    });
  }
});

describe("parsePlayerId", () => {
  it("returns the lowercase dashed form of a dashed UUID", () => {
    expect<string | undefined>(parsePlayerId("069A79F4-44E9-4726-A5BE-FCA90E38AAF5")).toBe(
      "069a79f4-44e9-4726-a5be-fca90e38aaf5",
    );
  });

  it("adds dashes to an undashed UUID", () => {
    expect<string | undefined>(parsePlayerId("069a79f444e94726a5befca90e38aaf5")).toBe(
      "069a79f4-44e9-4726-a5be-fca90e38aaf5",
    );
  });

  for (const input of ["", "Notch", "069a79f4-44e9-4726-a5be", "069a79f4-44e9-4726-a5be-fca90e38aaf5x"]) {
    it(`rejects ${JSON.stringify(input)}`, () => {
      expect(parsePlayerId(input)).toBeUndefined();
      expect(() => playerId(input)).toThrow(TypeError);
    });
  }
});

describe("entry vocabulary", () => {
  it("recognises the kinds and origins the ledger uses", () => {
    expect(isEntryKind("reversal")).toBe(true);
    expect(isEntryOrigin("raid")).toBe(true);
    expect(isEntryOrigin("shop")).toBe(true);
    expect(isEntryOrigin("cone")).toBe(true);
    expect(isEntryOrigin("offering")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isEntryKind("refund")).toBe(false);
    expect(isEntryOrigin("gift")).toBe(false);
  });
});
