/**
 * A run's rooms as the table shows them: the track along the top, a pip for each room of the fifteen
 * the run is among (an endless run's come round again after the fifteenth, and the track says which
 * room it is in), the card each room opens, and the chairs an endless run has won. A room of the Deep
 * Woods that is held says by whom; one the forest grows in says by how much.
 */
import { type Description, link, register } from "@sequoia-leaf/kit/card.ts";
import { el } from "@sequoia-leaf/kit/dom.ts";
import { member } from "@sequoia-leaf/kit/live.ts";
import {
  chairsOf,
  ECONOMY,
  ENDLESS,
  fieldCap,
  grownAt,
  isHeld,
  lastRoom,
  type Room,
  ROOM_COUNT,
  roomAt,
  type RunView,
} from "@sequoia-leaf/raid";
import { regularOf } from "@sequoia-leaf/raid/content/rooms.ts";

import { roomIcon } from "../art/icons.ts";
import { opening } from "../logic.ts";
import { S } from "../state.ts";
import { pic } from "./cards.ts";

/** The rooms the track shows, counting from 0: the fifteen the run is among (for an endless run past the fifteenth, those it has come round to). */
export function roomsShown(run: Pick<RunView, "room">): number[] {
  const first = Math.floor(run.room / ROOM_COUNT) * ROOM_COUNT;
  return Array.from({ length: ROOM_COUNT }, (_, i) => first + i);
}

/** How a room came out, the last time it was fought: won, lost, drawn, or not yet. */
export function outcomeOf(run: Pick<RunView, "record">, room: number): "won" | "lost" | "drawn" | "" {
  const record = run.record.findLast((r) => r.room === room);
  return record ? (record.result === "win" ? "won" : record.result === "loss" ? "lost" : "drawn") : "";
}

/** The rooms a run is among as pips (the room it is in lit), each with a gap before a new wing. */
export function pipsOf(run: RunView, tag: "button" | "span"): HTMLElement[] {
  return roomsShown(run).flatMap((i) => {
    const room = roomAt(i);
    if (!room) return [];
    const state = outcomeOf(run, i);
    const here = tag === "button" && i === run.room && run.stage.phase !== "over" && state !== "won";
    const wing = i % ROOM_COUNT > 0 && roomAt(i - 1)?.wing !== room.wing ? " wing" : "";
    const cls = `k-slot pip ${room.kind} ${here ? "here lit" : state}${wing}`.trim();
    return [el(tag, cls, tag === "button" ? { type: "button" } : {}, pic(roomIcon(room.kind)))];
  });
}

/** What the track last drew, so it is drawn again only when that changes. */
const drawn = { key: "" };
/** Forgets what the track drew: for a new run. */
export const forgetTrack = (): void => void (drawn.key = "");

/** The track's plaque: one stop for the keyboard (the room the run is in), and the arrows walk along the rest. */
export function trackPlaque(): HTMLElement {
  register("room", (id) => (S.run ? roomDesc(Number(id), S.run) : null));
  return el("div", "k-plaque hung", {
    id: "track",
    onkeydown: (e: Event) => {
      const key = "key" in e ? e.key : "";
      const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
      const pips = [
        ...(e.currentTarget instanceof HTMLElement ? e.currentTarget.querySelectorAll<HTMLElement>(".pip") : []),
      ];
      const next = pips[pips.findIndex((p) => p === document.activeElement) + step];
      if (step === 0 || !next) return;
      e.preventDefault();
      next.focus();
    },
  });
}

/** Draws the track for a run: past the fifteenth room, which room it is in, before the pips. */
export function renderTrack(run: RunView): void {
  const track = document.getElementById("track");
  if (!track) return;
  const key = `${S.runs}:${run.endless}:${run.room}:${run.stage.phase}:${run.record.map((r) => r.result[0]).join("")}`;
  if (key === drawn.key) return;
  drawn.key = key;
  const pips = pipsOf(run, "button");
  roomsShown(run).forEach((i, at) => {
    const pip = pips[at];
    if (!pip) return;
    const state = outcomeOf(run, i);
    pip.setAttribute("aria-label", `Room ${i + 1}${state ? `, ${state}` : ""}`);
    pip.tabIndex = i === run.room && run.stage.phase !== "over" ? 0 : -1;
    link(pip, `room:${i}`);
  });
  // On a phone, the number alone.
  const past =
    run.room >= ROOM_COUNT
      ? el("b", "k-gold deep", {}, el("span", "wide-only", { text: "Room " }), String(run.room + 1))
      : null;
  track.replaceChildren(...(past ? [past] : []), ...pips);
}

/** An endless run's chairs, for the level's plaque: how many figures it may field, once a boss past the fifteenth room has given one (hidden until then). */
export const chairsTag = (run: RunView): HTMLElement =>
  el("span", "k-leafy chairs", { text: `Chairs: ${fieldCap(run)}`, hidden: chairsOf(run) === 0 });

// ---------- a room's card ----------

/** Who is across the table in the room the run is in: a regular, the forest, or a member's board (in the Deep Woods, the one who holds the room). */
function across(run: RunView): string {
  if (regularOf(run.foe)) return `${opening(run.foe.who)} ${run.foe.title}.`;
  if (isHeld(run, run.room))
    return run.foe.by === member()?.id
      ? "Held by you: your board at this room."
      : `Held by ${run.foe.who}: ${run.foe.title}.`;
  return `${run.foe.who}${run.foe.title ? `: ${run.foe.title}` : ""}.`;
}

/** What a room not yet fought gives, by its kind; in an endless run, the chair a boss past the fifteenth room adds. */
function gives(index: number, room: Room, run: RunView): string {
  const lose = `Lose: 1 of ${ECONOMY.componentsLost}.`;
  if (room.kind === "spar" && isHeld(run, index))
    return `${index === run.room ? "" : "Held by the last member to win it this week, or a regular while nobody has. "}Win it, and your board holds it.`;
  if (room.kind === "spar") return "A regular's party. It gives no components.";
  if (room.kind === "trouble") return `Win: pick 1 of ${ECONOMY.componentsWon} components. ${lose}`;
  if (index === lastRoom(run)) return "The last room. It is fought again until it is won or health runs out.";
  const chair = run.endless && index >= ROOM_COUNT && chairsOf(run) < ENDLESS.chairs ? " Win: 1 more chair." : "";
  return `Win: pick 1 of ${ECONOMY.componentsWon} components, twice. ${lose}${chair}`;
}

/** A room on the track: what kind it is, who is or was there, what it gives, and in an endless run how much the forest has grown in it. */
function roomDesc(index: number, run: RunView): Description | null {
  const room = roomAt(index);
  if (!room || index > lastRoom(run)) return null;
  const state = outcomeOf(run, index);
  const here = run.room === index && run.stage.phase !== "over";
  const kind = room.kind === "spar" ? "Sparring" : room.kind === "boss" ? "A boss" : "Trouble";
  const lines = [
    here ? across(run) : null,
    state === "won" ? "Won." : state === "lost" ? "Lost." : state === "drawn" ? "A draw." : gives(index, room, run),
    ECONOMY.boonRooms.some((r) => r === index) ? "A boon after it, won or lost." : null,
    run.endless && index >= ROOM_COUNT && room.kind !== "spar"
      ? `+${Math.round(grownAt(index) - 100)}% health and attack.`
      : null,
  ];
  return {
    name: `Room ${index + 1}`,
    icon: roomIcon(room.kind),
    tag: `${kind}, wing ${room.wing}.`,
    blocks: [{ body: lines.filter((l) => l !== null).join(" ") }],
  };
}
