/**
 * Leaf's Discord bot, present: while Leaf runs, it holds a session on Discord's gateway as the bot of
 * Leaf's Discord application (`AppConfig.activity.botToken`, `LEAF_ACTIVITY_BOT_TOKEN`), so the bot
 * shows online, "Playing Leaf". It asks for no events (intents
 * 0) and sends only what keeps the session, by the gateway's rules
 * (https://docs.discord.com/developers/events/gateway): a heartbeat every interval, a resume after a
 * lost connection, a new session when the old one can't be resumed. Two Leafs during a deploy each
 * hold one, which Discord allows.
 *
 * A close code Discord never takes the bot back after (a bad token, shards, the API version, intents)
 * stops it for good, logged once: Discord allows 1,000 identifies a day, so it never loops on one.
 */
import {
  Clock,
  Data,
  Deferred,
  Duration,
  Effect,
  Layer,
  Option,
  Random,
  Redacted,
  Ref,
  Schedule,
  Schema,
} from "effect";
import { Socket } from "effect/socket";

import { AppConfig } from "../config.ts";

/** Discord's gateway, where every new session starts. */
export const GATEWAY = new URL("wss://gateway.discord.gg");
/** What the bot shows while Leaf holds its session. */
const PRESENCE = { since: null, activities: [{ name: "Leaf", type: 0 }], status: "online", afk: false } as const;
/** Close codes Discord never takes the bot back after: a bad token (4004); shards, the version or intents (4010 to 4014). */
const REFUSED = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
/** Close codes that end the session, so the next connection identifies a new one. */
const ENDED = new Set([1000, 4007, 4009]);
/** What Leaf closes a connection with to connect again: any code but 1000 and 1001, which end the session. */
const RECONNECTING = 4000;
/** How long a connection has to open. */
const OPEN_WITHIN = Duration.seconds(10);
/** How long a session runs before its end is a first loss again: the next connection goes at once. */
const STEADY_AFTER = Duration.minutes(2);
/** How long Leaf waits to connect again after each loss in a row: 1 s, doubling to 60 s, each 0.8 to 1.2 times. */
const BACKOFF = Schedule.min([Schedule.exponential("1 second"), Schedule.spaced("60 seconds")]).pipe(Schedule.jittered);

const Hello = Schema.Struct({
  op: Schema.Literal(10),
  d: Schema.Struct({ heartbeat_interval: Schema.Int.check(Schema.isGreaterThan(0)) }),
});
const Dispatch = Schema.Struct({ op: Schema.Literal(0), s: Schema.Int, t: Schema.String, d: Schema.Unknown });
/** A frame from the gateway, of those Leaf reads: Hello, a dispatch, a beat asked for, reconnect, invalid session, an ack. */
const Frame = Schema.Union([
  Hello,
  Dispatch,
  Schema.Struct({ op: Schema.Literal(1) }),
  Schema.Struct({ op: Schema.Literal(7) }),
  Schema.Struct({ op: Schema.Literal(9), d: Schema.Boolean }),
  Schema.Struct({ op: Schema.Literal(11) }),
]);
/** Any other frame, or one Leaf can't read, is let pass. */
const readFrame = Schema.decodeUnknownOption(Schema.fromJsonString(Frame));
/** READY's data, of what Leaf keeps: the session's id, and where to resume it. */
const readReady = Schema.decodeUnknownOption(
  Schema.toCodecJson(Schema.Struct({ session_id: Schema.String, resume_gateway_url: Schema.URL })),
);

/** A session Leaf can resume: its id, where Discord said to resume it, and the last sequence number heard. */
interface Resumable {
  readonly id: string;
  readonly resumeAt: URL | null;
  readonly seq: number;
}

/** What Leaf says to the gateway: a heartbeat, an identify, a resume. */
type Said =
  | { readonly op: 1; readonly d: number | null }
  | {
      readonly op: 2;
      readonly d: {
        readonly token: string;
        readonly intents: 0;
        readonly properties: Readonly<Record<"os" | "browser" | "device", string>>;
        readonly presence: typeof PRESENCE;
      };
    }
  | { readonly op: 6; readonly d: { readonly token: string; readonly session_id: string; readonly seq: number } };

/** A connection ended: why, whether the next resumes its session, and whether it ever opened. */
class Lost extends Data.TaggedError("Lost")<{
  readonly reason: string;
  readonly resume: boolean;
  readonly opened: boolean;
}> {}

/** Discord closed the connection with a code it never takes the bot back after. */
class Refused extends Data.TaggedError("Refused")<{ readonly code: number; readonly reason: string }> {}

const identify = (token: Redacted.Redacted): Said => ({
  op: 2,
  d: {
    token: Redacted.value(token),
    intents: 0,
    properties: { os: "linux", browser: "leaf", device: "leaf" },
    presence: PRESENCE,
  },
});

/** A gateway address with what every connection asks for: API v10, in JSON. */
const withQuery = (at: URL): string => {
  const url = new URL(at);
  url.search = "?v=10&encoding=json";
  return url.href;
};

/** What a socket's failure means for the session. */
const fromSocket = ({ reason: why }: Socket.SocketError): Lost | Refused => {
  if (why instanceof Socket.SocketOpenError)
    return new Lost({ reason: "could not connect", resume: true, opened: false });
  if (!(why instanceof Socket.SocketCloseError)) return new Lost({ reason: why.message, resume: true, opened: true });
  if (REFUSED.has(why.code)) return new Refused({ code: why.code, reason: why.closeReason ?? "" });
  return new Lost({ reason: `closed ${why.message}`, resume: !ENDED.has(why.code), opened: true });
};

/** Says something to the gateway, in JSON. */
const say = (writer: Socket.Writer, said: Said) => writer.write(JSON.stringify(said));

/**
 * Beats every `interval`, the first at a random point in the first, so that bots reconnecting
 * together don't beat together. A beat with no ack since the one before means the connection is dead.
 */
const heartbeats = (interval: number, acked: Ref.Ref<boolean>, beat: Effect.Effect<void, Socket.SocketError>) =>
  Effect.gen(function* () {
    yield* Effect.sleep(Duration.millis(interval * (yield* Random.next)));
    return yield* Effect.forever(
      Effect.gen(function* () {
        if (!(yield* Ref.getAndSet(acked, false)))
          return yield* new Lost({ reason: "no heartbeat ack", resume: true, opened: true });
        yield* beat;
        yield* Effect.sleep(Duration.millis(interval));
      }),
    );
  });

/**
 * The session on an open connection, until the connection ends: once Hello says the interval, Leaf
 * identifies, or resumes the session it has, and beats; it answers a beat asked for at once, counts
 * acks, keeps the sequence number, and keeps READY's session to resume. `began` is when the session
 * was ready or resumed.
 */
const hold = (
  token: Redacted.Redacted,
  kept: Ref.Ref<Resumable | null>,
  began: Ref.Ref<number | null>,
  pull: Socket.Reader["pull"],
  writer: Socket.Writer,
) =>
  Effect.gen(function* () {
    const hello = yield* Deferred.make<number>();
    const acked = yield* Ref.make(true);
    const beat = Effect.flatMap(Ref.get(kept), (session) => say(writer, { op: 1, d: session?.seq ?? null }));
    const started = Effect.flatMap(Clock.currentTimeMillis, (now) => Ref.set(began, now));

    const dispatched = (frame: typeof Dispatch.Type) =>
      Effect.gen(function* () {
        const ready = frame.t === "READY" ? readReady(frame.d) : Option.none();
        if (Option.isSome(ready)) {
          const { session_id: id, resume_gateway_url: resumeAt } = ready.value;
          yield* Ref.set(kept, { id, resumeAt, seq: frame.s });
          yield* started;
          // Never the whole id, which resumes the session.
          return yield* Effect.logInfo("discord_gateway_ready").pipe(Effect.annotateLogs({ session: id.slice(0, 6) }));
        }
        if (frame.t === "RESUMED") yield* started;
        yield* Ref.update(kept, (session) => (session === null ? null : { ...session, seq: frame.s }));
      });

    const take = (frame: typeof Frame.Type): Effect.Effect<unknown, Lost | Socket.SocketError> => {
      switch (frame.op) {
        case 10:
          return Deferred.succeed(hello, frame.d.heartbeat_interval);
        case 0:
          return dispatched(frame);
        case 1:
          return beat;
        case 11:
          return Ref.set(acked, true);
        case 7:
          return new Lost({ reason: "discord asked to reconnect", resume: true, opened: true });
        case 9:
          return new Lost({ reason: "invalid session", resume: frame.d, opened: true });
      }
    };

    const listen = Effect.forever(
      Effect.flatMap(pull, (texts) =>
        Effect.forEach(texts, (text) => Option.match(readFrame(text), { onNone: () => Effect.void, onSome: take }), {
          discard: true,
        }),
      ),
    );
    const keep = Effect.gen(function* () {
      const interval = yield* Deferred.await(hello);
      const session = yield* Ref.get(kept);
      yield* say(
        writer,
        session === null
          ? identify(token)
          : { op: 6, d: { token: Redacted.value(token), session_id: session.id, seq: session.seq } },
      );
      return yield* heartbeats(interval, acked, beat);
    });
    return yield* Effect.raceFirst(listen, keep);
  });

/**
 * One connection, from opening to its end: to where the session resumes, or the gateway. Leaf closes
 * a connection it ends itself with `RECONNECTING`, which keeps the session; only Leaf's own stop
 * closes it with 1000, when the scope closes.
 */
const opened = (token: Redacted.Redacted, kept: Ref.Ref<Resumable | null>, began: Ref.Ref<number | null>) =>
  Effect.gen(function* () {
    const at = (yield* Ref.get(kept))?.resumeAt ?? GATEWAY;
    const socket = yield* Socket.makeWebSocket(withQuery(at), { openTimeout: OPEN_WITHIN });
    const writer = yield* socket.writer;
    const { pull } = yield* socket.reader;
    return yield* hold(token, kept, began, pull, writer).pipe(
      Effect.tapError(() => Effect.ignore(writer.write(new Socket.CloseEvent(RECONNECTING)))),
    );
  }).pipe(
    Effect.scoped,
    Effect.catchTag("SocketError", (error) => Effect.fail(fromSocket(error))),
  );

/**
 * A connection and what its end means: the session is kept to resume, or dropped (a new one waits 1
 * to 5 s, as Discord asks after an invalid session), from the gateway when the resume address never
 * opened. A session that ran `STEADY_AFTER` ends in success, so the next connection goes at once and
 * the waits start over; any other loss fails, to wait `BACKOFF`.
 */
const connection = (token: Redacted.Redacted, kept: Ref.Ref<Resumable | null>) =>
  Effect.gen(function* () {
    const began = yield* Ref.make<number | null>(null);
    const ended = yield* Effect.flip(opened(token, kept, began));
    if (ended instanceof Refused) return yield* ended;
    yield* Effect.logInfo("discord_gateway_reconnect").pipe(
      Effect.annotateLogs({ reason: ended.reason, resume: ended.resume }),
    );
    // A session that can't be resumed is dropped; one whose resume address never opened resumes at the gateway.
    yield* Ref.update(kept, (session) => {
      if (!ended.resume || session === null) return null;
      return ended.opened ? session : { ...session, resumeAt: null };
    });
    if (!ended.resume) yield* Effect.sleep(Duration.millis(yield* Random.nextBetween(1000, 5000)));
    const at = yield* Ref.get(began);
    const now = yield* Clock.currentTimeMillis;
    if (at === null || now - at < Duration.toMillis(STEADY_AFTER)) return yield* ended;
  });

/**
 * The bot's presence, started with the server when the bot's token is set, and nothing without it.
 * It lasts as long as Leaf, unless Discord refuses the bot for good.
 */
export const BotPresence = Layer.effectDiscard(
  Effect.gen(function* () {
    const token = (yield* AppConfig).activity?.botToken;
    if (token === undefined) return;
    const kept = yield* Ref.make<Resumable | null>(null);
    yield* connection(token, kept).pipe(
      Effect.retry({ schedule: BACKOFF, while: (ended) => ended instanceof Lost }),
      Effect.forever,
      Effect.catchTag("Refused", ({ code, reason }) =>
        Effect.logError("discord_gateway_stopped").pipe(Effect.annotateLogs({ code, reason })),
      ),
      Effect.forkScoped,
    );
  }),
);
