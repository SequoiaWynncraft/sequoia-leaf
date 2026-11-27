/**
 * A figure on a card as it stands in a fight: as itself, or (one of Graid's five, got back up) in
 * its true form, with that form's name, its own attack, and the one change it brings. Nothing here
 * draws, so a card's words can be tested.
 */
import { nameOf } from "@sequoia-leaf/figures/sprites.ts";
import type { Form, Unit } from "@sequoia-leaf/raid";
import { specOf, type UnitKind } from "@sequoia-leaf/raid/content/figures.ts";
import { formText, hasTrueForm, TRUE_FORMS } from "@sequoia-leaf/raid/content/graid.ts";

/** The form a card shows: the unit's in a fight, else its plain one. */
export const formOf = (u: Pick<Unit, "form"> | undefined): Form => u?.form ?? "plain";

/** Whether a figure on the card is in its true form. */
const isTrue = (kind: UnitKind, u: Pick<Unit, "form"> | undefined): boolean =>
  formOf(u) === "true" && hasTrueForm(kind);

/** What a card calls it: its true form's name once it has got back up in it ("Real Rock"), else its own. */
export const shownName = (kind: UnitKind, u?: Pick<Unit, "form">): string =>
  isTrue(kind, u) && hasTrueForm(kind) ? TRUE_FORMS[kind].name : nameOf(kind);

/** Whether it attacks: as a fight has it now (Real Rock does), else as its figure does. */
export const attacks = (kind: UnitKind, u?: Pick<Unit, "speed">): boolean => (u ? u.speed : specOf(kind).speed) > 0;

/** The one change its true form brings, as a line for its card ("Real Moth: Wing Dust covers..."); none as itself. */
export const formLines = (kind: UnitKind, u?: Pick<Unit, "form">): string[] =>
  isTrue(kind, u) ? [`${shownName(kind, u)}: ${formText(kind)}`] : [];
