/** Square pixel particles, Minecraft style, simulated on the CPU in one pool and drawn in one call. */
import { BufferAttribute, BufferGeometry, Points } from "three";
import { particleMaterial } from "./shaders.ts";

export type Kind = "bulb" | "spark" | "firefly" | "drop" | "splash" | "needle" | "mist" | "snow" | "shard" | "mote" | "ring" | "smoke" | "sparkle" | "glint";

export interface Spawn {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size: number;
  color: readonly [number, number, number];
  alpha?: number;
  add?: boolean;
  gravity?: number;
  drag?: number;
  kind: Kind;
  /** Ground height for drops; they splash when they reach it. */
  floor?: number;
}

const KINDS: Kind[] = ["bulb", "spark", "firefly", "drop", "splash", "needle", "mist", "snow", "shard", "mote", "ring", "smoke", "sparkle", "glint"];

export class Particles {
  readonly points: Points;
  private readonly cap: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly extra: Float32Array;
  private readonly vel: Float32Array;
  private readonly base: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly kind: Uint8Array;
  private readonly seed: Float32Array;
  private readonly floor: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private live = 0;
  private readonly geo: BufferGeometry;
  /** Bounds for fireflies and snow: centre and radius of the glade. */
  area = { r: 12, top: 14 };

  constructor(cap = 2400) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.extra = new Float32Array(cap * 2);
    this.vel = new Float32Array(cap * 3);
    this.base = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.kind = new Uint8Array(cap);
    this.seed = new Float32Array(cap);
    this.floor = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.geo = new BufferGeometry();
    this.geo.setAttribute("position", new BufferAttribute(this.pos, 3));
    this.geo.setAttribute("pcolor", new BufferAttribute(this.col, 4));
    this.geo.setAttribute("extra", new BufferAttribute(this.extra, 2));
    this.geo.setDrawRange(0, 0);
    this.points = new Points(this.geo, particleMaterial());
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  get count(): number {
    return this.live;
  }

  spawn(s: Spawn): void {
    if (this.live >= this.cap) return;
    const i = this.live++;
    this.pos.set([s.x, s.y, s.z], i * 3);
    this.base.set([s.x, s.y, s.z], i * 3);
    this.vel.set([s.vx ?? 0, s.vy ?? 0, s.vz ?? 0], i * 3);
    this.col.set([s.color[0], s.color[1], s.color[2], s.alpha ?? 1], i * 4);
    this.extra.set([s.size, s.add ? 1 : 0], i * 2);
    this.size[i] = s.size;
    this.alpha[i] = s.alpha ?? 1;
    this.life[i] = s.life;
    this.maxLife[i] = s.life;
    this.grav[i] = s.gravity ?? 0;
    this.drag[i] = s.drag ?? 0;
    this.kind[i] = KINDS.indexOf(s.kind);
    this.seed[i] = Math.random() * 100;
    this.floor[i] = s.floor ?? -99;
  }

  private kill(i: number): void {
    const last = --this.live;
    if (i === last) return;
    const copy = (a: Float32Array | Uint8Array, n: number) => a.copyWithin(i * n, last * n, last * n + n);
    copy(this.pos, 3);
    copy(this.base, 3);
    copy(this.vel, 3);
    copy(this.col, 4);
    copy(this.extra, 2);
    copy(this.life, 1);
    copy(this.maxLife, 1);
    copy(this.grav, 1);
    copy(this.drag, 1);
    copy(this.kind, 1);
    copy(this.seed, 1);
    copy(this.floor, 1);
    copy(this.size, 1);
    copy(this.alpha, 1);
  }

  update(dt: number, t: number): void {
    for (let i = this.live - 1; i >= 0; i--) {
      const k = KINDS[this.kind[i] ?? 0];
      const s = this.seed[i] ?? 0;
      const p = i * 3;
      const persistent = k === "firefly" || k === "snow" || k === "bulb";
      if (!persistent) {
        this.life[i] = (this.life[i] ?? 0) - dt;
        if ((this.life[i] ?? 0) <= 0) {
          this.kill(i);
          continue;
        }
      }
      const life01 = persistent ? 1 : (this.life[i] ?? 0) / Math.max(1e-3, this.maxLife[i] ?? 1);
      let vx = this.vel[p] ?? 0;
      let vy = this.vel[p + 1] ?? 0;
      let vz = this.vel[p + 2] ?? 0;
      vy -= (this.grav[i] ?? 0) * dt;
      const dr = Math.exp(-(this.drag[i] ?? 0) * dt);
      vx *= dr;
      vy *= dr;
      vz *= dr;
      this.vel[p] = vx;
      this.vel[p + 1] = vy;
      this.vel[p + 2] = vz;
      let x = (this.pos[p] ?? 0) + vx * dt;
      let y = (this.pos[p + 1] ?? 0) + vy * dt;
      let z = (this.pos[p + 2] ?? 0) + vz * dt;
      let a = this.alpha[i] ?? 1;
      let size = this.size[i] ?? 0.1;
      switch (k) {
        case "firefly": {
          const bx = this.base[p] ?? 0;
          const by = this.base[p + 1] ?? 0;
          const bz = this.base[p + 2] ?? 0;
          x = bx + Math.sin(t * 0.31 + s) * 1.6 + Math.sin(t * 0.73 + s * 2.1) * 0.6;
          y = by + Math.sin(t * 0.47 + s * 1.3) * 0.7;
          z = bz + Math.cos(t * 0.29 + s * 0.7) * 1.6 + Math.cos(t * 0.61 + s) * 0.5;
          const blink = Math.sin(t * (0.9 + (s % 1) * 0.8) + s * 7);
          a = Math.max(0, (blink - 0.1) / 0.9) ** 1.5;
          break;
        }
        case "bulb":
          a = (this.alpha[i] ?? 0.4) * (0.55 + 0.45 * Math.sin(t * (0.7 + (s % 1) * 0.9) + s * 5));
          break;
        case "snow": {
          x += Math.sin(t * 0.8 + s) * 0.006;
          z += Math.cos(t * 0.7 + s * 1.3) * 0.006;
          if (y < -14) {
            y = this.area.top + Math.random() * 6;
            const ang = Math.random() * Math.PI * 2;
            const rr = Math.sqrt(Math.random()) * (this.area.r + 10);
            x = Math.cos(ang) * rr;
            z = Math.sin(ang) * rr;
          }
          break;
        }
        case "spark":
          x += Math.sin(t * 6 + s) * 0.004;
          a = life01;
          this.col[i * 4 + 1] = 0.5 + 0.9 * life01;
          this.col[i * 4 + 2] = 0.15 + 0.3 * life01;
          break;
        case "needle":
          x += Math.sin(t * 5 + s) * 0.012;
          z += Math.cos(t * 4 + s) * 0.01;
          a = Math.min(1, life01 * 3);
          if (y < (this.floor[i] ?? -99)) {
            y = this.floor[i] ?? y;
            this.vel.fill(0, p, p + 3);
            this.grav[i] = 0;
          }
          break;
        case "drop":
          if (y < (this.floor[i] ?? -99)) {
            for (let n = 0; n < 2; n++)
              this.spawn({
                x,
                y: (this.floor[i] ?? 0) + 0.02,
                z,
                vx: (Math.random() - 0.5) * 1.6,
                vy: 1 + Math.random() * 1.2,
                vz: (Math.random() - 0.5) * 1.6,
                life: 0.35,
                size: 0.06,
                color: [0.75, 0.9, 1.1],
                gravity: 9,
                kind: "splash",
              });
            this.life[i] = 0.0001;
            a = 0;
          }
          break;
        case "mist":
          a = (this.alpha[i] ?? 0.3) * Math.sin(Math.PI * life01);
          size = (this.size[i] ?? 0.2) * (1.6 - life01 * 0.6);
          break;
        case "smoke":
          a = (this.alpha[i] ?? 0.3) * Math.sin(Math.PI * life01);
          size = (this.size[i] ?? 0.2) * (2.2 - life01 * 1.2);
          x += Math.sin(t * 0.8 + s) * 0.004;
          break;
        case "mote":
        case "sparkle":
          a = (this.alpha[i] ?? 1) * Math.sin(Math.PI * life01) * (0.6 + 0.4 * Math.sin(t * 9 + s));
          break;
        case "ring":
        case "glint":
        case "shard":
        case "splash":
          a = (this.alpha[i] ?? 1) * Math.min(1, life01 * 2.5);
          break;
      }
      this.pos[p] = x;
      this.pos[p + 1] = y;
      this.pos[p + 2] = z;
      this.col[i * 4 + 3] = a;
      this.extra[i * 2] = size;
    }
    this.geo.setDrawRange(0, this.live);
    (this.geo.getAttribute("position") as BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("pcolor") as BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("extra") as BufferAttribute).needsUpdate = true;
  }
}
