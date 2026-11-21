/**
 * Who asks for what on the board of standing orders, and why. Everybody here is made up: the
 * guild-mates, the places in town, and the small creatures the guild is fond of.
 */
import type { Item } from "./items.ts";

export interface Ask {
  readonly from: string;
  readonly line: string;
}

export const ASKS: Record<Item, readonly Ask[]> = {
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
    { from: "Embertoe", line: "Embertoe wants ore to practise smelting on. Stand well back." },
  ],
  clay: [
    { from: "Glorp", line: "Glorp sat in the clay and now it is Glorp's clay. Glorp wants more." },
    { from: "Tindra", line: "Tindra is making little clay moths. There are forty so far." },
  ],
  sand: [
    { from: "Crab #3", line: "Crab #3 is redecorating." },
    { from: "The cats", line: "The cats will not say what the sand is for." },
  ],
  resin: [
    { from: "Moth", line: "Moth got stuck in some resin once and has decided it was wonderful." },
    { from: "Bramblewick", line: "Bramblewick seals letters with resin. There are a great many letters." },
  ],
  plank: [
    { from: "Mossback", line: "The gate squeaks. One more plank would fix it. It is never one more plank." },
    { from: "The market stalls", line: "A stall has a wobble, and the stallholder has stopped pretending it hasn't." },
  ],
  brick: [
    { from: "The gnomes", line: "The wall is knee high now. The gnomes have plans." },
    { from: "The Treasury", line: "Cinfy wants a thicker vault wall. Nothing has happened. Cinfy just wants one." },
  ],
  ingot: [
    { from: "The Treasury", line: "The Treasury scales need counterweights. Cinfy weighs everything twice." },
    { from: "Sootpaw", line: "Sootpaw bent every spoon in camp. These are for new spoons." },
  ],
  pot: [
    { from: "Crab #4", line: "Crab #4 wants a pot to hide under. It is a private matter." },
    { from: "The campfire", line: "Stew night. Everybody is bringing a bowl and nobody is bringing a pot." },
  ],
  glass: [
    { from: "Moth", line: "Moth would like a window to bump into." },
    { from: "Quillfeather", line: "Quillfeather is making jars for fireflies, who have not been told." },
  ],
  oil: [
    { from: "Fernwhistle", line: "The lamps on the pond path are running low, and the crabs dislike the dark." },
    { from: "The gate", line: "The gate lamp is out and Mossback keeps walking into the gate." },
  ],
  tool: [
    { from: "The Branchmasters", line: "The raid parties are short of shovels again. Nobody will say why." },
    { from: "Pipwick", line: "Pipwick borrowed a hammer, and now nobody can find Pipwick's hammer." },
  ],
  gear: [
    { from: "Pipwick", line: "Pipwick is building something that ticks. It should not tick like that." },
    { from: "The quest board", line: "The board's little crank fell off and the quests are stuck at the top." },
  ],
  frame: [
    { from: "The market stalls", line: "New stalls for market day. The old ones have been leaning on each other." },
    { from: "Wrenly", line: "Wrenly paints, and has run out of things to put paintings in." },
  ],
  hamper: [
    { from: "Sootpaw", line: "The patrol is going out past the ridge and would like to eat on the way." },
    { from: "The campfire", line: "Somebody promised everyone a picnic. It was Greg. Greg cannot carry hampers." },
  ],
  shell: [
    { from: "The crab pond", line: "The shy crabs would like somewhere to be shy in." },
    { from: "Crab #9", line: "Crab #9 has outgrown its shell and is being brave about it." },
  ],
  lantern: [
    { from: "Fernwhistle", line: "The pond path wants a lantern for every crab that is afraid of the dark." },
    { from: "The fox", line: "The fox with the golden antlers left a note. It says 'lanterns'. Foxes cannot write." },
  ],
  engine: [
    { from: "Mossback", line: "The well-winch gave out again. Mossback has been looking at it and sighing." },
    { from: "Embertoe", line: "Embertoe wants an engine for the bellows and promises to stand further back." },
  ],
  pole: [
    { from: "Quillfeather", line: "The guild took another hill and there is nowhere to hang the banner." },
    { from: "Tindra", line: "Tindra wants a pole by the tent. For a banner. A small one. With a moth on it." },
  ],
  kit: [
    { from: "The Branchmasters", line: "A raid party is mustering at the gate and half of them forgot their packs." },
    { from: "Bramblewick", line: "Bramblewick is taking the new members out and is packing for all of them." },
  ],
  beacon: [
    { from: "The guild", line: "A beacon for the far ridge, so the raid parties can find their way home." },
    { from: "The gate", line: "Mossback wants a beacon over the gate. For safety. It is for the moths." },
  ],
  crab: [
    { from: "The crab pond", line: "Roll call came up one short again. A clockwork crab would help. It will not." },
    { from: "Crab #7", line: "Crab #7 would like a friend who also does not turn up to things." },
  ],
};
