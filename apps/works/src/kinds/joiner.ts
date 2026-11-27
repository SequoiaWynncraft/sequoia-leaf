/** The joiner on the page: a top over the belt where three lines meet, drawn flat with the floor. */
import { GOLD } from "@sequoia-leaf/kit/palette.ts";

import { arms } from "../art/belts.ts";
import { meeting } from "../art/meeting.ts";
import { beltArms, carries, straight } from "./carrier.ts";
import type { KindPage } from "./kind.ts";

export const joiner: KindPage = {
  picture: ({ m }, grade) => meeting(m, arms(2, 1, 1, 1), m.joiner[0], grade),
  top: (art, _y, _i, d) => art.m.joiner[d],
  arms: (y, i) => beltArms(y, i, true),
  aimArms: straight,
  mapMark: GOLD[2],
  dock: 2,
  line: 2,
  pace: carries,
  faces: true,
};
