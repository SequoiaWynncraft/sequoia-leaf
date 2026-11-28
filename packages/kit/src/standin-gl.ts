/**
 * A stand-in for the graphics card and the canvases a page makes, for tests: there is neither under
 * `bun test`. A canvas here is only its size; what is drawn on it with a 2D context is let go, and its
 * WebGL2 context is the card, which draws nothing and writes down what it was asked: each texture
 * made, each picture copied onto one, and each batch of boxes drawn, with what they were drawn from,
 * onto and how. Pages never load this.
 */

/** One box of a batch, as the painter sent it: where on the picture, from where on the texture, and its tint (each part from 0 to 1). */
export interface SentBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  readonly tint: readonly [number, number, number, number];
}

/** A batch drawn: the texture it was drawn from and the layer it was drawn onto (by their numbers; null for the canvas), the blending, the round mask, and its boxes in order. */
export interface SentBatch {
  readonly from: number;
  readonly onto: number | null;
  readonly blend: string;
  readonly disc: readonly number[];
  readonly boxes: readonly SentBox[];
}

/** A picture copied onto a texture: which texture, where, and the picture and its size. */
export interface Copied {
  readonly onto: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly pic: unknown;
}

interface Texture {
  readonly id: number;
  w: number;
  h: number;
}

/** The bytes of a box, as `painter.ts` lays them out. */
const BYTES = 32;

/** The card: everything asked of it, written down. */
export class FakeCard {
  /** With false, a canvas has no WebGL2 context at all: a browser without it. */
  has = true;
  /** The longest side a texture may have. */
  most = 4096;
  readonly batches: SentBatch[] = [];
  readonly copied: Copied[] = [];
  /** The textures alive, by their numbers, each with its size. */
  readonly textures = new Map<number, Texture>();
  /** How many programs have been linked: one, and one more each time the card came back. */
  programs = 0;
  /** How many canvases the stand-in document has made. */
  canvases = 0;
  #lost = false;
  #made = 0;
  #bound: Texture | null = null;
  #onto: { id: number; tex: Texture | null } | null = null;
  #blend = "";
  #disc: number[] = [];
  readonly #canvases = new Set<EventTarget>();

  /** Forgets what was drawn and copied so far, for a test that looks at what comes next. */
  clear(): void {
    this.batches.length = 0;
    this.copied.length = 0;
  }

  /** Takes everything back, as a browser does to a page put away: every canvas with a context is told. */
  lose(): void {
    this.#lost = true;
    this.textures.clear();
    for (const c of this.#canvases) c.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
  }

  /** Gives the card back, empty. */
  restore(): void {
    this.#lost = false;
    for (const c of this.#canvases) c.dispatchEvent(new Event("webglcontextrestored"));
  }

  /** The batches' boxes drawn from one texture onto the canvas, in order. */
  boxesFrom(texture: number): SentBox[] {
    return this.batches.filter((b) => b.from === texture && b.onto === null).flatMap((b) => b.boxes);
  }

  /** The context a canvas gets: every WebGL2 method the painter calls, and any other as one that does nothing. */
  context(canvas: EventTarget): unknown {
    if (!this.has) return null;
    this.#canvases.add(canvas);
    const texture = (): Texture | null => {
      if (this.#lost) return null;
      const t = { id: ++this.#made, w: 0, h: 0 };
      this.textures.set(t.id, t);
      return t;
    };
    const known: Record<string, unknown> = {
      isContextLost: () => this.#lost,
      getParameter: (name: string) => (name === "MAX_TEXTURE_SIZE" ? this.most : 0),
      getShaderParameter: () => true,
      getProgramParameter: () => true,
      createShader: () => ({}),
      createProgram: () => ({}),
      createBuffer: () => ({}),
      createVertexArray: () => ({}),
      getUniformLocation: (_program: unknown, name: string) => name,
      linkProgram: () => void this.programs++,
      createTexture: texture,
      deleteTexture: (t: Texture | null) => void (t && this.textures.delete(t.id)),
      bindTexture: (_target: unknown, t: Texture | null) => void (this.#bound = t),
      texStorage2D: (_t: unknown, _levels: unknown, _format: unknown, w: number, h: number) => {
        if (this.#bound) Object.assign(this.#bound, { w, h });
      },
      texSubImage2D: (_t: unknown, _l: unknown, x: number, y: number, ...rest: unknown[]) => {
        const pic = rest.at(-1);
        const sized = typeof pic === "object" && pic !== null && "width" in pic && "height" in pic;
        const [w, h] = sized ? [Number(pic.width), Number(pic.height)] : [Number(rest[0]), Number(rest[1])];
        if (this.#bound && !this.#lost) this.copied.push({ onto: this.#bound.id, x, y, w, h, pic });
      },
      createFramebuffer: () => (this.#lost ? null : { id: ++this.#made, tex: null }),
      bindFramebuffer: (_target: unknown, f: { id: number; tex: Texture | null } | null) => void (this.#onto = f),
      framebufferTexture2D: (_a: unknown, _b: unknown, _c: unknown, t: Texture | null) => {
        if (this.#onto) this.#onto.tex = t;
      },
      blendFunc: (src: string, dst: string) => void (this.#blend = `${src} ${dst}`),
      uniform3f: (name: string, x: number, y: number, r: number) => {
        if (name === "uDisc") this.#disc = [x, y, r];
      },
      bufferData: (_target: unknown, data: Float32Array, _usage: unknown, _from: number, floats: number) => {
        this.#sent = new Uint8Array(data.buffer, data.byteOffset, floats * 4).slice().buffer;
      },
      drawArraysInstanced: (_mode: unknown, _first: number, _corners: number, boxes: number) => {
        if (this.#lost) return;
        this.batches.push({
          from: this.#bound?.id ?? 0,
          onto: this.#onto?.tex?.id ?? null,
          blend: this.#blend,
          disc: this.#disc,
          boxes: read(this.#sent, boxes),
        });
      },
    };
    return new Proxy(known, {
      // A constant is its own name; anything else the painter calls does nothing.
      get: (had, name) =>
        typeof name !== "string" || name in had
          ? had[String(name)]
          : /^[A-Z0-9_]+$/.test(name)
            ? name
            : () => undefined,
    });
  }
  #sent: ArrayBuffer = new ArrayBuffer(0);
}

/** The boxes of a batch, read back out of the bytes sent. */
function read(bytes: ArrayBuffer, boxes: number): SentBox[] {
  const floats = new Float32Array(bytes);
  const shorts = new Uint16Array(bytes);
  return Array.from({ length: boxes }, (_, n) => {
    const f = (n * BYTES) / 4;
    const s = (n * BYTES) / 2 + 8;
    const part = (k: number): number => (shorts[s + k] ?? 0) / 65535;
    return {
      x: floats[f] ?? 0,
      y: floats[f + 1] ?? 0,
      w: floats[f + 2] ?? 0,
      h: floats[f + 3] ?? 0,
      sx: shorts[s] ?? 0,
      sy: shorts[s + 1] ?? 0,
      sw: shorts[s + 2] ?? 0,
      sh: shorts[s + 3] ?? 0,
      tint: [part(4), part(5), part(6), part(7)],
    };
  });
}

/** Pixels the size a drawing asks for, all clear. */
const clear = (
  width: number,
  height: number,
): ImageDataSettings & { width: number; height: number; data: Uint8ClampedArray } => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4),
});

/**
 * Puts a document in place whose canvases are stand-ins: only their size, a 2D context that lets go
 * of whatever is drawn, and the card as their WebGL2 context. Gives back how to take it away again.
 */
export function standInCanvases(card: FakeCard): () => void {
  class Canvas extends EventTarget {
    width = 300;
    height = 150;
    getContext(kind: string): unknown {
      if (kind === "webgl2") return card.context(this);
      const answers: Record<string, unknown> = {
        canvas: this,
        getImageData: (_x: number, _y: number, w: number, h: number) => clear(w, h),
        createImageData: clear,
        measureText: () => ({ width: 0 }),
        createLinearGradient: () => ({ addColorStop: () => undefined }),
        createRadialGradient: () => ({ addColorStop: () => undefined }),
      };
      return new Proxy(answers, {
        get: (known, name) => (typeof name === "string" && name in known ? known[name] : () => undefined),
        set: () => true,
      });
    }
  }
  const createElement = (): Canvas => {
    card.canvases++;
    return new Canvas();
  };
  Object.defineProperty(globalThis, "document", { value: { createElement }, configurable: true });
  return () => void Reflect.deleteProperty(globalThis, "document");
}
