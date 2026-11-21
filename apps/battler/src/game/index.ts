/**
 * The Little Raid, with no screen in it. Everything a screen needs comes through here; see the
 * README beside this file for how the pieces fit and how to drive them.
 */

// What is in the game: plain tables.
export {
  abilityNumber,
  abilityShort,
  abilityText,
  type AbilitySpec,
  BOSS_IDS,
  type BossId,
  FIGURE_IDS,
  type FigureId,
  type FigureSpec,
  FIGURES,
  figuresOfTier,
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
export {
  CALLINGS,
  type CallingId,
  type KinId,
  KINS,
  stepFor,
  topStep,
  isTraitId,
  TRAIT_IDS,
  type TraitId,
  traitNumber,
  TRAITS,
  type TraitSpec,
  traitShort,
  traitText,
} from "./content/traits.ts";
export { GOOD_WITH, type Role, roleLine, ROLES, type Three } from "./content/advice.ts";
export {
  COMPONENT_IDS,
  type ComponentId,
  COMPONENTS,
  FINISHED,
  FINISHED_IDS,
  type FinishedId,
  forge,
  holdItem,
  HOLDS,
  isComponentId,
  isItemId,
  isFinishedId,
  ITEM_IDS,
  itemAdds,
  type ItemId,
  itemName,
  itemShort,
  type ItemStats,
  itemStats,
  itemText,
} from "./content/items.ts";
export {
  BOON_IDS,
  type BoonId,
  boonNumber,
  BOONS,
  boonShort,
  type BoonSpec,
  boonText,
  isBoonId,
} from "./content/boons.ts";
export {
  BOSS_ROOMS,
  ECONOMY,
  FIGHT,
  HANDLES,
  MAX_LEVEL,
  ROOM_COUNT,
  type Room,
  type RoomKind,
  ROOMS,
  sellPrice,
  STALL_ODDS,
  type Trail,
  TRAIL_COUNT,
  TRAILS,
} from "./content/rooms.ts";
export { type Milestone, MILESTONES, PAYOUT } from "./content/keepsakes.ts";

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
export { HZ } from "./fight/core.ts";
export type {
  DamageKind,
  DamageSource,
  Fight,
  FightEvent,
  FightResult,
  FightSetup,
  FightSummary,
  HealSource,
  LeapWhy,
  StatusId,
  Tally,
  Unit,
} from "./fight/types.ts";

// The run.
export {
  abandon,
  beginFight,
  type Begun,
  buy,
  buyXp,
  type Choice,
  choose,
  type Done,
  fieldCap,
  fielded,
  fightSetup,
  giveItem,
  hold,
  interestCap,
  interestNow,
  move,
  type Note,
  opposition,
  partyOf,
  type Phase,
  type Piece,
  pieceAt,
  pieces,
  priceOf,
  redraw,
  type Refused,
  roomNow,
  type RoomRecord,
  type Run,
  type RunOptions,
  type RunSummary,
  rustle,
  rustleCost,
  sell,
  sellValue,
  type Spot,
  spotOf,
  startRun,
  summariseRun,
  type Taken,
  takeTakings,
  toBench,
  traitsNow,
  xpToNext,
} from "./run.ts";
export { type Loaded, loadRun, SAVE_VERSION, saveRun } from "./save.ts";

// Between runs.
export {
  type Almanac,
  ALMANAC_VERSION,
  isLocked,
  loadAlmanac,
  milestones,
  newAlmanac,
  type News,
  openFigures,
  type Payout,
  payout,
  recordRun,
  saveAlmanac,
  trailCleared,
  trailOpen,
} from "./outside.ts";

// A player with habits, for trying things out.
export { CARELESS, fondOf, type Habit, planRoom, playRoom, playRun, ROLLER, SAVER, SENSIBLE } from "./bot.ts";
