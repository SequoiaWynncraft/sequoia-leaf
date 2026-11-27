/**
 * Lore: a line for the almanac about where a figure or a trait comes from. The table is told at the
 * stump; the gnomes, who were not there, carve what they hear. The fight never reads this.
 *
 * A crab's number is the tag painted on its shell: its lore line says it, as its picture shows it.
 */
import type { FigureId } from "./figures.ts";
import type { TraitId } from "./traits.ts";

export const LORE: Readonly<Partial<Record<FigureId | TraitId, string>>> = {
  // ---------- origins ----------
  ember: "From the campfire beside the stump. Nobody remembers lighting it.",
  moss: "From the north side of the stump, where it is always damp.",
  mist: "From the fog off the pond.",
  burrow: "From under the roots.",
  feather: "From the low branches. They came for the crumbs.",
  crab: "From the pond's edge. They hold a roll call every evening; it never comes out right.",
  gnome: "From the stall. They carve the figures and will not be told they got Greg wrong.",
  graid: "Carved from what the raiders said. A true form is what the raiders saw.",
  grooter: "From the nest raid, the one they run every night. Carved from what the grooters said was in there.",
  huddle: "From the winter the pond froze. The guild came home in onesies; some had penguins in them.",
  // ---------- classes ----------
  bulwark: "The ones who are told to stand in front.",
  fang: "The ones who would rather settle it up close.",
  slinger: "The ones who brought something to throw.",
  sage: "The ones who read the rules.",
  mender: "The ones who brought plasters.",
  sneak: "The ones who were behind you before the fight began.",
  chorus: "The ones who make the noise the forest makes at dusk.",
  // ---------- one figure's own (Greg's trait shares his line) ----------
  rooted: "It was a tree before it was a figure and sees no reason to move.",
  stowaway: "On every list and in no seat.",
  // ---------- one acorn ----------
  emberkit: "Born in the campfire. Has never left it; the fire comes along.",
  mossmote: "A clump of the stump's moss that learned to tuck people in.",
  moth: "What the raiders call the raid whose letters they argue about. The gnomes carved a moth.",
  worm: "What the raiders call the nest raid. The gnomes carved a worm, a small one.",
  finch: "Sings before every raid, whether or not there is one.",
  crab7: "Its tag says 7. Answers to it, most evenings.",
  barrowgnome: "Brings the wood the figures are carved from.",
  dibs: "The first to arrive. Says the others are coming.",
  peep: "Hatched halfway on the stump and stopped there. Nobody told the gnomes what comes out of the eggs, so they carved something green.",
  // ---------- two acorns ----------
  kettle: "Left on the fire by a raider who went back to Wynn. It whistles for them.",
  slug: "Crossed the stump once. It took a season.",
  glorp: "Came out of the pond. More of it is still in there.",
  chickaree: "Buries cones under the roots for a winter that has not come.",
  jay: "Lost a crumb to Twig in the spring. Has not let it go.",
  crab12: "Its tag says 12. It says it was 11. Skims pebbles on the pond, where the others live.",
  lanterngnome: "Lights the lanterns round the stump at dusk, so the raids can be told.",
  jet: "Found that the frozen pond was faster. Never stood up again.",
  // ---------- three acorns ----------
  leafling: "Sprouted on the stump. Believes the stump is its.",
  cindernewt: "Lives under the campfire's logs. Comes out when they are moved.",
  drizzlefrog: "The loudest thing on the pond at dusk.",
  rock: "What the raiders call the canyon raid. The gnomes brought a rock.",
  bushgnome: "Carves in the bush so nobody sees the figures before they are done.",
  crab23: "Its tag says 23. Keeps the colony's plasters. The colony needs a lot of plasters.",
  crab31: "Its tag says 31. Keeps time for the roll call. The count is still wrong.",
  larp: "Found a onesie after penguin month. It fit.",
  munch:
    "The grooters said something in there eats you shell and all. The gnomes carved the mouth and ran out of wood for the rest.",
  // ---------- four acorns ----------
  badger: "The stump is on top of its sett. It was not asked.",
  fogowl: "Hears every story from the fog and has never told one.",
  heron: "Stands in the pond all day. The crabs count it, to be safe.",
  crab40: "Its tag says 40. The widest crab. Roll call starts with it.",
  apothecary: "Makes the tonic from what grows on the stump.",
  flurry: "Carries the winter it came from. The stump is inside.",
  pomp: "Plays whenever a raider comes home with something.",
  clutch: "The raiders said the Nest. The gnomes carved a nest. It has eggs in, so it must be right.",
  // ---------- five acorns ----------
  greg: 'What the raiders call the nameless one. The gnomes asked what it did. "It eats." Offerings go missing near him.',
  whitefox: "The raiders say it has gold antlers and speaks. The gnomes carved a fox. Nobody corrected them.",
  hearthcat: "Sleeps by the campfire. Came to the table to push things off it.",
  seqwawa: "What is left of the guild's own tree. It is still growing.",
  crab8: "Nobody knows who Crab #8 is. It is at every raid.",
  yule: "Wears the hat all year. Says it is nearly December.",
  // ---------- a banner's member ----------
  commodore: "Asks if anyone is raiding. Somebody always is.",
};
