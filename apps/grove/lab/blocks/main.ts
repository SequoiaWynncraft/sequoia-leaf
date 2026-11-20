/**
 * Sequoia Grove · block-game glade. A floating voxel diorama with the player's giant sequoia, lit like a cozy shader pack.
 * URL: ?level=1..13 &seed= &time=dusk|day|night &season=normal|winter &still &scene=glade|cone &ct= &px= &stats
 */
import {
  BufferGeometry,
  Color,
  DepthTexture,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Scene,
  UnsignedIntType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { applyPreset, buildBackdrop, type TimeOfDay } from "./backdrop.ts";
import { GeoBuilder, type V3 } from "./geo.ts";
import { Hud } from "./hud.ts";
import { buildIsland, LAYOUT, litterUnder, placePlants, setIslandScale } from "./island.ts";
import { animateChickaree, animateCrab, chickaree, crab } from "./mobs.ts";
import { hex, RANKS } from "./palette.ts";
import { Particles } from "./particles.ts";
import { Post } from "./post.ts";
import { campfire, cone as buildCone, lantern, plants as buildPlants, seedlingPlant, shearBlade, stone, wateringCan, winterLights } from "./props.ts";
import { clamp } from "./rng.ts";
import { blockMaterial, depthMaterial, MAX_LIGHTS, shared, sky, skyMaterial } from "./shaders.ts";
import { makeAtlasTexture } from "./textures.ts";
import { growTree, prune, type TreeInfo } from "./tree.ts";
import { B, isTree, leafDepths, meshWorld, Voxels } from "./world.ts";

// ---------------------------------------------------------------- parameters

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => {
  const v = Number(q.get(k));
  return q.has(k) && Number.isFinite(v) ? v : d;
};
const P = {
  level: clamp(Math.round(num("level", 8)), 1, 13),
  seed: q.get("seed") ?? "seq",
  time: (["dusk", "day", "night"].includes(q.get("time") ?? "") ? q.get("time") : "dusk") as TimeOfDay,
  winter: q.get("season") === "winter",
  still: q.has("still"),
  scene: q.get("scene") === "cone" ? "cone" : "glade",
  ct: num("ct", 2.8),
  t: num("t", 7),
  stats: q.has("stats"),
  yaw: num("yaw", 0.42),
  cam: q.get("cam"),
  act: q.get("act"),
  at: num("at", 1.2),
  px: q.has("px") ? num("px", 2) : -1,
};
const RARITY = 3; // Dryad
const RARE = hex(RANKS[RARITY].color).map((c) => (c / 255) ** 2.2) as unknown as [number, number, number];

// ---------------------------------------------------------------- renderer

const host = document.getElementById("stage");
if (!host) throw new Error("missing #stage");
const renderer = new WebGLRenderer({ antialias: false, powerPreference: "high-performance", stencil: false });
renderer.autoClear = false;
renderer.info.autoReset = false;
renderer.setPixelRatio(1);
renderer.domElement.className = "world";
host.appendChild(renderer.domElement);
const hud = new Hud();
host.appendChild(hud.canvas);
const statsEl = document.createElement("pre");
statsEl.className = "stats";
if (P.stats) host.appendChild(statsEl);

const post = new Post(renderer);
const scene = new Scene();
const shadowScene = new Scene();
const camera = new PerspectiveCamera(34, 1, 0.5, 1200);
const atlas = makeAtlasTexture();

const matSolid = blockMaterial(atlas, { snap: true });
const matLeaves = blockMaterial(atlas, { snap: true, cutout: true });
const matPlants = blockMaterial(atlas, { cutout: true, plant: true, doubleSided: true });
const matCone = blockMaterial(atlas, {});
matCone.uniforms.uGlow = { value: new Vector4(0, 0, 0, 0) };
const depthSolid = depthMaterial(atlas, {});
const depthCut = depthMaterial(atlas, { cutout: true });

// Sky: a full-screen triangle drawn first.
const skyGeo = new BufferGeometry();
skyGeo.setAttribute("position", new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
const skyMesh = new Mesh(skyGeo, skyMaterial());
skyMesh.frustumCulled = false;
skyMesh.renderOrder = -100;
scene.add(skyMesh);

const preset = applyPreset(P.time);
const backdrop = buildBackdrop();
backdrop.apply(preset);
scene.add(backdrop.group);
post.composite.uniforms.uExposure!.value = preset.exposure * (P.winter ? 0.9 : 1);
(post.composite.uniforms.uLift!.value as Vector3).set(...preset.lift);
post.composite.uniforms.uBloom!.value = P.time === "night" ? 1.1 : 0.85;
post.bright.uniforms.uThreshold!.value = P.winter ? 1.6 : 1.4;

// ---------------------------------------------------------------- the glade

const world = new Voxels();
setIslandScale(P.level);
buildIsland(world);
const tree: TreeInfo = growTree(world, P.seed, P.level);
const pruneKey = `grove.blocks.pruned.${P.seed}.${P.level}`;
const pruned: V3[] = (() => {
  try {
    const raw = localStorage.getItem(pruneKey);
    return raw ? (JSON.parse(raw) as V3[]) : [];
  } catch {
    return [];
  }
})();
for (const [x, y, z] of pruned) if (world.get(x, y, z) === B.Leaf) world.set(x, y, z, B.Air);
litterUnder(world, tree);

const groundAt = (x: number, z: number) => world.top(Math.floor(x), Math.floor(z), 8) + 1;
const fireCell = LAYOUT.fire;
const reservedCells = new Set<string>();
for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) reservedCells.add(`${fireCell[0] + dx},${fireCell[1] + dz}`);
reservedCells.add(`${Math.floor(LAYOUT.cone[0])},${Math.floor(LAYOUT.cone[1])}`);
reservedCells.add(`${LAYOUT.lantern[0]},${LAYOUT.lantern[1]}`);
reservedCells.add(`${LAYOUT.lantern[0] + 1},${LAYOUT.lantern[1]}`);
// The Chickaree sits on the fallen log by the fire, nibbling its cone.
const chickPos = new Vector3(LAYOUT.seat.x + 0.5, 0, LAYOUT.seat.z0 + 1.7);
chickPos.y = groundAt(chickPos.x, chickPos.z);
reservedCells.add(`${Math.floor(chickPos.x)},${Math.floor(chickPos.z)}`);
const crabPos = new Vector3(LAYOUT.crab[0], 0, LAYOUT.crab[1]);
crabPos.y = groundAt(crabPos.x, crabPos.z);
for (let dx = -1; dx <= 1; dx++) reservedCells.add(`${Math.floor(crabPos.x) + dx},${Math.floor(crabPos.z)}`);
for (const [sx, sz, size] of LAYOUT.stones) {
  const rr = Math.ceil(size / 32);
  for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) reservedCells.add(`${Math.floor(sx) + dx},${Math.floor(sz) + dz}`);
}
const plantList = placePlants(world, tree, (x, z) => reservedCells.has(`${x},${z}`));

// Meshes from the grid.
const terrainMesh = new Mesh(new BufferGeometry(), matSolid);
const treeGroup = new Group();
treeGroup.position.set(tree.cx, 0, tree.cz);
const barkMesh = new Mesh(new BufferGeometry(), matSolid);
const leafMesh = new Mesh(new BufferGeometry(), matLeaves);
for (const m of [barkMesh, leafMesh]) {
  m.position.set(-tree.cx, 0, -tree.cz);
  treeGroup.add(m);
}
scene.add(terrainMesh, treeGroup);
const shadowTerrain = new Mesh(terrainMesh.geometry, depthSolid);
const shadowTree = new Group();
shadowTree.position.copy(treeGroup.position);
const shadowBark = new Mesh(barkMesh.geometry, depthSolid);
const shadowLeaves = new Mesh(leafMesh.geometry, depthCut);
for (const m of [shadowBark, shadowLeaves]) {
  m.position.set(-tree.cx, 0, -tree.cz);
  shadowTree.add(m);
}
shadowScene.add(shadowTerrain, shadowTree);

function remesh(): void {
  const t0 = performance.now();
  const set = meshWorld(world, { winter: P.winter }, leafDepths(world));
  for (const [mesh, shadow, geo] of [
    [terrainMesh, shadowTerrain, set.terrain],
    [barkMesh, shadowBark, set.tree],
    [leafMesh, shadowLeaves, set.leaves],
  ] as const) {
    mesh.geometry.dispose();
    mesh.geometry = geo;
    shadow.geometry = geo;
  }
  remeshMs = performance.now() - t0;
}
let remeshMs = 0;
remesh();

// Props.
const solid = new GeoBuilder();
const cut = new GeoBuilder();
const fireY = groundAt(fireCell[0] + 0.5, fireCell[1] + 0.5);
const firePos = campfire(solid, cut, fireCell[0], fireY, fireCell[1]);
const lanternPos = lantern(solid, LAYOUT.lantern[0], groundAt(LAYOUT.lantern[0] + 0.5, LAYOUT.lantern[1] + 0.5), LAYOUT.lantern[1]);
buildPlants(cut, plantList, P.winter);
for (const [sx, sz, size, mossy, turn] of LAYOUT.stones) stone(solid, sx, groundAt(sx, sz), sz, size, mossy, turn, P.winter);
if (tree.seedling) seedlingPlant(cut, tree.base[0], groundAt(tree.base[0], tree.base[2]), tree.base[2]);
let bulbs: V3[] = [];
if (P.winter) bulbs = winterLights(solid, tree, lanternPos, firePos);
const propMesh = new Mesh(solid.build(), matSolid);
const plantMesh = new Mesh(cut.build(), matPlants);
scene.add(propMesh, plantMesh);
shadowScene.add(new Mesh(propMesh.geometry, depthSolid), new Mesh(plantMesh.geometry, depthCut));

// The cone by the fire, a separate mesh so it can glow, shake and burst.
const coneGeoB = new GeoBuilder();
buildCone(coneGeoB, 1.2);
const coneMesh = new Mesh(coneGeoB.build(), matCone);
const coneHome = new Vector3(LAYOUT.cone[0], groundAt(LAYOUT.cone[0], LAYOUT.cone[1]), LAYOUT.cone[1]);
coneMesh.position.copy(coneHome);
coneMesh.rotation.set(0.12, 0.6, -0.18);
scene.add(coneMesh);
const coneShadow = new Mesh(coneMesh.geometry, depthSolid);
coneShadow.matrixAutoUpdate = false;
shadowScene.add(coneShadow);

// Tools that appear where they're used.
const canB = new GeoBuilder();
wateringCan(canB);
const canMesh = new Mesh(canB.build(), matSolid);
canMesh.visible = false;
canMesh.scale.setScalar(1.3);
scene.add(canMesh);
const shears = new Group();
for (const side of [-1, 1]) {
  const sb = new GeoBuilder();
  shearBlade(sb, side);
  const blade = new Mesh(sb.build(), matSolid);
  blade.userData.side = side;
  shears.add(blade);
}
shears.visible = false;
shears.scale.setScalar(1.4);
scene.add(shears);

// Critters.
const squirrel = chickaree();
const crabby = crab();
squirrel.mesh.position.copy(chickPos);
squirrel.mesh.rotation.y = 0.95;
crabby.mesh.position.copy(crabPos);
crabby.mesh.rotation.y = 0.25;
for (const m of [squirrel, crabby]) {
  m.shadow.matrixAutoUpdate = false;
  scene.add(m.mesh);
  shadowScene.add(m.shadow);
}

// Particles.
const particles = new Particles();
scene.add(particles.points);
particles.area.top = Math.max(14, tree.top + 4);
const fireflyCount = Math.round(28 * preset.fireflies * (P.winter ? 0.4 : 1));
for (let i = 0; i < fireflyCount; i++) {
  const a = (i / Math.max(1, fireflyCount)) * Math.PI * 2 + Math.sin(i * 12.9898) * 0.6;
  const r = 3 + ((i * 7) % 9);
  particles.spawn({ x: Math.cos(a) * r, y: 1.2 + ((i * 13) % 7) * 0.7, z: Math.sin(a) * r, life: 1, size: 0.085, color: [1.9, 1.65, 0.45], add: true, kind: "firefly" });
}
// Each fairy bulb wears a soft halo that breathes on its own cycle.
for (const [bx, by, bz] of bulbs) particles.spawn({ x: bx, y: by - 0.1, z: bz, life: 1, size: 0.34, color: [1.6, 1.0, 0.45], alpha: 0.32, add: true, kind: "bulb" });
if (P.winter)
  for (let i = 0; i < 360; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 26;
    particles.spawn({ x: Math.cos(a) * r, y: -14 + Math.random() * (particles.area.top + 20), z: Math.sin(a) * r, vy: -0.7 - Math.random() * 0.5, life: 1, size: 0.075, color: [0.95, 0.94, 1.0], alpha: 0.95, kind: "snow" });
  }

// ---------------------------------------------------------------- shadows

const SHADOW = 2048;
const shadowRT = new WebGLRenderTarget(SHADOW, SHADOW, { depthBuffer: true });
shadowRT.depthTexture = new DepthTexture(SHADOW, SHADOW, UnsignedIntType);
shared.uShadowMap.value = shadowRT.depthTexture;
shared.uShadowTexel.value = 1 / SHADOW;
const shadowCam = new OrthographicCamera(-20, 20, 20, -20, 0.5, 260);
function fitShadow(): void {
  const top = Math.max(8, tree.top + 2);
  const centre = new Vector3(0, top / 2 - 4, 0);
  const radius = Math.hypot(Math.max(14, tree.spread + 3), top / 2 + 9);
  shadowCam.left = -radius;
  shadowCam.right = radius;
  shadowCam.top = radius;
  shadowCam.bottom = -radius;
  shadowCam.position.copy(centre).addScaledVector(shared.uSunDir.value, 120);
  shadowCam.lookAt(centre);
  shadowCam.updateProjectionMatrix();
  shadowCam.updateMatrixWorld();
  shared.uShadowMatrix.value.multiplyMatrices(shadowCam.projectionMatrix, shadowCam.matrixWorldInverse);
}
fitShadow();

// ---------------------------------------------------------------- camera

const orbit = { yaw: P.yaw, pitch: 0.26, dist: 60, zoom: 1, focus: new Vector3(), lift: 0, row: 0.6 };
/**
 * Framing: the glade's focus sits at `row` of the frame height and the axis tilts up from it by `lift`,
 * which keeps the horizon (and the dusk sky) in the top fifth of the frame at the default pitch.
 */
function frame(): void {
  const t = Math.tan((camera.fov * Math.PI) / 360);
  if (P.scene === "cone") {
    orbit.focus.set(coneHome.x + 0.4, coneHome.y + 0.6, coneHome.z - 0.4);
    orbit.dist = 9;
    orbit.pitch = 0.3;
    orbit.row = 0.56;
    orbit.yaw = 0.08;
  } else {
    orbit.focus.set(0, 1.5, 0);
    orbit.row = 0.57;
    const lift = Math.atan((orbit.row - 0.5) * 2 * t);
    const h = Math.max(tree.top + 1.5, 6) - orbit.focus.y;
    const fitTop = h / Math.tan(Math.atan((1 - 2 * 0.06) * t) + lift);
    const halfW = Math.max(13.2 * (0.9 + (P.level - 1) * 0.022), tree.spread + 1.5);
    const fitW = halfW / (0.92 * t * camera.aspect);
    orbit.dist = Math.max(fitTop, fitW, 30) + 6;
  }
  if (P.cam) {
    // Debug framing: ?cam=x,y,z,dist,yaw,pitch
    const [x, y, z, d, yaw, pitch] = P.cam.split(",").map(Number);
    orbit.focus.set(x ?? 0, y ?? 0, z ?? 0);
    orbit.dist = d ?? 10;
    orbit.yaw = yaw ?? 0;
    orbit.pitch = pitch ?? 0.3;
    orbit.row = 0.5;
  }
  orbit.lift = Math.atan((orbit.row - 0.5) * 2 * t);
}

function placeCamera(): void {
  const d = orbit.dist * orbit.zoom;
  const cp = Math.cos(orbit.pitch);
  camera.position.set(orbit.focus.x + Math.sin(orbit.yaw) * cp * d, orbit.focus.y + Math.sin(orbit.pitch) * d, orbit.focus.z + Math.cos(orbit.yaw) * cp * d);
  camera.lookAt(orbit.focus);
  camera.rotateX(orbit.lift);
  camera.updateMatrixWorld();
}

// ---------------------------------------------------------------- sizing

let cssW = 1;
let cssH = 1;
let px = 1;
function resize(): void {
  cssW = host!.clientWidth;
  cssH = host!.clientHeight;
  px = P.px > 0 ? P.px : 1;
  const w = Math.max(1, Math.floor(cssW / px));
  const h = Math.max(1, Math.floor(cssH / px));
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = `${w * px}px`;
  renderer.domElement.style.height = `${h * px}px`;
  post.setSize(w, h);
  camera.aspect = w / h;
  frame();
  camera.updateProjectionMatrix();
  sky.uPixel.value = ((camera.fov * Math.PI) / 180) / h;
  (particles.points.material as unknown as { uniforms: { uScale: { value: number } } }).uniforms.uScale.value = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
  hud.resize(cssW, cssH);
}
addEventListener("resize", resize);
resize();

// ---------------------------------------------------------------- state and effects

const state = {
  pourAt: -10,
  pourFrom: new Vector3(),
  pourTo: new Vector3(),
  snipAt: -10,
  snipPos: new Vector3(),
  bloom: 0.6,
  charges: 4,
  pulse: -10,
  pulseY: 0,
  coneT: -1,
  rave: -10,
  hop: -10,
  revealed: false,
};
hud.state.level = P.level;
hud.state.stage = tree.stage;
hud.state.bloom = state.bloom;
hud.state.charges = state.charges;
const bump = (v: number) => {
  state.bloom = Math.min(1, state.bloom + v);
  hud.state.bloom = state.bloom;
};

function water(at: Vector3, now: number): void {
  if (state.charges <= 0) return;
  state.charges -= 1;
  hud.state.charges = state.charges;
  // The can appears beside the trunk on the camera's side and pours a stream onto the roots.
  void at;
  const centre = new Vector3(tree.cx, 0, tree.cz);
  const toCam = camera.position.clone().sub(centre).setY(0).normalize();
  const side = new Vector3(-toCam.z, 0, toCam.x);
  const reach = tree.seedling ? 0.3 : Math.max(1.2, tree.footprint * 0.75);
  state.pourTo.copy(centre).addScaledVector(toCam, reach);
  state.pourTo.y = groundAt(state.pourTo.x, state.pourTo.z);
  state.pourFrom.copy(state.pourTo).addScaledVector(toCam, 1.7).addScaledVector(side, -0.9).add(new Vector3(0, 2.1, 0));
  state.pourAt = now;
  state.pulse = now + 0.9;
  bump(0.1);
}

function mist(at: Vector3): void {
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2;
    particles.spawn({ x: at.x + Math.cos(a) * 0.4, y: at.y + Math.random() * 0.8, z: at.z + Math.sin(a) * 0.4, vx: Math.cos(a) * (0.6 + Math.random()), vy: 0.2 + Math.random() * 0.4, vz: Math.sin(a) * (0.6 + Math.random()), drag: 1.4, life: 1.6 + Math.random(), size: 0.22, color: [0.85, 0.92, 1.0], alpha: 0.32, kind: "mist" });
  }
  bump(0.05);
}

function shear(cell: [number, number, number]): void {
  const removed = prune(world, ...cell);
  if (!removed.length) return;
  state.snipAt = clock();
  state.snipPos.set(cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5);
  for (const [x, y, z] of removed) {
    pruned.push([x, y, z]);
    for (let i = 0; i < 3; i++)
      particles.spawn({ x: x + Math.random(), y: y + Math.random(), z: z + Math.random(), vx: (Math.random() - 0.5) * 1.2, vy: 0.5 + Math.random(), vz: (Math.random() - 0.5) * 1.2, gravity: 2.4, drag: 1.2, life: 3.5, size: 0.1, color: i % 2 ? [0.16, 0.34, 0.22] : [0.3, 0.5, 0.26], kind: "needle", floor: groundAt(x, z) + 0.05 });
  }
  try {
    localStorage.setItem(pruneKey, JSON.stringify(pruned));
  } catch {
    /* storage may be unavailable; the cut still shows this session */
  }
  remesh();
  bump(0.04);
}

// ---------------------------------------------------------------- picking

const raycaster = new Raycaster();
const ndc = new Vector2();
function rayFrom(cx: number, cy: number): { o: Vector3; d: Vector3 } {
  ndc.set((cx / cssW) * 2 - 1, -(cy / cssH) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return { o: raycaster.ray.origin.clone(), d: raycaster.ray.direction.clone() };
}

/** Voxel DDA: the first non-air cell along the ray. */
function castBlocks(o: Vector3, d: Vector3, maxDist = 400): { cell: [number, number, number]; point: Vector3 } | null {
  let x = Math.floor(o.x);
  let y = Math.floor(o.y);
  let z = Math.floor(o.z);
  const sx = Math.sign(d.x);
  const sy = Math.sign(d.y);
  const sz = Math.sign(d.z);
  const tdx = Math.abs(1 / d.x);
  const tdy = Math.abs(1 / d.y);
  const tdz = Math.abs(1 / d.z);
  let tx = (sx > 0 ? x + 1 - o.x : o.x - x) * tdx;
  let ty = (sy > 0 ? y + 1 - o.y : o.y - y) * tdy;
  let tz = (sz > 0 ? z + 1 - o.z : o.z - z) * tdz;
  let t = 0;
  while (t < maxDist) {
    if (world.get(x, y, z) !== B.Air) return { cell: [x, y, z], point: o.clone().addScaledVector(d, t) };
    if (tx < ty && tx < tz) {
      x += sx;
      t = tx;
      tx += tdx;
    } else if (ty < tz) {
      y += sy;
      t = ty;
      ty += tdy;
    } else {
      z += sz;
      t = tz;
      tz += tdz;
    }
  }
  return null;
}

const hitSphere = (o: Vector3, d: Vector3, c: Vector3, r: number): number => {
  const oc = o.clone().sub(c);
  const b = oc.dot(d);
  const disc = b * b - (oc.lengthSq() - r * r);
  return disc < 0 ? Infinity : -b - Math.sqrt(disc);
};

function tap(cx: number, cy: number, now: number): void {
  const slot = hud.hit(cx, cy);
  if (slot >= 0) {
    hud.state.tool = slot;
    return;
  }
  const { o, d } = rayFrom(cx, cy);
  const block = castBlocks(o, d);
  const blockT = block ? block.point.distanceTo(o) : Infinity;
  const coneT = state.coneT < 0 ? hitSphere(o, d, coneHome.clone().add(new Vector3(0, 0.55, 0)), 0.75) : Infinity;
  const crabT = hitSphere(o, d, crabby.mesh.position.clone().add(new Vector3(0, 0.3, 0)), 0.65);
  const sqT = hitSphere(o, d, squirrel.mesh.position.clone().add(new Vector3(0, 0.5, 0)), 0.6);
  const best = Math.min(blockT, coneT, crabT, sqT);
  if (best === Infinity) return;
  if (best === coneT) {
    state.coneT = now;
    return;
  }
  if (best === crabT) {
    state.rave = now;
    return;
  }
  if (best === sqT) {
    state.hop = now;
    return;
  }
  if (!block) return;
  const b = world.get(...block.cell);
  const tool = hud.state.tool;
  if (tool === 1) {
    if (b === B.Leaf) shear(block.cell);
    return;
  }
  const nearTree = isTree(b) || Math.hypot(block.point.x - tree.cx, block.point.z - tree.cz) < tree.footprint + 2.5;
  if (!nearTree) return;
  if (tool === 0) water(new Vector3(tree.base[0], groundAt(tree.base[0], tree.base[2]) + 0.2, tree.base[2]).lerp(block.point, b === B.Leaf ? 0 : 0.3), now);
  else mist(block.point);
}

let down: { x: number; y: number; t: number; yaw: number; pitch: number } | null = null;
let userTouched = -100;
const pointers = new Map<number, { x: number; y: number }>();
let pinch0 = 0;
renderer.domElement.addEventListener("pointerdown", (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch0 = a && b ? Math.hypot(a.x - b.x, a.y - b.y) / orbit.zoom : 0;
  }
  down = { x: e.clientX, y: e.clientY, t: performance.now(), yaw: orbit.yaw, pitch: orbit.pitch };
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2 && pinch0 > 0) {
    const [a, b] = [...pointers.values()];
    if (a && b) orbit.zoom = clamp(pinch0 / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), 0.55, 1.35);
    return;
  }
  if (!down) return;
  const dx = e.clientX - down.x;
  const dy = e.clientY - down.y;
  if (Math.hypot(dx, dy) > 6) {
    orbit.yaw = down.yaw - dx * 0.006;
    orbit.pitch = clamp(down.pitch + dy * 0.004, 0.12, 0.75);
    userTouched = performance.now() / 1000;
  }
});
renderer.domElement.addEventListener("pointerup", (e) => {
  pointers.delete(e.pointerId);
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 6 && performance.now() - down.t < 500) tap(e.clientX, e.clientY, clock());
  down = null;
});
renderer.domElement.addEventListener(
  "wheel",
  (e) => {
    orbit.zoom = clamp(orbit.zoom * Math.exp(e.deltaY * 0.001), 0.55, 1.35);
    e.preventDefault();
  },
  { passive: false },
);
addEventListener("keydown", (e) => {
  const n = Number(e.key);
  if (n >= 1 && n <= 3) hud.state.tool = n - 1;
});

// ---------------------------------------------------------------- lights

const L = shared.uLightPos.value;
const LC = shared.uLightColor.value;
function setLight(i: number, p: V3 | Vector3, radius: number, c: [number, number, number], k: number): void {
  const v = L[i];
  const col = LC[i];
  if (!v || !col) return;
  if (p instanceof Vector3) v.set(p.x, p.y, p.z, radius);
  else v.set(p[0], p[1], p[2], radius);
  col.set(c[0] * k, c[1] * k, c[2] * k);
}
for (let i = 0; i < MAX_LIGHTS; i++) setLight(i, [0, 0, 0], 0, [0, 0, 0], 0);
const bulbCentre = bulbs.length ? bulbs.reduce((a, b) => [a[0] + b[0] / bulbs.length, a[1] + b[1] / bulbs.length, a[2] + b[2] / bulbs.length] as V3, [0, 0, 0] as V3) : null;

// ---------------------------------------------------------------- the loop

const start = performance.now();
const clock = () => (P.still ? P.t : (performance.now() - start) / 1000 + P.t);
let last = clock();
let sparkAcc = 0;
let glintAcc = 0;
const tmpV = new Vector3();
const flash = post.composite.uniforms.uFlash!.value as Vector4;
const coneGlow = matCone.uniforms.uGlow!.value as Vector4;

function emitAmbient(dt: number): void {
  sparkAcc += dt * 7 * preset.fire;
  while (sparkAcc > 1) {
    sparkAcc -= 1;
    particles.spawn({ x: firePos[0] + (Math.random() - 0.5) * 0.5, y: firePos[1] - 0.2, z: firePos[2] + (Math.random() - 0.5) * 0.5, vx: (Math.random() - 0.5) * 0.4, vy: 1.6 + Math.random() * 1.6, vz: (Math.random() - 0.5) * 0.4, drag: 0.6, life: 0.9 + Math.random() * 1.1, size: 0.075, color: [3.4, 1.6, 0.5], add: true, kind: "spark" });
  }
  if (state.coneT < 0) {
    glintAcc += dt * 0.8;
    while (glintAcc > 1) {
      glintAcc -= 1;
      particles.spawn({ x: coneHome.x + (Math.random() - 0.5) * 0.6, y: coneHome.y + 0.3 + Math.random() * 0.6, z: coneHome.z + (Math.random() - 0.5) * 0.6, vy: 0.4, life: 0.9, size: 0.07, color: [3, 2.4, 1.1], add: true, kind: "sparkle" });
    }
  }
}

/** The hero moment: the cone glows, shakes, bursts in the rarity's light, and the Chickaree pops out. */
function coneSequence(now: number, dt: number): void {
  const t = now - state.coneT;
  const glowT = clamp(t / 1.2, 0, 1);
  if (t < 1.25) {
    const k = glowT * glowT;
    coneMesh.visible = true;
    coneGlow.set(RARE[0] * 1.6, RARE[1] * 1.6, RARE[2] * 1.6, 0.3 + k * 2.6 + Math.sin(t * 30) * 0.2 * k);
    const shake = k * 0.16;
    coneMesh.rotation.set(0.12 + Math.sin(t * 47) * shake, 0.6 + t * k * 3, -0.18 + Math.sin(t * 39 + 1) * shake);
    coneMesh.position.set(coneHome.x + Math.sin(t * 53) * shake * 0.25, coneHome.y + k * 0.35 + Math.abs(Math.sin(t * 26)) * shake * 0.4, coneHome.z);
    coneMesh.scale.setScalar(1 + k * 0.18);
    setLight(2, [coneHome.x, coneHome.y + 0.7, coneHome.z], 6 + k * 4, RARE, 1.5 + k * 5);
    // Embers spiral in toward the cone.
    if (Math.random() < dt * 40 * (0.3 + k)) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.6 + Math.random();
      particles.spawn({ x: coneHome.x + Math.cos(a) * r, y: coneHome.y + 0.4 + Math.random() * 1.2, z: coneHome.z + Math.sin(a) * r, vx: -Math.cos(a) * r * 1.6 - Math.sin(a), vy: 0.2, vz: -Math.sin(a) * r * 1.6 + Math.cos(a), life: 0.55, size: 0.08, color: [RARE[0] * 4, RARE[1] * 4, RARE[2] * 4], add: true, kind: "mote" });
    }
    flash.set(0, 0, 0, 0);
    return;
  }
  if (coneMesh.visible) {
    // Burst.
    coneMesh.visible = false;
    const c = coneHome.clone().add(new Vector3(0, 0.6, 0));
    for (let i = 0; i < 36; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 3;
      particles.spawn({ x: c.x, y: c.y, z: c.z, vx: Math.cos(a) * s, vy: 2 + Math.random() * 3, vz: Math.sin(a) * s, gravity: 9, drag: 0.8, life: 1.4, size: 0.11, color: i % 3 ? [0.32, 0.13, 0.05] : [0.55, 0.26, 0.1], kind: "shard" });
    }
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      particles.spawn({ x: c.x, y: c.y, z: c.z, vx: Math.cos(a) * 5.5, vy: 0.3, vz: Math.sin(a) * 5.5, drag: 2.6, life: 1.0, size: 0.1, color: [RARE[0] * 5, RARE[1] * 5, RARE[2] * 5], add: true, kind: "ring" });
    }
    for (let i = 0; i < 70; i++) {
      particles.spawn({ x: c.x + (Math.random() - 0.5) * 0.7, y: c.y + Math.random() * 0.4, z: c.z + (Math.random() - 0.5) * 0.7, vy: 3 + Math.random() * 7, drag: 0.9, life: 1.1 + Math.random() * 0.9, size: 0.1 + Math.random() * 0.06, color: [RARE[0] * 4.5 + 0.4, RARE[1] * 4.5 + 0.4, RARE[2] * 4.5 + 0.3], add: true, kind: "mote" });
    }
  }
  const after = t - 1.25;
  flash.set(RARE[0], RARE[1], RARE[2], Math.max(0, 0.32 * Math.exp(-after * 6)));
  setLight(2, [coneHome.x, coneHome.y + 0.9, coneHome.z], 8, RARE, 0.7 + 5 * Math.exp(-after * 4));
  // Motes keep drifting up round the newcomer.
  if (Math.random() < dt * 14) {
    const a = Math.random() * Math.PI * 2;
    particles.spawn({ x: coneHome.x + Math.cos(a) * 0.8, y: coneHome.y + 0.2, z: coneHome.z + Math.sin(a) * 0.8, vy: 0.8 + Math.random() * 0.6, life: 1.6, size: 0.08, color: [RARE[0] * 3, RARE[1] * 3, RARE[2] * 3], add: true, kind: "mote" });
  }
  // The Chickaree pops out with a hop and an overshoot, then lands facing us.
  const popT = clamp(after / 0.55, 0, 1);
  const overshoot = popT < 1 ? Math.sin(popT * Math.PI * 0.5) * (1 + 0.35 * Math.sin(popT * Math.PI)) : 1;
  squirrel.mesh.visible = true;
  squirrel.mesh.scale.setScalar(Math.max(0.001, overshoot));
  const hop = Math.sin(popT * Math.PI) * 1.3;
  squirrel.mesh.position.set(coneHome.x, coneHome.y + hop, coneHome.z + 0.1);
  tmpV.copy(camera.position).sub(squirrel.mesh.position);
  squirrel.mesh.rotation.y = Math.atan2(tmpV.x, tmpV.z) + 0.65;
  if (after > 0.75 && !hud.tooltip) {
    const head = squirrel.mesh.position.clone().add(new Vector3(0, 1.3, 0)).project(camera);
    hud.tooltip = {
      name: "Chickaree",
      rank: RARITY,
      lore: ["Buries cones round your tree", "and forgets where. Come spring,", "the glade fills with seedlings."],
      job: "Plants seedlings in your glade",
      start: now,
      x: ((head.x + 1) / 2) * hud.w + hud.w * 0.2,
      y: ((1 - head.y) / 2) * hud.h,
    };
    state.revealed = true;
  }
}

function step(now: number, dt: number): void {
  shared.uTime.value = now;
  sky.uTime.value = now;
  // Slow orbit unless the player is steering.
  if (!P.still && now - userTouched > 4 && P.scene !== "cone") orbit.yaw += dt * 0.035;
  placeCamera();
  backdrop.group.position.copy(camera.position);
  const inv = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
  sky.uInvViewProj.value.copy(inv);
  sky.uCam.value.copy(camera.position);

  // Fire and lantern flicker.
  const flick = 0.86 + 0.08 * Math.sin(now * 13.1) + 0.05 * Math.sin(now * 23.7 + 1.3) + 0.04 * Math.sin(now * 7.3);
  setLight(0, firePos, 7.5, [1.6, 0.76, 0.26], flick * preset.fire);
  setLight(1, lanternPos, 6.5, [1.5, 0.95, 0.42], (0.95 + 0.04 * Math.sin(now * 9.1)) * preset.fire);
  if (bulbCentre) setLight(3, [bulbCentre[0], bulbCentre[1] - 0.5, bulbCentre[2]], 12, [1.4, 0.9, 0.45], 0.8);
  if (state.coneT < 0) {
    coneGlow.set(RARE[0], RARE[1], RARE[2], 0.08 + 0.06 * Math.sin(now * 2.2));
    setLight(2, [0, 0, 0], 0, [0, 0, 0], 0);
  } else coneSequence(now, dt);

  // Growth pulse after watering: the tree swells a touch and a band of light climbs it.
  const pt = now - state.pulse;
  if (pt > 0 && pt < 1.6) {
    const s = 1 + 0.035 * Math.sin(pt * Math.PI * 3) * Math.exp(-pt * 2.2);
    treeGroup.scale.set(s, 1 + (s - 1) * 1.4, s);
    shared.uPulse.value.set(tree.cx, (pt / 1.6) * (tree.top + 4) - 1, tree.cz, Math.sin((pt / 1.6) * Math.PI));
    if (Math.random() < dt * 30) {
      const a = Math.random() * Math.PI * 2;
      const y = Math.random() * (pt / 1.6) * tree.top;
      particles.spawn({ x: tree.cx + Math.cos(a) * (tree.footprint + 0.4), y, z: tree.cz + Math.sin(a) * (tree.footprint + 0.4), vy: 1.2, life: 1, size: 0.08, color: [1.2, 2.8, 0.9], add: true, kind: "sparkle" });
    }
  } else {
    treeGroup.scale.set(1, 1, 1);
    shared.uPulse.value.w = 0;
  }
  shadowTree.scale.copy(treeGroup.scale);

  // Tools that appear where they're used.
const canB = new GeoBuilder();
wateringCan(canB);
const canMesh = new Mesh(canB.build(), matSolid);
canMesh.visible = false;
canMesh.scale.setScalar(1.3);
scene.add(canMesh);
const shears = new Group();
for (const side of [-1, 1]) {
  const sb = new GeoBuilder();
  shearBlade(sb, side);
  const blade = new Mesh(sb.build(), matSolid);
  blade.userData.side = side;
  shears.add(blade);
}
shears.visible = false;
shears.scale.setScalar(1.4);
scene.add(shears);

// Critters.
  if (P.scene === "cone" && state.coneT < 0) squirrel.mesh.visible = false;
  if (state.coneT < 0 || now - state.coneT < 1.25) {
    if (state.coneT >= 0) squirrel.mesh.visible = false;
    const hop = now - state.hop;
    squirrel.mesh.position.set(chickPos.x, chickPos.y + (hop > 0 && hop < 0.5 ? Math.sin((hop / 0.5) * Math.PI) * 0.6 : 0), chickPos.z);
    squirrel.mesh.scale.setScalar(1);
  }
  animateChickaree(squirrel, now, state.revealed ? 1 : 0);
  const raving = now - state.rave < 3.2 ? 1 : 0;
  const c = animateCrab(crabby, now, raving);
  crabby.mesh.position.set(crabPos.x + c.dx, crabPos.y, crabPos.z);
  for (const m of [squirrel, crabby]) {
    m.mesh.updateMatrix();
    m.shadow.matrix.copy(m.mesh.matrix);
    m.shadow.visible = m.mesh.visible;
  }
  coneMesh.updateMatrix();
  coneShadow.matrix.copy(coneMesh.matrix);
  coneShadow.visible = coneMesh.visible;

  // The watering can: rise in, tilt, pour an arcing stream, tilt back, shrink away.
  const pt2 = now - state.pourAt;
  if (pt2 >= 0 && pt2 < 1.9) {
    canMesh.visible = true;
    const tilt = Math.min(1, pt2 / 0.35) * (pt2 > 1.45 ? Math.max(0, 1 - (pt2 - 1.45) / 0.3) : 1);
    const dir = state.pourTo.clone().sub(state.pourFrom).setY(0).normalize();
    canMesh.position.copy(state.pourFrom).add(new Vector3(0, Math.sin(Math.min(1, pt2 / 0.3) * Math.PI * 0.5) * 0.3, 0));
    canMesh.rotation.set(0, Math.atan2(-dir.z, dir.x), -0.75 * tilt, "YXZ");
    canMesh.scale.setScalar(1.3 * (pt2 > 1.7 ? Math.max(0.01, 1 - (pt2 - 1.7) / 0.2) : 1));
    if (tilt > 0.6 && pt2 < 1.5) {
      const spout = new Vector3(9.5 / 16, 3 / 16, 0).multiplyScalar(1.3).applyEuler(canMesh.rotation).add(canMesh.position);
      for (let k = 0; k < Math.ceil(dt * 70); k++)
        particles.spawn({ x: spout.x, y: spout.y, z: spout.z, vx: dir.x * (1.3 + Math.random() * 0.4) + (Math.random() - 0.5) * 0.2, vy: 0.4 + Math.random() * 0.3, vz: dir.z * (1.3 + Math.random() * 0.4) + (Math.random() - 0.5) * 0.2, gravity: 9, life: 2, size: 0.1, color: [0.55, 0.8, 1.15], alpha: 0.95, kind: "drop", floor: groundAt(state.pourTo.x, state.pourTo.z) });
    }
  } else canMesh.visible = false;
  // Shears: blades open, snap shut on the pad, then vanish.
  const st = now - state.snipAt;
  if (st >= 0 && st < 0.6) {
    shears.visible = true;
    shears.position.copy(state.snipPos);
    shears.lookAt(camera.position);
    const open = st < 0.18 ? 0.5 : Math.max(0, 0.5 - (st - 0.18) * 4);
    for (const blade of shears.children) blade.rotation.z = (blade.userData.side as number) * open;
  } else shears.visible = false;

  emitAmbient(dt);
  particles.update(dt, now);

  // HUD.
  if (state.charges < 6 && Math.floor(now / 6) !== Math.floor((now - dt) / 6)) {
    state.charges += 1;
    hud.state.charges = state.charges;
  }
  hud.draw(now);
}

function render(): void {
  renderer.info.reset();
  renderer.setRenderTarget(shadowRT);
  renderer.setClearColor(new Color(0, 0, 0), 1);
  renderer.clear();
  renderer.render(shadowScene, shadowCam);
  renderer.setRenderTarget(post.scene);
  renderer.clear();
  renderer.render(scene, camera);
  post.finish(renderer);
}

let frames = 0;
let fpsT = performance.now();
let fps = 0;
function loop(): void {
  const now = clock();
  const dt = P.still ? 1 / 60 : clamp(now - last, 0, 0.1);
  last = now;
  step(now, dt);
  render();
  frames++;
  const real = performance.now();
  if (real - fpsT > 1000) {
    fps = (frames * 1000) / (real - fpsT);
    frames = 0;
    fpsT = real;
  }
  if (P.stats) {
    const info = renderer.info.render;
    statsEl.textContent = `draw calls ${info.calls}\ntriangles ${info.triangles}\nparticles ${particles.count}\nremesh ${remeshMs.toFixed(1)} ms\nfps ${fps.toFixed(0)}\ninternal ${renderer.domElement.width}x${renderer.domElement.height}`;
  }
  (window as unknown as { __stats: unknown }).__stats = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  requestAnimationFrame(loop);
}

/** Scripted taps for review shots: water the tree, or shear the leaf pad nearest the camera's view of the crown. */
function scripted(now: number): void {
  if (!P.act) return;
  if (P.act === "water") water(new Vector3(tree.base[0], groundAt(tree.base[0], tree.base[2]) + 0.2, tree.base[2]), now);
  if (P.act === "mist") mist(new Vector3(tree.cx, tree.top * 0.6, tree.cz + tree.spread * 0.6));
  if (P.act === "shear") {
    // Cast from the camera at the lower crown, as a player's tap would.
    const aim = new Vector3(tree.cx + 1.2, Math.max(3, tree.top * 0.45), tree.cz + 1.5);
    const d = aim.clone().sub(camera.position).normalize();
    const hit = castBlocks(camera.position.clone(), d);
    if (hit && world.get(...hit.cell) === B.Leaf) shear(hit.cell);
  }
}
(window as unknown as { __grove: unknown }).__grove = { tap: (x: number, y: number) => tap(x, y, clock()), scripted };

// Stills: replay the moments before the frame so sparks, smoke and a cone burst are already in the air.
if (P.scene === "cone") state.coneT = P.still ? P.t - P.ct : clock() + 1.2;
if (P.still) {
  const warm = 3.5;
  let acted = false;
  for (let k = Math.ceil(warm * 30); k > 0; k--) {
    const now = P.t - k / 30;
    if (!acted && P.act && now >= P.t - P.at) {
      placeCamera();
      scripted(now);
      acted = true;
    }
    step(now, 1 / 30);
  }
} else if (P.act) setTimeout(() => scripted(clock()), 1500);
loop();
