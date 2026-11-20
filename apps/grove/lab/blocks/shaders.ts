/** GLSL for the blocks lab. Everything renders linear HDR into a target; the composite pass grades and upscales. */
import {
  type CanvasTexture,
  Color,
  CustomBlending,
  DoubleSide,
  GLSL3,
  type IUniform,
  Matrix4,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  type Texture,
  Vector2,
  Vector3,
  Vector4,
} from "three";

export const MAX_LIGHTS = 6;

/** GLSL3 materials declare their own output in three r187. */
const OUT = "layout(location = 0) out highp vec4 fragOut;\n#define gl_FragColor fragOut\n";

/** Uniforms every lit material shares, so one update reaches them all. */
export const shared = {
  uTime: { value: 0 },
  uSunDir: { value: new Vector3(0.5, 0.3, 0.2).normalize() },
  /** Where the sky glows: the sunset sits behind the glade even when the key light is stylised to the front. */
  uGlowDir: { value: new Vector3(0.3, 0.1, -0.95).normalize() },
  uSunColor: { value: new Color(1, 0.8, 0.6) },
  uAmbTop: { value: new Color(0.3, 0.24, 0.45) },
  uAmbBottom: { value: new Color(0.16, 0.1, 0.12) },
  uFogColor: { value: new Color(0.4, 0.2, 0.4) },
  uFogSun: { value: new Color(0.9, 0.5, 0.3) },
  uFogDensity: { value: 0.006 },
  uMist: { value: new Color(0.35, 0.18, 0.4) },
  uShadowMap: { value: null as Texture | null },
  uShadowMatrix: { value: new Matrix4() },
  uShadowTexel: { value: 1 / 2048 },
  uLightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector4(0, 0, 0, 0)) },
  uLightColor: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector3(0, 0, 0)) },
  uEmissive: { value: 3.5 },
  uPulse: { value: new Vector4(0, 0, 0, 0) },
  uWind: { value: 1 },
  uGlow: { value: new Vector4(0, 0, 0, 0) },
} satisfies Record<string, IUniform>;

const LIGHTING = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uGlowDir;
uniform vec3 uSunColor;
uniform vec3 uAmbTop;
uniform vec3 uAmbBottom;
uniform vec3 uFogColor;
uniform vec3 uFogSun;
uniform float uFogDensity;
uniform vec3 uMist;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowTexel;
uniform vec4 uLightPos[${MAX_LIGHTS}];
uniform vec3 uLightColor[${MAX_LIGHTS}];
uniform float uEmissive;
uniform vec4 uPulse;
uniform vec4 uGlow;

float shadowAt(vec3 wp) {
  vec4 sc = uShadowMatrix * vec4(wp, 1.0);
  vec3 c = sc.xyz / sc.w * 0.5 + 0.5;
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  float bias = 0.0009;
  float sum = 0.0;
  for (int i = -1; i <= 1; i++)
    for (int j = -1; j <= 1; j++) {
      float d = texture(uShadowMap, c.xy + vec2(float(i), float(j)) * uShadowTexel * 1.25).r;
      sum += step(c.z - bias, d);
    }
  return sum / 9.0;
}

vec3 pointLights(vec3 p, vec3 n, float ao) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    float r = uLightPos[i].w;
    if (r <= 0.0) continue;
    vec3 L = uLightPos[i].xyz - p;
    float d = length(L);
    float att = clamp(1.0 - d / r, 0.0, 1.0);
    att *= att;
    float lam = max(dot(n, L / max(d, 1e-3)), 0.0) * 0.7 + 0.3;
    acc += uLightColor[i] * att * lam * mix(0.6, 1.0, ao);
  }
  return acc;
}

vec3 applyFog(vec3 col, vec3 p) {
  vec3 v = p - cameraPosition;
  float dist = length(v);
  float fog = 1.0 - exp(-pow(dist * uFogDensity, 1.5));
  float sunward = pow(max(dot(normalize(v.xz + 1e-4), normalize(uGlowDir.xz + 1e-4)), 0.0), 3.0);
  vec3 fc = mix(uFogColor, uFogSun, sunward * 0.7);
  col = mix(col, fc, clamp(fog, 0.0, 1.0));
  // Mist pools in the valley under the island.
  float mist = smoothstep(-3.0, -18.0, p.y);
  return mix(col, uMist, mist * 0.9);
}
`;

const BLOCK_VERT = /* glsl */ `
in vec2 local;
in vec4 aoc;
in vec3 tint;
in vec4 fx;
in float bone;
out vec2 vUv;
out vec2 vLocal;
flat out vec4 vAo;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vTint;
out vec4 vFx;
uniform float uTime;
uniform float uWind;
#ifdef BONES
uniform mat4 uBones[16];
#endif
void main() {
  vec3 p = position;
  vec3 n = normal;
#ifdef BONES
  mat4 bm = uBones[int(bone + 0.5)];
  p = (bm * vec4(p, 1.0)).xyz;
  n = mat3(bm) * n;
#endif
  vec4 wp = modelMatrix * vec4(p, 1.0);
  float s = fx.y * uWind;
  if (s > 0.0) {
    vec3 q = floor(wp.xyz * 2.0) * 0.5;
    wp.x += s * (sin(uTime * 1.6 + q.x * 0.31 + q.y * 0.23) * 0.05 + sin(uTime * 0.7 + q.z * 0.17) * 0.035);
    wp.z += s * (cos(uTime * 1.3 + q.z * 0.29 + q.y * 0.19) * 0.05);
    wp.y += s * sin(uTime * 2.0 + q.x * 0.5 + q.z * 0.5) * 0.012;
  }
  vec2 uv2 = uv;
  if (fx.w > 1.5) {
    float phase = fract(sin(dot(floor(wp.xz), vec2(12.9898, 78.233))) * 43758.5453);
    uv2.x += floor(mod(uTime * 8.0 + phase * fx.w, fx.w)) * (32.0 / 512.0);
  }
  vUv = uv2;
  vLocal = local;
  vAo = aoc;
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * n);
  vTint = tint;
  vFx = fx;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const BLOCK_FRAG = /* glsl */ `
uniform sampler2D uMap;
in vec2 vUv;
in vec2 vLocal;
flat in vec4 vAo;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vTint;
in vec4 vFx;
${LIGHTING}
void main() {
  vec4 tex = texture(uMap, vUv);
#ifdef CUTOUT
  if (tex.a < 0.5) discard;
#endif
  vec3 alb = pow(tex.rgb, vec3(2.2)) * vTint;
  vec3 n = normalize(vNormal);
  vec3 p = vWorld;
  vec2 lc = vLocal;
#ifdef SNAP
  // Light per texel: snap the shading point to the 1/16 grid across the face, keep it on the face.
  vec3 an = abs(n);
  if (max(an.x, max(an.y, an.z)) > 0.99) {
    vec3 m = 1.0 - step(0.5, an);
    p = mix(p, (floor(p * 16.0) + 0.5) / 16.0, m);
    lc = (floor(vLocal * 16.0) + 0.5) / 16.0;
  }
#endif
  float ao = mix(mix(vAo.x, vAo.y, lc.x), mix(vAo.w, vAo.z, lc.x), lc.y);
  float sky = vFx.z;
  float ndl = max(dot(n, uSunDir), 0.0);
#ifdef PLANT
  ndl = 0.2 + 0.35 * max(uSunDir.y, 0.0);
#endif
  float sh = ndl > 0.0 ? shadowAt(p + n * 0.04) : 0.0;
  vec3 light = uSunColor * ndl * sh;
  vec3 amb = mix(uAmbBottom, uAmbTop, n.y * 0.5 + 0.5);
  light += amb * ao * sky;
  light += pointLights(p, n, ao);
  vec3 col = alb * light;
  float lum = dot(tex.rgb, vec3(0.3, 0.59, 0.11));
  col += alb * vFx.x * smoothstep(0.42, 0.8, lum) * uEmissive;
  // Growth pulse: a band of soft green light that climbs the tree.
  if (uPulse.w > 0.0) {
    float band = 1.0 - clamp(abs(p.y - uPulse.y) / 3.5, 0.0, 1.0);
    float near = 1.0 - clamp(length(p.xz - uPulse.xz) / 18.0, 0.0, 1.0);
    col += (alb * 2.0 + 0.05) * vec3(0.5, 1.0, 0.35) * band * band * near * uPulse.w * 3.0;
  }
  col += (alb * 0.9 + 0.05) * uGlow.rgb * uGlow.a;
  col = applyFog(col, p);
  gl_FragColor = vec4(col, 1.0);
}
`;

const DEPTH_FRAG = /* glsl */ `
uniform sampler2D uMap;
in vec2 vUv;
void main() {
#ifdef CUTOUT
  if (texture(uMap, vUv).a < 0.5) discard;
#endif
  gl_FragColor = vec4(1.0);
}
`;

export interface BlockOpts {
  cutout?: boolean;
  snap?: boolean;
  bones?: boolean;
  plant?: boolean;
  doubleSided?: boolean;
}

function defines(o: BlockOpts): Record<string, string> {
  const d: Record<string, string> = {};
  if (o.cutout) d.CUTOUT = "";
  if (o.snap) d.SNAP = "";
  if (o.bones) d.BONES = "";
  if (o.plant) d.PLANT = "";
  return d;
}

export function blockMaterial(map: Texture | CanvasTexture, o: BlockOpts = {}, bones?: Matrix4[]): ShaderMaterial {
  const uniforms: Record<string, IUniform> = { ...shared, uMap: { value: map } };
  if (bones) uniforms.uBones = { value: bones };
  const m = new ShaderMaterial({
    glslVersion: GLSL3,
    uniforms,
    vertexShader: BLOCK_VERT,
    fragmentShader: OUT + BLOCK_FRAG,
    defines: defines(o),
  });
  if (o.doubleSided) m.side = DoubleSide;
  return m;
}

export function depthMaterial(map: Texture | CanvasTexture, o: BlockOpts = {}, bones?: Matrix4[]): ShaderMaterial {
  const uniforms: Record<string, IUniform> = { uTime: shared.uTime, uWind: shared.uWind, uMap: { value: map } };
  if (bones) uniforms.uBones = { value: bones };
  const m = new ShaderMaterial({
    glslVersion: GLSL3,
    uniforms,
    vertexShader: BLOCK_VERT,
    fragmentShader: OUT + DEPTH_FRAG,
    defines: defines(o),
  });
  m.side = DoubleSide;
  return m;
}

// ---------------------------------------------------------------- sky

/** Sky stops: eight colours from below the horizon to the zenith, one set toward the sun and one away. */
export const sky = {
  uInvViewProj: { value: new Matrix4() },
  uCam: { value: new Vector3() },
  uSunward: { value: Array.from({ length: 10 }, () => new Vector3()) },
  uAway: { value: Array.from({ length: 10 }, () => new Vector3()) },
  uStops: { value: [-0.7, -0.3, -0.13, -0.035, 0.0, 0.05, 0.11, 0.21, 0.42, 1.0] },
  uSunDir: shared.uGlowDir,
  uSunDisc: { value: new Vector3(1, 0.9, 0.7) },
  uCloudLit: { value: new Vector3(1, 0.6, 0.45) },
  uCloudDark: { value: new Vector3(0.6, 0.3, 0.5) },
  uCloudAmount: { value: 0.5 },
  uStars: { value: 0.5 },
  uTime: shared.uTime,
  uRes: { value: new Vector2(800, 600) },
  uPixel: { value: 0.0015 },
} satisfies Record<string, IUniform>;

const NOISE = /* glsl */ `
float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float bayer4(vec2 p) {
  ivec2 q = ivec2(mod(p, 4.0));
  int i = q.x + q.y * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}
`;

const SKY_VERT = /* glsl */ `
out vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.9999, 1.0); }
`;

const SKY_FRAG = /* glsl */ `
uniform mat4 uInvViewProj;
uniform vec3 uCam;
uniform vec3 uSunward[10];
uniform vec3 uAway[10];
uniform float uStops[10];
uniform vec3 uSunDir;
uniform vec3 uSunDisc;
uniform vec3 uCloudLit;
uniform vec3 uCloudDark;
uniform float uCloudAmount;
uniform float uStars;
uniform float uTime;
uniform float uPixel;
in vec2 vNdc;
${NOISE}
vec3 ramp(vec3 c[10], float e) {
  vec3 col = c[0];
  for (int i = 0; i < 9; i++) {
    float t = clamp((e - uStops[i]) / (uStops[i + 1] - uStops[i]), 0.0, 1.0);
    if (e >= uStops[i]) col = mix(c[i], c[i + 1], t);
  }
  return col;
}
void main() {
  vec4 w = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(w.xyz / w.w - uCam);
  float az = max(dot(normalize(d.xz + 1e-4), normalize(uSunDir.xz + 1e-4)), -1.0);
  float sunward = pow(az * 0.5 + 0.5, 2.2);
  vec3 col = mix(ramp(uAway, d.y), ramp(uSunward, d.y), sunward);
  // Streaked clouds: stretched noise in a band above the horizon, lit from below toward the sun.
  vec3 q = d * vec3(3.2, 26.0, 3.2) + vec3(uTime * 0.01, 0.0, 0.0);
  float n = vnoise(q) * 0.62 + vnoise(q * 2.03 + 7.1) * 0.28 + vnoise(q * 4.1 + 3.3) * 0.1;
  float band = smoothstep(0.02, 0.1, d.y) * (1.0 - smoothstep(0.3, 0.52, d.y));
  float c = smoothstep(0.62 - uCloudAmount * 0.18, 0.74 - uCloudAmount * 0.18, n) * band;
  float lit = smoothstep(0.55, 0.85, vnoise(q + vec3(0.0, -0.6, 0.0))) * 0.5 + sunward * 0.6;
  vec3 cloud = mix(uCloudDark, uCloudLit, clamp(lit, 0.0, 1.0));
  col = mix(col, cloud, c * 0.85);
  // A sea of cloud below the horizon: soft banks whose tops catch the low sun.
  vec3 sq = d * vec3(4.5, 52.0, 4.5) + vec3(uTime * 0.006, 0.0, 0.0);
  float sn = vnoise(sq) * 0.6 + vnoise(sq * 2.1 + 3.7) * 0.3 + vnoise(sq * 4.3) * 0.1;
  float sea = smoothstep(-0.02, -0.08, d.y) * (1.0 - smoothstep(-0.45, -0.7, d.y));
  float bank = smoothstep(0.56, 0.64, sn) * sea;
  float rimLit = smoothstep(0.62, 0.5, vnoise(sq + vec3(0.0, 0.5, 0.0)) * 0.6 + vnoise((sq + vec3(0.0, 0.5, 0.0)) * 2.1 + 3.7) * 0.3 + 0.05);
  vec3 bankCol = mix(col * 1.18 + uCloudDark * 0.06, mix(col, uCloudLit, 0.55), rimLit * (0.35 + 0.65 * sunward));
  col = mix(col, bankCol, bank * 0.4);
  // Sun: a warm glow and a pale disc.
  float sd = dot(d, uSunDir);
  col += uSunDisc * pow(max(sd, 0.0), 24.0) * 0.35;
  col = mix(col, uSunDisc * 1.6, smoothstep(0.99935, 0.9996, sd));
  float moon = uStars > 1.0 ? smoothstep(0.99922, 0.99928, sd) : 0.0;
  vec3 md = floor(d * 900.0);
  float maria = step(0.62, vnoise(md * 0.18)) * 0.22 + step(0.8, h31(md)) * 0.08;
  col = mix(col, uSunDisc * (1.2 - maria), moon);
  // Stars twinkle in the upper sky, one cell of direction each.
  if (uStars > 0.0 && d.y > -0.005) {
    float cell = uPixel * 1.4;
    vec2 g = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0))) / cell;
    vec2 gi = floor(g);
    float r = h31(vec3(gi, 7.0));
    float vis = smoothstep(-0.01, 0.12, d.y) * (1.0 - c);
    if (r > 0.9965) {
      float tw = 0.55 + 0.45 * sin(uTime * (1.5 + r * 3.0) + r * 40.0);
      col = mix(col, vec3(1.0, 0.95, 1.0) * (0.9 + tw), vis * uStars * tw);
    }
  }
  // Pixel-art banding: quantise in display space with a 4x4 ordered dither.
  vec3 srgb = pow(max(col, 0.0), vec3(1.0 / 2.2));
  srgb = floor(srgb * 28.0 + bayer4(gl_FragCoord.xy)) / 28.0;
  gl_FragColor = vec4(pow(srgb, vec3(2.2)), 1.0);
}
`;

export function skyMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    uniforms: sky,
    vertexShader: SKY_VERT,
    fragmentShader: OUT + SKY_FRAG,
    depthWrite: false,
    depthTest: false,
  });
}

// ---------------------------------------------------------------- distant silhouettes

const SIL_VERT = /* glsl */ `
out vec2 vUv;
out vec3 vRel;
#ifdef BILLBOARD
uniform vec3 uCenter;
#endif
void main() {
  vUv = uv;
#ifdef BILLBOARD
  vec3 c = (modelMatrix * vec4(uCenter, 1.0)).xyz;
  vec3 toCam = normalize(vec3(cameraPosition.x - c.x, 0.0, cameraPosition.z - c.z));
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 wp = c + right * position.x + vec3(0.0, position.y, 0.0);
  vRel = uCenter;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
#else
  vRel = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
#endif
}
`;

const SIL_FRAG = /* glsl */ `
uniform sampler2D uMask;
uniform vec3 uColor;
uniform vec3 uRim;
uniform vec3 uHaze;
uniform vec3 uSunDir;
uniform vec3 uLantern;
uniform float uTime;
uniform vec2 uHazeRange;
in vec2 vUv;
in vec3 vRel;
void main() {
  vec4 m = texture(uMask, vUv);
  if (m.a < 0.5) discard;
  vec2 dir = normalize(vRel.xz + 1e-4);
  vec2 tangent = vec2(-dir.y, dir.x);
  float sunRight = dot(tangent, uSunDir.xz);
  float rim = sunRight > 0.0 ? m.b : m.g;
  float toward = max(dot(dir, normalize(uSunDir.xz + 1e-4)), 0.0);
  vec3 col = mix(uColor, uRim, rim * (0.25 + 0.75 * toward));
  float haze = smoothstep(uHazeRange.x, uHazeRange.y, vUv.y);
  col = mix(uHaze, col, haze);
  if (m.r > 0.5 && m.r < 0.9) {
    float ph = fract(sin(dot(floor(vUv * 512.0), vec2(12.9898, 78.233))) * 43758.5453);
    col = uLantern * (0.65 + 0.45 * sin(uTime * (0.8 + ph) + ph * 30.0));
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export function silhouetteMaterial(mask: Texture, hazeRange: [number, number], billboard = false, center?: Vector3): ShaderMaterial {
  const uniforms: Record<string, IUniform> = {
    uMask: { value: mask },
    uColor: { value: new Color() },
    uRim: { value: new Color() },
    uHaze: { value: new Color() },
    uHazeRange: { value: new Vector2(...hazeRange) },
    uSunDir: shared.uGlowDir,
    uLantern: { value: new Color(2.4, 1.5, 0.7) },
    uTime: shared.uTime,
  };
  if (center) uniforms.uCenter = { value: center };
  return new ShaderMaterial({
    glslVersion: GLSL3,
    uniforms,
    vertexShader: SIL_VERT,
    fragmentShader: OUT + SIL_FRAG,
    defines: billboard ? { BILLBOARD: "" } : {},
    side: DoubleSide,
    depthWrite: false,
  });
}

// ---------------------------------------------------------------- particles

const PART_VERT = /* glsl */ `
in vec4 pcolor;
in vec2 extra;
out vec4 vColor;
out float vAdd;
uniform float uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float s = extra.x * uScale / max(-mv.z, 0.1);
  gl_PointSize = clamp(floor(s + 0.5), 1.0, 7.0);
  vColor = pcolor;
  vAdd = extra.y;
}
`;

const PART_FRAG = /* glsl */ `
in vec4 vColor;
in float vAdd;
void main() {
  float a = vColor.a;
  gl_FragColor = vec4(vColor.rgb * a, a * (1.0 - vAdd));
}
`;

export function particleMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    uniforms: { uScale: { value: 400 } },
    vertexShader: PART_VERT,
    fragmentShader: OUT + PART_FRAG,
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
  });
}

// ---------------------------------------------------------------- post

const FS_VERT = /* glsl */ `
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export function brightMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    uniforms: { uSrc: { value: null }, uTexel: { value: new Vector2() }, uThreshold: { value: 0.9 } },
    vertexShader: FS_VERT,
    fragmentShader: OUT + /* glsl */ `
      uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uThreshold; in vec2 vUv;
      void main() {
        vec3 c = vec3(0.0);
        c += texture(uSrc, vUv + uTexel * vec2(-0.5, -0.5)).rgb;
        c += texture(uSrc, vUv + uTexel * vec2(0.5, -0.5)).rgb;
        c += texture(uSrc, vUv + uTexel * vec2(-0.5, 0.5)).rgb;
        c += texture(uSrc, vUv + uTexel * vec2(0.5, 0.5)).rgb;
        c *= 0.25;
        float l = max(c.r, max(c.g, c.b));
        float k = clamp((l - uThreshold) / max(l, 1e-4), 0.0, 1.0);
        gl_FragColor = vec4(c * k, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
}

export function blurMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    uniforms: { uSrc: { value: null }, uDir: { value: new Vector2() } },
    vertexShader: FS_VERT,
    fragmentShader: OUT + /* glsl */ `
      uniform sampler2D uSrc; uniform vec2 uDir; in vec2 vUv;
      void main() {
        vec3 c = texture(uSrc, vUv).rgb * 0.227;
        c += texture(uSrc, vUv + uDir * 1.385).rgb * 0.316;
        c += texture(uSrc, vUv - uDir * 1.385).rgb * 0.316;
        c += texture(uSrc, vUv + uDir * 3.231).rgb * 0.07;
        c += texture(uSrc, vUv - uDir * 3.231).rgb * 0.07;
        gl_FragColor = vec4(c, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
}

export function compositeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    uniforms: {
      uScene: { value: null },
      uBloomA: { value: null },
      uBloomB: { value: null },
      uBloom: { value: 0.6 },
      uExposure: { value: 1.0 },
      uLift: { value: new Vector3(0.05, 0.02, 0.08) },
      uGain: { value: new Vector3(1.02, 1.0, 0.98) },
      uVignette: { value: 0.35 },
      uVigColor: { value: new Vector3(0.12, 0.04, 0.16) },
      uFlash: { value: new Vector4(0, 0, 0, 0) },
    },
    vertexShader: FS_VERT,
    fragmentShader: OUT + /* glsl */ `
      uniform sampler2D uScene; uniform sampler2D uBloomA; uniform sampler2D uBloomB;
      uniform float uBloom; uniform float uExposure; uniform vec3 uLift; uniform vec3 uGain;
      uniform float uVignette; uniform vec3 uVigColor; uniform vec4 uFlash;
      in vec2 vUv;
      ${NOISE}
      vec3 shoulder(vec3 x) {
        const float a = 0.72;
        vec3 over = max(x - a, 0.0);
        return min(x, vec3(a)) + (1.0 - a) * (1.0 - exp(-over / (1.0 - a)));
      }
      void main() {
        vec3 c = texture(uScene, vUv).rgb * uExposure;
        vec3 b = texture(uBloomA, vUv).rgb * 0.6 + texture(uBloomB, vUv).rgb * 0.8;
        c += b * uBloom;
        c += uFlash.rgb * uFlash.a;
        // Hue-preserving shoulder: scale by the brightest channel so lit cream stays cream instead of going white.
        float mx = max(c.r, max(c.g, c.b));
        if (mx > 0.0) c *= shoulder(vec3(mx)).r / mx;
        // Grade: violet in the shadows, a touch of warmth in the lights.
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        c = c * uGain + uLift * (1.0 - smoothstep(0.0, 0.5, l));
        vec2 v = vUv - 0.5;
        float vig = smoothstep(0.35, 0.95, length(v * vec2(1.15, 1.0)));
        c = mix(c, c * uVigColor * 2.0 + uVigColor * 0.15, vig * uVignette);
        vec3 s = pow(max(c, 0.0), vec3(1.0 / 2.2));
        s += (bayer4(gl_FragCoord.xy) - 0.5) / 255.0;
        gl_FragColor = vec4(s, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
}
