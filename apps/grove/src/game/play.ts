/**
 * The game as it is played in the grove: everything the player can touch, and what the world does
 * back. The rules are in `state.ts`; this is the hand that carries them out where they can be seen.
 *
 * Nothing here is a screen effect. A tree that is shaken sheds leaves, rain falls from a cloud, a
 * cone is carried to the fire and burns through the colours of the ranks, a tree that grows swells
 * out of its old self, and whoever lives in the grove turns to watch.
 */
import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { cloud, cone, critter, tallOf } from "../art/critters.ts";
import { paintTile, tileIndex } from "../art/tiles.ts";
import { type Actor, draw, flames } from "../engine/actors.ts";
import { B, BLOCKS } from "../engine/blocks.ts";
import { Particles } from "../engine/particles.ts";
import type { Stage } from "../engine/render.ts";
import { World } from "../engine/world.ts";
import { C, type Home, plant, SIZE, treeGirth, treeHeight } from "../gen/home.ts";
import { hud } from "./hud.ts";
import { sfx, sound } from "./sfx.ts";
import { type Kind, KINDS, RANK_BONUS, RANK_COLOUR, RANKS } from "./spirits.ts";
import * as game from "./state.ts";

type V3 = [number, number, number];
export interface View {
  eye: V3;
  at: V3;
  fov: number;
}
export interface Play {
  frame(now: number, dt: number, time: number): void;
  /** Whether the player has the camera, or a ceremony does. */
  readonly free: boolean;
  /** Puts the grove in a given state, for review. */
  set(next: game.Save): void;
  /** Taps the world at a point of the screen, as a finger would. */
  tap(x: number, y: number): void;
  /** Carries the first waiting cone to the fire, for review. */
  burn(): void;
}

const LEAVES = ["#2f5c34", "#3b7340", "#4b8c4a", "#62a658"];
const GOLD = ["#fff3cf", "#ffd98a", "#f5b95e"];
const ease = (t: number): number => t * t * (3 - 2 * t);
const out = (t: number): number => 1 - (1 - t) ** 3;
/** Past the mark and back: a thing arriving with a little bounce. */
const back = (t: number): number => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
const mix = (a: V3, b: V3, k: number): V3 => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];
const rgb = (hex: string): V3 => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as V3;

interface Spirit {
  readonly kind: Kind;
  readonly actor: Actor;
  /** Where it lives, and extra height and spin the game adds to its own idle life. */
  readonly home: V3;
  lift: number;
  spin: number;
  /** When it was last petted or last cheered, in seconds; it hops for a moment after. */
  glad: number;
  size: number;
}
interface Cone {
  readonly actor: Actor;
  slot: number;
  /** Lying still and able to be picked up. */
  resting: boolean;
}

export function play(ctx: {
  canvas: HTMLCanvasElement;
  stage: Stage;
  controls: OrbitControls;
  world: World;
  home: Home;
  night: number;
}): Play {
  const { canvas, stage: s, controls, world, home } = ctx;
  const G = home.ground;
  const centre: V3 = [C + 0.5, G, C + 0.5];
  const fire = home.fire;
  const parts = new Particles();
  s.scene.add(parts.points);

  // The grove as it was left, with what it made since.
  const away = game.advance(game.load(localStorage, Date.now()), Date.now());
  let save = away.save;
  let clock = 0;
  let lastTouch = 0;
  let busy = false;
  let touched = 0;

  // ---------- small machinery: things that take time ----------

  interface Tween {
    wait: number;
    t: number;
    dur: number;
    fn: (k: number) => void;
    then?: () => void;
  }
  const tweens: Tween[] = [];
  const run = (dur: number, fn: (k: number) => void, then?: () => void, wait = 0): void => {
    tweens.push({ wait, t: 0, dur, fn, ...(then ? { then } : {}) });
  };
  const after = (wait: number, fn: () => void): void => run(0.0001, () => {}, fn, wait);

  // ---------- the camera ----------

  const hero = (level: number): View => {
    // Down on the foot of the tree and the fire from the fire's side, the fire in the lower half of the
    // picture and clear of the buttons; a step further back as the tree grows.
    const d = 14 + level * 0.8;
    const at: V3 = [C + 4.4, G + 1.4 + level * 0.12, C + 3.8];
    return { eye: [at[0] + d * 0.4, at[1] + d * 0.56, at[2] + d * 0.74], at, fov: 46 };
  };
  let flying = 0;
  const place = (v: View): void => {
    s.camera.position.set(...v.eye);
    controls.target.set(...v.at);
    s.camera.fov = v.fov;
    s.camera.updateProjectionMatrix();
    s.camera.lookAt(...v.at);
  };
  /** Carries the camera to a view over `secs`. */
  const go = (to: View, secs: number, then?: () => void): void => {
    const from: View = {
      eye: s.camera.position.toArray() as V3,
      at: controls.target.toArray() as V3,
      fov: s.camera.fov,
    };
    flying++;
    run(
      secs,
      (k) => {
        const e = ease(k);
        place({ eye: mix(from.eye, to.eye, e), at: mix(from.at, to.at, e), fov: from.fov + (to.fov - from.fov) * e });
      },
      () => {
        flying--;
        controls.update();
        then?.();
      },
    );
  };
  place(hero(save.level));
  controls.update();
  /** A point of the world as a point of the page. */
  const screen = (p: V3): [number, number] => {
    const v = new THREE.Vector3(...p).project(s.camera);
    const r = canvas.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  };

  // ---------- the interface ----------

  const portrait = (id: string): HTMLCanvasElement => {
    const c = document.createElement("canvas");
    c.width = c.height = 16;
    const px = paintTile(id === "leafling" ? "leafling_face" : `cr_face_${id}`);
    const img = new ImageData(16, 16);
    img.data.set(px);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    c.getContext("2d")!.putImageData(img, 0, 0);
    return c;
  };
  const face = hud(document.querySelector<HTMLElement>("#hud")!, {
    water: () => rain(),
    grow: () => growTree(),
    forage: () => forage(),
    sound: (on) => {
      sound.on = on;
      if (on) sfx.sap();
    },
    get soundOn() {
      return sound.on;
    },
    portrait,
  });
  const keep = (): void => {
    game.store(localStorage, save);
    show();
  };
  const show = (): void => {
    face.show(save, Date.now());
    const cost = game.growCost(save);
    face.hint(
      busy
        ? null
        : save.opened === 0 && save.cones > 0
          ? "Tap the cone lying by your tree"
          : save.level === 0 && cost !== null && save.sap >= cost
            ? "You have the Sap: grow your tree"
            : touched < 3
              ? "Tap anything: the tree, the fire, a flower"
              : null,
    );
  };
  const setBusy = (is: boolean): void => {
    busy = is;
    face.busy(is);
    controls.enabled = !is;
    show();
  };

  // ---------- who lives here ----------

  const spirits = new Map<string, Spirit>();
  const settle = (k: Kind, at?: V3): Spirit => {
    const spot = home.spots[KINDS.indexOf(k) % home.spots.length]!;
    const pos: V3 = at ? [...at] : [...spot];
    const sp: Spirit = {
      kind: k,
      actor: critter(k.id, pos, Math.atan2(fire[0] - spot[0], fire[2] - spot[2]), KINDS.indexOf(k) * 1.7),
      home: [...spot],
      lift: 0,
      spin: 0,
      glad: -9,
      size: 1,
    };
    spirits.set(k.id, sp);
    return sp;
  };
  for (const k of KINDS) if (save.spirits[k.id]) settle(k);
  /** Everyone hops for a moment, a little after one another. */
  const cheer = (): void => {
    let i = 0;
    for (const sp of spirits.values()) sp.glad = clock + i++ * 0.07;
  };
  /** Everyone turns to look at a point for a few seconds. */
  let gaze: { at: V3; until: number } | null = null;
  const look = (at: V3, secs: number): void => {
    gaze = { at, until: clock + secs };
  };

  // ---------- cones ----------

  const cones: Cone[] = [];
  const lay = (c: Cone): void => {
    for (const p of c.actor.parts) p.rot = [1.45, 0, 0];
    c.actor.scale = 1.7;
  };
  const freeSlot = (): number => home.rest.findIndex((_, i) => !cones.some((c) => c.slot === i));
  for (let i = 0; i < save.cones; i++) {
    const c: Cone = { actor: cone([...home.rest[i % home.rest.length]!]), slot: i % home.rest.length, resting: true };
    lay(c);
    cones.push(c);
  }
  /** A cone falls from the crown, bounces and comes to rest by the tree's foot. */
  const dropCone = (): void => {
    const slot = Math.max(0, freeSlot());
    const to = home.rest[slot]!;
    const from: V3 = [to[0] - 1.2, G + Math.min(treeHeight(save.level) * 0.8, 13), to[2] - 1.2];
    const c: Cone = { actor: cone([...from]), slot, resting: false };
    c.actor.scale = 1.7;
    cones.push(c);
    let bounced = 0;
    run(
      1.25,
      (k) => {
        // A fall, then two bounces, each lower than the last.
        const t = k * 1.25;
        const h =
          t < 0.6
            ? 1 - (t / 0.6) ** 2
            : t < 0.95
              ? 0.16 * Math.sin(((t - 0.6) / 0.35) * Math.PI)
              : 0.05 * Math.sin(((t - 0.95) / 0.3) * Math.PI);
        const along = Math.min(1, t / 0.6);
        c.actor.pos[0] = from[0] + (to[0] - from[0]) * along;
        c.actor.pos[2] = from[2] + (to[2] - from[2]) * along;
        c.actor.pos[1] = G + (from[1] - G) * Math.max(0, h);
        for (const p of c.actor.parts) p.rot = [t * 9 * (1 - k) + 1.45 * k, 0, t * 4 * (1 - k)];
        const hits = t >= 0.95 ? 2 : t >= 0.6 ? 1 : 0;
        if (hits > bounced) {
          bounced = hits;
          sfx.tok();
          parts.emit({
            at: [to[0], G + 0.05, to[2]],
            n: 8,
            speed: 1.6,
            flat: 0.7,
            life: 0.5,
            size: 1.2,
            colours: ["#6a4418", "#8b5920", "#523c18"],
            gravity: 5,
          });
        }
      },
      () => {
        c.resting = true;
        lay(c);
        show();
      },
    );
  };

  // ---------- things to find ----------

  const finds = home.finds.map((f) => ({ ...f, tile: tileIndex(f.tile), back: 0, born: -9 }));
  const light = new Float32Array(2);
  const sheets = (at: V3, tile: number, size: number, lean: number): void => {
    world.lightAt(at[0], at[1] + 0.5, at[2], light);
    const uv = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ] as const;
    for (const [ax, az] of [
      [0.4, 0.4],
      [0.4, -0.4],
    ] as const) {
      const p: V3[] = [
        [at[0] - ax * size, at[1], at[2] - az * size],
        [at[0] + ax * size, at[1], at[2] + az * size],
        [at[0] + ax * size + lean, at[1] + size, at[2] + az * size],
        [at[0] - ax * size + lean, at[1] + size, at[2] - az * size],
      ];
      s.dyn.quad(p, uv, tile, 0, [0, 1, 0], light[0]! / 15, light[1]! / 15, 1);
      s.dyn.quad(
        [p[1]!, p[0]!, p[3]!, p[2]!],
        [uv[1], uv[0], uv[3], uv[2]],
        tile,
        0,
        [0, 1, 0],
        light[0]! / 15,
        light[1]! / 15,
        1,
      );
    }
  };

  // ---------- the fire ----------

  /** How big the flames are, and what the fire is doing to the grove's light, each easing back to rest. */
  let flame = 1;
  let power = 1;
  let tint: V3 = [1, 0.58, 0.24];
  let tinted = 0;
  const sparks = (n: number, colours: readonly string[], speed = 2.4): void =>
    parts.emit({
      at: [fire[0], fire[1] + 0.7, fire[2]],
      n,
      spread: 0.25,
      push: [0, 2.2, 0],
      speed,
      life: 1.1,
      size: 1.3,
      colours,
      gravity: -0.8,
      drag: 0.8,
      glow: true,
    });
  const stokeFire = (x: number, y: number): void => {
    const was = save.stoked > Date.now();
    save = game.stoke(save, Date.now());
    flame = 1.9;
    power = 2.3;
    sparks(46, ["#fff3cf", "#f5b95e", "#f08a3c", "#e67967"], 3.4);
    sfx.crackle();
    cheer();
    look(fire, 1.5);
    face.pop(x, y, was ? "Stoked again" : "Stoked ×1.5", "#ffd98a");
    keep();
  };

  // ---------- the tree ----------

  /** How lively the leaves are, 0 at rest; it dies away by itself. */
  let gust = 0;
  /** Leaves fall from the crown, or from as high as the eye can see of it. */
  const shed = (n: number, wide: number): void => {
    const h = treeHeight(save.level);
    const top = G + Math.min(h, 15);
    parts.emit({
      at: [centre[0], top - Math.min(h, 15) * 0.25, centre[2]],
      n,
      spread: [wide, Math.min(h, 15) * 0.25, wide],
      push: [0.3, -0.6, 0.2],
      speed: 0.9,
      life: 3.2,
      size: 1.6,
      colours: LEAVES,
      gravity: 2.2,
      drag: 1.6,
      floor: G + 0.03,
    });
  };
  const shake = (at: V3, x: number, y: number): void => {
    gust = Math.max(gust, 1);
    shed(14, Math.max(2.5, treeGirth(save.level) * 1.2 + 2));
    // Flakes of bark and drops of sap where the hand fell.
    parts.emit({
      at,
      n: 7,
      spread: 0.2,
      speed: 1.8,
      life: 0.7,
      size: 1.1,
      colours: ["#8a4a30", "#6f3826", "#a35d3b"],
      gravity: 7,
    });
    parts.emit({
      at,
      n: 5,
      spread: 0.15,
      speed: 1.4,
      push: [0, 1.6, 0],
      life: 0.8,
      size: 1.2,
      colours: GOLD,
      gravity: 3,
      glow: true,
    });
    const n = game.tapGain(save);
    save = game.tap(save);
    face.fly(x, y, Math.min(7, 3 + Math.floor(Math.log10(n + 1) * 2)));
    face.pop(x, y, `+${game.short(n)}`);
    sfx.rustle();
    sfx.sap();
    show();
  };

  // ---------- rain ----------

  let raining = false;
  let sky: Actor | null = null;
  function rain(): void {
    if (raining || busy) return;
    const done = game.water(save);
    if (!done) {
      sfx.no();
      face.toast("No water yet: it comes back by itself");
      return;
    }
    raining = true;
    const h = treeHeight(save.level);
    // Where it can be seen: over the tree if the tree is small, else in front of the trunk on the eye's side.
    const reach = h < 7 ? 0.5 : treeGirth(save.level) + 2.2;
    const over: V3 = [centre[0] + reach * 0.5, G + Math.min(h + 1.5, 6.5), centre[2] + reach * 0.86];
    const from: V3 = [over[0] - 16, over[1] + 3, over[2] - 6];
    const c = cloud([...from]);
    c.scale = 0.2;
    sky = c;
    sfx.whoosh();
    look(over, 3.4);
    run(
      0.7,
      (k) => {
        c.pos = mix(from, over, out(k));
        c.scale = 0.2 + 0.8 * back(k);
      },
      () => {
        sfx.rain(1.8);
        save = done.save;
        gust = Math.max(gust, 0.5);
        const [bx, by] = screen([centre[0], G + 1.2, centre[2] + treeGirth(save.level) + 1]);
        face.fly(bx, by, 6);
        face.pop(bx, by, `+${game.short(game.waterGain(save))}`, "#cfe6ff");
        keep();
        run(
          1.7,
          (k) => {
            c.pos[1] = over[1] + Math.sin(k * 20) * 0.04;
            // Drops from the cloud's belly, and a splash where each would land.
            parts.emit({
              at: [c.pos[0], c.pos[1], c.pos[2]],
              n: 5,
              spread: [1.3, 0, 0.5],
              push: [0, -7, 0],
              life: 1.1,
              size: 1,
              colours: ["#7fb6e6", "#cfe6ff", "#5a8fc8"],
              gravity: 16,
              floor: G + 0.02,
            });
            if (k > 0.25)
              parts.emit({
                at: [c.pos[0], G + 0.05, c.pos[2]],
                n: 2,
                spread: [1.6, 0, 0.9],
                speed: 1.1,
                push: [0, 1.2, 0],
                life: 0.35,
                size: 0.9,
                colours: ["#cfe6ff", "#f7f7f7"],
                gravity: 6,
              });
            gust = Math.max(gust, 0.35);
          },
          () => {
            const to: V3 = [over[0] + 14, over[1] + 4, over[2] - 4];
            run(
              0.8,
              (k) => {
                c.pos = mix(over, to, ease(k));
                c.scale = 1 - k * 0.8;
              },
              () => {
                sky = null;
                raining = false;
                show();
              },
            );
            if (done.cone) {
              face.banner("Bloom", "A cone fell", "Carry it to the fire: tap it", "#ffd98a");
              gust = 1;
              shed(10, 3);
              dropCone();
            }
          },
        );
      },
    );
    show();
  }
  function forage(): void {
    if (busy) return;
    const next = game.forage(save);
    if (!next) {
      sfx.no();
      return;
    }
    save = next;
    gust = Math.max(gust, 0.8);
    sfx.rustle();
    shed(8, 3);
    dropCone();
    keep();
  }

  // ---------- opening a cone in the fire ----------

  function burn(c: Cone): void {
    const opened = game.open(save, Math.random(), Math.random());
    if (!opened || busy) return;
    const before = game.rate(save);
    save = opened.save;
    game.store(localStorage, save);
    setBusy(true);
    c.resting = false;
    const rank = opened.kind.rank;
    const from: V3 = [...c.actor.pos];
    const seat: V3 = [fire[0], fire[1] + 0.55, fire[2]];
    sfx.whoosh();
    look(fire, 30);
    go({ eye: [fire[0] + 3.3, fire[1] + 2.5, fire[2] + 6], at: [fire[0], fire[1] + 1.25, fire[2]], fov: 42 }, 0.9);
    // It is tossed to the fire in an arc, turning over as it goes.
    run(
      0.75,
      (k) => {
        const p = mix(from, seat, k);
        c.actor.pos = [p[0], p[1] + Math.sin(k * Math.PI) * 2.4, p[2]];
        for (const part of c.actor.parts) part.rot = [1.45 + k * 12, 0, k * 5];
      },
      () => {
        sfx.thud();
        sparks(18, ["#f5b95e", "#f08a3c"]);
        flame = 1.5;
        // It burns up through the ranks, one beat for each, to the one it holds.
        const beat = 0.55;
        for (let i = 0; i <= rank; i++)
          after(0.25 + i * beat, () => {
            tint = rgb(RANK_COLOUR[i]!);
            tinted = 1;
            flame = 1.5 + i * 0.22;
            power = 1.6 + i * 0.3;
            sfx.step(i);
            parts.emit({
              at: [fire[0], fire[1] + 0.5, fire[2]],
              n: 22 + i * 6,
              speed: 2.6 + i * 0.5,
              flat: 0.85,
              life: 0.7,
              size: 1.4,
              colours: [RANK_COLOUR[i]!, "#fff3cf"],
              drag: 1.5,
              glow: true,
            });
            sparks(8 + i * 3, [RANK_COLOUR[i]!, "#fff3cf"], 2 + i * 0.4);
            cheer();
          });
        const shiver = { on: true };
        run(0.25 + (rank + 1) * beat, (k) => {
          if (!shiver.on) return;
          const a = 0.02 + k * 0.05;
          c.actor.pos = [
            seat[0] + (Math.random() - 0.5) * a,
            seat[1] + (Math.random() - 0.5) * a,
            seat[2] + (Math.random() - 0.5) * a,
          ];
          c.actor.scale = 1 + k * 0.35;
        });
        after(0.25 + (rank + 1) * beat, () => {
          shiver.on = false;
          cones.splice(cones.indexOf(c), 1);
          const colour = RANK_COLOUR[rank]!;
          sfx.reveal(rank);
          power = 3.2;
          flame = 2.3;
          parts.emit({
            at: [fire[0], fire[1] + 0.8, fire[2]],
            n: 70 + rank * 22,
            speed: 4.5 + rank * 0.6,
            life: 1.2,
            size: 1.6,
            colours: [colour, colour, "#fff3cf"],
            gravity: 2.5,
            drag: 1.2,
            glow: true,
          });
          // What was in it rises out of the flames, turning, and takes its full size.
          const born = critter(opened.kind.id, [fire[0], fire[1] + 0.3, fire[2]], 0, 0);
          const guest: Spirit = {
            kind: opened.kind,
            actor: born,
            home: [...fire],
            lift: 0,
            spin: 0,
            glad: -9,
            size: 0,
          };
          arrival = guest;
          run(
            1.15,
            (k) => {
              born.pos[1] = fire[1] + 0.3 + out(k) * 1.55;
              guest.size = Math.max(0.01, back(k)) * 1.25;
              born.yaw = (1 - out(k)) * 12.6 + 0.5;
              parts.emit({
                at: [born.pos[0], born.pos[1] + 0.3, born.pos[2]],
                n: 2,
                spread: 0.3,
                speed: 0.6,
                life: 0.8,
                size: 1.1,
                colours: [colour, "#fff3cf"],
                gravity: 1.5,
                glow: true,
              });
            },
            () => {
              face.reveal(
                {
                  id: opened.kind.id,
                  name: opened.kind.name,
                  says: opened.kind.says,
                  rank,
                  isNew: opened.isNew,
                  hearts: opened.hearts,
                  gift: opened.gift,
                },
                () => arrive(guest, opened, before),
              );
            },
          );
        });
      },
    );
  }
  /** A spirit just out of the fire, not yet at home. */
  let arrival: Spirit | null = null;
  /** After its card is read: a new spirit hops to its place; one already here joins its own and their bond shows. */
  function arrive(guest: Spirit, o: game.Opened, before: number): void {
    const old = spirits.get(o.kind.id);
    const k = o.kind;
    const spot = home.spots[KINDS.indexOf(k) % home.spots.length]!;
    const from: V3 = [...guest.actor.pos];
    const to: V3 = [spot[0], G, spot[2]];
    tinted = 0;
    sfx.whoosh();
    run(
      0.8,
      (t) => {
        const p = mix(from, to, ease(t));
        guest.actor.pos = [p[0], p[1] + Math.sin(t * Math.PI) * 1.4, p[2]];
        guest.size = old ? 1.25 - t * 1.2 : 1.25 - t * 0.25;
        guest.actor.yaw = Math.atan2(to[0] - from[0], to[2] - from[2]);
      },
      () => {
        arrival = null;
        const at: V3 = [to[0], G + 0.5, to[2]];
        if (old) {
          old.glad = clock;
          parts.emit({
            at,
            n: 16,
            spread: 0.3,
            push: [0, 1.6, 0],
            speed: 0.8,
            life: 1.1,
            size: 1.5,
            colours: ["#e67fb0", "#ff9fc8", "#fff3cf"],
            gravity: -0.6,
            glow: true,
          });
          sfx.pet();
        } else {
          const sp = settle(k);
          sp.glad = clock;
          parts.emit({
            at,
            n: 12,
            speed: 1.5,
            flat: 0.6,
            life: 0.6,
            size: 1.2,
            colours: ["#6a4418", "#4b8c4a", "#fff3cf"],
            gravity: 5,
          });
          sfx.thud();
        }
        cheer();
        const [x, y] = screen(at);
        if (o.gift) {
          face.fly(x, y, 8);
          face.pop(x, y, `+${game.short(o.gift)}`);
        } else face.pop(x, y, `+${Math.round((game.rate(save) / before - 1) * 100)}% sap`, RANK_COLOUR[k.rank]);
        if (o.isNew && k.rank >= 3)
          face.banner(
            RANKS[k.rank]!,
            k.name,
            `Adds ${Math.round(RANK_BONUS[k.rank]! * 100)}% to what your tree makes`,
            RANK_COLOUR[k.rank],
          );
        gaze = null;
        go(hero(save.level), 1.1, () => setBusy(false));
        keep();
      },
    );
  }

  // ---------- growing ----------

  /** The grove with the tree a ring older, built ahead of time a piece at a moment, so growing never waits. */
  const spare = new World(SIZE, world.sy, SIZE);
  let ahead: { level: number; planted: boolean; job: ReturnType<Stage["ahead"]> | null; ready: boolean } | null = null;
  const prepare = (): boolean => {
    if (save.level >= game.MAX_LEVEL && (!ahead || ahead.level !== save.level)) return true;
    if (!ahead || (ahead.level !== save.level + 1 && ahead.level !== save.level))
      ahead = { level: save.level + 1, planted: false, job: null, ready: false };
    if (ahead.ready) return true;
    if (!ahead.planted) {
      plant(spare, ahead.level);
      ahead.planted = true;
      ahead.job = s.ahead(spare);
    } else if (!ahead.job!.step()) ahead.ready = true;
    return ahead.ready;
  };
  /** Shows the world built ahead and makes it the one that is lit, walked on and touched. */
  const adopt = (): void => {
    ahead!.job!.swap();
    world.blocks.set(spare.blocks);
    world.sky.set(spare.sky);
    world.glow.set(spare.glow);
    ahead = null;
  };
  let size = 1;
  function growTree(): void {
    if (busy) return;
    const next = game.grow(save);
    if (!next) {
      sfx.no();
      return;
    }
    const before = game.rate(save);
    const old = treeHeight(save.level);
    ahead =
      ahead && ahead.level === save.level + 1
        ? ahead
        : { level: save.level + 1, planted: false, job: null, ready: false };
    save = next;
    game.store(localStorage, save);
    setBusy(true);
    sfx.grow();
    const tall = treeHeight(save.level);
    const girth = treeGirth(save.level - 1);
    look([centre[0], G + 3, centre[2]], 6);
    const v = hero(save.level);
    // The eye draws back and looks up the trunk while the tree gathers itself.
    go(
      {
        eye: [v.eye[0] + 2, v.eye[1] + 2 + Math.min(6, tall * 0.1), v.eye[2] + 5],
        at: [v.at[0] - 1.5, v.at[1] + Math.min(9, tall * 0.22), v.at[2] - 1.5],
        fov: 52,
      },
      1.1,
    );
    let waited = 0;
    const gather = (): void =>
      run(
        0.12,
        () => {
          // Gold rises round the foot of the tree, faster as the moment comes.
          const a = Math.random() * 6.283;
          const r = girth * 1.5 + 0.9;
          parts.emit({
            at: [centre[0] + Math.cos(a) * r, G + Math.random() * 0.6, centre[2] + Math.sin(a) * r],
            n: 2,
            push: [-Math.sin(a) * 1.6, 2.4 + waited * 1.5, Math.cos(a) * 1.6],
            life: 1.1,
            size: 1.3,
            colours: GOLD,
            gravity: -1.5,
            glow: true,
          });
          gust = Math.max(gust, 0.3 + waited * 0.3);
          prepare();
        },
        () => {
          waited += 0.12;
          if (waited < 1.1 || !prepare()) gather();
          else swell();
        },
      );
    const swell = (): void => {
      adopt();
      size = old / tall;
      gust = 1.6;
      sfx.thud();
      cheer();
      parts.emit({
        at: [centre[0], G + 0.3, centre[2]],
        n: 60,
        spread: [girth + 1, 0.2, girth + 1],
        speed: 3.2,
        flat: 0.5,
        push: [0, 2.5, 0],
        life: 1.3,
        size: 1.5,
        colours: GOLD,
        gravity: 2.5,
        glow: true,
      });
      face.banner(
        `Ring ${save.level + 1}`,
        game.stage(save.level),
        `+${game.short(Math.max(1, game.rate(save) - before))} sap a second`,
      );
      run(
        1.6,
        (k) => {
          // It swells out of its old size, past its new one by a hair, and settles.
          size = Math.min(1, old / tall + (1 - old / tall) * back(k));
          gust = Math.max(gust, 1.2 * (1 - k));
          if (k < 0.8) shed(3, Math.max(3, treeGirth(save.level) * 1.5 + 2.5));
        },
        () => {
          size = 1;
          gaze = null;
          go(hero(save.level), 1.3, () => setBusy(false));
          keep();
        },
      );
    };
    gather();
  }

  // ---------- touching the world ----------

  const caster = new THREE.Raycaster();
  /** The first block along a ray, by stepping from cell to cell. */
  const strike = (from: THREE.Vector3, dir: THREE.Vector3, far: number): { id: number; at: V3; t: number } | null => {
    const cell = [Math.floor(from.x), Math.floor(from.y), Math.floor(from.z)];
    const d = [dir.x, dir.y, dir.z];
    const o = [from.x, from.y, from.z];
    const step = d.map((v) => (v > 0 ? 1 : -1));
    const next = d.map((v, i) => (v === 0 ? Infinity : ((v > 0 ? cell[i]! + 1 : cell[i]!) - o[i]!) / v));
    const span = d.map((v) => (v === 0 ? Infinity : Math.abs(1 / v)));
    let t = 0;
    for (let n = 0; n < 400 && t < far; n++) {
      const id = world.get(cell[0]!, cell[1]!, cell[2]!);
      if (id || cell[1]! < 0) return { id, at: [o[0]! + d[0]! * t, o[1]! + d[1]! * t, o[2]! + d[2]! * t], t };
      const i = next[0]! < next[1]! ? (next[0]! < next[2]! ? 0 : 2) : next[1]! < next[2]! ? 1 : 2;
      t = next[i]!;
      next[i] = next[i]! + span[i]!;
      cell[i] = cell[i]! + step[i]!;
    }
    return null;
  };
  /** How far along a ray it passes within `r` of a point, or nothing. */
  const near = (from: THREE.Vector3, dir: THREE.Vector3, p: V3, r: number): number | null => {
    const to = new THREE.Vector3(...p).sub(from);
    const t = to.dot(dir);
    return t > 0 && to.lengthSq() - t * t < r * r ? t : null;
  };
  function tap(x: number, y: number): void {
    if (busy) return;
    touched++;
    const r = canvas.getBoundingClientRect();
    caster.setFromCamera(
      new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2),
      s.camera,
    );
    const { origin, direction } = caster.ray;
    const hit = strike(origin, direction, 140);
    let best = hit?.t ?? Infinity;
    let act: (() => void) | null = null;
    for (const sp of spirits.values()) {
      const tall = tallOf(sp.kind.id);
      const t = near(
        origin,
        direction,
        [sp.actor.pos[0], sp.actor.pos[1] + tall * 0.5 + sp.lift, sp.actor.pos[2]],
        0.5 + tall * 0.3,
      );
      if (t !== null && t < best + 0.6) {
        best = Math.min(best, t);
        act = () => pet(sp, x, y);
      }
    }
    for (const c of cones) {
      const t = c.resting
        ? near(origin, direction, [c.actor.pos[0], c.actor.pos[1] + 0.2, c.actor.pos[2]], 0.55)
        : null;
      if (t !== null && t < best + 0.6) {
        best = Math.min(best, t);
        act = () => burn(c);
      }
    }
    for (const f of finds) {
      const t = f.back <= clock ? near(origin, direction, [f.at[0], f.at[1] + 0.4, f.at[2]], 0.55) : null;
      if (t !== null && t < best + 0.6) {
        best = Math.min(best, t);
        act = () => {
          f.back = clock + 40 + Math.random() * 20;
          parts.emit({
            at: [f.at[0], f.at[1] + 0.5, f.at[2]],
            n: 14,
            speed: 2,
            push: [0, 1.8, 0],
            life: 0.9,
            size: 1.4,
            colours: f.petals,
            gravity: 4,
            drag: 1,
          });
          const n = game.findGain(save);
          save = game.find(save);
          face.fly(x, y, 4);
          face.pop(x, y, `+${game.short(n)}`);
          sfx.pick();
          show();
        };
      }
    }
    if (act) return act();
    if (!hit) return;
    const name = BLOCKS[hit.id]?.name ?? "";
    const dx = hit.at[0] - centre[0];
    const dz = hit.at[2] - centre[2];
    if (hit.id === B.firepit || Math.hypot(hit.at[0] - fire[0], hit.at[2] - fire[2]) < 0.9) stokeFire(x, y);
    else if ((name === "bark" || name.startsWith("leaves")) && Math.hypot(dx, dz) < 14) shake(hit.at, x, y);
    else {
      // The ground answers too: a puff of whatever it is made of.
      const green = name === "moss" || name === "grass" || name === "fern";
      parts.emit({
        at: [hit.at[0], hit.at[1] + 0.05, hit.at[2]],
        n: 7,
        speed: 1.3,
        flat: 0.5,
        push: [0, 1.4, 0],
        life: 0.5,
        size: 1.1,
        colours: green ? LEAVES : ["#6a4418", "#8b5920", "#523c18"],
        gravity: 6,
      });
      gust = Math.max(gust, 0.25);
    }
  }
  function pet(sp: Spirit, x: number, y: number): void {
    sp.glad = clock;
    sp.spin = 6.283;
    parts.emit({
      at: [sp.actor.pos[0], sp.actor.pos[1] + tallOf(sp.kind.id) + 0.2, sp.actor.pos[2]],
      n: 7,
      spread: 0.2,
      push: [0, 1.3, 0],
      speed: 0.5,
      life: 1,
      size: 1.5,
      colours: ["#e67fb0", "#ff9fc8", "#fff3cf"],
      gravity: -0.5,
      glow: true,
    });
    face.pop(x, y, "♥", "#ff9fc8");
    sfx.pet();
  }
  // A tap is a touch that did not turn into a drag.
  let down: [number, number] | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    down = [e.clientX, e.clientY];
    lastTouch = performance.now();
  });
  canvas.addEventListener("pointerup", (e) => {
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 7) tap(e.clientX, e.clientY);
    down = null;
  });
  addEventListener("pagehide", () => game.store(localStorage, save));

  show();
  if (away.awayMs > 60_000 && away.gained >= 1) {
    const mins = Math.round(Math.min(away.awayMs, game.AWAY_CAP_MS) / 60_000);
    face.card("Welcome back", [
      `Your tree made ${game.short(away.gained)} sap`,
      `in ${mins < 90 ? `${mins} minutes` : `${Math.round(mins / 60)} hours`}${away.capped ? " (it rests after a day)" : ""}`,
    ]);
  }

  let shown = 0;
  let kept = 0;
  let frames = 0;
  return {
    get free() {
      return !busy && flying === 0;
    },
    tap,
    burn() {
      const c = cones.find((k) => k.resting);
      if (c) burn(c);
    },
    set(next) {
      save = { ...next, seen: Date.now() };
      plant(world, save.level);
      s.remesh();
      ahead = null;
      spirits.clear();
      for (const k of KINDS) if (save.spirits[k.id]) settle(k);
      cones.length = 0;
      for (let i = 0; i < save.cones; i++) {
        const c: Cone = {
          actor: cone([...home.rest[i % home.rest.length]!]),
          slot: i % home.rest.length,
          resting: true,
        };
        lay(c);
        cones.push(c);
      }
      place(hero(save.level));
      controls.update();
      keep();
    },
    frame(now, dt, time) {
      clock = time;
      frames++;
      save = game.advance(save, Date.now()).save;
      for (let i = tweens.length - 1; i >= 0; i--) {
        const t = tweens[i]!;
        if (t.wait > 0) {
          t.wait -= dt;
          continue;
        }
        t.t += dt;
        const k = Math.min(1, t.t / t.dur);
        t.fn(k);
        if (k >= 1) {
          tweens.splice(tweens.indexOf(t), 1);
          t.then?.();
        }
      }
      // The grove a ring older is built in idle moments, a piece every so often.
      // Only when the player's hands are off the grove, and never two pieces close together.
      if (!busy && frames % 45 === 0 && now - lastTouch > 2500) prepare();

      const hot = save.stoked > Date.now();
      gust *= Math.exp(-dt * 2.2);
      flame += ((hot ? 1.25 : 1) - flame) * Math.min(1, dt * 2.5);
      power += ((hot ? 1.3 : 1) - power) * Math.min(1, dt * 2.5);
      s.fx.gust = gust;
      s.fx.tree = [centre[0], centre[2], G, size];
      s.fx.fire = tint;
      s.fx.fireMix += (tinted - s.fx.fireMix) * Math.min(1, dt * 6);
      s.fx.firePower = power;
      if (hot && Math.random() < dt * 5) sparks(1, ["#f5b95e", "#f08a3c"]);

      flames(s.dyn, fire, time, flame);
      const all = arrival ? [...spirits.values(), arrival] : [...spirits.values()];
      s.fx.casters = [];
      for (const sp of all) {
        const a = sp.actor;
        a.update?.(time);
        // Glad: three quick hops. Petted: a spin as well.
        const since = time - sp.glad;
        const hop = since >= 0 && since < 0.9 ? Math.abs(Math.sin(since * 10.5)) * (1 - since / 0.9) * 6 : 0;
        sp.spin *= Math.exp(-dt * 5);
        if (sp !== arrival) {
          const to = gaze && gaze.until > time ? gaze.at : fire;
          const want = Math.atan2(to[0] - a.pos[0], to[2] - a.pos[2]) + sp.spin;
          a.yaw += Math.atan2(Math.sin(want - a.yaw), Math.cos(want - a.yaw)) * Math.min(1, dt * 6);
        }
        for (const p of a.parts) p.off = [0, (p.off?.[1] ?? 0) + hop, 0];
        a.scale = sp.size;
        draw(s.dyn, world, a);
        s.fx.casters.push({ at: a.pos, height: tallOf(sp.kind.id) + 0.1, radius: 0.3 });
      }
      for (const c of cones) {
        // A cone waiting to be opened glints, so it is found.
        if (c.resting && Math.random() < dt * 2.2)
          parts.emit({
            at: [c.actor.pos[0], c.actor.pos[1] + 0.35, c.actor.pos[2]],
            n: 1,
            spread: 0.2,
            push: [0, 0.7, 0],
            life: 0.9,
            size: 1.2,
            colours: GOLD,
            gravity: -0.3,
            glow: true,
          });
        draw(s.dyn, world, c.actor);
      }
      if (sky) draw(s.dyn, world, sky);
      for (const f of finds) {
        if (f.back > time) {
          f.born = f.back;
          continue;
        }
        // Back out of the ground with a wobble.
        const age = Math.min(1, (time - f.born) / 0.5);
        sheets(f.at, f.tile, 0.4 + 0.6 * back(age), Math.sin(time * 1.3 + f.at[0]) * 0.04);
      }

      const px = s.renderer.getDrawingBufferSize(new THREE.Vector2());
      parts.update(dt, px.y / (2 * Math.tan((s.camera.fov * Math.PI) / 360)), ctx.night);

      if (now - shown > 200) {
        shown = now;
        show();
      }
      if (now - kept > 5000) {
        kept = now;
        game.store(localStorage, save);
      }
    },
  };
}
