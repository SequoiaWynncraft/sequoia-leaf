/**
 * Small square lights and scraps flung about by what the player does: sparks, leaves, raindrops,
 * hearts, dust. Each is one pixel-art square with a colour, a size, a life and a little physics.
 * They are moved here, on the processor, a few hundred at most.
 */
import * as THREE from "three";

type V3 = readonly [number, number, number];
export interface Burst {
  at: V3;
  /** How many, and how far from `at` each may start. */
  n: number;
  spread?: number | V3;
  /** Starting speed: a fixed push, plus up to `speed` in a random direction (flattened by `flat`). */
  push?: V3;
  speed?: number;
  flat?: number;
  /** Seconds each lives, give or take a third. */
  life: number;
  /** Size in pixels of the world (a sixteenth of a block). */
  size?: number;
  colours: readonly string[];
  /** Blocks a second squared downward; a negative number floats up. */
  gravity?: number;
  drag?: number;
  /** Gives light: it shows at full colour in the dark and blooms. */
  glow?: boolean;
  /** Stops at this height and lies there until it fades. */
  floor?: number;
}

const MAX = 1400;
const hex = (c: string): [number, number, number] => [
  parseInt(c.slice(1, 3), 16) / 255,
  parseInt(c.slice(3, 5), 16) / 255,
  parseInt(c.slice(5, 7), 16) / 255,
];

export class Particles {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(MAX * 3);
  private readonly look = new Float32Array(MAX * 4);
  private readonly more = new Float32Array(MAX * 2);
  private readonly vel = new Float32Array(MAX * 3);
  /** life left, whole life, gravity, drag, floor */
  private readonly live = new Float32Array(MAX * 5);
  private next = 0;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.ShaderMaterial;

  constructor() {
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aLook", new THREE.BufferAttribute(this.look, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aMore", new THREE.BufferAttribute(this.more, 2).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      blending: THREE.NoBlending,
      uniforms: { uScale: { value: 600 }, uNight: { value: 0 } },
      vertexShader: /* glsl */ `
        in vec4 aLook;
        in vec2 aMore;
        uniform float uScale;
        out vec4 vLook;
        void main() {
          vLook = aLook;
          vec4 mv = viewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // A scrap shrinks as it dies; a dead one is off the screen.
          gl_PointSize = aMore.x <= 0.0 ? 0.0 : max(1.5, aMore.y * aMore.x * uScale / -mv.z);
          if (aMore.x <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uNight;
        in vec4 vLook;
        out vec4 outColour;
        void main() {
          // What gives no light of its own takes the dusk's; alpha marks what glows, for the bloom.
          vec3 c = vLook.a > 0.5 ? vLook.rgb : vLook.rgb * mix(0.85, 0.42, uNight);
          outColour = vec4(c, vLook.a);
        }`,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
  }

  emit(b: Burst): void {
    const spread = typeof b.spread === "number" ? [b.spread, b.spread, b.spread] : (b.spread ?? [0, 0, 0]);
    for (let k = 0; k < b.n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const a = Math.random() * 6.283;
      const up = (Math.random() * 2 - 1) * (1 - (b.flat ?? 0));
      const out = Math.sqrt(Math.max(0, 1 - up * up));
      const v = (b.speed ?? 0) * (0.4 + Math.random() * 0.6);
      this.pos.set(
        [
          b.at[0] + (Math.random() * 2 - 1) * spread[0]!,
          b.at[1] + (Math.random() * 2 - 1) * spread[1]!,
          b.at[2] + (Math.random() * 2 - 1) * spread[2]!,
        ],
        i * 3,
      );
      this.vel.set(
        [
          (b.push?.[0] ?? 0) + Math.cos(a) * out * v,
          (b.push?.[1] ?? 0) + up * v,
          (b.push?.[2] ?? 0) + Math.sin(a) * out * v,
        ],
        i * 3,
      );
      const life = b.life * (0.67 + Math.random() * 0.66);
      this.live.set([life, life, b.gravity ?? 0, b.drag ?? 0, b.floor ?? -1e9], i * 5);
      this.look.set([...hex(b.colours[Math.floor(Math.random() * b.colours.length)]!), b.glow ? 1 : 0], i * 4);
      this.more.set([1, ((b.size ?? 1) / 16) * (0.8 + Math.random() * 0.5)], i * 2);
    }
  }

  /** Moves everything on by `dt` seconds. `scale` is the picture's height in pixels over twice the tangent of half the camera's angle. */
  update(dt: number, scale: number, night: number): void {
    this.mat.uniforms.uScale!.value = scale;
    this.mat.uniforms.uNight!.value = night;
    const { pos, vel, live, more } = this;
    for (let i = 0; i < MAX; i++) {
      const left = live[i * 5]!;
      if (left <= 0) continue;
      const now = left - dt;
      live[i * 5] = now;
      if (now <= 0) {
        more[i * 2] = 0;
        continue;
      }
      const drag = Math.max(0, 1 - live[i * 5 + 3]! * dt);
      vel[i * 3] = vel[i * 3]! * drag;
      vel[i * 3 + 1] = vel[i * 3 + 1]! * drag - live[i * 5 + 2]! * dt;
      vel[i * 3 + 2] = vel[i * 3 + 2]! * drag;
      pos[i * 3] = pos[i * 3]! + vel[i * 3]! * dt;
      pos[i * 3 + 1] = pos[i * 3 + 1]! + vel[i * 3 + 1]! * dt;
      pos[i * 3 + 2] = pos[i * 3 + 2]! + vel[i * 3 + 2]! * dt;
      const floor = live[i * 5 + 4]!;
      if (pos[i * 3 + 1]! < floor) {
        pos[i * 3 + 1] = floor;
        vel.fill(0, i * 3, i * 3 + 3);
      }
      // Full size for most of its life, then gone in the last third.
      more[i * 2] = Math.min(1, (now / live[i * 5 + 1]!) * 3);
    }
    for (const name of ["position", "aLook", "aMore"]) this.geo.getAttribute(name).needsUpdate = true;
  }
}
