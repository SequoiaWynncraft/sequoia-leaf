import { expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";

import { behind, contrast, type Facts, judge, report, type Rgb, rgba } from "./audit.ts";

test("contrast is worked out as the guidelines do, from the colours a page computes", () => {
  expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
  expect(contrast([118, 118, 118], [255, 255, 255])).toBeCloseTo(4.54, 2);
  expect(rgba("rgb(255, 246, 226)")).toEqual([255, 246, 226, 1]);
  expect(rgba("rgba(0, 0, 0, 0.5)")).toEqual([0, 0, 0, 0.5]);
  expect(rgba("color(srgb 1 0.5 0 / 0.25)")).toEqual([255, 127.5, 0, 0.25]);
  expect(rgba("oklab(0.5 0 0)")).toBeNull();
  // One colour behind words is that colour; a picture behind them is no one colour.
  expect(
    behind([
      [24, 16, 37],
      [23, 16, 37],
      [23, 16, 37],
      [23, 16, 37],
      [200, 150, 60],
    ]),
  ).toEqual([23, 16, 37]);
  expect(
    behind([
      [0, 0, 0],
      [255, 255, 255],
      [0, 0, 0],
      [255, 255, 255],
    ]),
  ).toBeNull();
});

const box = { x: 0, y: 0, w: 100, h: 20 };
const words = {
  who: "p",
  text: "Words",
  px: 14,
  bold: false,
  sentence: true,
  color: "rgb(255, 255, 255)",
  opacity: 1,
  off: false,
  boxes: [box],
};

test("words are held to 4.5:1, large ones to 3:1, and a picture behind them is said to be unknown only when it matters", () => {
  const facts: Facts = {
    width: 1440,
    height: 900,
    controls: [],
    dialogs: [],
    words: [
      { ...words, who: "grey", color: "rgb(119, 119, 119)" },
      { ...words, who: "title", px: 20, bold: true, color: "rgb(150, 150, 150)" },
      { ...words, who: "faded", opacity: 0.3 },
      { ...words, who: "off", color: "rgb(30, 30, 30)", off: true },
      { ...words, who: "busy" },
      { ...words, who: "dusk" },
    ],
  };
  const black: Rgb = [0, 0, 0];
  const found = judge(
    facts,
    [
      [[255, 255, 255]],
      [black],
      [black],
      [black],
      [black, [250, 250, 250], black, [250, 250, 250]],
      [black, [40, 40, 40], [80, 80, 80], [20, 20, 20]],
    ],
    [],
  );
  expect(found.map((f) => `${f.kind} ${f.who}`)).toEqual(["contrast grey", "contrast faded", "contrast? busy"]);
});

test("small words, unnamed and unreachable controls, crowded targets on a phone and dialogs that are not one are each said once", () => {
  const control = { who: "b", box: { x: 0, y: 0, w: 30, h: 30 }, tab: true, ring: true, crowded: true };
  const facts: Facts = {
    width: 390,
    height: 844,
    words: [
      { ...words, who: "tiny", px: 8, sentence: false },
      { ...words, who: "fine", px: 11 },
      { ...words, who: "label", px: 10, sentence: false },
    ],
    controls: [
      control,
      { ...control, who: "alone", crowded: false },
      { ...control, who: "div", tab: false, ring: null, crowded: false },
      { ...control, who: "plain", ring: false, box: { x: 0, y: 0, w: 60, h: 40 } },
    ],
    dialogs: [{ who: "aside", why: "has a Close button; not a dialog" }],
  };
  const lines = report(
    judge(
      facts,
      facts.words.map(() => [[0, 0, 0]]),
      [
        { who: "button.icon", role: "button" },
        { who: "button.icon", role: "button" },
        { who: "div.card", role: "dialog" },
      ],
    ),
  );
  expect(lines).toEqual([
    "no name        button.icon: button with no name (2 alike)",
    "no tab         div: looks pressable; Tab does not reach it",
    "no ring        plain: looks the same focused",
    "dialog         div.card: dialog with no name",
    "dialog         aside: has a Close button; not a dialog",
    'tiny text      tiny: 8px "Words"',
    'small sentence fine: 11px "Words"',
    "small target   b: 30x30 with another control by it",
  ]);
  expect(report([])).toEqual(["nothing found"]);
});

/** A page with one of each fault the audit finds, and the same things done right beside them. */
const FIXTURE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Audit</title><style>
  body { margin: 0; padding: 8px; background: #000; color: #fff; font: 16px sans-serif; }
  #ringless:focus-visible { outline: none; }
  button, #clicky { display: block; min-width: 44px; min-height: 44px; margin: 4px 0; }
  .pair button, #lone { display: inline-block; min-width: 0; min-height: 0; width: 24px; height: 24px; padding: 0; }
  #lone { margin: 30px; }
  #reached { position: relative; display: inline-block; min-width: 0; min-height: 0; width: 24px; height: 24px; padding: 0; margin: 0 0 0 10px; }
  #reached::after { content: ""; position: absolute; inset: -12px; }
  #scrim { position: absolute; right: 0; bottom: 0; }
</style></head><body>
  <button id="bare"><i></i></button>
  <button id="ringless">Go</button>
  <button id="ringed">Fine</button>
  <div id="clicky" style="cursor: pointer">Open</div>
  <p id="tiny" style="font-size: 8px">Tiny words</p>
  <p id="small" style="font-size: 11px">This is a sentence to be read.</p>
  <p id="faint" style="color: #777; background: #666">Faint words here</p>
  <p id="plain">Plain words</p>
  <div class="pair"><button id="left">A</button><button id="right">B</button></div>
  <button id="lone">C</button>
  <div class="pair"><button id="reached">D</button><button id="buddy" style="width: 44px; height: 44px">E</button></div>
  <aside id="panel"><button aria-label="Close">x</button> A panel</aside>
  <div id="nameless" role="dialog">Nobody named this</div>
  <div id="scrim" class="k-scrim"><div id="notice">Notice</div></div>
</body></html>`;

test.skipIf(!Bun.which("chromium"))(
  "the audit finds each fault on a page in Chromium, and nothing done right",
  async () => {
    const dir = `${process.env["TMPDIR"] ?? `${homedir()}/.cache`}/kit-audit-test-${process.pid}`;
    mkdirSync(`${dir}/site`, { recursive: true });
    try {
      await Bun.write(`${dir}/site/index.html`, FIXTURE);
      await Bun.write(`${dir}/steps.json`, JSON.stringify([["size", 390, 844], ["audit"]]));
      const run = Bun.spawn(
        ["bun", `${import.meta.dir}/drive.ts`, "http://audit.test/", `${dir}/out`, `${dir}/steps.json`, `${dir}/site`],
        { stdout: "pipe", stderr: "inherit" },
      );
      const out = await new Response(run.stdout).text();
      expect(await run.exited).toBe(0);
      const said = (kind: string, who: string): boolean =>
        out.split("\n").some((line) => line.startsWith(kind) && line.includes(who));
      expect(said("no name", "button#bare")).toBe(true);
      expect(said("no ring", "button#ringless")).toBe(true);
      expect(said("no tab", "div#clicky")).toBe(true);
      expect(said("tiny text", "p#tiny")).toBe(true);
      expect(said("small sentence", "p#small")).toBe(true);
      expect(said("contrast", "p#faint")).toBe(true);
      expect(said("small target", "button#left")).toBe(true);
      expect(said("dialog", "aside#panel")).toBe(true);
      expect(said("dialog", "div#nameless")).toBe(true);
      expect(said("dialog", "div#notice")).toBe(true);
      for (const fine of ["#ringed", "#plain", "#lone", "#reached"]) expect(out).not.toContain(fine);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  20_000,
);
