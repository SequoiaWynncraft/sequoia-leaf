/**
 * Working yards of any size, ported from the scale study's generator (works-scale/scripts/gen.ts).
 *
 * Built the way a player builds, with commands (build, lay, way, remove, stand), on the flat yard,
 * and every command kept, so the same yard can be built again on today's rules by giving it the
 * same commands. Each group is a line: gatherers on a deposit, a collecting belt, a splitter before
 * each machine input with its left way running to a sink and its right way shut, mills, benches
 * fed by two mill lines, engines from two benches, lanterns at workshops, rows of mills on a main
 * line of splitters, banks of boilers; straight runs turned into tunnels; pylons four to a plot.
 *
 * The study's sinks were docks, a piece the game does not have. Here a sink is a crate, which takes
 * 128 things and then backs its line up; and a tile held clear for a line is held by a crate too.
 */
import * as F from "../src/index.ts";
import { PH, PW } from "./land.ts";
import { rng } from "./random.ts";

type Raw = F.RawName;
type Dir = 0 | 1 | 2 | 3;
const dirOf = (n: number | undefined): Dir => (n === 1 ? 1 : n === 2 ? 2 : n === 3 ? 3 : 0);
const DX = [1, 0, -1, 0] as const;
const DY = [0, 1, 0, -1] as const;
const LEFT: Dir[] = [3, 0, 1, 2];
const RIGHT: Dir[] = [1, 2, 3, 0];
const BACK: Dir[] = [2, 3, 0, 1];
const DIRS: Dir[] = [0, 1, 2, 3];

const BENCHES: [Raw, Raw][] = [
  ["deadfall", "ore"],
  ["ore", "stone"],
  ["deadfall", "stone"],
  ["deadfall", "clay"],
  ["clay", "sand"],
];
const LANTERN: Raw[] = ["sand", "ore", "resin"];

type Spec = Raw | { readonly kind: "bench" | "workshop"; readonly from: readonly Spec[] };
type Rec = Record<string, unknown>;

/** What stands on each tile, to go back to: kind, way, span and shut ways. */
interface Snap {
  kind: Uint8Array;
  dir: Uint8Array;
  span: Int8Array;
  shut: Uint8Array;
  docks: number;
  corridor: Map<number, number>;
  pyloned: Set<number>;
}

export class Gen {
  readonly y: F.Yard;
  readonly W: number;
  readonly H: number;
  readonly r: () => number;
  /** Every command given, in order: the same commands build the same yard on today's rules. */
  readonly commands: Rec[] = [];
  patches: { kind: Raw; tiles: number[]; cx: number; cy: number }[] = [];
  docks: number[] = [];
  pyloned = new Set<number>();
  corridor = new Map<number, number>();
  stats = { groups: 0, failed: 0 };
  why = "";

  constructor(land: F.Land, seed: number) {
    // Every goal of the slice done: every kind, a crate of 128, taller pylons, the bigger flywheel.
    this.y = F.create({ land, tier: 4, seed: 1758855484 });
    this.W = land.w;
    this.H = land.h;
    this.r = rng(seed);
    const seen = new Uint8Array(land.w * land.h);
    for (let i = 0; i < land.w * land.h; i++) {
      const kind = this.deposit(i);
      if (!kind || seen[i]) continue;
      const tiles: number[] = [];
      const queue = [i];
      seen[i] = 1;
      for (let j = queue.pop(); j !== undefined; j = queue.pop()) {
        tiles.push(j);
        for (const d of DIRS) {
          const k = this.step(j, d);
          if (k >= 0 && !seen[k] && this.deposit(k) === kind) {
            seen[k] = 1;
            queue.push(k);
          }
        }
      }
      const cx = tiles.reduce((s, t) => s + (t % this.W), 0) / tiles.length;
      const cy = tiles.reduce((s, t) => s + Math.floor(t / this.W), 0) / tiles.length;
      this.patches.push({ kind, tiles, cx, cy });
    }
    const [dx, dy] = land.depot;
    this.patches.toSorted((a, b) => Math.hypot(a.cx - dx, a.cy - dy) - Math.hypot(b.cx - dx, b.cy - dy));
  }

  /** Gives the yard a command, keeps it, and says whether it was done. */
  cmd(c: Rec): boolean {
    const wire = { tick: this.y.tick, ...c };
    this.commands.push(wire);
    const read = F.readCommand(wire);
    return read !== null && !("refused" in F.play(this.y, read));
  }
  no(why: string): false {
    this.why = why;
    return false;
  }

  deposit(i: number): Raw | null {
    const n = this.y.land.deposit[i] ?? F.NONE;
    const name = F.isItem(n) ? F.itemName(n) : null;
    return F.RAW.find((r) => r === name) ?? null;
  }
  kind(i: number): string | null {
    const k = this.y.kind[i] ?? F.NONE;
    return F.isKind(k) ? F.kindName(k) : null;
  }
  lit(i: number): boolean {
    return F.litOf(this.y)[i] === 1;
  }
  idx(x: number, z: number): number {
    return x < 0 || z < 0 || x >= this.W || z >= this.H ? -1 : z * this.W + x;
  }
  xy(i: number): [number, number] {
    return [i % this.W, Math.floor(i / this.W)];
  }
  step(i: number, d: Dir, n = 1): number {
    const [x, z] = this.xy(i);
    return this.idx(x + DX[d] * n, z + DY[d] * n);
  }
  free(i: number): boolean {
    return i >= 0 && this.y.kind[i] === F.NONE && this.y.land.water[i] === 0 && this.y.land.trunk[i] === 0;
  }
  room(i: number): boolean {
    return this.free(i) && this.y.land.deposit[i] === F.NONE;
  }
  put(kind: string, i: number, dir: Dir): boolean {
    const [x, z] = this.xy(i);
    return this.cmd({ do: "build", kind, x, y: z, dir });
  }
  unput(i: number): void {
    const [x, z] = this.xy(i);
    this.cmd({ do: "remove", x, y: z });
  }
  /** Lays a belt from the free tile `from` to the piece at `to`, tunnels allowed, and gives its tiles. */
  lay(from: number, to: number): number[] | null {
    // The router misses a way now and then where tunnels cross; above ground is tried as well.
    const legs =
      F.route(this.y, this.xy(from), this.xy(to)) ?? F.route(this.y, this.xy(from), this.xy(to), { tunnels: false });
    if (!legs || legs.length === 0) return null;
    const wire = legs.map((l) => ({ kind: F.kindName(l.kind), x: l.x, y: l.y, dir: l.dir, span: l.span }));
    if (!this.cmd({ do: "lay", legs: wire })) return null;
    return legs.map((l) => this.idx(l.x, l.y));
  }

  around(i: number, rmin: number, rmax: number): number[] {
    const [x, z] = this.xy(i);
    const out: [number, number][] = [];
    for (let dy = -rmax; dy <= rmax; dy++)
      for (let dx = -rmax; dx <= rmax; dx++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d < rmin || d > rmax) continue;
        const j = this.idx(x + dx, z + dy);
        if (j >= 0) out.push([j, d + this.r() * 0.9]);
      }
    return out.toSorted((a, b) => a[1] - b[1]).map((p) => p[0]);
  }

  /** Four pylons a plot, in the plot and in every plot on the way to it from the depot's. */
  pylons(i: number): void {
    const [x, z] = this.xy(i);
    const pc = Math.floor(x / PW);
    const pr = Math.floor(z / PH);
    const [dx, dy] = this.y.land.depot;
    let c = Math.floor(dx / PW);
    let r = Math.floor(dy / PH);
    const path: [number, number][] = [[c, r]];
    while (c !== pc || r !== pr) {
      if (c !== pc) c += Math.sign(pc - c);
      else r += Math.sign(pr - r);
      path.push([c, r]);
    }
    for (const [pcol, prow] of path) {
      const key = prow * 1000 + pcol;
      if (this.pyloned.has(key)) continue;
      this.pyloned.add(key);
      for (const [lx, ly] of [
        [4, 3],
        [12, 3],
        [4, 9],
        [12, 9],
      ] as const) {
        const at = this.idx(pcol * PW + lx, prow * PH + ly);
        const spot = [at, ...this.around(at, 1, 2)].find((j) => this.room(j));
        if (spot !== undefined) this.put("pylon", spot, 0);
      }
    }
  }

  dist(a: number, b: number): number {
    const [ax, ay] = this.xy(a);
    const [bx, by] = this.xy(b);
    return Math.abs(ax - bx) + Math.abs(ay - by);
  }

  /** Lays a line from a free tile to a sink, now and then through a crate. */
  toSink(from: number, crate = false): boolean {
    if (crate) {
      for (const c of this.around(from, 2, 5)) {
        if (!this.room(c)) continue;
        for (const d of DIRS) {
          const out = this.step(c, d);
          if (!this.room(out) || out === from) continue;
          if (!this.put("crate", c, d)) continue;
          if (!this.lay(from, c)) return false;
          return this.toSink(out);
        }
      }
    }
    const has = (s: number): boolean => DIRS.some((k) => this.free(this.step(s, k)));
    const old = this.docks
      .filter((s) => this.dist(s, from) <= 9 && has(s))
      .toSorted((a, b) => this.dist(a, from) - this.dist(b, from));
    if (old.length && this.r() < 0.6) for (const s of old.slice(0, 2)) if (this.lay(from, s)) return true;
    let tries = 0;
    for (const j of this.around(from, 3, 7)) {
      if (tries >= 4) break;
      if (!this.room(j) || !has(j)) continue;
      if (!this.put("crate", j, 0)) continue;
      tries++;
      if (this.lay(from, j)) {
        this.docks.push(j);
        return true;
      }
      this.unput(j);
    }
    return false;
  }

  /**
   * A machine with a splitter on `inputs` of its sides, each splitter's left way sent to a sink and
   * its right way shut; its goods out of the fourth side.
   */
  machine(
    kind: string,
    inputs: number,
    near: number,
    nth = 0,
  ): { feeds: number[]; backs: number[]; out: number } | null {
    let fits = 0;
    for (const m of this.around(near, 2, 9)) {
      if (!this.room(m) || !this.lit(m)) continue;
      for (const o of DIRS) {
        const out = this.step(m, o);
        if (!this.room(out)) continue;
        const sides = [1, 2, 3].map((k) => dirOf((o + k) % 4));
        const used = new Set([m, out]);
        const ins: { p: number; dir: Dir; back: number; stub: number[] }[] = [];
        let ok = true;
        for (const s of sides.slice(0, inputs)) {
          const p = this.step(m, s);
          const dir = BACK[s] ?? 0;
          const back = this.step(p, s);
          const long = 1 + Math.floor(this.r() * 3);
          const stub = Array.from({ length: long + 1 }, (_, k) => this.step(p, LEFT[dir] ?? 0, k + 1));
          for (const t of [p, back, ...stub]) {
            if (!this.room(t) || used.has(t)) ok = false;
            used.add(t);
          }
          ins.push({ p, dir, back, stub });
        }
        if (!ok || fits++ < nth) continue;
        if (!this.put(kind, m, o)) continue;
        for (const i of ins) {
          this.put("splitter", i.p, i.dir);
          const [x, z] = this.xy(i.p);
          this.cmd({ do: "way", x, y: z, way: 2, open: false });
        }
        for (const i of ins) {
          const way = LEFT[i.dir] ?? 0;
          const crate = this.r() < 0.2 && i.stub.length >= 3;
          i.stub.forEach((t, k) => {
            const last = k === i.stub.length - 1;
            this.put(last || (crate && k === 1) ? "crate" : "belt", t, way);
            if (last) this.docks.push(t);
          });
        }
        for (const t of [out, ...ins.map((i) => i.back)]) this.put("crate", t, 0);
        for (const [t, d] of [[out, o] as const, ...ins.map((i) => [i.back, BACK[i.dir] ?? 0] as const)]) {
          const beyond = this.step(t, d);
          if (this.room(beyond)) {
            this.put("crate", beyond, 0);
            this.corridor.set(t, beyond);
          }
        }
        return { feeds: ins.map((i) => i.p), backs: ins.map((i) => i.back), out };
      }
    }
    return null;
  }

  /** Takes away a crate standing in for a tile kept clear. */
  release(t: number): void {
    const beyond = this.corridor.get(t);
    if (beyond !== undefined) {
      this.corridor.delete(t);
      this.release(beyond);
    }
    if (this.kind(t) === "crate" && !this.docks.includes(t)) this.unput(t);
  }

  /** Gatherers on a patch of `kind` near `to`, their belt ending in the piece at `to`. */
  gather(kind: Raw, to: number, count: number): boolean {
    const [tx, ty] = this.xy(to);
    const patch = this.patches
      .filter((p) => p.kind === kind && p.tiles.some((t) => this.free(t)))
      .toSorted((a, b) => Math.hypot(a.cx - tx, a.cy - ty) - Math.hypot(b.cx - tx, b.cy - ty))[0];
    if (!patch || Math.hypot(patch.cx - tx, patch.cy - ty) > 26) return false;
    this.pylons(this.idx(Math.round(patch.cx), Math.round(patch.cy)));
    const tiles = patch.tiles
      .filter((t) => this.free(t) && this.lit(t))
      .toSorted((a, b) => {
        const [ax, ay] = this.xy(a);
        const [bx, by] = this.xy(b);
        return Math.abs(ax - tx) + Math.abs(ay - ty) - (Math.abs(bx - tx) + Math.abs(by - ty));
      });
    let line: number[] | null = null;
    let made = 0;
    for (const g of tiles) {
      if (made >= count) break;
      if (!this.free(g)) continue;
      const dirs = DIRS.toSorted(() => this.r() - 0.5);
      for (const d of dirs) {
        const ahead = this.step(g, d);
        if (line === null) {
          if (!this.free(ahead)) continue;
          if (!this.put("gatherer", g, d)) continue;
          const laid = this.lay(ahead, to);
          if (!laid) {
            this.unput(g);
            continue;
          }
          line = laid;
          made++;
          break;
        }
        // Straight onto the line's side, or by a short belt of its own to the line.
        if (this.kind(ahead) === "belt" && line.includes(ahead) && this.step(ahead, dirOf(this.y.dir[ahead])) !== g) {
          if (this.put("gatherer", g, d)) {
            made++;
            break;
          }
          continue;
        }
        if (!this.free(ahead)) continue;
        if (!this.put("gatherer", g, d)) continue;
        const near = line
          .slice(0, -1)
          .filter((t) => this.kind(t) === "belt")
          .toSorted((a, c) => this.dist(a, ahead) - this.dist(c, ahead))[0];
        const laid = near === undefined ? null : this.lay(ahead, near);
        if (!laid) {
          this.unput(g);
          continue;
        }
        made++;
        break;
      }
    }
    return made > 0;
  }

  snap(): Snap {
    const y = this.y;
    return {
      kind: y.kind.slice(),
      dir: y.dir.slice(),
      span: y.span.slice(),
      shut: y.shut.slice(),
      docks: this.docks.length,
      corridor: new Map(this.corridor),
      pyloned: new Set(this.pyloned),
    };
  }
  /** Goes back to what stood before, with commands: what is new is taken away, what went is set down again. */
  undo(s: Snap): void {
    const y = this.y;
    const sameAt = (i: number): boolean =>
      y.kind[i] === s.kind[i] && y.dir[i] === s.dir[i] && y.span[i] === s.span[i] && y.shut[i] === s.shut[i];
    for (let i = 0; i < y.kind.length; i++)
      if (y.kind[i] !== F.NONE && y.kind[i] !== F.DEPOT && !sameAt(i)) {
        const span = y.span[i] ?? 0;
        if (span >= 0) this.unput(i);
      }
    for (let i = 0; i < y.kind.length; i++) {
      const k = s.kind[i] ?? F.NONE;
      if (!F.isKind(k) || k === F.DEPOT || (s.span[i] ?? 0) < 0 || sameAt(i)) continue;
      const [x, z] = this.xy(i);
      this.cmd({
        do: "stand",
        pieces: [{ kind: F.kindName(k), x, y: z, dir: s.dir[i], span: s.span[i], shut: s.shut[i] }],
      });
    }
    this.docks.length = s.docks;
    this.corridor = new Map(s.corridor);
    this.pyloned = new Set(s.pyloned);
  }

  line(spec: Spec, near: number, to: { feed: number; back: number } | null): boolean {
    for (let nth = 0; nth < 4; nth++) {
      const s = this.snap();
      if (this.lineAt(spec, near, to, nth)) return true;
      this.undo(s);
      if (this.why.endsWith("spot")) return false;
    }
    return false;
  }

  lineAt(spec: Spec, near: number, to: { feed: number; back: number } | null, nth: number): boolean {
    const kind = typeof spec === "string" ? "mill" : spec.kind;
    const inputs = typeof spec === "string" ? 1 : spec.from.length;
    const m = this.machine(kind, inputs, near, nth);
    if (!m) return this.no(`${kind} spot`);
    if (to === null) {
      this.release(m.out);
      if (!this.toSink(m.out)) return this.no(`${kind} out to sink`);
    } else {
      this.release(to.back);
      this.release(m.out);
      if (this.lay(m.out, to.feed) === null) return this.no(`${kind} out to next`);
    }
    if (typeof spec !== "string") {
      for (const [k, from] of spec.from.entries()) {
        const back = m.backs[k];
        const feed = m.feeds[k];
        if (back === undefined || feed === undefined || !this.line(from, back, { feed, back })) return false;
      }
      return true;
    }
    const back = m.backs[0] ?? -1;
    const feed = m.feeds[0] ?? -1;
    this.release(back);
    // Now and then two gatherer lines meet at a joiner before the splitter.
    if (this.r() < 0.12 && this.put("joiner", back, dirOf(this.y.dir[feed]))) {
      if (this.gather(spec, back, 1) && this.gather(spec, back, 1)) return true;
      return this.no(`gather ${spec} to joiner`);
    }
    return this.gather(spec, feed, 2) || this.no(`gather ${spec}`);
  }

  /** Three splitters in a row with a boiler on each side, fed by deadfall, the rest to a sink. */
  boilers(near: number): boolean {
    for (const s of this.around(near, 2, 9)) {
      for (const d of DIRS) {
        const row = [0, 1, 2].map((k) => this.step(s, d, k));
        const sides = row.flatMap((t) => [this.step(t, LEFT[d] ?? 0), this.step(t, RIGHT[d] ?? 0)]);
        const back = this.step(s, BACK[d] ?? 0);
        const out = this.step(s, d, 3);
        const all = [...row, ...sides, back, out];
        if (new Set(all).size !== all.length || !all.every((t) => this.room(t) && this.lit(t))) continue;
        for (const t of sides) this.put("boiler", t, 0);
        for (const t of row) this.put("splitter", t, d);
        this.put("crate", back, 0);
        if (!this.toSink(out)) return this.no("boilers out");
        this.release(back);
        return this.gather("deadfall", s, 3) || this.no("gather boilers");
      }
    }
    return this.no("boilers spot");
  }

  /** A row of mills on a main line of `k` splitters, each mill's goods onto a collecting belt to a sink. */
  millRow(kind: Raw, near: number, k: number): boolean {
    for (const s of this.around(near, 2, 9)) {
      for (const d of DIRS) {
        const L = LEFT[d] ?? 0;
        const R = RIGHT[d] ?? 0;
        const row = Array.from({ length: k }, (_, j) => this.step(s, d, j));
        const millsL = row.map((t) => this.step(t, L));
        const millsR = row.map((t) => this.step(t, R));
        const colL = row.map((t) => this.step(t, L, 2));
        const colR = row.map((t) => this.step(t, R, 2));
        const back = this.step(s, BACK[d] ?? 0);
        const out = this.step(s, d, k);
        const endL = this.step(colL[k - 1] ?? -1, d);
        const endR = this.step(colR[k - 1] ?? -1, d);
        const all = [...row, ...millsL, ...millsR, ...colL, ...colR, back, out, endL, endR];
        if (new Set(all).size !== all.length || !all.every((t) => this.room(t) && this.lit(t))) continue;
        for (const t of row) this.put("splitter", t, d);
        for (const t of millsL) this.put("mill", t, L);
        for (const t of millsR) this.put("mill", t, R);
        for (const t of [...colL, ...colR]) this.put("belt", t, d);
        for (const t of [back, out, endL, endR]) this.put("crate", t, 0);
        for (const end of [out, endL, endR]) {
          this.release(end);
          if (!this.toSink(end)) return this.no("mill row out");
        }
        this.release(back);
        return this.gather(kind, s, 3) || this.no("gather mill row");
      }
    }
    return this.no("mill row spot");
  }

  /** One group at a patch, of a kind taken in turn, all of it or none. */
  group(patchAt: number, turn: number): boolean {
    const p = this.patches[patchAt];
    if (!p) return false;
    const near = this.idx(Math.round(p.cx), Math.round(p.cy));
    const before = this.snap();
    this.pylons(near);
    const kind = ["bench", "engine", "boilers", "row", "workshop", "bench", "row", "engine", "boilers", "workshop"][
      turn % 10
    ];
    const pair = (): [Raw, Raw] =>
      BENCHES.filter(([a, b]) => a === p.kind || b === p.kind)[turn % 3] ??
      BENCHES.find(([a, b]) => a === p.kind || b === p.kind) ?? ["deadfall", "stone"];
    let ok = false;
    if (kind === "bench") ok = this.line({ kind: "bench", from: pair() }, near, null);
    else if (kind === "engine")
      ok = this.line(
        {
          kind: "bench",
          from: [
            { kind: "bench", from: ["deadfall", "ore"] },
            { kind: "bench", from: ["ore", "stone"] },
          ],
        },
        near,
        null,
      );
    else if (kind === "workshop") ok = this.line({ kind: "workshop", from: LANTERN }, near, null);
    else if (kind === "row") ok = this.millRow(p.kind, near, 3 + (turn % 2));
    else ok = this.boilers(near);
    if (!ok) {
      this.undo(before);
      this.stats.failed++;
      return false;
    }
    this.stats.groups++;
    return true;
  }

  pieces(): number {
    let n = 0;
    for (const k of this.y.kind) if (k !== F.NONE) n++;
    return n;
  }

  /**
   * Turns straight runs of belt into tunnels, as players dig under what is in the way, until mouths
   * are `share` of the pieces. Only runs that nothing feeds from the side.
   */
  tunnelRuns(share: number): void {
    const y = this.y;
    const n = y.kind.length;
    const feeders = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (y.kind[i] === F.NONE) continue;
      if (y.kind[i] === F.SPLITTER) {
        for (let k = 0; k < 3; k++) {
          const to = F.wayOut(y, i, k);
          if (to >= 0) feeders[to] = (feeders[to] ?? 0) + 1;
        }
      } else {
        const to = F.nextOf(y, i);
        if (to >= 0) feeders[to] = (feeders[to] ?? 0) + 1;
      }
    }
    let mouths = 0;
    let pieces = 0;
    for (const k of y.kind) {
      if (k !== F.NONE) pieces++;
      if (k === F.TUNNEL) mouths++;
    }
    const plain = (i: number, d: number): boolean =>
      y.kind[i] === F.BELT && y.dir[i] === d && y.tint[i] === 0 && feeders[i] === 1;
    const order = Array.from({ length: n }, (_, i) => i).toSorted(() => this.r() - 0.5);
    for (const i of order) {
      if (mouths >= share * pieces) break;
      if (y.kind[i] !== F.BELT) continue;
      const d = dirOf(y.dir[i]);
      const behind = this.step(i, BACK[d] ?? 0);
      if (!plain(i, d) || behind < 0 || F.nextOf(y, behind) !== i || y.kind[behind] !== F.BELT) continue;
      const span = 1 + Math.floor(this.r() * 3);
      const run = Array.from({ length: span + 2 }, (_, k) => this.step(i, d, k));
      if (!run.every((t, k) => t >= 0 && (k === 0 || F.nextOf(y, run[k - 1] ?? -1) === t) && plain(t, d))) continue;
      for (const t of run) this.unput(t);
      const [x, z] = this.xy(i);
      if (!this.cmd({ do: "stand", pieces: [{ kind: "tunnel", x, y: z, dir: d, span }] })) throw new Error("tunnel");
      mouths += 2;
      pieces -= span;
      for (const t of run) feeders[t] = 9;
    }
  }
}

/**
 * A working yard of about `target` pieces on a land, and the commands that built it. `before` is
 * given the generator first: a land of many plots has its plots bought there.
 */
export function generate(land: F.Land, target: number, seed = 1, before: (g: Gen) => void = () => undefined): Gen {
  const g = new Gen(land, seed);
  before(g);
  let turn = 0;
  let pieces = g.pieces();
  for (let round = 0; round < 8 && pieces < target; round++) {
    for (let p = 0; p < g.patches.length && pieces < target; p++) {
      if (g.group(p, turn)) turn++;
      else if (round > 0) turn++;
      if (g.stats.groups % 8 === 0) g.tunnelRuns(0.17);
      pieces = g.pieces();
    }
    g.tunnelRuns(0.17);
    pieces = g.pieces();
  }
  return g;
}
