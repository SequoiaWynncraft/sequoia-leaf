/** Draws a world: the block meshes with their baked light, the moving things, a pixel sky, glows and sparks. */
import * as THREE from "three";

import { paintTile, TILE, tileNames } from "../art/tiles.ts";
import { Dyn } from "./actors.ts";
import { meshRegion, STRIDE } from "./mesh.ts";
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

function tiles(): THREE.DataArrayTexture {
  const names = tileNames();
  const data = new Uint8Array(TILE * TILE * 4 * names.length);
  names.forEach((name, layer) => {
    const px = paintTile(name);
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

export interface Glow {
  readonly at: V3;
  /** How wide the halo is, in blocks. */
  readonly size: number;
  readonly flicker: boolean;
}

export interface Scene {
  readonly world: World;
  readonly sun: V3;
  readonly flies: readonly V3[];
  readonly glows?: readonly Glow[];
  /** Where sparks rise from. */
  readonly fire?: V3;
  /** 0 is sunset, 1 is full night. */
  readonly night?: number;
}

export interface Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** The moving things: fill it before each frame. */
  readonly dyn: Dyn;
  /** Where the fog begins, in blocks from the eye. */
  fogStart: number;
  frame(time: number): void;
  resize(): void;
}

export function stage(canvas: HTMLCanvasElement, set: Scene): Stage {
  const { world, sun } = set;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
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

  const blocks = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...common(), uTiles: { value: tiles() } },
    vertexShader: /* glsl */ `
      in vec4 aUv;
      in vec4 aLight;
      out vec2 vUv;
      out float vTile;
      out float vEmit;
      out vec4 vLight;
      out vec3 vN;
      out vec3 vPos;
      void main() {
        vUv = aUv.xy;
        vTile = aUv.z;
        vEmit = aUv.w;
        vLight = aLight;
        vN = normal;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      precision highp sampler2DArray;
      uniform sampler2DArray uTiles;
      ${SHARED}
      in vec2 vUv;
      in float vTile;
      in float vEmit;
      in vec4 vLight;
      in vec3 vN;
      in vec3 vPos;
      out vec4 outColour;
      void main() {
        vec4 t = texture(uTiles, vec3(vUv, vTile));
        if (t.a < 0.5) discard;
        float side = vN.y > 0.5 ? 1.0 : vN.y < -0.5 ? 0.55 : abs(vN.x) > abs(vN.z) ? 0.88 : 0.74;
        float open = vLight.x * sqrt(sqrt(vLight.x));
        // Under the open sky a surface shows its own colour; shade goes down toward purple, night toward blue.
        vec3 lit = mix(vec3(1.0, 0.95, 1.06), vec3(0.34, 0.37, 0.72), uNight);
        vec3 shade = mix(vec3(0.20, 0.15, 0.30), vec3(0.07, 0.07, 0.17), uNight);
        vec3 sky = mix(shade, lit, open) * side * vLight.w;
        float sunAmt = max(dot(vN, uSun), 0.0) * vLight.z * (1.0 - uNight);
        vec3 sun = vec3(1.0, 0.62, 0.32) * sunAmt * 0.95;
        float flicker = 1.0 + 0.05 * sin(uTime * 9.0) + 0.035 * sin(uTime * 23.7) + 0.03 * sin(uTime * 4.3);
        float lampAmt = vLight.y * vLight.y;
        vec3 lamp = vec3(1.0, 0.68, 0.36) * lampAmt * mix(1.7, 2.5, uNight) * flicker * mix(1.0, vLight.w, 0.6);
        // Firelight turns what it falls on toward gold, whatever its own colour, as a real fire does.
        float lum = dot(t.rgb, vec3(0.4, 0.45, 0.15));
        vec3 warm = mix(t.rgb, vec3(lum) * vec3(1.5, 1.12, 0.62), min(1.0, lampAmt * 0.75));
        // Away from the fire, night takes the red out of things and leaves them blue.
        vec3 cool = mix(t.rgb, vec3(lum) * vec3(0.9, 0.95, 1.25), uNight * 0.45);
        vec3 c = cool * sky + t.rgb * sun + warm * lamp;
        // The low sun lays a little gold on what it touches, as the welcome's rim light does.
        c += vec3(0.83, 0.56, 0.27) * sunAmt * 0.14;
        // Keep the brightest light from burning out.
        vec3 over = max(c - 0.62, 0.0);
        c = min(c, 0.62) + over / (1.0 + over * 2.2);
        c = mix(c, t.rgb * 1.15, vEmit);
        vec3 eye = vPos - cameraPosition;
        float fd = max(length(eye) - uFogStart, 0.0) / 62.0;
        float f = 1.0 - exp(-fd * sqrt(fd));
        // The haze lies thicker near the ground.
        f *= mix(1.0, 0.75, clamp((vPos.y - 12.0) / 90.0, 0.0, 1.0));
        c = mix(c, fogColour(eye, uSun), clamp(f, 0.0, 1.0));
        outColour = vec4(c, 1.0);
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
          outColour = vec4(c, 1.0);
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
      scene.add(new THREE.Mesh(geo, blocks));
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

  // Halos round the fire and the lamps: warm light in the air, stepped like the sky's bands.
  const glows = set.glows ?? [];
  points(
    glows.map((g) => g.at),
    glows.flatMap((g) => [g.size, g.flicker ? 1 : 0]),
    /* glsl */ `void main() {
      vec4 mv = viewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      float flick = 1.0 + aData.y * (0.06 * sin(uTime * 9.0) + 0.04 * sin(uTime * 23.7));
      gl_PointSize = min(uScale * 1.5 * aData.x * flick / -mv.z, 900.0);
      vA = flick * (aData.x > 5.0 ? 1.0 : 0.8);
    }`,
    /* glsl */ `void main() {
      float r = length(gl_PointCoord - 0.5) * 2.0;
      float a = max(0.0, 1.0 - r);
      a = a * a * 0.34;
      outColour = vec4(vec3(1.0, 0.62, 0.28) * a * vA, 1.0);
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

  const out: Stage = {
    renderer,
    scene,
    camera,
    dyn,
    fogStart: 40,
    resize() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      renderer.setSize(w, h, false);
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
      renderer.render(scene, camera);
    },
  };
  return out;
}
