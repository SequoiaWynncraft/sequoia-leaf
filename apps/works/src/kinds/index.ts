/**
 * Every kind of piece on the page, by its name: one module each (`kinds/kind.ts` says what is in
 * one). It is a record of every kind the rules have, so a kind the rules gain does not build until
 * its page module is here too.
 */
import { ALL_KINDS, type KindName, kindName } from "@sequoia-leaf/factory";

import { assembler } from "./assembler.ts";
import { belt } from "./belt.ts";
import { bench } from "./bench.ts";
import { boiler } from "./boiler.ts";
import { breaker } from "./breaker.ts";
import { cracker } from "./cracker.ts";
import { crate } from "./crate.ts";
import { depot } from "./depot.ts";
import { gatherer } from "./gatherer.ts";
import { joiner } from "./joiner.ts";
import type { KindPage } from "./kind.ts";
import { mill } from "./mill.ts";
import { powerhouse } from "./powerhouse.ts";
import { pylon } from "./pylon.ts";
import { sorter } from "./sorter.ts";
import { splitter } from "./splitter.ts";
import { still } from "./still.ts";
import { stop } from "./stop.ts";
import { study } from "./study.ts";
import { tunnel } from "./tunnel.ts";
import { wheel } from "./wheel.ts";
import { workshop } from "./workshop.ts";

export const PAGES: Readonly<Record<KindName, KindPage>> = {
  belt,
  gatherer,
  mill,
  bench,
  workshop,
  splitter,
  joiner,
  tunnel,
  crate,
  pylon,
  wheel,
  boiler,
  depot,
  study,
  stop,
  sorter,
  assembler,
  breaker,
  still,
  cracker,
  powerhouse,
};

/** Each kind's page module, by the kind's number. */
export const PAGE: readonly KindPage[] = ALL_KINDS.map((k) => PAGES[kindName(k)]);
/** The page module of the kind of a number, if it is one. */
export const pageOf = (k: number): KindPage | undefined => PAGE[k];
/** Whether a kind is flipped to send to its other side (`KindPage.flips`: a sorter). */
export const flips = (k: number): boolean => PAGE[k]?.flips === true;
