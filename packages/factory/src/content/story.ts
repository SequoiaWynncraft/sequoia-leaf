/**
 * The story: twenty orders, one after another. Each is filled by sending the depot what it asks
 * for; filling it pays, and opens machines, plots and plans for the yard. Some of them leave
 * something in the town for good.
 */
import type { Wants } from "./items.ts";
import type { KindName } from "./machines.ts";
import type { PlanName } from "./plans.ts";
import type { PlotName } from "./plots.ts";

export interface Opens {
  readonly kinds?: readonly KindName[];
  readonly plots?: readonly PlotName[];
  readonly plans?: readonly PlanName[];
  /** The board of standing orders goes up. */
  readonly board?: true;
}

/** Something a finished order leaves in the town, for the town to show. */
export interface Gift {
  readonly id: string;
  readonly line: string;
}

export interface StoryOrder {
  readonly title: string;
  readonly from: string;
  /** What whoever asked says about it. */
  readonly say: string;
  readonly want: Wants;
  readonly pay: number;
  readonly opens: Opens;
  readonly gift?: Gift;
}

export const STORY: readonly StoryOrder[] = [
  {
    title: "Planks for the Treasury",
    from: "Cinfy",
    say: "The Treasury floor creaks, and I would rather it didn't while I am counting.",
    want: { plank: 12 },
    pay: 80,
    opens: {},
  },
  {
    title: "Ingots and bricks",
    from: "Cinfy",
    say: "Ore and stone lie at the corners of the yard, past where the depot's power reaches. Pylons will carry it.",
    want: { ingot: 12, brick: 12 },
    pay: 160,
    opens: { kinds: ["bench"] },
  },
  {
    title: "Tools for the raid parties",
    from: "The raid parties",
    say: "They came back with half the shovels they left with. Nobody will say where the other half went.",
    want: { tool: 10 },
    pay: 260,
    opens: { kinds: ["splitter", "joiner"] },
  },
  {
    title: "Gears and frames",
    from: "The crab pond",
    say: "The crabs want a little gate. With a gear. They have drawn it. It is mostly crab.",
    want: { gear: 10, frame: 10 },
    pay: 500,
    opens: { plans: ["boiler", "rakes"], board: true },
  },
  {
    title: "Engines for the well-winch",
    from: "The gnomes",
    say: "The winch has been hauled by hand since spring, and by hand they mean by them.",
    want: { engine: 20 },
    pay: 600,
    opens: { plots: ["meadow"], plans: ["waxed", "tunnel"] },
  },
  {
    title: "Poles for the new banners",
    from: "The guild",
    say: "The guild took a hill, and then some more hills, and the banners are folded on a shelf. A banner should not be on a shelf.",
    want: { pole: 20 },
    pay: 700,
    opens: { plots: ["bank"], kinds: ["crate"] },
    gift: { id: "banner-pole", line: "A new banner pole stands in town, and the banner is up it." },
  },
  {
    title: "Pots for the campfire stew",
    from: "The campfire",
    say: "Everybody is bringing a bowl and nobody is bringing a pot. There is clay to the west.",
    want: { pot: 200 },
    pay: 800,
    opens: { plots: ["stream"], kinds: ["wheel"] },
  },
  {
    title: "Hampers for the long patrol",
    from: "The raid parties",
    say: "Three days past the ridge, and somebody has promised lunch on every one.",
    want: { hamper: 150 },
    pay: 900,
    opens: { plans: ["flywheel", "bigcrates"] },
  },
  {
    title: "Glass for the Treasury windows",
    from: "Cinfy",
    say: "I should like to see who is coming. There is sand by the stream.",
    want: { glass: 300 },
    pay: 1000,
    opens: { plots: ["grove"], plans: ["tallpylons"] },
  },
  {
    title: "Lamp oil before the dark",
    from: "The crab pond",
    say: "The evenings are drawing in and the crabs dislike it. The old stumps to the north weep resin.",
    want: { oil: 300 },
    pay: 1200,
    opens: { plans: ["workshop"] },
  },
  {
    title: "Lanterns for the great tree",
    from: "The guild",
    say: "One for every raid that came home, and there have been a lot of raids. Glass, an ingot, and oil to fill it.",
    want: { lantern: 160 },
    pay: 1500,
    opens: { plans: ["tooling"] },
    gift: { id: "tree-lanterns", line: "Lanterns from the Works hang in the great tree." },
  },
  {
    title: "Raid kits",
    from: "The raid parties",
    say: "A tool, a lantern and a hamper, in one pack, so that nobody forgets two of the three.",
    want: { kit: 150 },
    pay: 2000,
    opens: { plots: ["seam"] },
    gift: { id: "gate-kits", line: "Raid kits from the Works are stacked by the gate." },
  },
  {
    title: "Shells for the shy crabs",
    from: "The crab pond",
    say: "Some of them would like somewhere to be shy in. Glazed, please. They were firm about glazed.",
    want: { shell: 300 },
    pay: 1500,
    opens: { plans: ["barrows"] },
  },
  {
    title: "War season",
    from: "The guild",
    say: "Winches for the walls and a pole for every hill we mean to keep.",
    want: { engine: 240, pole: 120 },
    pay: 2500,
    opens: { plots: ["quarry"] },
    gift: { id: "war-banners", line: "Banner poles from the Works line the road to the gate." },
  },
  {
    title: "A lantern for every path",
    from: "Pipwick",
    say: "And a hamper under each, because a path is a long way to walk on an empty stomach. I walk all of them.",
    want: { lantern: 300, hamper: 300 },
    pay: 2500,
    opens: { plans: ["rollers"] },
    gift: { id: "path-lanterns", line: "Every path in town has its lantern now." },
  },
  {
    title: "The Beacon",
    from: "The market stalls",
    say: "A great lamp on a pole, turned by an engine, so the raid parties can find the way home. And the moths. And customers.",
    want: { beacon: 2 },
    pay: 3000,
    opens: { plots: ["hollow"] },
    gift: { id: "beacon", line: "The Beacon turns above the town at night." },
  },
  {
    title: "Kits for the deep raid",
    from: "The raid parties",
    say: "Everyone is going. Everyone. Even Greg has a pack, though Greg cannot wear it.",
    want: { kit: 240 },
    pay: 3500,
    opens: { plans: ["jigs"] },
  },
  {
    title: "Parts for Pipwick",
    from: "Pipwick",
    say: "I am building something that ticks. I need engines and shells and I will not be taking questions.",
    want: { engine: 300, shell: 300 },
    pay: 3500,
    opens: { plots: ["pond"] },
  },
  {
    title: "The first clockwork crab",
    from: "Pipwick",
    say: "It walks sideways! It was meant to. An engine, a glazed shell, and a lantern for its eyes.",
    want: { crab: 1 },
    pay: 2000,
    opens: { plans: ["fourth"] },
    gift: { id: "clockwork-crab", line: "A clockwork crab from the Works ticks about the pond." },
  },
  {
    title: "Roll call",
    from: "The crab pond",
    say: "One crab is always missing at roll call. A hundred clockwork ones should settle it. One of them will go missing.",
    want: { crab: 100 },
    pay: 6000,
    opens: {},
    gift: { id: "roll-call", line: "A hundred clockwork crabs answer roll call at the pond. Ninety-nine, most days." },
  },
];
