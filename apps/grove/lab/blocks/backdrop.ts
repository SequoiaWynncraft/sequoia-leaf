/** The world beyond the island: time-of-day presets, layered conifer silhouettes and the guild's Great Sequoia. */
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  NearestFilter,
  NoColorSpace,
  RepeatWrapping,
  Vector3,
} from "three";
import { Rng } from "./rng.ts";
import { shared, silhouetteMaterial, sky } from "./shaders.ts";

const lin = (h: string): Vector3 => {
  const c = new Color(h);
  return new Vector3(c.r, c.g, c.b).set(Math.pow(c.r, 2.2), Math.pow(c.g, 2.2), Math.pow(c.b, 2.2));
};
/** Colours below come from the welcome scenes' forest palette and are given in display (sRGB) space. */
const col = (h: string): Color => {
  const c = new Color(h);
  return new Color(Math.pow(c.r, 2.2), Math.pow(c.g, 2.2), Math.pow(c.b, 2.2));
};

export type TimeOfDay = "dusk" | "day" | "night";

type L3 = [number, number, number];

interface Preset {
  sunward: string[];
  away: string[];
  sunElev: number;
  /** Linear light colours. */
  sunColor: L3;
  ambTop: L3;
  ambBottom: L3;
  sunDisc: string;
  fog: string;
  fogSun: string;
  fogDensity: number;
  mist: string;
  cloudLit: string;
  cloudDark: string;
  clouds: number;
  stars: number;
  /** Far to near: the ridge, then four forest layers. */
  layers: { color: string; rim: string; haze: string }[];
  great: { color: string; rim: string; haze: string };
  exposure: number;
  lift: L3;
  fireflies: number;
  fire: number;
}

const layer = (color: string, rim: string, haze: string) => ({ color, rim, haze });

/** Seven layers from the far ridge to the nearest forest, stepping from hazy and light to dark and close. */
function ramp7(far: [string, string, string], near: [string, string, string]): { color: string; rim: string; haze: string }[] {
  const mixHex = (a: string, b: string, k: number) => {
    const ca = new Color(a);
    const cb = new Color(b);
    return `#${ca.lerp(cb, k).getHexString()}`;
  };
  return Array.from({ length: 7 }, (_, i) => {
    const k = (i / 6) ** 0.85;
    return layer(mixHex(far[0], near[0], k), mixHex(far[1], near[1], k), mixHex(far[2], near[2], k));
  });
}

export const PRESETS: Record<TimeOfDay, Preset> = {
  dusk: {
    // below horizon → zenith
    sunward: ["#2c1640", "#4c256a", "#86388e", "#c8607c", "#f5b95e", "#e67967", "#d06170", "#b84d84", "#7a348a", "#3d2050"],
    away: ["#24122e", "#3d2050", "#68347a", "#9a4486", "#c25a80", "#a24484", "#8a3a8c", "#723086", "#5a296e", "#321b3c"],
    sunElev: 0.3,
    sunColor: [2.05, 1.28, 0.7],
    ambTop: [0.46, 0.34, 0.64],
    ambBottom: [0.27, 0.15, 0.14],
    sunDisc: "#ffe3a0",
    fog: "#7a3a86",
    fogSun: "#d0706e",
    fogDensity: 0.0026,
    mist: "#6e3282",
    cloudLit: "#f2a070",
    cloudDark: "#a24768",
    clouds: 0.55,
    stars: 0.85,
    layers: ramp7(["#924088", "#d8807e", "#cc6a7a"], ["#2e1846", "#5a2c60", "#5a2a74"]),
    great: layer("#7a3c84", "#e8927e", "#b45a88"),
    exposure: 1.0,
    lift: [0.03, 0.0, 0.05],
    fireflies: 1,
    fire: 1,
  },
  day: {
    sunward: ["#5a6890", "#7a88aa", "#a0aec8", "#cdd6e2", "#f2e6c8", "#d4e0ea", "#b8cce4", "#9ab8de", "#7ea2d6", "#6088c8"],
    away: ["#525e86", "#7280a2", "#97a4c0", "#c0cad8", "#dce0e6", "#c4d4e4", "#aac4e2", "#90b2dc", "#769cd2", "#5c82c2"],
    sunElev: 0.62,
    sunColor: [1.5, 1.35, 1.06],
    ambTop: [0.56, 0.63, 0.84],
    ambBottom: [0.33, 0.28, 0.22],
    sunDisc: "#fff6dc",
    fog: "#aab8d0",
    fogSun: "#e8dcc4",
    fogDensity: 0.002,
    mist: "#98a6c2",
    cloudLit: "#fffaf0",
    cloudDark: "#c8d0e2",
    clouds: 0.5,
    stars: 0,
    layers: ramp7(["#9eacc6", "#c4ccd8", "#c8d2e2"], ["#46565e", "#66766a", "#8492aa"]),
    great: layer("#8a98b2", "#ccc4ac", "#b4c0d4"),
    exposure: 1.0,
    lift: [0.01, 0.01, 0.02],
    fireflies: 0,
    fire: 0.55,
  },
  night: {
    sunward: ["#0e0b22", "#17112e", "#251c4c", "#352a66", "#4a3c80", "#3a2e6e", "#2c225a", "#21194a", "#18123a", "#0f0b26"],
    away: ["#0c0a1e", "#140f2a", "#1e1744", "#2a2158", "#382c6a", "#2c2258", "#211a4a", "#1a143e", "#130f32", "#0c0920"],
    sunElev: 0.42,
    sunColor: [0.8, 0.9, 1.6],
    ambTop: [0.24, 0.24, 0.5],
    ambBottom: [0.07, 0.06, 0.11],
    sunDisc: "#eef2ff",
    fog: "#262050",
    fogSun: "#3a3270",
    fogDensity: 0.003,
    mist: "#241e4c",
    cloudLit: "#3e3a70",
    cloudDark: "#1c1838",
    clouds: 0.35,
    stars: 1.4,
    layers: ramp7(["#4a4288", "#6c64aa", "#5a52a0"], ["#0e0b24", "#2c2758", "#2a2458"]),
    great: layer("#2a2458", "#4a4686", "#3a3270"),
    exposure: 1.0,
    lift: [0.02, 0.015, 0.05],
    fireflies: 1.6,
    fire: 1.35,
  },
};

/** Sun azimuth: low behind the island's right shoulder from the default view. */
/** Key light: golden hour from the front right of the default view. */
export const SUN_AZIMUTH = 0.4;
/** The sunset glow in the sky, behind the glade from the default view. */
export const GLOW_AZIMUTH = -1.32;
/** Where the guild's Great Sequoia stands, far off across the valley. */
export const GREAT_AZIMUTH = -2.2;

export function applyPreset(time: TimeOfDay): Preset {
  const p = PRESETS[time];
  const elev = p.sunElev;
  const az = time === "night" ? SUN_AZIMUTH + 1.15 : SUN_AZIMUTH;
  shared.uSunDir.value.set(Math.cos(az) * Math.cos(Math.asin(elev)), elev, Math.sin(az) * Math.cos(Math.asin(elev))).normalize();
  const glowElev = time === "day" ? 0.5 : time === "night" ? 0.062 : 0.035;
  const gaz = time === "night" ? GLOW_AZIMUTH - 0.5 : GLOW_AZIMUTH;
  shared.uGlowDir.value.set(Math.cos(gaz) * Math.cos(Math.asin(glowElev)), glowElev, Math.sin(gaz) * Math.cos(Math.asin(glowElev))).normalize();
  shared.uSunColor.value.setRGB(...p.sunColor);
  shared.uAmbTop.value.setRGB(...p.ambTop);
  shared.uAmbBottom.value.setRGB(...p.ambBottom);
  shared.uFogDensity.value = p.fogDensity;
  shared.uFogColor.value.copy(col(p.fog));
  shared.uFogSun.value.copy(col(p.fogSun));
  shared.uMist.value.copy(col(p.mist));
  p.sunward.forEach((h, i) => sky.uSunward.value[i]?.copy(lin(h)));
  p.away.forEach((h, i) => sky.uAway.value[i]?.copy(lin(h)));
  sky.uSunDisc.value.copy(lin(p.sunDisc));
  sky.uCloudLit.value.copy(lin(p.cloudLit));
  sky.uCloudDark.value.copy(lin(p.cloudDark));
  sky.uCloudAmount.value = p.clouds;
  sky.uStars.value = p.stars;
  return p;
}

// ---------------------------------------------------------------- silhouettes

/** Texels round the full circle for every layer, so all layers share one pixel size in angle. */
const AROUND = 4800;

function makeTex(canvas: HTMLCanvasElement, repeat: boolean): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  if (repeat) tex.wrapS = RepeatWrapping;
  tex.colorSpace = NoColorSpace;
  return tex;
}

/** Writes a one-bit mask to RGBA: R/alpha = mask, G = left rim, B = right rim, R≈0.7 = lantern. */
function encode(mask: Uint8Array, w: number, h: number, rng: Rng, lantern?: Uint8Array): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d");
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const left = !mask[y * w + ((x - 1 + w) % w)];
      const right = !mask[y * w + ((x + 1) % w)];
      const up = y > 0 && !mask[i - w];
      img.data[i * 4] = lantern?.[i] ? 180 : 255;
      img.data[i * 4 + 1] = left || (up && rng.chance(0.5)) ? 255 : 0;
      img.data[i * 4 + 2] = right || (up && rng.chance(0.5)) ? 255 : 0;
      img.data[i * 4 + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Conifer spires with tiered, stepped edges standing on a rolling forest floor. Tree heights in texels. */
function forestStrip(seed: string, w: number, h: number, minH: number, maxH: number, spacing: number, groundRows: number): CanvasTexture {
  const rng = new Rng(seed);
  const mask = new Uint8Array(w * h);
  const ph = rng.next() * 10;
  const groundAt = (x: number) => Math.round(h - groundRows - 3 * Math.sin((x / w) * Math.PI * 8 + ph) - 2 * Math.sin((x / w) * Math.PI * 22 + ph * 2));
  for (let x = 0; x < w; x++) for (let y = Math.max(0, groundAt(x)); y < h; y++) mask[y * w + x] = 1;
  let x = rng.int(0, 6);
  while (x < w) {
    // Heights vary in groves: a slow wave plus a little per-tree spread, never uniform.
    const grove = 0.5 + 0.5 * Math.sin((x / w) * Math.PI * 10 + ph * 3);
    const tall = Math.round(minH + (maxH - minH) * (0.35 * grove + 0.65 * rng.next() ** 1.4));
    const hw = Math.max(2, Math.round(tall * rng.range(0.17, 0.23)));
    const base = groundAt(x) + 1;
    const tier = rng.int(3, 5);
    for (let k = 0; k < tall; k++) {
      const y = base - k;
      if (y < 0) break;
      const t = k / tall;
      const step = (tall - k) % tier;
      let half = hw * (1 - t) ** 0.9 + (step === 0 ? 1 : 0) * (1 - t) - (step === tier - 1 ? 0.6 : 0) * (1 - t);
      if (k >= tall - 2) half = 0;
      for (let xx = Math.round(x - half); xx <= Math.round(x + half); xx++) mask[y * w + ((xx % w) + w) % w] = 1;
    }
    x += Math.max(2, Math.round(hw * rng.range(0.8, 1.7) * spacing));
  }
  return makeTex(encode(mask, w, h, rng), true);
}

/** Far ridges: soft rolling hills with a fringe of tiny trees on their crests. */
function ridgeStrip(seed: string, w: number, h: number): CanvasTexture {
  const rng = new Rng(seed);
  const mask = new Uint8Array(w * h);
  const ph = rng.next() * 10;
  for (let x = 0; x < w; x++) {
    const u = x / w;
    const top = Math.round(h * 0.45 - h * 0.28 * (0.55 * Math.sin(u * Math.PI * 6 + ph) + 0.3 * Math.sin(u * Math.PI * 14 + ph * 1.7) + 0.15 * Math.sin(u * Math.PI * 34)));
    const fringe = rng.chance(0.5) ? rng.int(1, 3) : 0;
    for (let y = Math.max(0, top - fringe); y < h; y++) mask[y * w + x] = 1;
  }
  return makeTex(encode(mask, w, h, rng), true);
}

/** The Great Sequoia: a straight column of a trunk under a tall, rounded, clouded crown hung with lanterns. */
function greatSequoia(): CanvasTexture {
  const w = 112;
  const h = 448;
  const rng = new Rng("great-sequoia");
  const mask = new Uint8Array(w * h);
  const lantern = new Uint8Array(w * h);
  const cx = w / 2;
  for (let y = 60; y < h; y++) {
    const t = (y - 60) / (h - 60);
    const half = Math.round(4 + t * 4 + Math.max(0, t - 0.9) * 60);
    for (let x = cx - half; x <= cx + half; x++) mask[y * w + x] = 1;
  }
  const clumps: [number, number, number, number][] = [];
  let side = 1;
  for (let k = 0; k < 30; k++) {
    const y = 14 + k * 6.5 + rng.int(-2, 2);
    const t = (y - 10) / 200;
    const reach = Math.sin(Math.PI * (0.12 + 0.88 * Math.min(1, t))) ** 0.6 * 36 + 4;
    side = rng.chance(0.7) ? -side : side;
    const x = cx + side * rng.range(reach * 0.35, reach);
    clumps.push([x, y, rng.range(7, 11), rng.range(4.5, 6.5)]);
  }
  clumps.push([cx, 18, 12, 11]);
  for (let k = 0; k < 9; k++) clumps.push([cx + rng.range(-6, 6), 30 + k * 20, 18 + Math.sin((k / 8) * Math.PI) * 12, 12]);
  for (const [x0, y0, rx, ry] of clumps)
    for (let y = Math.floor(y0 - ry); y <= y0 + ry; y++)
      for (let x = Math.floor(x0 - rx); x <= x0 + rx; x++) {
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        const dy = y - y0;
        const d = ((x - x0) / rx) ** 2 + ((dy * (dy > 0 ? 1.6 : 1)) / ry) ** 2;
        if (d <= 1) mask[y * w + x] = 1;
        if (d > 0.4 && d < 0.8 && dy > 0 && rng.chance(0.045)) lantern[y * w + x] = 1;
      }
  return makeTex(encode(mask, w, h, rng, lantern), false);
}

export interface Backdrop {
  group: Group;
  apply(p: Preset): void;
}

const rad = (d: number) => (d * Math.PI) / 180;

export function buildBackdrop(): Backdrop {
  const group = new Group();
  // Each layer: radius, top and bottom elevation in degrees, tree heights in texels (one texel ≈ 0.15°).
  const layers = [
    { r: 600, top: 0.35, bottom: -2.5, kind: "ridge", seed: "ridge", minH: 0, maxH: 0, spacing: 1 },
    { r: 480, top: -0.5, bottom: -4, kind: "forest", seed: "l4", minH: 7, maxH: 15, spacing: 0.8 },
    { r: 380, top: -1.3, bottom: -6, kind: "forest", seed: "l3", minH: 9, maxH: 21, spacing: 0.85 },
    { r: 290, top: -2.6, bottom: -9, kind: "forest", seed: "l2", minH: 12, maxH: 29, spacing: 0.9 },
    { r: 220, top: -4.6, bottom: -13, kind: "forest", seed: "l1", minH: 15, maxH: 38, spacing: 1.0 },
    { r: 165, top: -7.5, bottom: -19, kind: "forest", seed: "l0", minH: 19, maxH: 50, spacing: 1.05 },
    { r: 125, top: -11.5, bottom: -28, kind: "forest", seed: "lm", minH: 24, maxH: 62, spacing: 1.1 },
  ];
  const mats = layers.map((l, i) => {
    const yTop = l.r * Math.tan(rad(l.top));
    const yBottom = l.r * Math.tan(rad(l.bottom));
    const texel = (Math.PI * 2 * l.r) / AROUND;
    const w = AROUND / 4;
    const h = Math.max(8, Math.ceil((yTop - yBottom) / texel));
    const tex = l.kind === "ridge" ? ridgeStrip(l.seed, w, h) : forestStrip(l.seed, w, h, l.minH, l.maxH, l.spacing, Math.max(4, h - (l.maxH + 4)));
    tex.repeat.set(4, 1);
    const m = silhouetteMaterial(tex, l.kind === "ridge" ? [0.0, 0.8] : [0.18, 0.74]);
    const geo = new CylinderGeometry(l.r, l.r, yTop - yBottom, 128, 1, true);
    const uv = geo.getAttribute("uv");
    for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * 4);
    const mesh = new Mesh(geo, m);
    mesh.position.y = (yTop + yBottom) / 2;
    mesh.renderOrder = -50 + i;
    mesh.frustumCulled = false;
    group.add(mesh);
    return m;
  });
  // The Great Sequoia: a far billboard that always turns to face us, towering over every ridge.
  const gTex = greatSequoia();
  const gr = 380;
  const centre = new Vector3(Math.cos(GREAT_AZIMUTH) * gr, gr * Math.tan(rad(-10)), Math.sin(GREAT_AZIMUTH) * gr);
  const gMat = silhouetteMaterial(gTex, [0.0, 0.3], true, centre);
  const gh = gr * (Math.tan(rad(5.2)) - Math.tan(rad(-10)));
  const gw = (gh * 112) / 448;
  const gGeo = new BufferGeometry();
  gGeo.setAttribute("position", new Float32BufferAttribute([-gw / 2, 0, 0, gw / 2, 0, 0, gw / 2, gh, 0, -gw / 2, gh, 0], 3));
  gGeo.setAttribute("uv", new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  gGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const great = new Mesh(gGeo, gMat);
  great.frustumCulled = false;
  great.renderOrder = -49.5;
  group.add(great);
  return {
    group,
    apply(p: Preset) {
      mats.forEach((m, i) => {
        const l = p.layers[i];
        if (!l) return;
        (m.uniforms.uColor!.value as Color).copy(col(l.color));
        (m.uniforms.uRim!.value as Color).copy(col(l.rim));
        (m.uniforms.uHaze!.value as Color).copy(col(l.haze));
      });
      (gMat.uniforms.uColor!.value as Color).copy(col(p.great.color));
      (gMat.uniforms.uRim!.value as Color).copy(col(p.great.rim));
      (gMat.uniforms.uHaze!.value as Color).copy(col(p.great.haze));
    },
  };
}
