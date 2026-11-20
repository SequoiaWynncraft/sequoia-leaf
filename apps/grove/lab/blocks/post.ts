/** Scene → half-float target → bloom (two blurred levels) → grade and tone → screen, upscaled by whole pixels. */
import {
  BufferGeometry,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  Scene,
  type ShaderMaterial,
  UnsignedByteType,
  WebGLRenderTarget,
  type WebGLRenderer,
} from "three";
import { blurMaterial, brightMaterial, compositeMaterial } from "./shaders.ts";

export class Post {
  readonly scene: WebGLRenderTarget;
  private readonly half: WebGLRenderTarget;
  private readonly halfB: WebGLRenderTarget;
  private readonly quarter: WebGLRenderTarget;
  private readonly quarterB: WebGLRenderTarget;
  private readonly quad: Mesh;
  private readonly fsScene = new Scene();
  private readonly cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly bright = brightMaterial();
  readonly blur = blurMaterial();
  readonly composite = compositeMaterial();
  private w = 1;
  private h = 1;

  constructor(renderer: WebGLRenderer) {
    const ext = renderer.extensions;
    const type = ext.has("EXT_color_buffer_float") || ext.has("EXT_color_buffer_half_float") ? HalfFloatType : UnsignedByteType;
    const rt = (depth: boolean, nearest: boolean) =>
      new WebGLRenderTarget(1, 1, { type, depthBuffer: depth, magFilter: nearest ? NearestFilter : LinearFilter, minFilter: nearest ? NearestFilter : LinearFilter, generateMipmaps: false });
    this.scene = rt(true, true);
    this.half = rt(false, false);
    this.halfB = rt(false, false);
    this.quarter = rt(false, false);
    this.quarterB = rt(false, false);
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new Mesh(g, this.composite);
    this.quad.frustumCulled = false;
    this.fsScene.add(this.quad);
  }

  setSize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.scene.setSize(w, h);
    this.half.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.halfB.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.quarter.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    this.quarterB.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
  }

  private pass(renderer: WebGLRenderer, m: ShaderMaterial, target: WebGLRenderTarget | null): void {
    this.quad.material = m;
    renderer.setRenderTarget(target);
    renderer.render(this.fsScene, this.cam);
  }

  /** Runs bloom and the composite; the caller has already drawn the scene into `this.scene`. */
  finish(renderer: WebGLRenderer): void {
    const b = this.bright.uniforms;
    b.uSrc!.value = this.scene.texture;
    (b.uTexel!.value as { set(x: number, y: number): void }).set(1 / this.w, 1 / this.h);
    this.pass(renderer, this.bright, this.half);
    const u = this.blur.uniforms;
    const dir = u.uDir!.value as { set(x: number, y: number): void };
    u.uSrc!.value = this.half.texture;
    dir.set(1 / (this.w >> 1), 0);
    this.pass(renderer, this.blur, this.halfB);
    u.uSrc!.value = this.halfB.texture;
    dir.set(0, 1 / (this.h >> 1));
    this.pass(renderer, this.blur, this.half);
    u.uSrc!.value = this.half.texture;
    dir.set(1 / (this.w >> 2), 0);
    this.pass(renderer, this.blur, this.quarterB);
    u.uSrc!.value = this.quarterB.texture;
    dir.set(0, 1 / (this.h >> 2));
    this.pass(renderer, this.blur, this.quarter);
    u.uSrc!.value = this.quarter.texture;
    dir.set(2 / (this.w >> 2), 0);
    this.pass(renderer, this.blur, this.quarterB);
    u.uSrc!.value = this.quarterB.texture;
    dir.set(0, 2 / (this.h >> 2));
    this.pass(renderer, this.blur, this.quarter);
    const c = this.composite.uniforms;
    c.uScene!.value = this.scene.texture;
    c.uBloomA!.value = this.half.texture;
    c.uBloomB!.value = this.quarter.texture;
    this.pass(renderer, this.composite, null);
  }
}
