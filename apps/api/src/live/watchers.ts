import { Context, Layer } from "effect";

import type { Outbox } from "./room.ts";

/**
 * Who hears what Leaf does to a state as it does it: everybody in a visit's room (`visitRoom`), by
 * the room's name. Live puts each of them here as they come into the room and takes them out as
 * they leave it; the play service tells them each batch it keeps of that state (`tell`), and makes
 * nothing to tell for a state nobody hears (`heard`). In memory, in this process, as Live's rooms
 * are.
 */
export class Watchers extends Context.Service<
  Watchers,
  {
    /** Somebody hears what is told in a room from now on; what it gives back stops it. */
    readonly hear: (room: string, outbox: Outbox) => () => void;
    /** Whether anybody hears what is told in a room. */
    readonly heard: (room: string) => boolean;
    /** Says a frame to everybody who hears a room. */
    readonly tell: (room: string, frame: string) => void;
    /** How many frames have been told since Leaf started, each counted once however many heard it. */
    readonly told: () => number;
  }
>()("leaf/Watchers") {
  static readonly layer = Layer.sync(Watchers, () => {
    const rooms = new Map<string, Set<Outbox>>();
    let told = 0;
    return Watchers.of({
      hear: (room, outbox) => {
        const those = rooms.get(room) ?? new Set();
        those.add(outbox);
        rooms.set(room, those);
        return () => {
          those.delete(outbox);
          if (those.size === 0 && rooms.get(room) === those) rooms.delete(room);
        };
      },
      heard: (room) => rooms.has(room),
      tell: (room, frame) => {
        const those = rooms.get(room);
        if (!those) return;
        told++;
        for (const outbox of those) outbox.send(frame);
      },
      told: () => told,
    });
  });
}
