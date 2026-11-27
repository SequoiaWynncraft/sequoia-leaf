/**
 * The tips in a browser: the keyboard, the mouse and a long press, as a player makes them.
 *
 *   bun review/tips.ts [<out-dir>]
 *
 * Builds `review/tips.html` into a folder of its own, has the kit's driver (`tools/drive.ts`, headless
 * Chromium) go through the steps below on it at 1280x760 and 390x844, and checks each line the page
 * says (`tips.say()`: what is up and how, where the focus is, presses on the button, and whether the
 * card is inside the window and clear of its thing) against what it should be. Pictures of the
 * moments go to `<out-dir>`. It fails on the first line that differs.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const kit = resolve(import.meta.dir, "..");
const out = process.argv[2] ?? join(process.env["TMPDIR"] ?? join(homedir(), ".cache"), "kit-tips");
const site = mkdtempSync(join(process.env["TMPDIR"] ?? join(homedir(), ".cache"), "kit-tips-site-"));

type Step = readonly unknown[];
/** A step, and what the page says after it where it is asked (`tips.say()`). */
const SAY: Step = ["eval", "tips.say()"];
const finger = (part: "down" | "up", selector: string): Step => [
  "finger",
  part,
  `tips.at(${JSON.stringify(selector)})`,
];
const tapFinger = (selector: string): Step[] => [
  finger("down", selector),
  ["wait", 60],
  finger("up", selector),
  ["wait", 200],
];

const plan: (Step | [Step, string])[] = [
  ["size", 1280, 760],
  ["wait", 400],
  // The keyboard: a focused tip shows, Enter pins it and takes the focus in, Escape gives it back.
  ["key", "Tab"],
  [SAY, "passing Purse focus=plain pressed=0 clear=yes"],
  ["key", "Enter"],
  [SAY, "pinned Purse focus=card pressed=0 clear=yes"],
  ["key", "Escape"],
  [SAY, "none focus=plain pressed=0 clear=-"],
  // A button's tip shows for the focus, and Enter is the button's own.
  ["key", "Tab"],
  [SAY, "passing Reroll focus=act pressed=0 clear=yes"],
  ["key", "Enter"],
  [SAY, "passing Reroll focus=act pressed=1 clear=yes"],
  // A thing's whole card for the focus; pinned, Tab stays in it (its close button, then its first number), and the number is followed with a way back.
  ["key", "Tab"],
  [SAY, "passing Amber focus=gem pressed=1 clear=yes"],
  ["shot", "key-card"],
  ["key", "Enter"],
  ["key", "Tab"],
  ["key", "Tab"],
  ["key", "Enter"],
  [SAY, "pinned Attack 15 back focus=card pressed=1 clear=yes"],
  ["shot", "key-followed"],
  ["key", "Escape"],
  [SAY, "none focus=gem pressed=1 clear=-"],
  // The mouse: its glance at once, the whole card once it rests, gone when it leaves.
  ["moveAt", "tips.at('#gem')"],
  ["wait", 60],
  [SAY, "glance Amber focus=gem pressed=1 clear=yes"],
  ["shot", "mouse-glance"],
  ["wait", 400],
  [SAY, "passing Amber focus=gem pressed=1 clear=yes"],
  ["shot", "mouse-card"],
  ["move", 640, 700],
  ["wait", 100],
  [SAY, "none focus=gem pressed=1 clear=-"],
  // In every corner, the tip is inside the window and off its button.
  ...["tl", "tr", "bl", "br"].flatMap((c): (Step | [Step, string])[] => [
    ["moveAt", `tips.at('#${c}')`],
    ["wait", 80],
    [SAY, `passing Corner ${c} focus=gem pressed=1 clear=yes`],
  ]),
  ["move", 640, 300],
  ["size", 390, 844],
  ["wait", 400],
  // A long press on a button: its tip is pinned as a sheet, stays, and the button was not pressed.
  finger("down", "#act"),
  ["wait", 700],
  finger("up", "#act"),
  ["wait", 200],
  [SAY, "pinned Reroll sheet-bottom focus=act pressed=1 clear=yes"],
  ["wait", 3000],
  [SAY, "pinned Reroll sheet-bottom focus=act pressed=1 clear=yes"],
  // A tap elsewhere puts it away; a tap on a thing that only explains itself pins its tip, and a second tap puts it away.
  ...tapFinger("body"),
  [SAY, "none focus=body pressed=1 clear=-"],
  ...tapFinger("#plain"),
  [SAY, "pinned Purse sheet-bottom focus=plain pressed=1 clear=yes"],
  ...tapFinger("#plain"),
  [SAY, "none focus=plain pressed=1 clear=-"],
  // A thing near the bottom: its sheet goes along the top, off it. (No pictures after a finger: headless
  // Chromium's screenshot can hang once touch has been used.)
  ...tapFinger("#low"),
  [SAY, "pinned Amber sheet-top focus=low pressed=1 clear=yes"],
];

const steps = plan.map((p) => (typeof p[1] === "string" && Array.isArray(p[0]) ? p[0] : p));
const expected = plan.flatMap((p) => (typeof p[1] === "string" && Array.isArray(p[0]) ? [p[1]] : []));

let failed = false;
try {
  const built = Bun.spawnSync(["bun", "build", "review/tips.html", "--outdir", site], {
    cwd: kit,
    stderr: "inherit",
    stdout: "ignore",
  });
  if (built.exitCode !== 0) throw new Error("The page did not build");
  const stepsFile = join(site, "steps.json");
  await Bun.write(stepsFile, JSON.stringify(steps));
  const run = Bun.spawnSync(["bun", "tools/drive.ts", "http://tips.test/tips.html", out, stepsFile, site], {
    cwd: kit,
    stderr: "inherit",
    stdout: "pipe",
  });
  const said = run.stdout
    .toString()
    .split("\n")
    .filter((l) => l.startsWith('"'))
    .map((l): unknown => JSON.parse(l));
  for (const [i, want] of expected.entries()) {
    const got = said[i];
    const mark = got === want ? "ok  " : "FAIL";
    console.log(`${mark} ${want}${got === want ? "" : `\n     got: ${String(got)}`}`);
    if (got !== want) failed = true;
  }
  if (run.exitCode !== 0) throw new Error("The driver stopped");
} finally {
  rmSync(site, { recursive: true, force: true });
}
console.log(
  failed ? "The tips do not behave as they should." : `All ${expected.length} checks hold. Pictures in ${out}`,
);
process.exit(failed ? 1 : 0);
