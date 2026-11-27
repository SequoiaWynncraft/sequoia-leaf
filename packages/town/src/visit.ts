/** What a visitor of somebody's camp is given of it (`TOWN.visit`). */
import { eraAt } from "@sequoia-leaf/raid/content/releases.ts";

import { publicCamp, visitorsCamp } from "./camp.ts";
import type { Town, TownView } from "./game.ts";

/**
 * What a visitor is given of somebody's camp: its public part (`publicCamp`: the pet chosen, what
 * stands there, each thing in its own state, and who lives there); nothing else of theirs (no
 * letters, tray or caller, every counter at 0, an arrival letter that says nothing, none of their
 * games' postcards), in the shape the page draws a camp from.
 */
export const visitView = (s: Town, now: number): TownView => ({
  sightings: 0,
  spotAt: 0,
  chestDay: -1,
  welcomedDay: -1,
  seenAt: 0,
  cursor: null,
  stay: false,
  camp: visitorsCamp(s.camp),
  visit: null,
  made: 0,
  pets: [...publicCamp(s.camp).pets],
  arrival: { first: false, newDay: false, away: 0, said: [], mail: [] },
  doors: {},
  era: eraAt(now),
});
