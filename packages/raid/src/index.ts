/**
 * The Little Raid, with no screen in it. Everything a screen needs comes through here; see the
 * README beside this file for how the pieces fit and how to drive them.
 */

// What exists, when: the catalogue of an era (`catalogOf`), the one door to every figure, trait, item and boon
// and their numbers, and to which figures a draw may draw (`available`), by the era Leaf's clock is in.
export {
  available,
  type Catalog,
  catalogAt,
  catalogOf,
  everyFigure,
  type Figure,
  type Figures,
  figureOf,
  prizeOf,
  type Purpose,
  type Rarity,
  RARITY_IDS,
} from "./content/catalog.ts";
export { type Era, eraAt, eraOf, isEra, LAST_ERA, LEGACY_ERA, type ReleaseId, RELEASES } from "./content/releases.ts";
export { type Banner, BANNERS, GROVE } from "./content/banners.ts";

// What is in the game: ids, words and numbers, each read from a catalogue.
export {
  abilityNumber,
  abilityShort,
  abilityText,
  type AbilitySpec,
  BOSS_IDS,
  type BossId,
  type FigureId,
  type FigureSpec,
  figureIn,
  isBossId,
  isFigureId,
  isUnitKind,
  type Shape,
  specOf,
  STAR,
  starScale,
  type Stars,
  SUMMONS,
  type SummonId,
  type Tier,
  traitsOf,
  TROUBLE,
  type TroubleId,
  type UnitKind,
  type UnitSpec,
} from "./content/figures.ts";
export { levelOf, placedOf, type Roster, rosterOf, stallOdds, stallPool } from "./own.ts";
export { isMemberId, type MemberId } from "./content/members.ts";
export {
  formNumber,
  formText,
  hasTrueForm,
  TRUE_FORM_IDS,
  type TrueForm,
  type TrueFormId,
  TRUE_FORMS,
} from "./content/graid.ts";
export { LORE } from "./content/lore.ts";
export {
  CALLINGS,
  type CallingId,
  type KinId,
  KINS,
  stepFor,
  topStep,
  isCalling,
  isKin,
  isTraitId,
  TRAIT_IDS,
  type TraitId,
  traitIn,
  traitNumber,
  type TraitSpec,
  traitDraw,
  traitShort,
  traitText,
} from "./content/traits.ts";
export { drawName, drawReach, drawTip, GOOD_WITH, placeOf, roleLine, ROLES, type Three } from "./content/advice.ts";
export {
  carriedTraits,
  carries,
  COMPONENT_IDS,
  type ComponentId,
  EMBLEM_IDS,
  type EmblemId,
  emblemTrait,
  FINISHED_IDS,
  type FinishedId,
  grantOf,
  halvesOf,
  HOLDS,
  isComponentId,
  isEmblemId,
  isItemId,
  isFinishedId,
  ITEM_IDS,
  itemAdds,
  type ItemId,
  itemIn,
  itemName,
  itemNumber,
  itemQuip,
  itemShort,
  type ItemSpec,
  type ItemStats,
  itemStats,
  itemText,
} from "./content/items.ts";
export { combine, forgedOf, type Held, holdItem, type Made, type NotHeld } from "./content/recipes.ts";
export { chairsOn, overfills } from "./chairs.ts";
export {
  BOON_IDS,
  type BoonId,
  boonIn,
  boonNumber,
  boonShort,
  type BoonSpec,
  boonText,
  giftOf,
  giftsTrait,
  isBoonId,
} from "./content/boons.ts";
export {
  BOSS_ROOMS,
  ECONOMY,
  FIGHT,
  HANDLES,
  MAX_LEVEL,
  ROOM_COUNT,
  type RoomKind,
  ROOMS,
  type RoomSpec,
  sellPrice,
  STALL_ODDS,
  levelBoost,
  LEVELS,
  type Trail,
  TRAIL_COUNT,
  TRAILS,
} from "./content/rooms.ts";
export { PAYOUT } from "./content/keepsakes.ts";

// The board.
export {
  backRow,
  cellAt,
  CELLS,
  cellSeat,
  centre,
  colOf,
  COLS,
  cone,
  distance,
  HOME_ROWS,
  line,
  mirror,
  neighbours,
  ring,
  rowOf,
  ROWS,
  seatCell,
  SEATS,
  type Side,
  within,
} from "./hex.ts";

// A party, as plain data.
export {
  type Carrier,
  chairsUsed,
  countTraits,
  isParty,
  type Party,
  partyWorth,
  type Placed,
  type TraitCounts,
  type TraitState,
  traitStates,
  traitSteps,
} from "./party.ts";
export { arrange } from "./formation.ts";
export { sparParty } from "./spar.ts";

// The fight.
export { openFight, recordFight, resolveFight, runFight, speedNow, stepFight, summarise } from "./fight/engine.ts";
export { drawOf, HZ } from "./fight/core.ts";
export type {
  DamageKind,
  DamageSource,
  Fight,
  FightEvent,
  FightResult,
  FightSetup,
  FightSummary,
  HealSource,
  Form,
  LeapWhy,
  RiseWhy,
  StatusId,
  Tally,
  Unit,
  Zone,
  ZoneKind,
} from "./fight/types.ts";

// The run.
export {
  abandon,
  type AcornsWhy,
  ACORNS_WHYS,
  beginFight,
  type Begun,
  buy,
  buyXp,
  type Choice,
  choose,
  type Done,
  fieldCap,
  fielded,
  type Fought,
  giveItem,
  hold,
  interestCap,
  interestNow,
  move,
  nextStreak,
  type Note,
  partyOf,
  type Phase,
  type Piece,
  pieceAt,
  pieces,
  priceOf,
  redraw,
  refusal,
  REFUSALS,
  type Refused,
  type RoomRecord,
  type Ending,
  endingOf,
  foughtOf,
  picksOf,
  type Run,
  type RunOptions,
  type RunSummary,
  type Stage,
  rustle,
  rustleCost,
  sell,
  sellValue,
  type Spot,
  spotOf,
  layOutAfresh,
  playsAsKept,
  startRun,
  streakPay,
  summariseRun,
  type Taken,
  takeTakings,
  toBench,
  traitsNow,
  type Why,
  whyText,
  xpToNext,
} from "./run.ts";
export { forgeItems, melt, toolRefusal, useTongs, useWhetstone } from "./rack.ts";
export { counted, countOn, isRackItem, kindsOn, type Rack, rackOf, rackSize } from "./racks.ts";
export type { Pickable } from "./rewards.ts";
export {
  isToolId,
  MELT,
  meltValue,
  type RackItem,
  rackName,
  rackSortOf,
  TOOL_IDS,
  TOOL_ODDS,
  type ToolId,
  TOOLS,
  type ToolSpec,
} from "./content/tools.ts";
export { type Fed, feed, mealFor } from "./feed.ts";
export { boardMet, opposition } from "./foe.ts";
// A run's record: its last rooms in full, the rest as totals.
export { KEPT_ROOMS, keepRoom, roomsFought, type RoomTotals, totalsOf } from "./record.ts";

// The endless runs: the Wilds and the Deep Woods.
export { ENDLESS, ENDLESS_WAYS, type EndlessWay, isEndlessWay } from "./content/endless.ts";
export { chairsOf, grownAt, isHeld, lastRoom, roomAt, sparAt } from "./endless.ts";
export { type Apart, type Deepest, type Depths, type Week, weekAt } from "./depths.ts";
// How a run set out, and everything keyed from it.
export {
  type Course,
  type CourseId,
  courseOf,
  COURSES,
  counts,
  lanes,
  offered,
  onTrail,
  payKey,
  type Pool,
  type RunRef,
  slotOf,
  type Span,
  trailOf,
  type Way,
  wayLogged,
  wayOn,
  wayWords,
} from "./way.ts";
export { checkRun, type Loaded, readRunView } from "./save.ts";
// What binds a room: the Wilds' rules, a wing each.
export { isRuleId, RULE_IDS, type RuleId, WILDS } from "./content/wilds.ts";
export { bind, type FightRules, PLAIN_RULES, ROOM_RULES, ruled, type RuleRow, shut } from "./content/rules.ts";
export { closedNow, type Room, roomOf, type RoomRun } from "./room.ts";
export { type Wing, wingEnd, wingOf } from "./wing.ts";
export { closedCells, rulesOf } from "./fight/rules.ts";

// Between runs.
export {
  type Almanac,
  beatenBosses,
  newAlmanac,
  readAlmanac,
  type News,
  type Payout,
  payout,
  recordRun,
  trailCleared,
  trailOpen,
} from "./outside.ts";

// A player with habits, for trying things out.
export {
  CARELESS,
  DIRECT,
  fondOf,
  type Habit,
  type Hands,
  planRoom,
  planWith,
  playRoom,
  playRun,
  ROLLER,
  SAVER,
  SENSIBLE,
} from "./bot.ts";
export { type Did, type Measure, measureOf, MEASURES, partsOf, tally } from "./tally.ts";

// How the table may look.
export {
  BASES,
  type BaseId,
  CLOTHS,
  type ClothId,
  isLookKind,
  LANTERNS,
  type LanternId,
  LOOK_KINDS,
  LOOK_TITLES,
  type LookId,
  type LookKind,
  LOOKS,
  type Looks,
  type LookSpec,
  newLooks,
  owns,
  type PlaceId,
  PLACES,
  readLooks,
  tryOn,
  wear,
  wornOf,
} from "./content/looks.ts";

// The table as Leaf plays it.
export {
  type Aimed,
  aimedAt,
  COMMANDS,
  isPlanning,
  isPredicted,
  isRunCommand,
  legal,
  type PlanningCommand,
  type Predicted,
  type RaidCommand,
  type RaidCommandName,
  type RunCommand,
  type Slot,
  type TableCommand,
} from "./command.ts";
export {
  decodeTable,
  encodeTable,
  newTable,
  planCommands,
  predict,
  readCommand,
  RAID,
  type RaidNote,
  refusalText,
  runView,
  type RunView,
  startOf,
  type Table,
  TABLE_REFUSALS,
  TABLE_VERSION,
  type TableView,
  type TableWhy,
  tableView,
  unfought,
} from "./game.ts";
export { readNotes, readView } from "./wire.ts";
