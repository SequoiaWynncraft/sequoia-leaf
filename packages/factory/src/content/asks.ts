/**
 * Who asks for what on the board of standing orders, and why: the places in town, the town's own
 * (Pipwick, Fika, Tindra), and the small creatures the guild is fond of. Never a member: a gnome
 * comes to the gate for whoever asked.
 */
import type { ItemName } from "./items.ts";

export interface Ask {
  readonly from: string;
  readonly line: string;
}

/** Folios too: once the research that wants them is known, an order is what a folio line is for. */
export const ASKS: Partial<Record<ItemName, readonly Ask[]>> = {
  deadfall: [
    { from: "The campfire", line: "The fire is down to its last log and somebody has started a long story." },
    { from: "Worm", line: "Worm lives under a log. Worm would like a second log, for guests." },
  ],
  stone: [
    { from: "Rock", line: "Rock would like company. Rock did not say so. Rock is a rock." },
    { from: "The gnomes", line: "The gnomes are building a wall. It is ankle high and they are very proud." },
  ],
  ore: [
    { from: "Greg", line: "Greg is collecting shiny lumps. Nobody has asked why." },
    { from: "The raid parties", line: "The raid parties want ore to practise smelting on. Stand well back." },
  ],
  clay: [
    { from: "Glorp", line: "Glorp sat in the clay and now it is Glorp's clay. Glorp wants more." },
    { from: "The market stalls", line: "A stall is selling little clay moths. There are forty so far." },
  ],
  sand: [
    { from: "Crab #3", line: "Crab #3 is redecorating." },
    { from: "The cats", line: "The cats will not say what the sand is for." },
  ],
  resin: [
    { from: "Moth", line: "Moth got stuck in some resin once and has decided it was wonderful." },
    { from: "Pipwick", line: "Pipwick seals the town's letters with resin. There are a great many letters." },
  ],
  plank: [
    { from: "The gate", line: "The gate squeaks. One more plank would fix it. It is never one more plank." },
    { from: "The market stalls", line: "A stall has a wobble, and the stallholder has stopped pretending it hasn't." },
  ],
  brick: [
    { from: "The gnomes", line: "The wall is knee high now. The gnomes have plans." },
    { from: "The Treasury", line: "Cinfy wants a thicker vault wall. Nothing has happened. Cinfy just wants one." },
  ],
  ingot: [
    { from: "The Treasury", line: "The Treasury scales need counterweights. Cinfy weighs everything twice." },
    { from: "The campfire", line: "Somebody bent every spoon at the fire. These are for new spoons." },
  ],
  pot: [
    { from: "Crab #4", line: "Crab #4 wants a pot to hide under. It is a private matter." },
    { from: "The campfire", line: "Stew night. Everybody is bringing a bowl and nobody is bringing a pot." },
  ],
  glass: [
    { from: "Moth", line: "Moth would like a window to bump into." },
    { from: "The market stalls", line: "The lamp stall is making jars for fireflies, who have not been told." },
  ],
  oil: [
    { from: "The crab pond", line: "The lamps on the pond path are running low, and the crabs dislike the dark." },
    { from: "The gate", line: "The gate lamp is out and Pipwick keeps walking into the gate." },
  ],
  tool: [
    { from: "The raid parties", line: "The raid parties are short of shovels again. Nobody will say why." },
    { from: "Pipwick", line: "Pipwick borrowed a hammer, and now nobody can find Pipwick's hammer." },
  ],
  gear: [
    { from: "Pipwick", line: "Pipwick is building something that ticks. It should not tick like that." },
    { from: "The quest board", line: "The board's little crank fell off and the quests are stuck at the top." },
  ],
  frame: [
    { from: "The market stalls", line: "New stalls for market day. The old ones have been leaning on each other." },
    { from: "The quest board", line: "Somebody painted the quest notes, and now they want frames." },
  ],
  hamper: [
    { from: "The raid parties", line: "The patrol is going out past the ridge and would like to eat on the way." },
    { from: "The campfire", line: "Somebody promised everyone a picnic. It was Greg. Greg cannot carry hampers." },
  ],
  shell: [
    { from: "The crab pond", line: "The shy crabs would like somewhere to be shy in." },
    { from: "Crab #9", line: "Crab #9 has outgrown its shell and is being brave about it." },
  ],
  lantern: [
    { from: "The crab pond", line: "The pond path wants a lantern for every crab that is afraid of the dark." },
    { from: "The fox", line: "The fox with the golden antlers left a note. It says 'lanterns'. Foxes cannot write." },
  ],
  engine: [
    { from: "The Treasury", line: "The vault's winch gave out again. Cinfy has been looking at it and sighing." },
    { from: "Fika", line: "Fika sleeps on the bellows and would like them warmer. An engine, then. Meow." },
  ],
  pole: [
    { from: "The quest board", line: "The guild took another hill and there is nowhere to pin that it did." },
    { from: "Tindra", line: "Tindra wants a pole by her stall. For a banner. A small one. With a moth on it." },
  ],
  kit: [
    { from: "The raid parties", line: "A raid party is mustering at the gate and half of them forgot their packs." },
    { from: "The raid parties", line: "Somebody is taking the new members out and is packing for all of them." },
  ],
  beacon: [
    { from: "The guild", line: "A beacon for the far ridge, so the raid parties can find their way home." },
    { from: "The gate", line: "Pipwick wants a beacon over the gate. For safety. It is for the moths." },
  ],
  crab: [
    { from: "The crab pond", line: "Roll call came up one short again. A clockwork crab would help. It will not." },
    { from: "Crab #7", line: "Crab #7 would like a friend who also does not turn up to things." },
  ],
  timber: [
    { from: "The scholars", line: "The gnomes in the hall have run out of folios to write their questions in." },
    { from: "Pipwick", line: "Pipwick is pressing a leaf from every tree in the forest. Each leaf gets a folio." },
  ],
  brass: [
    { from: "The scholars", line: "The scholars keep their best answers in brass. They have two, and room for more." },
    {
      from: "The Treasury",
      line: "Cinfy keeps the guild's books in brass folios, so they cannot be lost. Cinfy has lost two.",
    },
  ],
};
