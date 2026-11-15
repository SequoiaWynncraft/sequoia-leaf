import { describe, expect, it } from "vitest";
import { isLeaf, leaf, MAX_LEAF } from "./leaf.ts";
import { parsePlayerId } from "./player.ts";

describe("leaf", () => {
  it("accepts whole positive amounts up to the maximum", () => {
    expect(leaf(1)).toBe(1);
    expect(leaf(MAX_LEAF)).toBe(MAX_LEAF);
  });

  it.each([0, -1, 1.5, MAX_LEAF + 1, Number.NaN, Number.POSITIVE_INFINITY])("rejects %s", (value) => {
    expect(isLeaf(value)).toBe(false);
    expect(() => leaf(value)).toThrow(RangeError);
  });
});

describe("parsePlayerId", () => {
  it("returns the lowercase dashed form of a dashed UUID", () => {
    expect(parsePlayerId("069A79F4-44E9-4726-A5BE-FCA90E38AAF5")).toBe("069a79f4-44e9-4726-a5be-fca90e38aaf5");
  });

  it("adds dashes to an undashed UUID", () => {
    expect(parsePlayerId("069a79f444e94726a5befca90e38aaf5")).toBe("069a79f4-44e9-4726-a5be-fca90e38aaf5");
  });

  it.each(["", "Notch", "069a79f4-44e9-4726-a5be", "069a79f4-44e9-4726-a5be-fca90e38aaf5x"])("rejects %j", (input) => {
    expect(parsePlayerId(input)).toBeUndefined();
  });
});
