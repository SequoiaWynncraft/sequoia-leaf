/**
 * Pixel pictures drawn by the graphics card (WebGL2), for a game that draws its world small and lets
 * the page enlarge it. Everything is a box of the picture filled from a box of a texture, in the
 * order it was asked for, so what is drawn later lies over what was drawn before, as on a canvas.
 *
 * - Small pictures (canvases the art code painted) are copied onto one atlas (`atlas.ts`) the first
 *   time each is drawn, and drawn from it afterwards: a picture must not be painted on again once it
 *   has been drawn. A flat colour is the atlas's one white pixel, tinted.
 * - A large picture kept by its owner (the ground, a plan) is a `Sheet`: a texture of its own that
 *   the owner copies canvases onto.
 * - A `Layer` is a picture drawn here and then laid on another, whole and as faint as asked: dusk
 *   with the lamps cut out of it, pieces not yet built.
 *
 * Boxes are gathered and sent to the card together; a batch ends only where the texture, the way of
 * blending, the round mask or the picture drawn on changes.
 *
 * The card may take everything back (`webglcontextlost`). Nothing is drawn until it returns
 * (`webglcontextrestored`); then the program, the atlas, the sheets and the layers are made again,
 * empty, and whoever asked (`restored`) is told to paint what they keep on a sheet again.
 */

import { Atlas } from "./atlas.ts";
import type { Scope } from "./scope.ts";

/** How what is drawn joins what is under it: over it, added to its light, or cut out of it by how solid it is. */
export type Blend = "over" | "add" | "cut";

/** A colour's red, green and blue and how solid it is, each from 0 to 1. */
type Rgba = readonly [number, number, number, number];

const VERTEX = `#version 300 es
layout(location = 0) in vec4 aBox;
layout(location = 1) in vec4 aCut;
layout(location = 2) in vec4 aTint;
uniform vec4 uView;
out vec2 vAt;
out vec2 vCut;
out vec4 vTint;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vAt = aBox.xy + corner * aBox.zw;
  vCut = aCut.xy + corner * aCut.zw;
  vTint = aTint;
  gl_Position = vec4(vAt * uView.xy + uView.zw, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uPic;
uniform vec3 uDisc;
in vec2 vAt;
in vec2 vCut;
in vec4 vTint;
out vec4 colour;
void main() {
  float cover = uDisc.z < 0.0 ? 1.0 : clamp(uDisc.z + 0.5 - distance(vAt, uDisc.xy), 0.0, 1.0);
  colour = texelFetch(uPic, ivec2(vCut), 0) * vTint * cover;
}`;

/** Boxes sent to the card in one go, at most; and the bytes of each: its box (4 floats), its box of the texture and its tint (4 shorts each). */
const BATCH = 8192;
const BYTES = 32;
/** The atlas's size at first, and the largest it grows to, each way. */
const ATLAS = { first: 1024, most: 4096 } as const;

const COLOURS = new Map<string, Rgba>();
/** A colour as the styles write it (`#rrggbb`, `rgb(r,g,b)`, `rgba(r,g,b,a)`), as numbers. */
export function rgba(css: string): Rgba {
  let c = COLOURS.get(css);
  if (c) return c;
  if (css.startsWith("#")) {
    const n = parseInt(css.slice(1), 16);
    c = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  } else {
    const [r = 0, g = 0, b = 0, a = 1] = css
      .slice(css.indexOf("(") + 1, css.indexOf(")"))
      .split(",")
      .map(Number);
    c = [r / 255, g / 255, b / 255, a];
  }
  COLOURS.set(css, c);
  return c;
}

/** A texture and its size. */
interface Tex {
  t: WebGLTexture | null;
  w: number;
  h: number;
}

/** A large picture kept on the card by its owner. Emptied when the card takes everything back. */
export interface Sheet {
  readonly w: number;
  readonly h: number;
  /** Copies a canvas onto it, the canvas's corner at (`x`, `y`). */
  put(c: TexImageSource, x: number, y: number): void;
}

/** A picture drawn on the card to be laid on another. */
export interface Layer {
  /** Everything drawn until `end` goes on this layer, `w` by `h`, cleared first to a colour (four numbers, already multiplied by how solid it is) or to nothing. */
  begin(w: number, h: number, clear?: Rgba): void;
  end(): void;
  /** Gives its picture's memory back to the card, until it is next begun. */
  release(): void;
}

/** What the card holds for the painter: made when it opens, and again when the card comes back. */
interface Made {
  readonly program: WebGLProgram;
  readonly buffer: WebGLBuffer;
  readonly view: WebGLUniformLocation | null;
  readonly disc: WebGLUniformLocation | null;
  readonly atlas: Tex;
}

function shader(gl: WebGL2RenderingContext, kind: number, source: string): WebGLShader {
  const s = gl.createShader(kind);
  if (!s) throw new Error("no shader");
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost())
    throw new Error(`shader: ${gl.getShaderInfoLog(s) ?? ""}`);
  return s;
}

/** A texture of a size, clear, read a pixel for a pixel. */
function texture(gl: WebGL2RenderingContext, w: number, h: number): WebGLTexture | null {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/** The program, the boxes' buffer and how the card reads it, and the atlas's texture. */
function make(gl: WebGL2RenderingContext, atlasSize: number): Made {
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  if (!program || !buffer) throw new Error("no program");
  gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost())
    throw new Error(`program: ${gl.getProgramInfoLog(program) ?? ""}`);
  gl.useProgram(program);
  gl.bindVertexArray(gl.createVertexArray());
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, BYTES, 0);
  gl.vertexAttribPointer(1, 4, gl.UNSIGNED_SHORT, false, BYTES, 16);
  gl.vertexAttribPointer(2, 4, gl.UNSIGNED_SHORT, true, BYTES, 24);
  for (let k = 0; k < 3; k++) {
    gl.enableVertexAttribArray(k);
    gl.vertexAttribDivisor(k, 1);
  }
  gl.enable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  const atlas = { t: texture(gl, atlasSize, atlasSize), w: atlasSize, h: atlasSize };
  return {
    program,
    buffer,
    view: gl.getUniformLocation(program, "uView"),
    disc: gl.getUniformLocation(program, "uDisc"),
    atlas,
  };
}

/** The bytes some textures take on the card: four a pixel. */
const bytesOf = (all: Iterable<Tex>): number => [...all].reduce((n, t) => n + t.w * t.h * 4, 0);

/** A tint that leaves a picture as it is, and nothing at all. */
const WHOLE: Rgba = [1, 1, 1, 1];
const CLEAR: Rgba = [0, 0, 0, 0];
/** What stands for the white pixel in the atlas's corner, so that no picture is placed on it. */
const WHITE = {};

/** A layer as the painter keeps it: its texture and what draws onto it. */
interface Target extends Tex {
  f: WebGLFramebuffer | null;
}

export class Painter {
  readonly #c: HTMLCanvasElement;
  readonly #gl: WebGL2RenderingContext;
  #made: Made;
  readonly #atlas: Atlas<object>;
  /** The sheets and layers handed out, each with what the painter keeps of it. */
  readonly #sheets = new Map<Sheet, Tex>();
  readonly #layers = new Map<Layer, Target>();
  readonly #restored: (() => void)[] = [];
  #lost = false;

  /** The boxes gathered and not yet sent: as floats and as shorts over the same bytes, and how many. */
  readonly #bytes = new ArrayBuffer(BATCH * BYTES);
  readonly #floats = new Float32Array(this.#bytes);
  readonly #shorts = new Uint16Array(this.#bytes);
  #count = 0;
  /** What the gathered boxes are drawn with: the texture, the blending, the round mask, and the picture drawn on. */
  #tex: Tex;
  #blend: Blend = "over";
  #disc: readonly [number, number, number] = [0, 0, -1];
  #onto: Target | null = null;
  /** How many batches and boxes the frame has sent, for whoever measures it. */
  readonly sent = { batches: 0, boxes: 0 };

  /** A painter on a canvas, or null where the browser has no WebGL2. `sc` holds its listening. */
  static open(c: HTMLCanvasElement, sc: Scope): Painter | null {
    const gl = c.getContext("webgl2", { alpha: true, antialias: false, depth: false, stencil: false });
    return gl ? new Painter(c, gl, sc) : null;
  }

  private constructor(c: HTMLCanvasElement, gl: WebGL2RenderingContext, sc: Scope) {
    this.#c = c;
    this.#gl = gl;
    const most = Math.min(ATLAS.most, Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || ATLAS.first);
    this.#atlas = new Atlas(ATLAS.first, most);
    this.#made = make(gl, this.#atlas.size);
    this.#tex = this.#made.atlas;
    this.#white();
    sc.on(c, "webglcontextlost", (e) => {
      // Unless this is said, the browser never gives the card back.
      e.preventDefault();
      this.#lost = true;
      this.#count = 0;
    });
    sc.on(c, "webglcontextrestored", () => this.#remake());
  }

  /** Everything on the card made again, empty, once the card is back; and those who keep sheets told. */
  #remake(): void {
    const gl = this.#gl;
    this.#lost = false;
    this.#atlas.empty();
    this.#made = make(gl, this.#atlas.size);
    this.#tex = this.#made.atlas;
    this.#white();
    this.#onto = null;
    this.#count = 0;
    for (const s of this.#sheets.values()) s.t = texture(gl, s.w, s.h);
    for (const l of this.#layers.values()) if (l.w > 0) this.#size(l, l.w, l.h);
    for (const told of this.#restored) told();
  }

  /** Whether the card has taken everything back, and nothing can be drawn until it returns. */
  get lost(): boolean {
    return this.#lost;
  }

  /** The longest side a sheet may have. */
  get most(): number {
    return Number(this.#gl.getParameter(this.#gl.MAX_TEXTURE_SIZE)) || ATLAS.first;
  }

  /** How large the atlas is each way, how many pictures are on it, and how many times it has started again. */
  get atlas(): { size: number; pictures: number; turns: number } {
    return { size: this.#atlas.size, pictures: this.#atlas.count, turns: this.#atlas.turn };
  }

  /** Calls `told` each time the card comes back: every sheet is empty then. */
  restored(told: () => void): void {
    this.#restored.push(told);
  }

  // ---------- a frame ----------

  /** Begins a frame on the canvas at its size now, cleared to a colour (or to nothing). Gives false while the card is lost: draw nothing. */
  begin(clear: string | null): boolean {
    if (this.#lost) return false;
    const gl = this.#gl;
    this.sent.batches = 0;
    this.sent.boxes = 0;
    this.#aim(null);
    const [r, g, b, a] = clear === null ? [0, 0, 0, 0] : rgba(clear);
    gl.clearColor(r * a, g * a, b * a, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.#blend = "over";
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.#disc = [0, 0, -1];
    gl.uniform3f(this.#made.disc, 0, 0, -1);
    return true;
  }

  /** Ends the frame: everything gathered is sent. */
  end(): void {
    this.#flush();
  }

  /** Waits for the card to have drawn everything sent, for whoever times a frame. */
  settle(): void {
    this.#flush();
    this.#gl.readPixels(0, 0, 1, 1, this.#gl.RGBA, this.#gl.UNSIGNED_BYTE, new Uint8Array(4));
  }

  /** Draws from here on onto a layer, or with null onto the canvas. */
  #aim(onto: Target | null): void {
    const gl = this.#gl;
    this.#flush();
    this.#onto = onto;
    gl.bindFramebuffer(gl.FRAMEBUFFER, onto ? onto.f : null);
    const w = onto ? onto.w : this.#c.width;
    const h = onto ? onto.h : this.#c.height;
    gl.viewport(0, 0, w, h);
    // The canvas's first row is its top; a layer's first row is the first of its texture.
    if (onto) gl.uniform4f(this.#made.view, 2 / w, 2 / h, -1, -1);
    else gl.uniform4f(this.#made.view, 2 / w, -2 / h, -1, 1);
  }

  /** Sends the boxes gathered to the card, as one draw. */
  #flush(): void {
    const n = this.#count;
    if (n === 0) return;
    this.#count = 0;
    const gl = this.#gl;
    gl.bindTexture(gl.TEXTURE_2D, this.#tex.t);
    gl.bufferData(gl.ARRAY_BUFFER, this.#floats, gl.STREAM_DRAW, 0, (n * BYTES) / 4);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    this.sent.batches++;
    this.sent.boxes += n;
  }

  /** How what is drawn from here on joins what is under it. */
  blend(how: Blend): void {
    if (how === this.#blend) return;
    this.#flush();
    this.#blend = how;
    const gl = this.#gl;
    if (how === "over") gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else if (how === "add") gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
  }

  /**
   * From here on only what lies within `r` pixels of (`x`, `y`) is drawn, its edge softened over a
   * pixel as a canvas softens a circle's; with no radius, everything is drawn again.
   */
  disc(x = 0, y = 0, r = -1): void {
    const d = this.#disc;
    if (d[0] === x && d[1] === y && d[2] === r) return;
    this.#flush();
    this.#disc = [x, y, r];
    this.#gl.uniform3f(this.#made.disc, x, y, r);
  }

  // ---------- boxes ----------

  /** Gathers one box: (`x`, `y`, `w`, `h`) of the picture from (`sx`, `sy`, `sw`, `sh`) of a texture, tinted (already multiplied by how solid). */
  #box(
    tex: Tex,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    x: number,
    y: number,
    w: number,
    h: number,
    tint: Rgba,
    a: number,
  ): void {
    if (this.#lost) return;
    if (tex !== this.#tex) {
      this.#flush();
      this.#tex = tex;
    } else if (this.#count === BATCH) this.#flush();
    const f = this.#count * 8;
    const s = this.#count * 16 + 8;
    const floats = this.#floats;
    const shorts = this.#shorts;
    floats[f] = x;
    floats[f + 1] = y;
    floats[f + 2] = w;
    floats[f + 3] = h;
    shorts[s] = sx;
    shorts[s + 1] = sy;
    shorts[s + 2] = sw;
    shorts[s + 3] = sh;
    const solid = tint[3] * a * 65535;
    shorts[s + 4] = tint[0] * solid + 0.5;
    shorts[s + 5] = tint[1] * solid + 0.5;
    shorts[s + 6] = tint[2] * solid + 0.5;
    shorts[s + 7] = solid + 0.5;
    this.#count++;
  }

  /** Where a picture lies on the atlas: copied onto it the first time it is drawn, the atlas started again (larger, if it can be) when it is full. */
  #placed(c: HTMLCanvasElement): { readonly x: number; readonly y: number } {
    const had = this.#atlas.at(c);
    if (had) return had;
    let place = this.#atlas.place(c, c.width, c.height);
    while (!place) {
      // What was gathered was placed on the atlas as it is: it is drawn before the atlas is emptied.
      this.#flush();
      this.#atlas.restart();
      this.#white();
      place = this.#atlas.place(c, c.width, c.height);
    }
    const gl = this.#gl;
    gl.bindTexture(gl.TEXTURE_2D, this.#made.atlas.t);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, place.x, place.y, gl.RGBA, gl.UNSIGNED_BYTE, c);
    return place;
  }

  /** The atlas's texture at the atlas's size now, with its white pixel in the corner, which the atlas keeps clear of pictures. */
  #white(): void {
    const gl = this.#gl;
    const a = this.#made.atlas;
    if (a.w !== this.#atlas.size) {
      gl.deleteTexture(a.t);
      a.w = a.h = this.#atlas.size;
      a.t = texture(gl, a.w, a.h);
    }
    gl.bindTexture(gl.TEXTURE_2D, a.t);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    this.#atlas.place(WHITE, 1, 1);
  }

  /** The part (`sx`, `sy`, `sw`, `sh`) of a picture on the atlas, filling (`x`, `y`, `w`, `h`). */
  #picture(
    c: HTMLCanvasElement,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    x: number,
    y: number,
    w: number,
    h: number,
    a: number,
  ): void {
    if (this.#lost) return;
    const at = this.#placed(c);
    this.#box(this.#made.atlas, at.x + sx, at.y + sy, sw, sh, x, y, w, h, WHOLE, a);
  }

  /** A picture, its corner at (`x`, `y`), `a` solid. */
  pic(c: HTMLCanvasElement, x: number, y: number, a = 1): void {
    this.#picture(c, 0, 0, c.width, c.height, x, y, c.width, c.height, a);
  }

  /** The part (`sx`, `sy`, `w`, `h`) of a picture, that part's corner at (`x`, `y`). */
  part(c: HTMLCanvasElement, sx: number, sy: number, w: number, h: number, x: number, y: number, a = 1): void {
    this.#picture(c, sx, sy, w, h, x, y, w, h, a);
  }

  /** A picture made to fill (`x`, `y`, `w`, `h`), each pixel of the box taking the pixel of the picture under its middle. */
  stretch(c: HTMLCanvasElement, x: number, y: number, w: number, h: number, a = 1): void {
    this.#picture(c, 0, 0, c.width, c.height, x, y, w, h, a);
  }

  /** A box of one colour, `a` of the colour's own solidness. */
  rect(x: number, y: number, w: number, h: number, colour: string, a = 1): void {
    this.#box(this.#made.atlas, 0, 0, 1, 1, x, y, w, h, rgba(colour), a);
  }

  // ---------- sheets and layers ----------

  /** A large picture of the owner's own, `w` by `h`, clear. */
  sheet(w: number, h: number): Sheet {
    const gl = this.#gl;
    const tex: Tex = { t: texture(gl, w, h), w, h };
    const sheet: Sheet = {
      w,
      h,
      put: (c, x, y) => {
        // What was gathered from the sheet as it was is drawn before it changes.
        if (this.#tex === tex) this.#flush();
        gl.bindTexture(gl.TEXTURE_2D, tex.t);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, c);
      },
    };
    this.#sheets.set(sheet, tex);
    return sheet;
  }

  /** Lets go of a sheet: its memory on the card is given back. */
  drop(sheet: Sheet): void {
    const tex = this.#sheets.get(sheet);
    if (!tex) return;
    if (this.#tex === tex) this.#flush();
    this.#gl.deleteTexture(tex.t);
    this.#sheets.delete(sheet);
  }

  /** The part (`sx`, `sy`, `w`, `h`) of a sheet or of a layer's picture, that part's corner at (`x`, `y`). */
  from(src: Sheet | Layer, sx: number, sy: number, w: number, h: number, x: number, y: number, a = 1): void {
    const tex = "put" in src ? this.#sheets.get(src) : this.#layers.get(src);
    if (tex) this.#box(tex, sx, sy, w, h, x, y, w, h, WHOLE, a);
  }

  /** A layer's texture and what draws onto it, at a size. */
  #size(l: Target, w: number, h: number): void {
    const gl = this.#gl;
    gl.deleteTexture(l.t);
    gl.deleteFramebuffer(l.f);
    l.w = w;
    l.h = h;
    l.t = texture(gl, w, h);
    l.f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, l.f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, l.t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#onto ? this.#onto.f : null);
  }

  /** A picture to draw on and then lay on another (`from`). */
  layer(): Layer {
    const gl = this.#gl;
    const l: Target = { t: null, f: null, w: 0, h: 0 };
    const layer: Layer = {
      begin: (w, h, clear = CLEAR) => {
        if (this.#lost) return;
        if (this.#tex === l) this.#flush();
        if (l.w !== w || l.h !== h || l.t === null) this.#size(l, w, h);
        this.#aim(l);
        gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
        gl.clear(gl.COLOR_BUFFER_BIT);
      },
      end: () => {
        if (!this.#lost) this.#aim(null);
      },
      release: () => {
        if (l.w === 0) return;
        if (this.#tex === l) this.#flush();
        gl.deleteTexture(l.t);
        gl.deleteFramebuffer(l.f);
        Object.assign(l, { t: null, f: null, w: 0, h: 0 });
      },
    };
    this.#layers.set(layer, l);
    return layer;
  }

  /** The bytes the card holds for the painter: the atlas, the sheets, the layers and the boxes' buffer. */
  get memory(): { atlas: number; sheets: number; layers: number; boxes: number } {
    return {
      atlas: bytesOf([this.#made.atlas]),
      sheets: bytesOf(this.#sheets.values()),
      layers: bytesOf(this.#layers.values()),
      boxes: BATCH * BYTES,
    };
  }
}
