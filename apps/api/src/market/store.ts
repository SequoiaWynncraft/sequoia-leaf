import {
  LISTING_KINDS,
  type ListingInput,
  type ListingKind,
  ORDER_STATES,
  ORDER_STEPS,
  type OrderRole,
  type OrderState,
  type OrderStep,
  type PlayerId,
} from "@sequoia-leaf/core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { PlayerUuid } from "../wire.ts";

/** A listing as stored, with how many of its units the standing orders took and how many orders are open. */
const ListingRow = Schema.Struct({
  id: Schema.Int,
  sellerId: PlayerUuid,
  sellerName: Schema.String,
  requestId: Schema.String,
  kind: Schema.Literals(LISTING_KINDS),
  title: Schema.String,
  description: Schema.String,
  price: Schema.Int,
  quantity: Schema.Int,
  createdAt: Schema.Int,
  updatedAt: Schema.Int,
  expiresAt: Schema.Int,
  withdrawnAt: Schema.NullOr(Schema.Int),
  taken: Schema.Int,
  openOrders: Schema.Int,
});
export type Listing = typeof ListingRow.Type;

// Orders that stand take their units; a cancelled or refunded one gives them back.
const TAKEN = `(SELECT COALESCE(SUM(taken.quantity), 0) FROM market_orders AS taken
  WHERE taken.listing_id = listing.id AND taken.state NOT IN ('cancelled', 'refunded'))`;
const OPEN_ORDERS = `(SELECT COUNT(*) FROM market_orders AS open
  WHERE open.listing_id = listing.id AND open.state IN ('placed', 'delivered', 'disputed'))`;

const LISTING_COLUMNS = `listing.id, listing.seller_id AS sellerId, listing.seller_name AS sellerName,
  listing.request_id AS requestId, listing.kind, listing.title, listing.description, listing.price,
  listing.quantity, listing.created_at AS createdAt, listing.updated_at AS updatedAt,
  listing.expires_at AS expiresAt, listing.withdrawn_at AS withdrawnAt,
  ${TAKEN} AS taken, ${OPEN_ORDERS} AS openOrders`;

/** An order as stored, with its listing's title and kind and what its steps say. */
const OrderRow = Schema.Struct({
  id: Schema.Int,
  listingId: Schema.Int,
  title: Schema.String,
  kind: Schema.Literals(LISTING_KINDS),
  sellerId: PlayerUuid,
  sellerName: Schema.String,
  buyerId: PlayerUuid,
  buyerName: Schema.String,
  requestId: Schema.String,
  quantity: Schema.Int,
  price: Schema.Int,
  leaf: Schema.Int,
  fee: Schema.Int,
  state: Schema.Literals(ORDER_STATES),
  placedAt: Schema.Int,
  deliveredAt: Schema.NullOr(Schema.Int),
  disputedAt: Schema.NullOr(Schema.Int),
  closedAt: Schema.NullOr(Schema.Int),
  /** Every step it took. */
  steps: Schema.fromJsonString(Schema.Array(Schema.Literals(ORDER_STEPS))),
  cancelledBy: Schema.NullOr(Schema.Literals(["buyer", "seller"])),
  disputeReason: Schema.NullOr(Schema.String),
  resolution: Schema.NullOr(Schema.Literals(["released", "refunded"])),
  resolutionNote: Schema.NullOr(Schema.String),
});

export interface Order extends Omit<typeof OrderRow.Type, "steps"> {
  readonly steps: ReadonlySet<OrderStep>;
}

const ORDER_COLUMNS = `ord.id, ord.listing_id AS listingId, listing.title, listing.kind,
  ord.seller_id AS sellerId, listing.seller_name AS sellerName, ord.buyer_id AS buyerId,
  ord.buyer_name AS buyerName, ord.request_id AS requestId, ord.quantity, ord.price, ord.leaf, ord.fee,
  ord.state, ord.placed_at AS placedAt, ord.delivered_at AS deliveredAt, ord.disputed_at AS disputedAt,
  ord.closed_at AS closedAt,
  (SELECT json_group_array(step) FROM market_order_steps WHERE order_id = ord.id) AS steps,
  (SELECT role FROM market_order_steps WHERE order_id = ord.id AND step = 'cancelled') AS cancelledBy,
  (SELECT note FROM market_order_steps WHERE order_id = ord.id AND step = 'disputed') AS disputeReason,
  (SELECT step FROM market_order_steps WHERE order_id = ord.id AND step IN ('released', 'refunded')) AS resolution,
  (SELECT note FROM market_order_steps WHERE order_id = ord.id AND step IN ('released', 'refunded')) AS resolutionNote`;

const ORDER_FROM = `market_orders AS ord JOIN market_listings AS listing ON listing.id = ord.listing_id`;

function toOrder(row: typeof OrderRow.Type): Order {
  return { ...row, steps: new Set(row.steps) };
}

const NewId = Schema.Struct({ id: Schema.Int });

/** What the open listings can be narrowed to: a kind, words in the title or description, and a page. */
export interface ListingQuery {
  readonly kind: ListingKind | undefined;
  readonly text: string | undefined;
  /** Only listings older than this one, the last of the page before. */
  readonly before: number | undefined;
  readonly limit: number;
}

/** A row that may not be there, as undefined when it isn't. */
const optional = <A>(found: Effect.Effect<Option.Option<A>, unknown>) =>
  found.pipe(Effect.map(Option.getOrUndefined), Effect.orDie);

/** Escapes `%`, `_` and the escape character itself, so a member's words match as written. */
function likePattern(text: string): string {
  return `%${text.replaceAll(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/**
 * The member marketplace's listings and orders. Each change is recorded in
 * the audit tables in the same call that makes it; Leaf moves only through
 * the ledger, never here. Writes belong in the caller's transaction. A
 * database failure is a defect.
 */
export class Market extends Context.Service<
  Market,
  {
    readonly listing: (id: number) => Effect.Effect<Listing | undefined>;
    /** The listing a seller's request made, if it made one. */
    readonly listingFor: (sellerId: PlayerId, requestId: string) => Effect.Effect<Listing | undefined>;
    /** Makes a listing and answers its id. */
    readonly createListing: (
      seller: { readonly playerId: PlayerId; readonly username: string },
      requestId: string,
      listing: ListingInput,
      expiresAt: number,
      now: number,
    ) => Effect.Effect<number>;
    /** Changes a listing's terms, under the name the seller signed in with now. */
    readonly editListing: (
      id: number,
      terms: { readonly price: number; readonly description: string },
      seller: { readonly playerId: PlayerId; readonly username: string },
      now: number,
    ) => Effect.Effect<void>;
    readonly withdrawListing: (id: number, actor: PlayerId, now: number) => Effect.Effect<void>;
    /** How many of a seller's listings are neither withdrawn nor expired. */
    readonly openListingsOf: (sellerId: PlayerId, now: number) => Effect.Effect<number>;
    /** Listings taking orders, newest first. */
    readonly browse: (query: ListingQuery, now: number) => Effect.Effect<readonly Listing[]>;
    /** A seller's own listings, however they stand, newest first. */
    readonly listingsOf: (
      sellerId: PlayerId,
      before: number | undefined,
      limit: number,
    ) => Effect.Effect<readonly Listing[]>;
    readonly order: (id: number) => Effect.Effect<Order | undefined>;
    /** The order a buyer's request placed, if it placed one. */
    readonly orderFor: (buyerId: PlayerId, requestId: string) => Effect.Effect<Order | undefined>;
    /** Places an order and records its first step. Answers its id. */
    readonly placeOrder: (
      order: {
        readonly listing: Listing;
        readonly buyer: { readonly playerId: PlayerId; readonly username: string };
        readonly requestId: string;
        readonly quantity: number;
        readonly leaf: number;
        readonly fee: number;
      },
      now: number,
    ) => Effect.Effect<number>;
    /** Moves an order to a state, recording the step that moved it and who took it. */
    readonly moveOrder: (
      id: number,
      to: OrderState,
      step: OrderStep,
      by: { readonly role: OrderRole; readonly actor: PlayerId | null; readonly note: string | null },
      now: number,
    ) => Effect.Effect<void>;
    /** Orders a member bought or sold, newest first. */
    readonly ordersOf: (
      playerId: PlayerId,
      before: number | undefined,
      limit: number,
    ) => Effect.Effect<readonly Order[]>;
    /** Orders waiting on staff, the longest-waiting first. */
    readonly disputes: Effect.Effect<readonly Order[]>;
    /** Orders delivered at or before a moment and not disputed, oldest first. */
    readonly deliveredBy: (at: number, limit: number) => Effect.Effect<readonly number[]>;
    /** How many listings were made in each window of `windowMs` from `from` up to `to`, for windows with any. */
    readonly listedPerWindow: (
      from: number,
      to: number,
      windowMs: number,
    ) => Effect.Effect<readonly { readonly start: number; readonly count: number }[]>;
  }
>()("leaf/Market") {
  static readonly layer = Layer.effect(
    Market,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const listingById = SqlSchema.findOneOption({
        Request: Schema.Int,
        Result: ListingRow,
        execute: (id) => sql`SELECT ${sql.literal(LISTING_COLUMNS)} FROM market_listings AS listing WHERE id = ${id}`,
      });
      const listingByRequest = SqlSchema.findOneOption({
        Request: Schema.Struct({ sellerId: Schema.String, requestId: Schema.String }),
        Result: ListingRow,
        execute: ({ sellerId, requestId }) => sql`
          SELECT ${sql.literal(LISTING_COLUMNS)} FROM market_listings AS listing
          WHERE seller_id = ${sellerId} AND request_id = ${requestId}
        `,
      });
      const openCount = SqlSchema.findOne({
        Request: Schema.Struct({ sellerId: Schema.String, now: Schema.Int }),
        Result: Schema.Struct({ count: Schema.Int }),
        execute: ({ sellerId, now }) => sql`
          SELECT COUNT(*) AS count FROM market_listings
          WHERE seller_id = ${sellerId} AND withdrawn_at IS NULL AND expires_at > ${now}
        `,
      });
      const browse = SqlSchema.findAll({
        Request: Schema.Struct({
          kind: Schema.NullOr(Schema.String),
          pattern: Schema.NullOr(Schema.String),
          before: Schema.NullOr(Schema.Int),
          limit: Schema.Int,
          now: Schema.Int,
        }),
        Result: ListingRow,
        execute: ({ kind, pattern, before, limit, now }) => sql`
          SELECT ${sql.literal(LISTING_COLUMNS)} FROM market_listings AS listing
          WHERE ${sql.and([
            sql`listing.withdrawn_at IS NULL`,
            sql`listing.expires_at > ${now}`,
            sql`listing.quantity > ${sql.literal(TAKEN)}`,
            ...(kind === null ? [] : [sql`listing.kind = ${kind}`]),
            ...(pattern === null
              ? []
              : [sql`(listing.title LIKE ${pattern} ESCAPE '\\' OR listing.description LIKE ${pattern} ESCAPE '\\')`]),
            ...(before === null ? [] : [sql`listing.id < ${before}`]),
          ])}
          ORDER BY listing.id DESC LIMIT ${limit}
        `,
      });
      const sellerListings = SqlSchema.findAll({
        Request: Schema.Struct({ sellerId: Schema.String, before: Schema.NullOr(Schema.Int), limit: Schema.Int }),
        Result: ListingRow,
        execute: ({ sellerId, before, limit }) => sql`
          SELECT ${sql.literal(LISTING_COLUMNS)} FROM market_listings AS listing
          WHERE ${sql.and([sql`listing.seller_id = ${sellerId}`, ...(before === null ? [] : [sql`listing.id < ${before}`])])}
          ORDER BY listing.id DESC LIMIT ${limit}
        `,
      });
      const orderById = SqlSchema.findOneOption({
        Request: Schema.Int,
        Result: OrderRow,
        execute: (id) => sql`SELECT ${sql.literal(ORDER_COLUMNS)} FROM ${sql.literal(ORDER_FROM)} WHERE ord.id = ${id}`,
      });
      const orderByRequest = SqlSchema.findOneOption({
        Request: Schema.Struct({ buyerId: Schema.String, requestId: Schema.String }),
        Result: OrderRow,
        execute: ({ buyerId, requestId }) => sql`
          SELECT ${sql.literal(ORDER_COLUMNS)} FROM ${sql.literal(ORDER_FROM)}
          WHERE ord.buyer_id = ${buyerId} AND ord.request_id = ${requestId}
        `,
      });
      // A member's orders as either side, by the two indexes, newest first.
      const memberOrders = SqlSchema.findAll({
        Request: Schema.Struct({ playerId: Schema.String, before: Schema.NullOr(Schema.Int), limit: Schema.Int }),
        Result: OrderRow,
        execute: ({ playerId, before, limit }) => sql`
          SELECT ${sql.literal(ORDER_COLUMNS)} FROM ${sql.literal(ORDER_FROM)}
          WHERE ${sql.and([
            sql`ord.id IN (
              SELECT id FROM market_orders WHERE buyer_id = ${playerId}
              UNION ALL
              SELECT id FROM market_orders WHERE seller_id = ${playerId}
            )`,
            ...(before === null ? [] : [sql`ord.id < ${before}`]),
          ])}
          ORDER BY ord.id DESC LIMIT ${limit}
        `,
      });
      const disputed = SqlSchema.findAll({
        Request: Schema.Void,
        Result: OrderRow,
        execute: () => sql`
          SELECT ${sql.literal(ORDER_COLUMNS)} FROM ${sql.literal(ORDER_FROM)}
          WHERE ord.state = 'disputed' ORDER BY ord.disputed_at, ord.id
        `,
      });
      const delivered = SqlSchema.findAll({
        Request: Schema.Struct({ at: Schema.Int, limit: Schema.Int }),
        Result: Schema.Struct({ id: Schema.Int }),
        execute: ({ at, limit }) => sql`
          SELECT id FROM market_orders WHERE state = 'delivered' AND delivered_at <= ${at}
          ORDER BY delivered_at, id LIMIT ${limit}
        `,
      });
      const perWindow = SqlSchema.findAll({
        Request: Schema.Struct({ from: Schema.Int, to: Schema.Int, windowMs: Schema.Int }),
        Result: Schema.Struct({ start: Schema.Int, count: Schema.Int }),
        execute: ({ from, to, windowMs }) => sql`
          SELECT (created_at / ${windowMs}) * ${windowMs} AS start, COUNT(*) AS count
          FROM market_listings WHERE created_at >= ${from} AND created_at < ${to}
          GROUP BY 1 ORDER BY 1
        `,
      });

      const recordChange = (
        listingId: number,
        change: "created" | "edited" | "withdrawn",
        actor: PlayerId,
        terms: { readonly price: number | null; readonly description: string | null },
        now: number,
      ) =>
        sql`INSERT INTO market_listing_changes ${sql.insert({ listingId, change, actor, ...terms, createdAt: now })}`;

      const recordStep = (
        orderId: number,
        step: OrderStep,
        by: { readonly role: OrderRole; readonly actor: PlayerId | null; readonly note: string | null },
        now: number,
      ) => sql`INSERT INTO market_order_steps ${sql.insert({ orderId, step, ...by, createdAt: now })}`;

      const decodeId = Schema.decodeUnknownEffect(NewId);

      return Market.of({
        listing: (id) => optional(listingById(id)),
        listingFor: (sellerId, requestId) => optional(listingByRequest({ sellerId, requestId })),
        createListing: (seller, requestId, listing, expiresAt, now) =>
          Effect.gen(function* () {
            const { id } = yield* sql`
              INSERT INTO market_listings ${sql.insert({
                sellerId: seller.playerId,
                sellerName: seller.username,
                requestId,
                ...listing,
                createdAt: now,
                updatedAt: now,
                expiresAt,
                withdrawnAt: null,
              })} RETURNING id
            `.pipe(Effect.flatMap(([row]) => decodeId(row)));
            yield* recordChange(
              id,
              "created",
              seller.playerId,
              { price: listing.price, description: listing.description },
              now,
            );
            return id;
          }).pipe(Effect.orDie),
        editListing: (id, terms, seller, now) =>
          Effect.gen(function* () {
            yield* sql`
              UPDATE market_listings
              SET price = ${terms.price}, description = ${terms.description}, seller_name = ${seller.username},
                  updated_at = ${now}
              WHERE id = ${id}
            `;
            yield* recordChange(id, "edited", seller.playerId, terms, now);
          }).pipe(Effect.orDie),
        withdrawListing: (id, actor, now) =>
          Effect.gen(function* () {
            yield* sql`UPDATE market_listings SET withdrawn_at = ${now}, updated_at = ${now} WHERE id = ${id}`;
            yield* recordChange(id, "withdrawn", actor, { price: null, description: null }, now);
          }).pipe(Effect.orDie),
        openListingsOf: (sellerId, now) =>
          openCount({ sellerId, now }).pipe(
            Effect.map((row) => row.count),
            Effect.orDie,
          ),
        browse: ({ kind, text, before, limit }, now) =>
          browse({
            kind: kind ?? null,
            pattern: text === undefined ? null : likePattern(text),
            before: before ?? null,
            limit,
            now,
          }).pipe(Effect.orDie),
        listingsOf: (sellerId, before, limit) =>
          sellerListings({ sellerId, before: before ?? null, limit }).pipe(Effect.orDie),
        order: (id) =>
          optional(orderById(id)).pipe(Effect.map((row) => (row === undefined ? undefined : toOrder(row)))),
        orderFor: (buyerId, requestId) =>
          optional(orderByRequest({ buyerId, requestId })).pipe(
            Effect.map((row) => (row === undefined ? undefined : toOrder(row))),
          ),
        placeOrder: ({ listing, buyer, requestId, quantity, leaf, fee }, now) =>
          Effect.gen(function* () {
            const { id } = yield* sql`
              INSERT INTO market_orders ${sql.insert({
                listingId: listing.id,
                sellerId: listing.sellerId,
                buyerId: buyer.playerId,
                buyerName: buyer.username,
                requestId,
                quantity,
                price: listing.price,
                leaf,
                fee,
                state: "placed",
                placedAt: now,
              })} RETURNING id
            `.pipe(Effect.flatMap(([row]) => decodeId(row)));
            yield* recordStep(id, "placed", { role: "buyer", actor: buyer.playerId, note: null }, now);
            return id;
          }).pipe(Effect.orDie),
        moveOrder: (id, to, step, by, now) =>
          Effect.gen(function* () {
            const times =
              to === "delivered"
                ? sql`delivered_at = ${now}`
                : to === "disputed"
                  ? sql`disputed_at = ${now}`
                  : sql`closed_at = ${now}`;
            yield* sql`UPDATE market_orders SET state = ${to}, ${times} WHERE id = ${id}`;
            yield* recordStep(id, step, by, now);
          }).pipe(Effect.orDie),
        ordersOf: (playerId, before, limit) =>
          memberOrders({ playerId, before: before ?? null, limit }).pipe(
            Effect.map((rows) => rows.map(toOrder)),
            Effect.orDie,
          ),
        disputes: disputed(undefined).pipe(
          Effect.map((rows) => rows.map(toOrder)),
          Effect.orDie,
        ),
        deliveredBy: (at, limit) =>
          delivered({ at, limit }).pipe(
            Effect.map((rows) => rows.map((row) => row.id)),
            Effect.orDie,
          ),
        listedPerWindow: (from, to, windowMs) => perWindow({ from, to, windowMs }).pipe(Effect.orDie),
      });
    }),
  );
}
