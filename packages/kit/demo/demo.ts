/** The demo page's cards, tags and tiers: a few made-up things that name each other, and one card pinned open. */
import { deck, register, thing } from "../src/card.ts";
import { add, amount, el, icon, shown } from "../src/dom.ts";
import { INK } from "../src/palette.ts";
import { bitmap, outlined } from "../src/pix.ts";

const PAL = {
  g: "#f5b95e",
  G: "#d49045",
  y: "#ffd98a",
  w: "#fff3cf",
  b: "#6f3826",
  B: "#3b1f19",
  s: "#888788",
  r: "#e67967",
};
const pic = (rows: readonly string[]): HTMLCanvasElement => outlined(bitmap(rows, PAL), INK);
const ART: Record<string, readonly string[]> = {
  lantern: ["..BB..", ".bbbb.", ".byyb.", ".bywb.", ".byyb.", ".bbbb.", "..bb.."],
  glass: ["......", ".wwww.", ".w..w.", ".w..w.", ".wwww.", "......"],
  ingot: ["......", "..ggg.", ".gggG.", "gggGG.", "GGGG..", "......"],
  oil: ["..bb..", "..ss..", ".gggg.", ".gyyg.", ".gggg.", "......"],
  crab: ["r....r", "rr..rr", ".rrrr.", "rrwwrr", ".rrrr.", "r.r.r."],
};

const THINGS: Record<string, { name: string; tag: string; made?: string[]; does: string }> = {
  lantern: { name: "Lantern", tag: "Put together", made: ["glass", "ingot", "oil"], does: "Lights the way home." },
  glass: { name: "Glass", tag: "Worked once", does: "Sand, melted." },
  ingot: { name: "Ingot", tag: "Worked once", does: "Ore, smelted." },
  oil: { name: "Lamp oil", tag: "Worked once", does: "Resin, pressed." },
};

register("item", (id) => {
  const t = THINGS[id];
  const art = ART[id];
  if (!t || !art) return null;
  const usedIn = Object.entries(THINGS).filter(([, o]) => o.made?.includes(id));
  return {
    name: t.name,
    icon: pic(art),
    tag: t.tag,
    aside: amount("coin", t.made ? 24 : 3),
    chips: [{ label: "Kind", text: t.made ? "Light" : "Stock", icon: pic(art), lit: !!t.made }],
    stats: [
      { label: "Pace", value: t.made ? "4.0s" : "1.2s" },
      { label: "Worth", value: t.made ? "24" : "3" },
      t.made ? { label: "Draw", value: "8", mark: "raised" } : { label: "Draw", value: "3" },
    ],
    blocks: [{ title: "What it is", note: t.made ? "at a workshop" : "at a mill", body: t.does }],
    rows: [
      { label: "Made from", things: (t.made ?? []).map((k) => ({ ref: `item:${k}`, count: "×1" })) },
      { label: "Used in", things: usedIn.map(([k]) => ({ ref: `item:${k}` })) },
      { label: "Asked for by", things: t.made ? [{ ref: "crab:7", note: "3 owed", tag: "board" }] : [] },
    ],
    actions: [{ label: "Pin recipe", look: "wood sm", on: () => {} }],
  };
});
register("crab", (id) => ({
  name: `Crab #${id}`,
  icon: pic(ART.crab ?? []),
  tag: "Never at roll call.",
  chips: [{ label: "Kin", text: "Crab", icon: pic(ART.crab ?? []), count: "1/3", lit: true }],
  blocks: [{ body: "Seen about town, usually holding something it should not be." }],
}));

const list = document.getElementById("things");
if (list) {
  add(
    list,
    ...["lantern", "glass", "ingot", "oil"].map((k) => thing(`item:${k}`)),
    thing("crab:7"),
    el("span", "k-d", {}, "Point at one; click to pin it.", icon("star")),
  );
}
// A trait or a kind is a hexagon badge with its name beside it; `--c` is its colour.
const tags = document.getElementById("tags");
if (tags) {
  const badge = (art: string, text: string, colour?: string): HTMLElement => {
    const chip = el("span", "k-chip", {}, shown(pic(ART[art] ?? [])), text);
    if (colour) chip.style.setProperty("--c", colour);
    return chip;
  };
  add(tags, badge("oil", "Ember", "#ff8a6b"), badge("glass", "Mist", "#9fe3e6"), badge("crab", "Crab"));
  tags.lastElementChild?.classList.add("lit");
}

// The five tiers side by side: stone, jade, sapphire, amethyst, gold.
const tiers = document.getElementById("tiers");
if (tiers) {
  const TIERS = [
    ["glass", "Stone", "Glass"],
    ["ingot", "Jade", "Ingot"],
    ["oil", "Sapphire", "Lamp oil"],
    ["lantern", "Amethyst", "Lantern"],
    ["crab", "Gold", "Crab #7"],
  ] as const;
  TIERS.forEach(([art, stone, name], i) => {
    add(
      tiers,
      el(
        "article",
        `k-tier-${i + 1} tier`,
        {},
        el("i", "k-crest"),
        shown(pic(ART[art] ?? []), 5),
        el("b", "k-title big", { text: name }),
        el("span", "k-dim", { text: `Tier ${i + 1} · ${stone}` }),
        el(
          "div",
          "k-info-block",
          {},
          el("b", "k-info-title", { text: "What it is" }),
          el("div", "k-read k-info-body", {}, "Worth ", el("b", "", { text: String((i + 1) * 12) }), " at the depot."),
        ),
        el("button", "k-btn wide", { type: "button" }, "Choose"),
      ),
    );
  });
}

// The page shows a card pinned open, beside the lantern, so a picture of the page has one in it.
const lantern = document.querySelector<HTMLElement>("#things [data-ref='item:lantern']");
if (lantern) {
  void document.fonts.ready.then(() => deck.press("item:lantern", lantern, "mouse", lantern, true));
}
