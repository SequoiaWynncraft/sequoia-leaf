/**
 * A live connection as tests, the local play server's walkers and the load test use it: Bun's
 * WebSocket, sending a session as the cookie (with an `Origin`, as a browser would) or as a Bearer
 * header, and keeping everything Leaf sends for the caller to wait on.
 */
import {
  decodeSnapshot,
  encodeMove,
  livePath,
  type Motion,
  readToClient,
  type Snapshot,
  type ToClient,
  type ToServer,
} from "@sequoia-leaf/core";

export interface Opening {
  readonly cookie?: string;
  readonly bearer?: string;
  readonly origin?: string;
  /** What the page says it is on, as `&device=` in the address. */
  readonly device?: string;
}

type Of<T extends ToClient["t"]> = Extract<ToClient, { t: T }>;

/** Whether a message from Leaf is of a kind. */
const isOf =
  <T extends ToClient["t"]>(t: T) =>
  (m: ToClient): m is Of<T> =>
    m.t === t;

export class LiveClient {
  readonly texts: ToClient[] = [];
  readonly snapshots: { at: number; snapshot: Snapshot }[] = [];
  /** What arrived, in order: each text's `t`, or `snapshot`. */
  readonly arrived: string[] = [];
  /** How the connection closed, once it has. */
  closed: { code: number; reason: string } | null = null;
  /** Told each snapshot as it arrives, with when (`performance.now()`). */
  onSnapshot: (snapshot: Snapshot, at: number) => void = () => undefined;
  private readonly ws: WebSocket;
  private readonly waiting = new Set<() => void>();
  private seq = 0;
  private pings = 0;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.binaryType = "arraybuffer";
    ws.addEventListener("message", (e: MessageEvent) => {
      if (typeof e.data === "string") {
        const m = readToClient(e.data);
        if (m) {
          this.texts.push(m);
          this.arrived.push(m.t);
        }
      } else if (e.data instanceof ArrayBuffer) {
        this.arrived.push("snapshot");
        const snapshot = decodeSnapshot(new Uint8Array(e.data));
        const at = performance.now();
        if (snapshot) {
          this.snapshots.push({ at, snapshot });
          this.onSnapshot(snapshot, at);
        }
      }
      this.wake();
    });
    ws.addEventListener("close", (e: CloseEvent) => {
      this.closed = { code: e.code, reason: e.reason };
      this.wake();
    });
  }

  /** Opens a connection into a room on Leaf at `origin` (`http://127.0.0.1:4000`), resolving once it is open. */
  static open(origin: string, sent: Opening, room = "town"): Promise<LiveClient> {
    const path = livePath(room);
    const headers: Record<string, string> = {};
    if (sent.cookie !== undefined) headers["Cookie"] = `seq_session=${sent.cookie}`;
    if (sent.bearer !== undefined) headers["Authorization"] = `Bearer ${sent.bearer}`;
    if (sent.origin !== undefined) headers["Origin"] = sent.origin;
    const device = sent.device === undefined ? "" : `&device=${encodeURIComponent(sent.device)}`;
    const ws = new WebSocket(`${origin.replace(/^http/, "ws")}${path}${device}`, { headers });
    const client = new LiveClient(ws);
    return new Promise((resolve, reject) => {
      ws.addEventListener("open", () => resolve(client), { once: true });
      ws.addEventListener("error", () => reject(new Error("The live connection did not open")), { once: true });
    });
  }

  send(message: ToServer): void {
    this.ws.send(JSON.stringify(message));
  }

  sendRaw(frame: string | Uint8Array): void {
    this.ws.send(frame);
  }

  /** Sends the player's motion, numbering it. Returns its number. */
  move(motion: Motion): number {
    this.seq = (this.seq + 1) & 0xffff;
    this.ws.send(encodeMove(this.seq, motion));
    return this.seq;
  }

  /**
   * Once Leaf has answered a ping: it has taken everything this connection sent before it, and this
   * connection has everything Leaf sent it before the answer, so what has not come by then was not sent.
   */
  async settled(): Promise<void> {
    this.pings += 1;
    const c = this.pings;
    this.send({ t: "ping", c });
    await this.next("pong", (m) => m.c === c);
  }

  /** The welcome a connection opens with, or the next one. */
  welcome(): Promise<Of<"welcome">> {
    return this.next("welcome");
  }

  /** Moves into a room of another kind on this connection (or is greeted again in this one). */
  join(room = "town"): Promise<Of<"welcome">> {
    this.send({ t: "join", room });
    return this.next("welcome");
  }

  close(): void {
    this.ws.close();
  }

  /** The connection drops, as the network drops it: no closing handshake, which Leaf sees as 1006. */
  drop(): void {
    this.ws.terminate();
  }

  /** The first text of this kind (that passes `which`) not yet taken, waiting for it if need be. */
  next<T extends ToClient["t"]>(t: T, which: (m: Of<T>) => boolean = () => true, ms = 2000): Promise<Of<T>> {
    const of = isOf(t);
    return this.until(() => {
      const i = this.texts.findIndex((m) => of(m) && which(m));
      if (i < 0) return undefined;
      const [m] = this.texts.splice(i, 1);
      return m !== undefined && of(m) ? m : undefined;
    }, ms);
  }

  /** The first snapshot that passes `which` not yet taken, waiting for it if need be. */
  snapshot(which: (s: Snapshot) => boolean = () => true, ms = 2000): Promise<Snapshot> {
    return this.until(() => {
      const i = this.snapshots.findIndex((s) => which(s.snapshot));
      if (i < 0) return undefined;
      return this.snapshots.splice(i, 1)[0]?.snapshot;
    }, ms);
  }

  /** How the connection closes, waiting for it if need be. */
  ended(ms = 2000): Promise<{ code: number; reason: string }> {
    return this.until(() => this.closed ?? undefined, ms);
  }

  private until<A>(found: () => A | undefined, ms: number): Promise<A> {
    const now = found();
    if (now !== undefined) return Promise.resolve(now);
    return new Promise((resolve, reject) => {
      const look = () => {
        const it = found();
        if (it === undefined) return;
        this.waiting.delete(look);
        clearTimeout(timer);
        resolve(it);
      };
      const timer = setTimeout(() => {
        this.waiting.delete(look);
        reject(
          new Error(
            `Waited ${ms} ms in vain. Texts: ${JSON.stringify(this.texts)}; closed: ${JSON.stringify(this.closed)}`,
          ),
        );
      }, ms);
      this.waiting.add(look);
    });
  }

  private wake(): void {
    for (const look of this.waiting) look();
  }
}
