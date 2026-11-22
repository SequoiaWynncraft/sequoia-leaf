import { Context } from "effect";

/**
 * Which Leaf process this is: an id made at random once, as Leaf starts. During a deploy the old
 * and the new container run side by side on one database file; what each writes of the players
 * it hears from carries its own id, so that the one stopping undoes only what is still its own.
 */
export const LeafInstance = Context.Reference<string>("leaf/Instance", {
  defaultValue: () => crypto.randomUUID(),
});
