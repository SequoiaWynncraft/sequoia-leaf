/**
 * The guild going about its evening: who is where, who is walking, the raid parties, the scouts,
 * the crabs. All of it is made up and none of it talks to a server; it moves on by `update(dt)`.
 */
import { sfx } from "./audio.ts";
import * as fx from "./fx.ts";
import type { Lands } from "./lands.ts";
import { P } from "./palette.ts";
import { ICONS, type IconId, LANTERN } from "./pix.ts";
import { madeUp, type Skin } from "./skins.ts";
import {
  CAMP,
  EDGES,
  edgePoint,
  type GateId,
  GATES,
  type Hue,
  LANDS,
  type Leg,
  NODES,
  type NodeId,
  type Owner,
  POND,
  RIVAL,
  roadDistance,
  ropeSlot,
  route,
  WORKS,
} from "./world.ts";

export type Route = { legs: Leg[]; i: number; s: number; dest: NodeId };
export type Member = {
  id: number;
  name: string;
  rank: string;
  level: number;
  skin: Skin;
  you: boolean;
  npc: boolean;
  /** The node they stand at, or null while on the road. */
  at: NodeId | null;
  route: Route | null;
  x: number;
  y: number;
  speed: number;
  delay: number;
  face: 1 | -1;
  walk: number;
  busy: "" | "raid" | "scout" | "visit";
  /** 0 on the road, 1 standing in their own spot at a place. */
  settle: number;
  say: string;
  sayT: number;
  emote: IconId | null;
  emoteT: number;
  /** How long the picture they are showing was put up for, and where on screen it goes. */
  emoteFor: number;
  top: number;
  hop: number;
  carry: boolean;
  sit: boolean;
  wander: number;
  then: (() => void) | null;
  /** Where they were last drawn on screen, for taps. */
  sx: number;
  sy: number;
  sr: number;
};

export type FeedEntry = { icon: IconId; html: string; x: number; y: number; who?: Member; earlier?: true };
/** What the page does when the guild does something; the interface fills these in. */
export const hooks = {
  feed: (_e: FeedEntry): void => {},
  toast: (_text: string): void => {},
  purse: (_what: "leaf" | "coins", _delta: number): void => {},
  quests: (): void => {},
};

const WALK = 30;
const RAID_WAIT = 9;
const CLAIM = 7;

export const state = {
  T: 0,
  /** False while the "while you were away" moment plays: people stand still until it is over. */
  live: false,
  leaf: 128,
  coins: 240,
};

export const members: Member[] = [];
function member(id: number, name: string, rank: string, level: number, skin: Skin, at: NodeId): Member {
  const p = NODES[at];
  return {
    id,
    name,
    rank,
    level,
    skin,
    you: false,
    npc: false,
    at,
    route: null,
    x: p.x,
    y: p.y,
    speed: WALK,
    delay: 0,
    face: 1,
    walk: 0,
    busy: "",
    settle: 1,
    say: "",
    sayT: 0,
    emote: null,
    emoteT: 0,
    emoteFor: 1,
    top: 0,
    hop: 0,
    carry: false,
    sit: false,
    wander: 6 + Math.random() * 20,
    then: null,
    sx: -99,
    sy: -99,
    sr: 0,
  };
}

/** Made-up handles, never a real person's. */
const ROSTER: [string, string, number, NodeId][] = [
  ["Bramblewick", "Warden", 61, "gateB"],
  ["Hobnail", "Warden", 57, "gateB"],
  ["Fennick", "Ranger", 51, "gateB"],
  ["Thistledown", "Ranger", 39, "gateB"],
  ["Tansyfoot", "Ranger", 44, "millfork"],
  ["Mossbeard", "Warden", 66, "millfork"],
  ["Wrenna", "Sapling", 28, "millfork"],
  ["Oakum", "Elder", 78, "fire"],
  ["Dapplethorn", "Seedling", 9, "fire"],
  ["Pipkin", "Seedling", 12, "market"],
  ["Quillfeather", "Sapling", 23, "board"],
];

export const you: Member = member(0, "You", "Ranger", 47, madeUp(1), "camp");
you.you = true;
members.push(you);
ROSTER.forEach(([name, rank, level, at], i) => members.push(member(i + 1, name, rank, level, madeUp(i + 11), at)));

/** Cinfy keeps the Treasury, and does not leave the door. */
export const cinfy: Member = member(99, "Cinfy", "Treasurer", 99, madeUp(77, { style: 4, cloth: 3, trim: P.plum2, hair: 4, beard: false, tone: 0 }), "treasury");
cinfy.npc = true;
cinfy.x = NODES.treasury.x - 11;
cinfy.y = NODES.treasury.y - 3;

const NODE_NAME: Partial<Record<NodeId, string>> = {
  town: "the plaza",
  treasury: "the Treasury",
  board: "the quest board",
  market: "the Market",
  fire: "the campfire",
  works: "the Works",
  pond: "the crab pond",
  camp: "your camp",
  mill: "the windmill",
  gateA: GATES.gateA.name,
  gateB: GATES.gateB.name,
  gateC: GATES.gateC.name,
  otter: "Otter Bend",
  stonering: "Stonering",
  bracken: "Brackenmoor",
  reed: "Reedmere",
};
const IDLE: Partial<Record<NodeId, string>> = {
  town: "Standing about in the plaza",
  treasury: "Haggling with Cinfy",
  board: "Reading the quest board",
  market: "Browsing the Market",
  fire: "Warming up by the campfire",
  works: "Poking around the Works",
  pond: "Counting crabs. Again.",
  mill: "Watching the windmill go round",
  camp: "Visiting your camp",
};

/** What a member is up to, in a line, for their card. */
export function doing(m: Member): string {
  if (m.npc) return "Counting every Leaf twice";
  if (m.you) return "That's you";
  const raid = raids.find((r) => r.party.includes(m) && r.phase !== "done");
  if (raid) {
    const gate = GATES[raid.gate].name;
    if (raid.phase === "out") return `Walking out to ${gate} with a party of four`;
    if (raid.phase === "wait") return `At ${gate}, waiting while the ring fills`;
    return m.carry ? "Carrying a lantern home" : `On the way home from ${gate}`;
  }
  const push = pushes.find((p) => p.scouts.includes(m) && p.phase !== "done");
  if (push) return `Scouting ${(LANDS[push.land] as (typeof LANDS)[number]).name}`;
  if (m.route) return `On the road to ${NODE_NAME[m.route.dest] ?? "somewhere"}`;
  return (m.at && IDLE[m.at]) ?? "Taking the air";
}

// ---------- walking ----------

type Plan = { legs: Leg[]; len: number };
function plan(m: Member, dest: NodeId): Plan {
  if (m.route && m.route.i < m.route.legs.length) {
    // Already on a road: carry on to whichever end of it is the shorter way round.
    const leg = m.route.legs[m.route.i] as Leg;
    const edge = EDGES[leg.e] as (typeof EDGES)[number];
    const s = m.route.s;
    const viaA = s + roadDistance(edge.a, dest);
    const viaB = edge.len - s + roadDistance(edge.b, dest);
    return viaA <= viaB
      ? { legs: [{ e: leg.e, from: s, to: 0 }, ...route(edge.a, dest)], len: viaA }
      : { legs: [{ e: leg.e, from: s, to: edge.len }, ...route(edge.b, dest)], len: viaB };
  }
  const from = m.at ?? "town";
  return { legs: route(from, dest), len: roadDistance(from, dest) };
}

/** Sends someone walking to a node. `seconds` hurries them so the trip takes about that long. */
export function send(m: Member, dest: NodeId, opts: { delay?: number; seconds?: number; then?: () => void } = {}): number {
  const p = plan(m, dest);
  m.then = opts.then ?? null;
  m.sit = false;
  if (p.legs.length === 0) {
    const done = m.then;
    m.then = null;
    done?.();
    return 0;
  }
  m.route = { legs: p.legs, i: 0, s: (p.legs[0] as Leg).from, dest };
  m.at = null;
  m.delay = opts.delay ?? 0;
  m.speed = opts.seconds ? Math.max(WALK, p.len / opts.seconds) : WALK;
  return p.len;
}

function stepWalk(m: Member, dt: number): void {
  const r = m.route;
  if (!r) {
    m.settle = Math.min(1, m.settle + dt * 2.2);
    return;
  }
  m.settle = Math.max(0, m.settle - dt * 4);
  if (m.delay > 0) {
    m.delay -= dt;
    return;
  }
  let move = m.speed * dt;
  while (move > 0 && r.i < r.legs.length) {
    const leg = r.legs[r.i] as Leg;
    const rem = Math.abs(leg.to - r.s);
    if (move < rem) {
      r.s += Math.sign(leg.to - r.s) * move;
      move = 0;
    } else {
      move -= rem;
      r.s = leg.to;
      r.i++;
      if (r.i < r.legs.length) r.s = (r.legs[r.i] as Leg).from;
    }
  }
  const leg = r.legs[Math.min(r.i, r.legs.length - 1)] as Leg;
  const p = edgePoint(leg.e, r.s);
  if (Math.abs(p.x - m.x) > 0.05) m.face = p.x > m.x ? 1 : -1;
  m.x = p.x;
  m.y = p.y;
  const before = Math.floor(m.walk);
  m.walk += dt * (4 + m.speed * 0.09);
  if (Math.floor(m.walk) !== before) {
    if (m.you) {
      fx.dust(m.x, m.y, 2);
      sfx.step();
    } else if (m.speed > WALK * 1.2 && Math.random() < 0.5) fx.dust(m.x, m.y, 1);
  }
  if (r.i >= r.legs.length) {
    m.route = null;
    m.at = r.dest;
    const end = NODES[r.dest];
    m.x = end.x;
    m.y = end.y;
    const done = m.then;
    m.then = null;
    done?.();
  }
}

// ---------- small expressions ----------

export function say(m: Member, text: string, seconds = 3.4): void {
  m.say = text;
  m.sayT = seconds;
}
export function emote(m: Member, icon: IconId, seconds = 1.7): void {
  m.emote = icon;
  m.emoteT = seconds;
  m.emoteFor = seconds;
}
export function hop(m: Member, wait = 0): void {
  m.hop = 0.45 + wait;
}
/** Everyone standing within reach hops and shows a small picture: the guild, pleased. */
export function cheer(x: number, y: number, reach: number, icon: IconId): void {
  for (const m of members) {
    const d = Math.hypot(m.x - x, m.y - y);
    if (d > reach || m.route) continue;
    hop(m, Math.random() * 0.4);
    if (Math.random() < 0.7) emote(m, icon, 1.4 + Math.random());
  }
}
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)] as T;
const free = (): Member[] => members.filter((m) => !m.you && m.busy === "");
const names = (list: Member[]): string => {
  const n = list.map((m) => m.name);
  return n.length > 1 ? `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}` : (n[0] ?? "");
};

// ---------- raids: out to a gate, wait while the ring fills, home with a lantern ----------

export type Raid = { gate: GateId; party: Member[]; phase: "out" | "wait" | "back" | "done"; ring: number; leaf: number };
export const raids: Raid[] = [];
export const lanterns: { t: number; hue: Hue; swing: number }[] = (["violet", "teal", "coral", "violet", "teal"] as const).map((hue) => ({
  t: -99,
  hue,
  swing: 0,
}));
const HUE_COLS: Record<Hue, readonly string[]> = {
  violet: [P.rose, P.plum3, P.cream],
  teal: [P.teal, P.w4, P.cream],
  coral: [P.coral, P.amber, P.cream],
  amber: [P.gold1, P.gold2, P.cream],
  cream: [P.cream, P.gold2],
};

export function startRaid(gate: GateId, party: Member[], ring = 0, there = false): void {
  const raid: Raid = { gate, party, phase: there ? "wait" : "out", ring, leaf: 14 + Math.floor(Math.random() * 10) };
  raids.push(raid);
  party.forEach((m, i) => {
    m.busy = "raid";
    if (there) {
      m.route = null;
      m.at = gate;
      m.x = NODES[gate].x;
      m.y = NODES[gate].y;
    } else send(m, gate, { delay: 0.6 + i * 0.45, seconds: 9 });
  });
}

function updateRaids(dt: number): void {
  for (const r of raids) {
    const gate = GATES[r.gate];
    if (r.phase === "out") {
      if (r.party.every((m) => m.at === r.gate)) {
        r.phase = "wait";
        fx.ring(gate.x, gate.y - 10, HUE_COLS[gate.hue][0] as string, 20, 0.8);
      }
    } else if (r.phase === "wait") {
      const before = Math.floor(r.ring * 20);
      r.ring = Math.min(1, r.ring + dt / RAID_WAIT);
      if (Math.floor(r.ring * 20) !== before && Math.random() < 0.6)
        fx.sparks(gate.x + (Math.random() - 0.5) * 8, gate.y - 12, HUE_COLS[gate.hue], 2, 12);
      if (r.ring >= 1) {
        r.phase = "back";
        fx.sparks(gate.x, gate.y - 12, HUE_COLS[gate.hue], 30, 46);
        fx.ring(gate.x, gate.y - 10, P.cream, 30, 0.9);
        fx.ring(gate.x, gate.y - 10, HUE_COLS[gate.hue][0] as string, 20, 0.6);
        sfx.ring();
        r.party.forEach((m, i) => {
          hop(m, i * 0.08);
          emote(m, "star", 1.6);
          fx.float(m.x + (i - 1.5) * 9, m.y - 18 - (i % 2) * 6, `+${r.leaf}`, P.g4, ICONS.leaf);
          send(m, "town", { delay: 1.5 + i * 0.4, seconds: 9 });
        });
        (r.party[0] as Member).carry = true;
        hooks.feed({
          icon: "lantern",
          html: `<b>${names(r.party)}</b> cleared <i>${gate.name}</i> · ${r.leaf} Leaf each`,
          x: gate.x,
          y: gate.y - 6,
        });
      }
    } else if (r.phase === "back") {
      const lead = r.party[0] as Member;
      if (lead.at === "town") {
        r.phase = "done";
        lead.carry = false;
        const slot = ropeSlot(lanterns.length);
        say(lead, pick(["one more for the rope!", "lantern's home", "mind your heads"]), 2.4);
        fx.fly(fx.flights, {
          icon: LANTERN,
          x0: lead.x,
          y0: lead.y - 14,
          x1: slot.x,
          y1: slot.y + 2,
          dur: 1,
          arc: 16,
          scale: 1,
          done: () => {
            lanterns.push({ t: state.T, hue: gate.hue, swing: 1 });
            sfx.lantern();
            fx.sparks(slot.x, slot.y + 2, [P.gold2, P.cream, P.amber], 14, 22);
            cheer(NODES.town.x, NODES.town.y, 70, "lantern");
            hooks.feed({
              icon: "lantern",
              html: `A lantern from <i>${gate.name}</i> was hung in town · ${lanterns.length} on the rope`,
              x: NODES.town.x,
              y: NODES.town.y - 16,
            });
          },
        });
        r.party.forEach((m, i) => {
          m.busy = "";
          m.wander = 3 + i * 1.6;
        });
      }
    }
  }
  for (let i = raids.length - 1; i >= 0; i--) if ((raids[i] as Raid).phase === "done") raids.splice(i, 1);
}

// ---------- lands: scouts gather, a banner climbs, the colour spreads ----------

export type Push = { land: number; scouts: Member[]; phase: "out" | "claim" | "spread" | "done"; p: number };
export const pushes: Push[] = [];
/** Each land's banner: how far up its pole the cloth is, and whose it is. */
export const flags: { h: number; col: Owner }[] = LANDS.map((l) => ({ h: l.owner === 1 ? 0 : 1, col: l.owner === 2 ? 2 : 0 }));
const flagWant: Owner[] = LANDS.map((l) => l.owner);
let lands: Lands;

export function startPush(land: number, scouts: Member[]): void {
  const node = (LANDS[land] as (typeof LANDS)[number]).node;
  if (!node) return;
  pushes.push({ land, scouts, phase: "out", p: 0 });
  scouts.forEach((m, i) => {
    m.busy = "scout";
    send(m, node, { delay: 0.3 + i * 0.5, seconds: 9 });
  });
}

function updatePushes(dt: number): void {
  for (const p of pushes) {
    const land = LANDS[p.land] as (typeof LANDS)[number];
    const flag = flags[p.land] as (typeof flags)[number];
    if (p.phase === "out") {
      if (p.scouts.every((m) => m.at === land.node)) {
        p.phase = "claim";
        flagWant[p.land] = 0;
        say(p.scouts[0] as Member, pick(["flag goes here, I think", "pole's in. hold it steady", "nice spot for a banner"]), 2.6);
      }
    } else if (p.phase === "claim") {
      // The old colours come down first, then the guild's climb the pole.
      if (flag.col !== 0 && flag.h > 0) flag.h = Math.max(0, flag.h - dt * 1.4);
      else {
        flag.col = 0;
        p.p = Math.min(1, p.p + dt / CLAIM);
        flag.h = p.p;
        if (Math.random() < dt * 2.5) fx.sparks(land.bx, land.by - 12 * p.p, [P.gold2, P.cream], 1, 10);
      }
      if (p.p >= 1) {
        p.phase = "spread";
        lands.begin(p.land, land.bx, land.by, 0);
        sfx.banner();
        fx.ring(land.bx, land.by, P.gold2, 40, 1.1);
        fx.bits(land.bx, land.by - 12, [P.gold1, P.gold2, P.cream, P.g4], 22);
        p.scouts.forEach((m, i) => {
          hop(m, i * 0.1);
          emote(m, "banner", 2);
        });
      }
    }
  }
  for (const done of lands.update(dt)) landChanged(done);
  // A spreading colour throws a few sparks along its edge.
  for (const s of lands.spreads) {
    if (Math.random() > dt * 40) continue;
    const a = Math.random() * 6.283;
    const x = s.ox + Math.cos(a) * s.r;
    const y = s.oy + Math.sin(a) * s.r;
    if (lands.ownerAt(Math.round(x), Math.round(y)) >= 0) fx.sparks(x, y, s.to === 0 ? [P.gold2, P.cream] : [P.coral, P.rose], 1, 6);
  }
  LANDS.forEach((_, i) => {
    if (pushes.some((p) => p.land === i && p.phase === "claim")) return;
    const f = flags[i] as (typeof flags)[number];
    const want = flagWant[i] as Owner;
    if (want === 1) f.h = Math.max(0, f.h - dt * 0.9);
    else if (f.col !== want) {
      f.h -= dt * 1.1;
      if (f.h <= 0) {
        f.h = 0;
        f.col = want;
      }
    } else f.h = Math.min(1, f.h + dt * 0.8);
  });
  for (let i = pushes.length - 1; i >= 0; i--) if ((pushes[i] as Push).phase === "done") pushes.splice(i, 1);
}

function landChanged(i: number): void {
  const land = LANDS[i] as (typeof LANDS)[number];
  const now = lands.owner[i] as Owner;
  const push = pushes.find((p) => p.land === i);
  if (now === 0) {
    hooks.feed({
      icon: "banner",
      html: `The guild holds <i>${land.name}</i> · ${lands.held()} lands${push ? `, thanks to <b>${names(push.scouts)}</b>` : ""}`,
      x: land.bx,
      y: land.by,
    });
    cheer(land.bx, land.by, 60, "banner");
    cheer(NODES.town.x, NODES.town.y, 70, "banner");
  } else {
    hooks.feed({
      icon: "banner",
      html: now === 2 ? `${RIVAL[0]?.toUpperCase()}${RIVAL.slice(1)} raised a flag over <i>${land.name}</i>` : `<i>${land.name}</i> slipped back to the wilds`,
      x: land.bx,
      y: land.by,
    });
  }
  if (push) {
    push.phase = "done";
    push.scouts.forEach((m, n) => {
      m.busy = "";
      m.wander = 2.5 + n * 1.5;
    });
  }
  hooks.quests();
}

/** A border land the guild holds goes back to the wilds or to the rival: nobody fights for it, the map just shows it. */
function drift(): boolean {
  if (lands.held() < 13) return false;
  const options = LANDS.map((l, i) => ({ l, i })).filter(
    ({ l, i }) => l.node && lands.owner[i] === 0 && !pushes.some((p) => p.land === i) && !lands.spreads.some((s) => s.land === i),
  );
  if (options.length === 0) return false;
  const { l, i } = pick(options);
  const to: Owner = Math.random() < 0.5 ? 2 : 1;
  flagWant[i] = to;
  lands.begin(i, l.bx, l.by, to);
  sfx.down();
  return true;
}

// ---------- the rest of what happens ----------

export const works = { ready: 0, planks: 12 };
export const quests = [
  { id: "raids", title: "Bring home three lanterns", text: "Clear three raids with guild-mates.", have: 3, need: 3, reward: 30, claimed: false },
  { id: "lands", title: "Hold fourteen lands at once", text: "The guild's banners, counted at dusk.", have: 13, need: 14, reward: 20, claimed: false },
  { id: "planks", title: "Ship twenty planks", text: "From your Works to the guild stores.", have: 12, need: 20, reward: 15, claimed: false },
];
export function refreshQuests(): void {
  const held = quests[1] as (typeof quests)[number];
  held.have = Math.max(held.have, lands.held());
  (quests[2] as (typeof quests)[number]).have = Math.min(20, works.planks);
}

export function gainLeaf(n: number): void {
  state.leaf += n;
  hooks.purse("leaf", n);
}
export function gainCoins(n: number): void {
  state.coins += n;
  hooks.purse("coins", n);
}

export function levelUp(m: Member): void {
  m.level++;
  fx.sparks(m.x, m.y - 12, [P.gold2, P.cream, P.amber], 22, 38);
  fx.ring(m.x, m.y - 6, P.gold2, 18, 0.7);
  fx.float(m.x, m.y - 20, `Lv ${m.level}`, P.gold2, ICONS.star);
  hop(m);
  emote(m, "star", 2);
  sfx.level();
  cheer(m.x, m.y, 30, "hand");
  hooks.feed({ icon: "star", html: `<b>${m.name}</b> reached level ${m.level}`, x: m.x, y: m.y, who: m });
}

function worksShip(): void {
  works.ready += 45;
  works.planks = Math.min(20, works.planks + 4);
  fx.float(WORKS.x, WORKS.y - 34, "+45", P.gold2, ICONS.coin);
  fx.sparks(WORKS.x, WORKS.y - 10, [P.gold1, P.cream], 8, 20);
  hooks.feed({ icon: "cog", html: "Your Works shipped a crate of planks · 45 Coins waiting", x: WORKS.x, y: WORKS.y - 12 });
  refreshQuests();
  hooks.quests();
}

const VISIT = ["left you a pinecone", "nice tent. very striped", "just checking the fire's lit", "I brought moss. For the look."];
function visit(m: Member, line = pick(VISIT)): void {
  m.busy = "visit";
  send(m, "camp", {
    seconds: 8,
    then: () => {
      emote(m, "heart", 2.2);
      setTimeout(() => say(m, line, 3.4), 900);
      fx.sparks(m.x, m.y - 12, [P.coral, P.rose, P.cream], 8, 16);
      hooks.feed({ icon: "heart", html: `<b>${m.name}</b> stopped by your camp`, x: CAMP.x + 8, y: CAMP.y, who: m });
      m.busy = "";
      m.wander = 5;
    },
  });
}

/** Someone comes over to say hello, a moment after the member is home. */
export function welcome(): void {
  const idle = free();
  if (idle.length) visit(pick(idle), "welcome back! we kept the fire going");
}

const ROTA = ["level", "raid", "works", "push", "visit", "raid", "level", "drift"] as const;
let rota = 0;
let nextEvent = 15;
function tryEvent(kind: (typeof ROTA)[number]): boolean {
  const idle = free();
  switch (kind) {
    case "level":
      if (idle.length === 0) return false;
      levelUp(pick(members.filter((m) => !m.you)));
      return true;
    case "works":
      worksShip();
      return true;
    case "visit": {
      if (idle.length < 3 || you.at !== "camp") return false;
      visit(pick(idle));
      return true;
    }
    case "raid": {
      if (idle.length < 6 || raids.length >= 2) return false;
      const open = (Object.keys(GATES) as GateId[]).filter((id) => !raids.some((r) => r.gate === id));
      const gate = pick(open);
      const party = [...idle].sort(() => Math.random() - 0.5).slice(0, 4);
      startRaid(gate, party);
      say(party[0] as Member, pick(["raid time. boots on!", `${GATES[gate].name}, anyone?`, "four of us. perfect"]), 2.8);
      hooks.feed({ icon: "pin", html: `<b>${names(party)}</b> set out for <i>${GATES[gate].name}</i>`, x: GATES[gate].x, y: GATES[gate].y });
      return true;
    }
    case "push": {
      if (idle.length < 5 || pushes.length > 0) return false;
      const options = LANDS.map((l, i) => ({ l, i })).filter(({ l, i }) => l.node && lands.owner[i] !== 0 && !lands.spreads.some((s) => s.land === i));
      if (options.length === 0) return false;
      const { l, i } = pick(options);
      const scouts = [...idle].sort(() => Math.random() - 0.5).slice(0, 3);
      startPush(i, scouts);
      hooks.feed({ icon: "pin", html: `Scouts <b>${names(scouts)}</b> set out for <i>${l.name}</i>`, x: l.bx, y: l.by });
      return true;
    }
    case "drift":
      return drift();
  }
}

/** Makes something happen now, for looking at it. */
export function force(kind: (typeof ROTA)[number]): boolean {
  return tryEvent(kind);
}

const LINES = [
  "who moved the campfire two blocks left",
  "crab count: still one short",
  "anyone seen my other boot?",
  "the redwoods look taller today",
  "proud of us, honestly",
  "Cinfy says the vault is 'mostly' locked",
  "I baked. It is mostly bread.",
  "good raid, good people",
  "save me a seat by the fire",
  "the Works is humming tonight",
  "I walked here. On purpose.",
  "leaf by leaf, friends",
  "that lantern is definitely mine",
  "is it dusk again already",
  "someone feed the crabs",
  "new banner looks sharp",
  "I got lost. It was lovely.",
  "tea's on if anyone wants it",
];
const LEISURE: NodeId[] = ["fire", "fire", "fire", "fire", "market", "market", "market", "board", "board", "treasury", "town", "works", "works", "pond", "pond", "mill"];
let nextChat = 4;

// ---------- crabs ----------

export type Crab = { n: number; x: number; y: number; tx: number; ty: number; wait: number; hop: number };
export const crabs: Crab[] = [];
const CRABS = 9;
const pondSpot = (): { x: number; y: number } => {
  const a = Math.random() * 6.283;
  const k = 1.22 + Math.random() * 0.36;
  return { x: POND.x + Math.cos(a) * POND.rx * k, y: POND.y + Math.sin(a) * POND.ry * k * 1.25 };
};
/** Where the one crab that is never at roll call has got to. */
export const HIDES = [
  { x: 486, y: 318, where: "behind the Treasury" },
  { x: 921, y: 136, where: "under the lighthouse" },
  { x: 240, y: 134, where: "beside the Gloamgate" },
  { x: 978, y: 322, where: "on the island" },
  { x: 150, y: 262, where: "in the windmill's shadow" },
  { x: 112, y: 440, where: "among the standing stones" },
  { x: 664, y: 306, where: "on a crate at the Works" },
  { x: 500, y: 478, where: "under the south bridge" },
];
export const stray = { n: 7, spot: 0, x: 486, y: 318, hop: 0, found: 0 };
for (let n = 1; n <= CRABS; n++) {
  if (n === stray.n) continue;
  const p = pondSpot();
  crabs.push({ n, ...p, tx: p.x, ty: p.y, wait: Math.random() * 3, hop: 0 });
}

export function crabsHop(): void {
  crabs.forEach((c, i) => {
    c.hop = 0.5 + i * 0.07;
  });
}

/** The stray is found: it is counted at last, and at once another slips away. */
export function findStray(): { found: number; gone: number; where: string } {
  const found = stray.n;
  const where = (HIDES[stray.spot] as (typeof HIDES)[number]).where;
  const gone = (pick(crabs) as Crab).n;
  const leaving = crabs.findIndex((c) => c.n === gone);
  crabs.splice(leaving, 1);
  const p = pondSpot();
  crabs.push({ n: found, x: POND.x - POND.rx * 2, y: POND.y + 4, tx: p.x, ty: p.y, wait: 0, hop: 0.6 });
  fx.sparks(stray.x, stray.y - 2, [P.coral, P.cream, P.gold2], 14, 30);
  fx.float(stray.x, stray.y - 10, `No. ${found}!`, P.coral, ICONS.crab);
  stray.n = gone;
  stray.spot = (stray.spot + 1 + Math.floor(Math.random() * (HIDES.length - 1))) % HIDES.length;
  const h = HIDES[stray.spot] as (typeof HIDES)[number];
  stray.x = h.x;
  stray.y = h.y;
  stray.found++;
  return { found, gone, where };
}

function updateCrabs(dt: number): void {
  for (const c of crabs) {
    if (c.hop > 0) c.hop -= dt;
    const d = Math.hypot(c.tx - c.x, c.ty - c.y);
    if (d < 0.6) {
      c.wait -= dt;
      if (c.wait <= 0) {
        const p = pondSpot();
        c.tx = p.x;
        c.ty = p.y;
        c.wait = 1 + Math.random() * 4;
      }
    } else {
      const v = Math.min(d, 10 * dt);
      c.x += ((c.tx - c.x) / d) * v;
      c.y += ((c.ty - c.y) / d) * v;
    }
  }
  if (stray.hop > 0) stray.hop -= dt;
}

// ---------- things bought at the Treasury, which land at the camp ----------

export type ShopId = "lantern" | "sapling" | "snacks";
export const SHOP: { id: ShopId; name: string; text: string; cost: number; icon: IconId; once: boolean }[] = [
  { id: "lantern", name: "A lantern for your camp", text: "Hand-blown. Slightly crooked. Glows all night.", cost: 40, icon: "lantern", once: true },
  { id: "sapling", name: "A redwood sapling", text: "Plant it by your tent. Check back in a thousand years.", cost: 60, icon: "leaf", once: true },
  { id: "snacks", name: "A bag of crab snacks", text: "For the pond. The crabs will remember this.", cost: 10, icon: "crab", once: false },
];
export const owned = { lantern: false, sapling: false, snacks: 0, saplingAge: 0 };
export const DROP_AT: Record<ShopId, { x: number; y: number }> = {
  lantern: { x: CAMP.x + 26, y: CAMP.y - 2 },
  sapling: { x: CAMP.x - 24, y: CAMP.y + 12 },
  snacks: { x: POND.x - POND.rx - 6, y: POND.y + 8 },
};
export const drops: { id: ShopId; t: number }[] = [];

/** Pays for a thing; false if the purse is short or it is already owned. */
export function buy(id: ShopId): boolean {
  const item = SHOP.find((s) => s.id === id) as (typeof SHOP)[number];
  if (state.leaf < item.cost) return false;
  if (item.once && (id === "lantern" ? owned.lantern : owned.sapling)) return false;
  state.leaf -= item.cost;
  hooks.purse("leaf", -item.cost);
  return true;
}
/** The bought thing comes down out of the sky where it belongs. */
export function deliver(id: ShopId): void {
  drops.push({ id, t: 0 });
}
function updateDrops(dt: number): void {
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i] as (typeof drops)[number];
    const before = d.t;
    d.t += dt;
    const at = DROP_AT[d.id];
    if (before < 0.55 && d.t >= 0.55) {
      sfx.thud();
      fx.dust(at.x, at.y, 8);
      fx.sparks(at.x, at.y - 4, [P.gold2, P.cream, P.g4], 16, 30);
      fx.ring(at.x, at.y, P.gold2, 16, 0.6);
      if (d.id === "lantern") owned.lantern = true;
      if (d.id === "sapling") owned.sapling = true;
      if (d.id === "snacks") {
        owned.snacks++;
        crabsHop();
        for (const c of crabs) {
          c.tx = at.x + (Math.random() - 0.5) * 12;
          c.ty = at.y + (Math.random() - 0.5) * 6;
          c.wait = 3 + Math.random() * 2;
        }
        fx.float(at.x, at.y - 14, "crab joy", P.coral, ICONS.heart);
      }
    }
    if (d.t > 1.4) drops.splice(i, 1);
  }
  if (owned.sapling) owned.saplingAge += dt;
}

// ---------- the whole evening, one moment on ----------

export function init(l: Lands): void {
  lands = l;
  refreshQuests();
  // As the member arrives: one party is at a gate with the ring part-filled, and scouts are on the road.
  startRaid("gateB", members.slice(1, 5), 0.42, true);
  startPush(11, members.slice(5, 8));
}

export function update(dt: number): void {
  state.T += dt;
  for (const m of members) {
    if (state.live || m.you) stepWalk(m, dt);
    if (m.sayT > 0) m.sayT -= dt;
    if (m.emoteT > 0) m.emoteT -= dt;
    if (m.hop > 0) m.hop -= dt;
  }
  if (cinfy.sayT > 0) cinfy.sayT -= dt;
  if (cinfy.emoteT > 0) cinfy.emoteT -= dt;
  if (cinfy.hop > 0) cinfy.hop -= dt;
  for (const l of lanterns) l.swing = Math.max(0, l.swing - dt * 0.5);
  updateCrabs(dt);
  updateDrops(dt);
  if (!state.live) return;

  updateRaids(dt);
  updatePushes(dt);

  works.ready += dt * 0.5;
  nextChat -= dt;
  if (nextChat <= 0) {
    nextChat = 4.5 + Math.random() * 4;
    const quiet = members.filter((m) => !m.you && !m.route && m.sayT <= 0);
    if (quiet.length) say(pick(quiet), pick(LINES));
  }
  for (const m of members) {
    if (m.you || m.busy !== "" || m.route) continue;
    m.wander -= dt;
    if (m.wander > 0) continue;
    m.wander = 14 + Math.random() * 24;
    const options = LEISURE.filter((n) => n !== m.at);
    send(m, pick(options));
  }
  if (state.T >= nextEvent) {
    nextEvent = state.T + 5;
    for (let tries = 0; tries < ROTA.length; tries++) {
      const kind = ROTA[rota++ % ROTA.length] as (typeof ROTA)[number];
      if (tryEvent(kind)) {
        nextEvent = state.T + 15 + Math.random() * 6;
        break;
      }
    }
  }
}

/** The member steps out of their tent: the evening starts moving. */
export function goLive(): void {
  state.live = true;
  state.T = 0;
  nextEvent = 15;
}
