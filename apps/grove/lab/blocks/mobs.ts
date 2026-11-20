/**
 * Box-model critters with our own skins, Minecraft-mob style: each part is a box with a painted net,
 * parts hang on bones, and the vertex shader bends them. One draw call per mob.
 */
import { CanvasTexture, Euler, Matrix4, Mesh, NearestFilter, NoColorSpace, Quaternion, Vector3 } from "three";
import { GeoBuilder, type V3 } from "./geo.ts";
import { hex, type Rgb } from "./palette.ts";
import { blockMaterial, depthMaterial } from "./shaders.ts";

type Face = "east" | "west" | "up" | "down" | "south" | "north";
type Painter = (face: Face, x: number, y: number, w: number, h: number) => Rgb | null;

interface BoxDef {
  from: V3;
  to: V3;
  paint: Painter;
}
interface BoneDef {
  name: string;
  parent: string | null;
  pivot: V3;
  boxes: BoxDef[];
}

const SKIN = 128;
const FACE_ORDER: Face[] = ["east", "west", "up", "down", "south", "north"];

export class Mob {
  readonly mesh: Mesh;
  readonly shadow: Mesh;
  readonly bones: Matrix4[];
  private readonly defs: BoneDef[];
  private readonly index = new Map<string, number>();
  readonly pose = new Map<string, Euler>();
  readonly offset = new Map<string, Vector3>();
  private readonly scale: number;

  constructor(defs: BoneDef[], scale: number) {
    this.defs = defs;
    this.scale = scale / 16;
    defs.forEach((d, i) => {
      this.index.set(d.name, i);
      this.pose.set(d.name, new Euler());
      this.offset.set(d.name, new Vector3());
    });
    this.bones = Array.from({ length: 16 }, () => new Matrix4());
    const canvas = document.createElement("canvas");
    canvas.width = SKIN;
    canvas.height = SKIN;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d");
    const img = ctx.createImageData(SKIN, SKIN);
    const geo = new GeoBuilder(SKIN);
    let cu = 0;
    let cv = 0;
    let shelf = 0;
    const tileAt = { u: 0, v: 0, frames: 1 };
    defs.forEach((bone, bi) => {
      for (const box of bone.boxes) {
        const w = Math.ceil(box.to[0] - box.from[0]);
        const h = Math.ceil(box.to[1] - box.from[1]);
        const d = Math.ceil(box.to[2] - box.from[2]);
        const rw = 2 * d + 2 * w;
        const rh = d + h;
        if (cu + rw > SKIN) {
          cu = 0;
          cv += shelf;
          shelf = 0;
        }
        const u = cu;
        const v = cv;
        cu += rw;
        shelf = Math.max(shelf, rh);
        const rects: Record<Face, [number, number, number, number]> = {
          up: [u + d, v, u + d + w, v + d],
          down: [u + d + w, v, u + d + 2 * w, v + d],
          west: [u, v + d, u + d, v + d + h],
          south: [u + d, v + d, u + d + w, v + d + h],
          east: [u + d + w, v + d, u + 2 * d + w, v + d + h],
          north: [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h],
        };
        for (const face of FACE_ORDER) {
          const [x0, y0, x1, y1] = rects[face];
          const fw = x1 - x0;
          const fh = y1 - y0;
          for (let y = 0; y < fh; y++)
            for (let x = 0; x < fw; x++) {
              const c = box.paint(face, x, y, fw, fh);
              if (!c) continue;
              const i = ((y0 + y) * SKIN + x0 + x) * 4;
              img.data[i] = c[0];
              img.data[i + 1] = c[1];
              img.data[i + 2] = c[2];
              img.data[i + 3] = 255;
            }
        }
        const s = this.scale * 16;
        geo.box(
          box.from,
          box.to,
          FACE_ORDER.map((f) => ({ tile: tileAt, rect: rects[f] })),
          { scale: s, bone: bi },
        );
      }
    });
    ctx.putImageData(img, 0, 0);
    const tex = new CanvasTexture(canvas);
    tex.flipY = false;
    tex.magFilter = NearestFilter;
    tex.minFilter = NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = NoColorSpace;
    const g = geo.build();
    this.mesh = new Mesh(g, blockMaterial(tex, {}, this.bones));
    this.shadow = new Mesh(g, depthMaterial(tex, {}, this.bones));
    this.mesh.frustumCulled = false;
    this.shadow.frustumCulled = false;
  }

  /** Recomputes bone matrices from the pose: rotate about each pivot, children inherit. */
  update(): void {
    const world: Matrix4[] = [];
    const t = new Matrix4();
    const r = new Matrix4();
    const q = new Quaternion();
    this.defs.forEach((d, i) => {
      const p = new Vector3(d.pivot[0], d.pivot[1], d.pivot[2]).multiplyScalar(this.scale);
      const e = this.pose.get(d.name) ?? new Euler();
      const o = (this.offset.get(d.name) ?? new Vector3()).clone().multiplyScalar(this.scale);
      q.setFromEuler(e);
      r.makeRotationFromQuaternion(q);
      const local = new Matrix4().makeTranslation(p.x + o.x, p.y + o.y, p.z + o.z).multiply(r).multiply(t.makeTranslation(-p.x, -p.y, -p.z));
      const parent = d.parent ? world[this.index.get(d.parent) ?? 0] : undefined;
      const m = parent ? parent.clone().multiply(local) : local;
      world[i] = m;
      this.bones[i]?.copy(m);
    });
    this.shadow.matrix.copy(this.mesh.matrix);
    this.shadow.matrixWorld.copy(this.mesh.matrixWorld);
  }

  set(name: string, x: number, y: number, z: number): void {
    this.pose.get(name)?.set(x, y, z);
  }
  move(name: string, x: number, y: number, z: number): void {
    this.offset.get(name)?.set(x, y, z);
  }
}

// ---------------------------------------------------------------- the Chickaree

const SQ = {
  dark: hex("#2e1d14"),
  fur: hex("#4e3424"),
  furLight: hex("#634430"),
  furTop: hex("#76533a"),
  belly: hex("#b0682a"),
  bellyLight: hex("#c47c38"),
  stripe: hex("#170e0a"),
  cream: hex("#c6a674"),
  eye: hex("#0c0606"),
  shine: hex("#ece4f2"),
  nose: hex("#1e110c"),
  tailCore: hex("#2c1b12"),
  fringe: hex("#b49464"),
  paw: hex("#9a5a2a"),
  cone: [hex("#3e1e10"), hex("#66341a"), hex("#86482a"), hex("#a8603a")] as Rgb[],
};

const furShade: Painter = (face, _x, y, _w, h) => (face === "up" ? SQ.furTop : face === "down" ? SQ.belly : y < h * 0.4 ? SQ.furLight : SQ.fur);

export function chickaree(): Mob {
  const haunch: Painter = (face, x, y, w, h) => {
    if (face === "south") return y >= 1 ? (x > 0 && x < w - 1 ? SQ.bellyLight : SQ.belly) : SQ.fur;
    if (face === "east" || face === "west") return y === h - 1 ? SQ.dark : y === 2 ? SQ.stripe : y > 2 ? SQ.belly : furShade(face, x, y, w, h);
    return furShade(face, x, y, w, h);
  };
  const torso: Painter = (face, x, y, w, h) => {
    if (face === "south") return x === 0 || x === w - 1 ? SQ.belly : y === 0 ? SQ.belly : SQ.bellyLight;
    if (face === "east" || face === "west") {
      const front = face === "west" ? x === w - 1 : x === 0;
      if (front) return SQ.belly;
      return y === h - 2 ? SQ.stripe : y === h - 1 ? SQ.belly : furShade(face, x, y, w, h);
    }
    if (face === "north") return y < 2 ? SQ.furLight : SQ.fur;
    return furShade(face, x, y, w, h);
  };
  const head: Painter = (face, x, y, w, h) => {
    if (face === "south") {
      if ((y === 2 || y === 1) && (x === 1 || x === w - 2)) return SQ.eye;
      if ((y === 1 || y === 2) && (x === 0 || x === w - 1)) return SQ.cream;
      if (y >= 3) return x === 0 || x === w - 1 ? SQ.furLight : SQ.cream;
      return y === 0 ? SQ.furTop : SQ.furLight;
    }
    if (face === "east" || face === "west") {
      const fx = face === "west" ? w - 1 - x : x;
      if (fx === 1 && y === 2) return SQ.eye;
      if ((fx === 0 || fx === 2) && y === 2) return SQ.cream;
      if (fx === 1 && (y === 1 || y === 3)) return SQ.cream;
      if (y === h - 1) return SQ.belly;
      return y === 0 ? SQ.furTop : SQ.fur;
    }
    if (face === "down") return SQ.cream;
    return furShade(face, x, y, w, h);
  };
  const snout: Painter = (face, x, y, w) => {
    if (face === "south" && y === 0 && x >= 0 && x < w) return SQ.nose;
    if (face === "up") return SQ.furLight;
    return SQ.cream;
  };
  const ear: Painter = (face, _x, y) => (y === 0 || face === "up" ? SQ.stripe : face === "south" ? SQ.paw : SQ.fur);
  const arm: Painter = (_face, _x, y) => (y >= 2 ? SQ.paw : SQ.belly);
  const cone: Painter = (face, x, y) => (face === "up" || face === "down" ? SQ.cone[1]! : SQ.cone[((x + y) % 3 === 0 ? 0 : (x + y * 2) % 3) + 1] ?? SQ.cone[2]!);
  const tail: Painter = (face, x, y, w, h) => {
    const edge = x === 0 || x === w - 1;
    if (face === "south" || face === "north") return edge ? SQ.fringe : (x + y) % 3 === 0 ? SQ.tailCore : SQ.fur;
    if (face === "up") return edge || y === 0 ? SQ.fringe : SQ.furLight;
    if (face === "down") return SQ.tailCore;
    return y === 0 || y === h - 1 ? SQ.fringe : (x + y) % 2 ? SQ.fur : SQ.furLight;
  };
  const tip: Painter = (face, x, y, w) => (face === "up" || x === 0 || x === w - 1 || y === 0 ? SQ.fringe : SQ.furLight);
  const foot: Painter = (face) => (face === "up" ? SQ.fur : SQ.paw);
  return new Mob(
    [
      { name: "root", parent: null, pivot: [0, 0, 0], boxes: [] },
      {
        name: "body",
        parent: "root",
        pivot: [0, 3, 0],
        boxes: [
          { from: [-3, 0, -3], to: [3, 5, 3], paint: haunch },
          { from: [-2.5, 4, -1.5], to: [2.5, 10, 2.5], paint: torso },
          { from: [-3.5, 0, 1], to: [-1.5, 1, 4], paint: foot },
          { from: [1.5, 0, 1], to: [3.5, 1, 4], paint: foot },
        ],
      },
      {
        name: "head",
        parent: "body",
        pivot: [0, 10, 0.5],
        boxes: [
          { from: [-3, 10, -1.5], to: [3, 15, 3.5], paint: head },
          { from: [-1, 10, 3.5], to: [1, 12, 4.5], paint: snout },
        ],
      },
      { name: "earL", parent: "head", pivot: [-2, 15, 0.5], boxes: [{ from: [-2.5, 15, 0], to: [-1.5, 17, 1], paint: ear }] },
      { name: "earR", parent: "head", pivot: [2, 15, 0.5], boxes: [{ from: [1.5, 15, 0], to: [2.5, 17, 1], paint: ear }] },
      {
        name: "arms",
        parent: "body",
        pivot: [0, 8, 2.5],
        boxes: [
          { from: [-2, 6, 2.5], to: [-1, 9, 3.5], paint: arm },
          { from: [1, 6, 2.5], to: [2, 9, 3.5], paint: arm },
          { from: [-1.5, 5, 3], to: [1.5, 9, 6], paint: cone },
        ],
      },
      { name: "tail1", parent: "root", pivot: [0, 2, -3], boxes: [{ from: [-2.5, 1, -7], to: [2.5, 8, -3], paint: tail }] },
      { name: "tail2", parent: "tail1", pivot: [0, 8, -5], boxes: [{ from: [-3, 8, -9], to: [3, 15, -4], paint: tail }] },
      { name: "tail3", parent: "tail2", pivot: [0, 15, -6.5], boxes: [{ from: [-3, 15, -7.5], to: [3, 19, -2.5], paint: tip }] },
    ],
    0.95,
  );
}

/** Idle: breathing, a nibble at the cone every few seconds, a tail that ripples and sometimes flicks, ear twitches. */
export function animateChickaree(m: Mob, t: number, excite = 0): void {
  const breathe = Math.sin(t * 2.2) * 0.04;
  const cycle = t % 4.2;
  const nibbling = cycle > 2.6 && cycle < 3.8;
  const nib = nibbling ? Math.sin(t * 22) * 0.12 : 0;
  m.set("body", breathe - 0.05, 0, 0);
  m.set("head", (nibbling ? 0.28 + nib : Math.sin(t * 0.7) * 0.06) - excite * 0.2, Math.sin(t * 0.45) * 0.35 * (nibbling ? 0.2 : 1), Math.sin(t * 0.3) * 0.05);
  m.set("arms", nibbling ? -0.18 + nib * 0.6 : -0.05, 0, 0);
  const flick = Math.max(0, Math.sin(t * 0.9) - 0.92) * 9;
  m.set("tail1", -0.35 + Math.sin(t * 1.3) * 0.06 - flick * 0.15, Math.sin(t * 0.8) * 0.08, 0);
  m.set("tail2", 0.25 + Math.sin(t * 1.3 - 0.7) * 0.12 + flick * 0.2, 0, 0);
  m.set("tail3", 0.55 + Math.sin(t * 1.3 - 1.4) * 0.18 + flick * 0.3, 0, 0);
  const twitch = Math.max(0, Math.sin(t * 1.7 + 1) - 0.95) * 8;
  m.set("earL", 0, 0, -twitch * 0.25);
  m.set("earR", 0, 0, twitch * 0.2);
  m.update();
}

// ---------------------------------------------------------------- the crab

const CR = {
  shell: hex("#a8361f"),
  light: hex("#c84a28"),
  top: hex("#dc6a3a"),
  dark: hex("#862a1b"),
  deep: hex("#5c1c13"),
  belly: hex("#f0c896"),
  bellyDark: hex("#c99a6a"),
  eye: hex("#120a0c"),
  shine: hex("#e6dcef"),
  speck: hex("#f6a070"),
  tip: hex("#4a1610"),
};

export function crab(): Mob {
  const shell: Painter = (face, x, y, w, h) => {
    if (face === "up") {
      if ((x === 2 && y === 1) || (x === w - 3 && y === 2) || (x === 4 && y === h - 2)) return CR.speck;
      return x === 0 || x === w - 1 || y === 0 || y === h - 1 ? CR.light : CR.top;
    }
    if (face === "down") return CR.belly;
    if (face === "south") {
      // A small smile under the eyes.
      if (y === 1 && (x === 3 || x === w - 4)) return CR.deep;
      if (y === 2 && x >= 4 && x <= w - 5) return CR.deep;
      if (y === h - 1) return CR.bellyDark;
      return y === 0 ? CR.light : CR.shell;
    }
    return y === 0 ? CR.light : y === h - 1 ? CR.bellyDark : CR.shell;
  };
  const dome: Painter = (face, x, y, w) => (face === "up" ? ((x === 1 && y === 1) || x === w - 3 ? CR.top : CR.light) : CR.light);
  const stalk: Painter = () => CR.dark;
  const eye: Painter = (face, x, y) => {
    if (face === "south" && x === 0 && y === 0) return CR.shine;
    if (face === "up" && x === 0 && y === 1) return CR.shine;
    return CR.eye;
  };
  const arm: Painter = (face) => (face === "up" ? CR.light : face === "down" ? CR.belly : CR.shell);
  const jaw: Painter = (face, x, y, w, h) => {
    if (face === "down") return CR.belly;
    if (face === "south") return y === h - 1 ? CR.tip : CR.light;
    if (face === "up") return y === 0 ? CR.light : y >= h - 1 ? CR.tip : CR.top;
    return x >= w - 1 ? CR.tip : y === 0 ? CR.top : CR.shell;
  };
  const lower: Painter = (face, x, _y, w) => (face === "up" ? CR.belly : x >= w - 1 && face !== "south" ? CR.tip : CR.dark);
  const leg: Painter = (face) => (face === "up" ? CR.light : CR.dark);
  const legBox = (side: number, z: number, i: number): BoneDef => ({
    name: `leg${side < 0 ? "L" : "R"}${i}`,
    parent: "body",
    pivot: [side * 4.5, 4, z + 0.5],
    boxes: [
      { from: side < 0 ? [-8.5, 3, z] : [4.5, 3, z], to: side < 0 ? [-4.5, 4, z + 1] : [8.5, 4, z + 1], paint: leg },
      { from: side < 0 ? [-9.5, 0, z] : [8.5, 0, z], to: side < 0 ? [-8.5, 3, z + 1] : [9.5, 3, z + 1], paint: leg },
    ],
  });
  return new Mob(
    [
      { name: "root", parent: null, pivot: [0, 0, 0], boxes: [] },
      {
        name: "body",
        parent: "root",
        pivot: [0, 4, 0],
        boxes: [
          { from: [-5, 3, -3.5], to: [5, 7, 3.5], paint: shell },
          { from: [-4, 7, -2.5], to: [4, 8, 2.5], paint: dome },
        ],
      },
      {
        name: "eyeL",
        parent: "body",
        pivot: [-2, 7, 2.5],
        boxes: [
          { from: [-2.5, 7, 2], to: [-1.5, 10, 3], paint: stalk },
          { from: [-3, 10, 1.5], to: [-1, 12, 3.5], paint: eye },
        ],
      },
      {
        name: "eyeR",
        parent: "body",
        pivot: [2, 7, 2.5],
        boxes: [
          { from: [1.5, 7, 2], to: [2.5, 10, 3], paint: stalk },
          { from: [1, 10, 1.5], to: [3, 12, 3.5], paint: eye },
        ],
      },
      {
        name: "clawL",
        parent: "body",
        pivot: [-5, 4.5, 2.5],
        boxes: [
          { from: [-7, 3.5, 2], to: [-5, 5.5, 5], paint: arm },
          { from: [-8.5, 4, 5], to: [-5, 6.5, 9], paint: jaw },
        ],
      },
      { name: "jawL", parent: "clawL", pivot: [-6.5, 4, 5.5], boxes: [{ from: [-8.5, 3, 5.5], to: [-5, 4, 8.5], paint: lower }] },
      {
        name: "clawR",
        parent: "body",
        pivot: [5, 4.5, 2.5],
        boxes: [
          { from: [5, 3.5, 2], to: [7, 5.5, 5], paint: arm },
          { from: [5, 4, 5], to: [8.5, 6.5, 9], paint: jaw },
        ],
      },
      { name: "jawR", parent: "clawR", pivot: [6.5, 4, 5.5], boxes: [{ from: [5, 3, 5.5], to: [8.5, 4, 8.5], paint: lower }] },
      legBox(-1, -3, 1),
      legBox(-1, -1, 2),
      legBox(-1, 1, 3),
      legBox(1, -3, 1),
      legBox(1, -1, 2),
      legBox(1, 1, 3),
    ],
    0.9,
  );
}

/** Idle: a sideways shuffle with scuttling legs, claws that click, eyes that bob out of step. `rave` makes it dance. */
export function animateCrab(m: Mob, t: number, rave = 0): { dx: number; dy: number } {
  const walkPhase = Math.sin(t * 0.55);
  const walking = Math.abs(Math.cos(t * 0.55));
  const dx = walkPhase * 0.35;
  const scuttle = Math.sin(t * 13) * walking;
  for (let i = 1; i <= 3; i++) {
    const ph = i * 2.1;
    m.set(`legL${i}`, 0, 0, Math.sin(t * 13 + ph) * 0.3 * walking - 0.1);
    m.set(`legR${i}`, 0, 0, -Math.sin(t * 13 + ph + 1) * 0.3 * walking + 0.1);
  }
  const click = Math.max(0, Math.sin(t * 1.1)) > 0.85 ? Math.abs(Math.sin(t * 16)) : 0;
  const danceUp = rave > 0 ? Math.abs(Math.sin(t * 9)) : 0;
  m.set("clawL", -0.15 - danceUp * 1.1 * rave, 0.2, -danceUp * 0.4 * rave);
  m.set("clawR", -0.15 - (rave > 0 ? Math.abs(Math.sin(t * 9 + Math.PI / 2)) : 0) * 1.1 * rave, -0.2, danceUp * 0.4 * rave);
  m.set("jawL", 0.35 * click + (rave ? 0.4 * Math.abs(Math.sin(t * 18)) : 0), 0, 0);
  m.set("jawR", 0.35 * (Math.max(0, Math.sin(t * 1.1 + 2)) > 0.85 ? Math.abs(Math.sin(t * 16)) : 0) + (rave ? 0.4 * Math.abs(Math.sin(t * 18 + 1)) : 0), 0, 0);
  m.set("eyeL", Math.sin(t * 2.3) * 0.12, 0, Math.sin(t * 1.7) * 0.1);
  m.set("eyeR", Math.sin(t * 2.3 + 1.4) * 0.12, 0, Math.sin(t * 1.9 + 0.5) * 0.1);
  m.set("body", 0, 0, scuttle * 0.04 + (rave ? Math.sin(t * 9) * 0.12 : 0));
  m.move("body", 0, rave ? danceUp * 1.6 : Math.abs(scuttle) * 0.15, 0);
  m.update();
  return { dx, dy: 0 };
}
