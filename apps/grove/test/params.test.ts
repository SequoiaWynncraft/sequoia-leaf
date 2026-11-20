import { describe, expect, test } from "bun:test";

import { readParams, seasonOn } from "../src/game/params.ts";

const on = (iso: string): Date => new Date(`${iso}T12:00:00`);

describe("the season", () => {
  test("is winter from December 1 to the end of February, by the local date", () => {
    expect(
      ["2026-11-30", "2026-12-01", "2027-01-15", "2027-02-28", "2028-02-29", "2027-03-01"].map((d) => seasonOn(on(d))),
    ).toEqual(["normal", "winter", "winter", "winter", "winter", "normal"]);
  });

  test("follows the date unless the address says", () => {
    expect(readParams("", on("2026-12-24")).season).toBe("winter");
    expect(readParams("", on("2026-07-01")).season).toBe("normal");
    expect(readParams("?season=normal", on("2026-12-24")).season).toBe("normal");
    expect(readParams("?season=winter", on("2026-07-01")).season).toBe("winter");
  });
});
