/** Draws a world: the block meshes with their baked light, the moving things, a pixel sky, glows and sparks. */
import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

import { GROUNDS, paintTile, reliefTile, TILE, tileNames } from "../art/tiles.ts";
import { Dyn } from "./actors.ts";
import { type Mesh, meshRegion, STRIDE } from "./mesh.ts";
import { ihash } from "./rand.ts";
import type { World } from "./world.ts";

type V3 = readonly [number, number, number];
const rgb = (hex: string): THREE.Vector3 =>
  new THREE.Vector3(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  );

/** The dusk sky from the horizon by the sun up to the zenith, in the welcome's colours. */
const SKY = [
  "#f5b95e",
  "#e67967",
  "#d06170",
  "#b84d84",
  "#973d8f",
  "#7a348a",
  "#692e80",
  "#5a296e",
  "#4c256a",
  "#3d2050",
  "#321b3c",
  "#2a1733",
];

const SHARED = /* glsl */ `
  uniform vec3 uSun;
  uniform vec3 uFogAway;
  uniform vec3 uFogSun;
  uniform float uFogStart;
  uniform float uTime;
  uniform float uNight;
  vec3 fogColour(vec3 dir, vec3 sun) {
    float a = dot(normalize(dir.xz), normalize(sun.xz));
    vec3 c = mix(uFogAway, uFogSun, pow(max(0.0, 0.5 + 0.5 * a), 2.5));
    return mix(c, c * vec3(0.42, 0.42, 0.62), uNight);
  }`;

/** Every tile as a layer of one texture: its colours, or its relief (see `reliefTile`). */
function tiles(paint: (name: string) => Uint8Array = paintTile): THREE.DataArrayTexture {
  const names = tileNames();
  const data = new Uint8Array(TILE * TILE * 4 * names.length);
  names.forEach((name, layer) => {
    const px = paint(name);
    // Rows go in from the bottom, so v runs up the tile.
    for (let y = 0; y < TILE; y++)
      data.set(px.subarray(y * TILE * 4, (y + 1) * TILE * 4), layer * TILE * TILE * 4 + (TILE - 1 - y) * TILE * 4);
  });
  const tex = new THREE.DataArrayTexture(data, TILE, TILE, names.length);
  tex.format = THREE.RGBAFormat;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** A lamp: the larger ones light what is round them point by point; all of them glow in the air. */
export interface Glow {
  readonly at: V3;
  /** How strong it is: a fire is about 9, a lantern 3, a bulb on a string 1.5. */
  readonly size: number;
  readonly flicker: boolean;
}
const LAMPS = 8;
/** Something standing in the firelight: a figure or a pet, as an upright rod that casts a shadow. */
export interface Caster {
  readonly at: V3;
  readonly height: number;
  readonly radius: number;
}
const CASTERS = 16;

export interface Scene {
  readonly world: World;
  readonly sun: V3;
  readonly flies: readonly V3[];
  readonly glows?: readonly Glow[];
  /** Where sparks rise from. */
  readonly fire?: V3;
  /** 0 is sunset, 1 is full night. */
  readonly night?: number;
  /** Who stands in the light of the strongest lamp and throws a shadow from it. */
  readonly casters?: readonly Caster[];
  /** What lies beyond the world and never changes: the ground running on, the far forest. */
  readonly beyond?: Mesh;
}

export interface Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** The moving things: fill it before each frame. */
  readonly dyn: Dyn;
  /** Where the fog begins, in blocks from the eye. */
  fogStart: number;
  /** Rebuilds the world's meshes after its blocks have changed. */
  remesh(): void;
  frame(time: number): void;
  resize(): void;
}

export function stage(canvas: HTMLCanvasElement, set: Scene): Stage {
  const { world, sun } = set;
  // The picture is drawn to a target of its own, so the canvas needs no smoothing; and a phone's
  // dense screen is not drawn at full density, which would cost four times the work for little gain.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.3, 600);
  /** Each material gets its own copies; `each` sets one on all of them. */
  const sets: Record<string, THREE.IUniform>[] = [];
  const common = (): Record<string, THREE.IUniform> => {
    const u = {
      uSun: { value: new THREE.Vector3(...sun) },
      uFogAway: { value: rgb("#3b2152") },
      uFogSun: { value: rgb("#8f4868") },
      uFogStart: { value: 40 },
      uTime: { value: 0 },
      uNight: { value: set.night ?? 0 },
      uScale: { value: 1 },
    };
    sets.push(u);
    return u;
  };
  const each = (name: string, value: number): void => {
    for (const u of sets) u[name]!.value = value;
  };

  // The strongest lamps light the world point by point; the shader always has room for eight.
  const strong = [...(set.glows ?? [])].filter((g) => g.size >= 2.5).sort((a, b) => b.size - a.size);
  const lamps: Glow[] = Array.from(
    { length: LAMPS },
    (_, i) => strong[i] ?? { at: [0, -999, 0], size: 0, flicker: false },
  );
  const casters: Caster[] = Array.from(
    { length: CASTERS },
    (_, i) => (set.casters ?? [])[i] ?? { at: [0, -999, 0], height: 0, radius: 0 },
  );
  const blocks = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      ...common(),
      uTiles: { value: tiles() },
      uRelief: { value: tiles(reliefTile) },
      uGround: { value: GROUNDS.flatMap((g) => g.ramp.map(rgb)) },
      uCut: { value: GROUNDS.flatMap((g) => [...g.cuts]) },
      uSpeck: { value: GROUNDS.map((g) => new THREE.Vector4(...rgb(g.speck).toArray(), g.rate)) },
      uLamp: { value: lamps.map((g) => new THREE.Vector4(g.at[0], g.at[1], g.at[2], 6 + g.size * 2)) },
      uLampSet: { value: lamps.map((g) => new THREE.Vector2(g.size > 5 ? 2.2 : 1.2, g.flicker ? 1 : 0)) },
      uLampN: { value: Math.min(LAMPS, strong.length) },
      uCaster: { value: casters.map((c) => new THREE.Vector4(c.at[0], c.at[1], c.at[2], c.radius)) },
      uCasterH: { value: casters.map((c) => c.height) },
      uCasterN: { value: Math.min(CASTERS, (set.casters ?? []).length) },
    },
    vertexShader: /* glsl */ `
      in vec4 aUv;
      in vec4 aLight;
      out vec2 vUv;
      out float vTile;
      out float vEmit;
      out vec4 vLight;
      out vec3 vN;
      out vec3 vPos;
      uniform float uTime;
      void main() {
        vUv = aUv.xy;
        vTile = aUv.z;
        vEmit = aUv.w;
        vLight = aLight;
        vN = normal;
        vec3 p = position;
        // Foliage stirs: every corner at one place moves the same way, so no gap opens between
        // blocks. A plant is rooted and only its top moves.
        bool plant = aUv.w > 2.5 && aUv.w < 3.5 || aUv.w > 4.5 && aUv.w < 5.5;
        if (plant || (aUv.w > 1.5 && aUv.w < 2.5)) {
          float reach = plant ? aUv.y * 0.07 : 0.03;
          float phase = dot(floor(position + 0.5), vec3(0.71, 0.37, 0.93));
          p.x += sin(uTime * 1.3 + phase) * reach;
          p.z += cos(uTime * 1.1 + phase * 1.3) * reach;
          p.y += sin(uTime * 0.9 + phase * 0.7) * reach * (plant ? 0.0 : 0.4);
        }
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      precision highp sampler2DArray;
      uniform sampler2DArray uTiles;
      uniform sampler2DArray uRelief;
      uniform vec3 uGround[24];
      uniform float uCut[20];
      uniform vec4 uSpeck[4];
      uniform vec4 uLamp[${LAMPS}];
      uniform vec2 uLampSet[${LAMPS}];
      uniform int uLampN;
      uniform vec4 uCaster[${CASTERS}];
      uniform float uCasterH[${CASTERS}];
      uniform int uCasterN;
      ${SHARED}
      in vec2 vUv;
      in float vTile;
      in float vEmit;
      in vec4 vLight;
      in vec3 vN;
      in vec3 vPos;
      out vec4 outColour;
      /** The least distance between the line from p1 to q1 and the line from p2 to q2. */
      float apart(vec3 p1, vec3 q1, vec3 p2, vec3 q2) {
        vec3 d1 = q1 - p1, d2 = q2 - p2, r = p1 - p2;
        float a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r), c = dot(d1, r), b = dot(d1, d2);
        float den = a * e - b * b;
        float s = den > 1e-5 ? clamp((b * f - c * e) / den, 0.0, 1.0) : 0.0;
        float t = clamp((b * s + f) / max(e, 1e-5), 0.0, 1.0);
        s = clamp((b * t - c) / max(a, 1e-5), 0.0, 1.0);
        return length(p1 + d1 * s - p2 - d2 * t);
      }
      float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float vnoise3(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
          mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
          f.z);
      }
      void main() {
        vec4 t = texture(uTiles, vec3(vUv, vTile));
        bool leafy = vEmit > 1.5 && vEmit < 2.5;
        // Leaves have real gaps: what shows through one is the next layer of the crown, a block deeper and darker.
        if (t.a < 0.5) discard;
        float glows = vEmit > 0.5 && vEmit < 1.5 ? 1.0 : 0.0;
        bool lawn = vEmit > 3.5 && vEmit < 4.5;
        bool earth = lawn || vEmit > 5.5;
        if (earth) {
          // Natural ground is not a tile laid over and over. Every pixel of it is coloured by where
          // it lies in the world: fine grain that never repeats, gathered into small clumps and into
          // wider rich and thin patches, in the ground's own colours and in the shares its drawing gave them.
          int gi = lawn ? 0 : int(vEmit - 4.5);
          vec3 px = floor((vPos - vN * 0.02) * 16.0);
          float grain = hash3(px + 3.0);
          float clump = vnoise3(px / 2.6 + 11.0);
          float lush = vnoise3(px / 9.0 + 23.0) * 0.6 + vnoise3(px / 31.0 + 37.0) * 0.4;
          // Mostly the middle greens, in soft clumps; the darkest and lightest are rare.
          float v = 0.5 + (grain - 0.5) * 0.5 + (clump - 0.5) * 0.6 + (lush - 0.5) * 0.4;
          // Far off, a pixel covers many of the ground's; the grain gives way to the patches, and nothing shimmers.
          vec3 across = fwidth(vPos * 16.0);
          float fine = clamp(1.6 - max(across.x, max(across.y, across.z)) * 0.7, 0.0, 1.0);
          v = mix(0.5 + (lush - 0.5) * 0.5, v, fine);
          int rung = 0;
          for (int k = 0; k < 5; k++) if (v > uCut[gi * 5 + k]) rung = k + 1;
          vec3 g = uGround[gi * 6 + rung];
          if (hash3(px + 71.0) < uSpeck[gi].a * 0.5 * fine) g = uSpeck[gi].rgb;
          // Quiet ground: its colours are drawn in toward their middle, and a lawn sits a little deeper than it was drawn.
          g = mix(uGround[gi * 6 + 2], g, lawn ? 0.55 : 0.7) * (lawn ? 0.86 : 0.95);
          t = vec4(g, 1.0);
        }
        if (vEmit > 3.5 && vEmit < 5.5) {
          // A meadow is not one green either: its colour drifts slowly from place to place, the way
          // a block game blends grass colour across the land, and the tufts take the colour of
          // the ground they stand on.
          vec2 at = floor(vPos.xz);
          float drift = vnoise3(vec3(at * 0.06, 1.0)) * 0.65 + vnoise3(vec3(at * 0.17, 5.0)) * 0.35;
          t.rgb *= mix(vec3(0.9, 0.95, 0.88), vec3(1.03, 1.02, 0.95), drift);
          // The tufts are as deep a green as the lawn they grow from.
          if (!lawn) t.rgb *= 0.86;
        }
        if (leafy) {
          // No two boughs are one green: it runs warmer and lighter here, cooler and deeper there,
          // changing slowly across a crown and never in steps from one block to the next.
          vec3 at = floor((vPos - vN * 0.03) * 16.0) / 16.0;
          float bough = vnoise3(at * 0.09) * 0.65 + vnoise3(at * 0.23 + 9.0) * 0.35;
          t.rgb *= mix(vec3(0.86, 0.92, 0.99), vec3(1.12, 1.08, 0.9), bough);
        }
        // Each pixel of a tile leans its own way (the tile's relief), so light picks out a stone's
        // edge or a board's groove. The lean is turned from the tile's own axes to the world's by
        // how position and tile coordinate change across the screen, whichever way the face is turned.
        vec4 relief = texture(uRelief, vec3(vUv, vTile));
        vec3 lean = relief.xyz * 2.0 - 1.0;
        float smoothness = relief.a;
        vec3 n = vN;
        if (!leafy && !earth && abs(lean.x) + abs(lean.y) > 0.01) {
          vec3 px = dFdx(vPos), py = dFdy(vPos);
          vec2 ux = dFdx(vUv), uy = dFdy(vUv);
          vec3 right = px * uy.y - py * ux.y;
          vec3 up = py * ux.x - px * uy.x;
          float det = ux.x * uy.y - uy.x * ux.y;
          if (abs(det) > 1e-9) n = normalize(normalize(right * sign(det)) * lean.x + normalize(up * sign(det)) * lean.y + vN * lean.z);
        }
        vec3 toEye = normalize(cameraPosition - vPos);
        float side = vN.y > 0.5 ? 1.0 : vN.y < -0.5 ? 0.55 : abs(vN.x) > abs(vN.z) ? 0.88 : 0.74;
        side *= 0.86 + 0.28 * dot(n, vN) * (0.5 + 0.5 * dot(n, normalize(vec3(0.3, 1.0, 0.2))));
        // A crown is a soft mass: its faces differ less than a wall's do.
        if (leafy) side = mix(1.0, side, 0.5);
        float open = vLight.x * sqrt(sqrt(vLight.x));
        // Under the open sky a surface shows its own colour; shade goes down toward purple, and
        // night takes nearly all of it, leaving a dim blue for the lamps to stand against.
        vec3 lit = mix(vec3(1.0, 0.95, 1.06), vec3(0.14, 0.17, 0.36), uNight);
        vec3 shade = mix(vec3(0.20, 0.15, 0.30), vec3(0.05, 0.055, 0.13), uNight);
        vec3 sky = mix(shade, lit, open) * side * vLight.w;
        float toSun = dot(n, uSun) * step(0.0, dot(vN, uSun) + 0.2);
        // Foliage is lit from behind as well: the sun comes through it.
        float sunAmt = (leafy ? toSun * 0.3 + 0.5 : max(toSun, 0.0)) * vLight.z * (1.0 - uNight);
        vec3 sun = vec3(1.0, 0.62, 0.32) * sunAmt * 0.95;
        float flicker = 1.0 + 0.06 * sin(uTime * 9.0) + 0.04 * sin(uTime * 23.7) + 0.035 * sin(uTime * 4.3);
        // A lamp lights each point by how far it is and how squarely the surface faces it, so a log's
        // near side is bright and its far side is not. The flooded light says whether the lamp can
        // reach the point at all, which keeps it from shining through a wall.
        // The strongest lamp, the fire, throws shadows: whoever stands between it and this point
        // takes most of its light away, with a soft edge that widens with the figure.
        float clear = 1.0;
        for (int j = 0; j < ${CASTERS}; j++) {
          if (j >= uCasterN || uLampN < 1) break;
          vec3 foot = uCaster[j].xyz;
          float r = uCaster[j].w;
          vec2 off = vPos.xz - foot.xz;
          // Not the figure's own surface.
          if (dot(off, off) < r * r * 2.6 && vPos.y > foot.y + 0.04 && vPos.y < foot.y + uCasterH[j] + 0.4) continue;
          float gap = apart(vPos + vN * 0.03, uLamp[0].xyz, foot, foot + vec3(0.0, uCasterH[j], 0.0));
          // A low fire would throw a shadow right across the glade; it softens and fades a few blocks out.
          float far = length(off);
          float dark = (1.0 - smoothstep(r * 0.45, r * (1.25 + far * 0.12), gap)) * (1.0 - smoothstep(1.5, 6.5, far));
          clear *= 1.0 - dark;
        }
        float direct = 0.0;
        float shine = 0.0;
        for (int i = 0; i < ${LAMPS}; i++) {
          if (i >= uLampN) break;
          vec3 to = uLamp[i].xyz - vPos;
          float d = length(to);
          float k = d / uLamp[i].w;
          float fall = max(0.0, 1.0 - k * k);
          fall = fall * fall / (1.0 + d * d * 0.03);
          vec3 dir = to / max(d, 0.01);
          float facing = dot(n, dir);
          float shape = leafy ? facing * 0.25 + 0.6 : clamp(facing * 0.8 + 0.2, 0.0, 1.0);
          // A lamp behind the face lights none of its pixels, however they lean.
          shape *= leafy ? 1.0 : smoothstep(-0.25, 0.1, dot(vN, dir));
          float power = uLampSet[i].x * fall * mix(1.0, flicker, uLampSet[i].y);
          if (i == 0) power *= mix(0.15, 1.0, clear);
          // Some of a lamp's light comes round by way of everything else it lights, so a ledge above
          // the fire or a wall turned from it is dim, not black.
          direct += power * mix(0.2, 1.0, shape);
          // The lamp's own glint on what is smooth: glass, a lantern, worn stone.
          float glint = pow(max(dot(n, normalize(dir + toEye)), 0.0), mix(6.0, 90.0, smoothness));
          shine += power * glint * smoothness * step(0.0, facing);
        }
        float reach = smoothstep(0.02, 0.28, vLight.y);
        direct *= reach;
        shine *= reach;
        // What the lamps' light does after it lands: a soft warm fill wherever the flood reached.
        float reached = min(vLight.y, 1.0);
        // The warm fill near the fire is mostly the fire's own, so its shadows take some of that too.
        float fill = reached * reached * 0.9 * mix(1.0, vLight.w, 0.6) * mix(0.5, 1.0, clear);
        vec3 lamp = vec3(1.0, 0.58, 0.24) * (direct + fill) * mix(0.75, 1.0, uNight);
        // Away from the lamps, night takes the red out of things and leaves them blue.
        float lum = dot(t.rgb, vec3(0.4, 0.45, 0.15));
        vec3 cool = mix(t.rgb, vec3(lum) * vec3(0.9, 0.95, 1.25), uNight * 0.45);
        vec3 c = cool * sky + t.rgb * (sun + lamp);
        float sunGlint = pow(max(dot(n, normalize(uSun + toEye)), 0.0), mix(6.0, 90.0, smoothness)) * smoothness * sunAmt;
        c += vec3(1.0, 0.72, 0.42) * shine * 1.4 + vec3(1.0, 0.8, 0.55) * sunGlint;
        // The low sun lays a little gold on what it touches.
        c += vec3(0.83, 0.56, 0.27) * sunAmt * 0.14;
        // Bright light rolls off instead of burning out, the red first, so a hot spot goes to gold.
        vec3 over = max(c - 0.7, 0.0);
        c = min(c, 0.7) + over / (1.0 + over * 2.5);
        c = mix(c, t.rgb * 1.1, glows);
        vec3 eye = vPos - cameraPosition;
        float fd = max(length(eye) - uFogStart, 0.0) / 62.0;
        float f = 1.0 - exp(-fd * sqrt(fd));
        // The haze lies thicker near the ground.
        f *= mix(1.0, 0.75, clamp((vPos.y - 12.0) / 90.0, 0.0, 1.0));
        c = mix(c, fogColour(eye, uSun), clamp(f, 0.0, 1.0));
        // Alpha marks what gives light, for the glow that is laid over the picture afterwards.
        outColour = vec4(c, glows * (1.0 - clamp(f, 0.0, 1.0)));
      }`,
  });

  // The sky is worked out in screen cells a few pixels wide, so it is pixel art whatever the window.
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      depthFunc: THREE.LessEqualDepth,
      depthWrite: false,
      uniforms: {
        ...common(),
        uRes: { value: new THREE.Vector2(1, 1) },
        uPx: { value: 3 },
        uInvProj: { value: new THREE.Matrix4() },
        uCam: { value: new THREE.Matrix4() },
        uPal: { value: SKY.map(rgb) },
      },
      vertexShader: /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.999999, 1.0); }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec2 uRes;
        uniform float uPx;
        uniform mat4 uInvProj;
        uniform mat4 uCam;
        uniform vec3 uPal[12];
        ${SHARED}
        out vec4 outColour;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float bayer(vec2 c) {
          const float M[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
          return (M[int(mod(c.y, 4.0)) * 4 + int(mod(c.x, 4.0))] + 0.5) / 16.0;
        }
        void main() {
          vec2 cell = floor(gl_FragCoord.xy / uPx);
          vec2 ndc = (cell + 0.5) * uPx / uRes * 2.0 - 1.0;
          vec4 v = uInvProj * vec4(ndc, 1.0, 1.0);
          vec3 dir = normalize(mat3(uCam) * (v.xyz / v.w));
          float el = asin(clamp(dir.y, -1.0, 1.0)) / 1.5708;
          float da = atan(dir.z, dir.x) - atan(uSun.z, uSun.x);
          da = atan(sin(da), cos(da));
          float sunward = pow(0.5 + 0.5 * cos(da), 2.0);
          // Night climbs the sky from the far side; the last light stays low by the sun.
          float g = pow(max(el, 0.0), 0.55) * 11.0 + (1.0 - sunward) * 2.8 + uNight * (2.0 + 5.0 * (1.0 - sunward * (1.0 - el)));
          float streak = vnoise(vec2(da * 5.0, el * 80.0)) * 0.65 + vnoise(vec2(da * 13.0 + 7.0, el * 190.0)) * 0.35;
          float band = smoothstep(0.015, 0.07, el) * (1.0 - smoothstep(0.22, 0.42, el));
          if (streak > 0.6) g -= 1.7 * band * (1.0 - uNight * 0.5);
          vec3 c = uPal[int(clamp(floor(g + (bayer(cell) - 0.5) * 0.9), 0.0, 11.0))];
          if (g > 11.5) c *= 0.8;
          // Stars, high up and away from the glow; more of them as night comes on.
          vec3 a = abs(dir);
          vec2 face = a.y > a.x && a.y > a.z ? dir.xz / a.y : a.x > a.z ? dir.yz / a.x : dir.xy / a.z;
          float star = hash(floor(face * 110.0) + floor(a * 3.0).xy * 31.0);
          if (el > 0.12 && star > mix(0.9965, 0.989, uNight) && g > 6.0) c = mix(vec3(1.0, 0.92, 0.75), c, 0.25 + 0.2 * sin(uTime * 2.0 + star * 900.0));
          // The far forest: three rows of spruce points, each hazier than the one in front.
          for (int k = 0; k < 3; k++) {
            float fk = float(k);
            float x = da * (58.0 - fk * 14.0) + fk * 17.3;
            float l = fract(x);
            float h = (0.3 + 0.7 * hash(vec2(floor(x), fk))) * (1.0 - abs(2.0 * l - 1.0));
            h -= 0.05 * step(0.5, fract(l * 7.0));
            float line = 0.012 + fk * 0.004 + (0.05 + fk * 0.035) * h;
            if (el < line) c = mix(fogColour(dir, uSun), vec3(0.19, 0.105, 0.26) * (1.0 - uNight * 0.5), 0.25 + fk * 0.25);
          }
          if (el < 0.0) c = fogColour(dir, uSun);
          outColour = vec4(c, 0.0);
        }`,
    }),
  );
  sky.frustumCulled = false;
  // The sky sits at the far plane and passes the depth test only where the world left a gap.
  scene.add(sky);

  const attributes = (geo: THREE.BufferGeometry, buf: THREE.InterleavedBuffer): void => {
    geo.setAttribute("position", new THREE.InterleavedBufferAttribute(buf, 3, 0));
    geo.setAttribute("aUv", new THREE.InterleavedBufferAttribute(buf, 4, 3));
    geo.setAttribute("normal", new THREE.InterleavedBufferAttribute(buf, 3, 7));
    geo.setAttribute("aLight", new THREE.InterleavedBufferAttribute(buf, 4, 10));
  };
  const CHUNK = 24;
  let chunks: THREE.Mesh[] = [];
  /** Builds the world's meshes from its blocks as they now are, in place of any built before. */
  const remesh = (): void => {
    for (const c of chunks) {
      scene.remove(c);
      c.geometry.dispose();
    }
    chunks = [];
    for (let z = 0; z < world.sz; z += CHUNK)
      for (let x = 0; x < world.sx; x += CHUNK) {
        const m = meshRegion(world, sun, x, z, Math.min(world.sx, x + CHUNK), Math.min(world.sz, z + CHUNK));
        if (!m.ni) continue;
        const geo = new THREE.BufferGeometry();
        attributes(geo, new THREE.InterleavedBuffer(m.data.subarray(0, m.nv * STRIDE), STRIDE));
        geo.setIndex(new THREE.BufferAttribute(m.index.subarray(0, m.ni), 1));
        geo.boundingSphere = new THREE.Sphere(
          new THREE.Vector3(x + CHUNK / 2, world.sy / 2, z + CHUNK / 2),
          Math.hypot(CHUNK, world.sy, CHUNK) / 2,
        );
        const mesh = new THREE.Mesh(geo, blocks);
        chunks.push(mesh);
        scene.add(mesh);
      }
  };
  remesh();
  if (set.beyond?.ni) {
    const m = set.beyond;
    const geo = new THREE.BufferGeometry();
    attributes(geo, new THREE.InterleavedBuffer(m.data.subarray(0, m.nv * STRIDE), STRIDE));
    geo.setIndex(new THREE.BufferAttribute(m.index.subarray(0, m.ni), 1));
    const far = new THREE.Mesh(geo, blocks);
    far.frustumCulled = false;
    scene.add(far);
  }

  // The moving things share the blocks' shader; their corners are rewritten every frame.
  const dyn = new Dyn();
  const dynBuf = new THREE.InterleavedBuffer(dyn.data, STRIDE);
  dynBuf.setUsage(THREE.DynamicDrawUsage);
  const dynGeo = new THREE.BufferGeometry();
  attributes(dynGeo, dynBuf);
  const quads = dyn.data.length / STRIDE / 4;
  const index = new Uint32Array(quads * 6);
  for (let q = 0; q < quads; q++) index.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
  dynGeo.setIndex(new THREE.BufferAttribute(index, 1));
  const dynMesh = new THREE.Mesh(dynGeo, blocks);
  dynMesh.frustumCulled = false;
  scene.add(dynMesh);

  const points = (
    pos: readonly V3[],
    extra: number[],
    vertex: string,
    fragment: string,
    depthTest = true,
  ): THREE.Points => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos.flat()), 3));
    g.setAttribute("aData", new THREE.BufferAttribute(new Float32Array(extra), 2));
    const p = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        transparent: true,
        depthWrite: false,
        depthTest,
        blending: THREE.AdditiveBlending,
        uniforms: common(),
        vertexShader: `in vec2 aData;\nuniform float uTime;\nuniform float uScale;\nout float vA;\n${vertex}`,
        fragmentShader: `precision highp float;\nin float vA;\nout vec4 outColour;\n${fragment}`,
      }),
    );
    p.frustumCulled = false;
    scene.add(p);
    return p;
  };

  // Fireflies: small square lights that drift and blink.
  points(
    set.flies,
    set.flies.flatMap((_, i) => [ihash(i, 0, 0, 5) * 6.283, 0]),
    /* glsl */ `void main() {
      vec3 p = position + vec3(sin(uTime * 0.31 + aData.x * 3.0), sin(uTime * 0.47 + aData.x) * 0.6, cos(uTime * 0.29 + aData.x * 2.0)) * 1.4;
      vec4 mv = viewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(uScale * 0.35 / -mv.z, 2.0, 7.0);
      vA = smoothstep(-0.2, 0.5, sin(uTime * 1.3 + aData.x * 5.0));
    }`,
    /* glsl */ `void main() {
      vec2 d = abs(gl_PointCoord - 0.5);
      float core = step(max(d.x, d.y), 0.2);
      outColour = vec4(mix(vec3(0.75, 0.52, 0.16) * 0.35, vec3(1.0, 0.9, 0.55), core) * vA, 1.0);
    }`,
  );

  // Sparks from the fire: each rises, drifts and goes out, then starts again.
  const fire = set.fire;
  points(
    fire ? Array.from({ length: 34 }, () => fire) : [],
    Array.from({ length: fire ? 34 : 0 }, (_, i) => [ihash(i, 1, 0, 6), ihash(i, 2, 0, 6)]).flat(),
    /* glsl */ `void main() {
      float life = fract(uTime * (0.16 + aData.y * 0.14) + aData.x);
      float a = aData.x * 40.0;
      vec3 p = position + vec3(sin(a) * 0.3 + sin(uTime * 1.3 + a) * 0.35 * life, 0.6 + life * (3.0 + aData.y * 3.5), cos(a) * 0.3 + cos(uTime * 1.1 + a * 1.7) * 0.35 * life);
      vec4 mv = viewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(uScale * 0.11 / -mv.z, 2.0, 6.0);
      vA = (1.0 - life) * (1.0 - life);
    }`,
    /* glsl */ `void main() { outColour = vec4(mix(vec3(0.9, 0.3, 0.1), vec3(1.0, 0.85, 0.5), vA) * min(1.0, vA * 2.0), 1.0); }`,
  );

  // The glow of lights in the air. What gives light was marked in the picture's alpha; that part is
  // blurred at three sizes and laid back over the picture, then the corners are drawn in a little.
  renderer.setClearColor(0x000000, 0);
  renderer.info.autoReset = false;
  const picture = new THREE.WebGLRenderTarget(1, 1, { samples: devicePixelRatio > 1.25 ? 0 : 4 });
  const levels = [2, 4, 8].map((div) => ({
    div,
    a: new THREE.WebGLRenderTarget(1, 1),
    b: new THREE.WebGLRenderTarget(1, 1),
  }));
  const flat = /* glsl */ `out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
  const pass = (uniforms: Record<string, THREE.IUniform>, body: string): THREE.ShaderMaterial =>
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      depthTest: false,
      depthWrite: false,
      uniforms,
      vertexShader: flat,
      fragmentShader: `precision highp float;\nin vec2 vUv;\nout vec4 outColour;\n${body}`,
    });
  const take = pass(
    { tMap: { value: null }, uMask: { value: 1 } },
    /* glsl */ `uniform sampler2D tMap; uniform float uMask;
    void main() { vec4 c = texture(tMap, vUv); outColour = vec4(c.rgb * mix(1.0, min(c.a, 1.0), uMask), 1.0); }`,
  );
  const blur = pass(
    { tMap: { value: null }, uStep: { value: new THREE.Vector2() } },
    /* glsl */ `uniform sampler2D tMap; uniform vec2 uStep;
    void main() {
      vec3 c = texture(tMap, vUv).rgb * 0.227;
      c += (texture(tMap, vUv + uStep * 1.385).rgb + texture(tMap, vUv - uStep * 1.385).rgb) * 0.316;
      c += (texture(tMap, vUv + uStep * 3.231).rgb + texture(tMap, vUv - uStep * 3.231).rgb) * 0.0703;
      outColour = vec4(c, 1.0);
    }`,
  );
  const join = pass(
    {
      tMap: { value: picture.texture },
      tNear: { value: levels[0]!.a.texture },
      tMid: { value: levels[1]!.a.texture },
      tFar: { value: levels[2]!.a.texture },
      uNight: { value: set.night ?? 0 },
    },
    /* glsl */ `uniform sampler2D tMap; uniform sampler2D tNear; uniform sampler2D tMid; uniform sampler2D tFar; uniform float uNight;
    void main() {
      vec3 c = texture(tMap, vUv).rgb;
      vec3 glow = texture(tNear, vUv).rgb * 0.16 + texture(tMid, vUv).rgb * 0.4 + texture(tFar, vUv).rgb * 0.6;
      c += glow * mix(0.4, 0.75, uNight);
      vec2 q = (vUv - 0.5) * vec2(1.0, 0.82);
      c *= mix(1.0, 0.74, smoothstep(0.32, 0.86, length(q)) * mix(0.5, 1.0, uNight));
      outColour = vec4(c, 1.0);
    }`,
  );
  const quad = new FullScreenQuad(take);
  const draw = (material: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget | null): void => {
    quad.material = material;
    renderer.setRenderTarget(to);
    quad.render(renderer);
  };

  const out: Stage = {
    renderer,
    scene,
    camera,
    dyn,
    fogStart: 40,
    remesh,
    resize() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      // Setting a canvas's size clears it, even to the size it has, so only when it changes.
      const now = renderer.getSize(new THREE.Vector2());
      if (now.x === w && now.y === h) return;
      renderer.setSize(w, h, false);
      const px = renderer.getDrawingBufferSize(new THREE.Vector2());
      picture.setSize(px.x, px.y);
      for (const l of levels) {
        l.a.setSize(Math.ceil(px.x / l.div), Math.ceil(px.y / l.div));
        l.b.setSize(Math.ceil(px.x / l.div), Math.ceil(px.y / l.div));
      }
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    frame(time) {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      each("uTime", time);
      each("uFogStart", out.fogStart);
      each("uScale", size.y);
      camera.updateMatrixWorld();
      const s = sky.material.uniforms;
      s.uRes!.value.copy(size);
      s.uPx!.value = Math.max(2, Math.round(size.y / 300));
      s.uInvProj!.value.copy(camera.projectionMatrixInverse);
      s.uCam!.value.copy(camera.matrixWorld);
      dynBuf.needsUpdate = true;
      dynGeo.setDrawRange(0, dyn.quads * 6);
      renderer.info.reset();
      renderer.setRenderTarget(picture);
      renderer.render(scene, camera);
      let from = picture.texture;
      for (const [i, l] of levels.entries()) {
        take.uniforms.tMap!.value = from;
        take.uniforms.uMask!.value = i ? 0 : 1;
        draw(take, l.a);
        for (let turn = 0; turn < 2; turn++) {
          blur.uniforms.tMap!.value = l.a.texture;
          blur.uniforms.uStep!.value.set(1 / l.a.width, 0);
          draw(blur, l.b);
          blur.uniforms.tMap!.value = l.b.texture;
          blur.uniforms.uStep!.value.set(0, 1 / l.a.height);
          draw(blur, l.a);
        }
        from = l.a.texture;
      }
      draw(join, null);
    },
  };
  return out;
}
