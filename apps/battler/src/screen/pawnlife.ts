/**
 * Where a pawn is in its life on the table, as one value, and the one function that moves it on. A
 * pawn is here (at its place, or hopping to it); loose (bought straight into three of a kind, with
 * no place of its own, held up until it hops in); or going (spoken for: into another figure, or
 * sold back to the stall), and gone once its last hop has landed.
 */
import type { Spot } from "@sequoia-leaf/raid";

export type Life =
  | { is: "here"; spot: Spot }
  | { is: "loose" }
  /** Going into another figure (`merge`) or back to the stall; `hopping` once its last hop has begun. */
  | { is: "going"; to: "merge" | "stall"; hopping: boolean };

export type LifeEvent =
  /** The rules have its figure at a place: it is here, whatever it was doing. */
  | { e: "placed"; spot: Spot }
  /** Its figure is gone from the rules' run: into another, or sold. */
  | { e: "spoken"; to: "merge" | "stall" }
  /** Its last hop begins. */
  | { e: "last hop" };

export function lifeAfter(life: Life, ev: LifeEvent): Life {
  switch (ev.e) {
    case "placed":
      return { is: "here", spot: ev.spot };
    case "spoken":
      return life.is === "going" ? life : { is: "going", to: ev.to, hopping: false };
    case "last hop":
      return life.is === "going" ? { ...life, hopping: true } : life;
  }
}

/** Its place, while it has one. */
export const placeOf = (life: Life): Spot | null => (life.is === "here" ? life.spot : null);
/** Whether a pawn whose hop has just landed is gone: that hop was its last. */
export const goneOnLanding = (life: Life): boolean => life.is === "going" && life.hopping;
/** Whether it fades as it hops: one sold back to the stall. */
export const fadingOf = (life: Life): boolean => life.is === "going" && life.to === "stall";
