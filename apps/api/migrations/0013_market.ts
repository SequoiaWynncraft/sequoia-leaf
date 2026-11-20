import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// The member marketplace: listings of in-game items and services, the orders on
// them, and what happened to each. Leaf itself moves only through the ledger: an
// order's Leaf is held by a spend (`market_hold:<order>`), paid to the seller by an
// earn (`market_sale:<order>`) or returned by the hold's reversal
// (`undo:market_hold:<order>`). The audit tables are never changed or deleted.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE market_listings (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_id    TEXT    NOT NULL,
      -- The Minecraft name the seller last signed in with, as buyers see it.
      seller_name  TEXT    NOT NULL,
      -- The seller's id for the request that made it, so a retried request makes one listing.
      request_id   TEXT    NOT NULL,
      kind         TEXT    NOT NULL CHECK (kind IN ('item', 'service')),
      title        TEXT    NOT NULL,
      description  TEXT    NOT NULL,
      -- Leaf for one unit.
      price        INTEGER NOT NULL CHECK (price > 0),
      quantity     INTEGER NOT NULL CHECK (quantity > 0),
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      -- It takes no orders from this moment.
      expires_at   INTEGER NOT NULL,
      withdrawn_at INTEGER,
      UNIQUE (seller_id, request_id)
    ) STRICT
  `;
  yield* sql`CREATE INDEX market_listings_by_seller ON market_listings (seller_id, id)`;
  yield* sql`CREATE INDEX market_listings_by_time ON market_listings (created_at)`;

  // Every change to a listing: made, its terms changed, withdrawn. `price` and
  // `description` are what they became.
  yield* sql`
    CREATE TABLE market_listing_changes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id  INTEGER NOT NULL REFERENCES market_listings (id),
      change      TEXT    NOT NULL CHECK (change IN ('created', 'edited', 'withdrawn')),
      actor       TEXT    NOT NULL,
      price       INTEGER,
      description TEXT,
      created_at  INTEGER NOT NULL
    ) STRICT
  `;
  yield* sql`CREATE INDEX market_listing_changes_by_listing ON market_listing_changes (listing_id, id)`;
  yield* sql`
    CREATE TRIGGER market_listing_changes_append_only_update
    BEFORE UPDATE ON market_listing_changes
    BEGIN
      SELECT RAISE(ABORT, 'market_audit_append_only');
    END
  `;
  yield* sql`
    CREATE TRIGGER market_listing_changes_append_only_delete
    BEFORE DELETE ON market_listing_changes
    BEGIN
      SELECT RAISE(ABORT, 'market_audit_append_only');
    END
  `;

  yield* sql`
    CREATE TABLE market_orders (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id   INTEGER NOT NULL REFERENCES market_listings (id),
      -- The listing's seller, kept here so each side finds their orders by one index.
      seller_id    TEXT    NOT NULL,
      buyer_id     TEXT    NOT NULL,
      -- The Minecraft name the buyer signed in with, as the seller sees it.
      buyer_name   TEXT    NOT NULL,
      -- The buyer's id for the request that placed it, so a retried request places one order.
      request_id   TEXT    NOT NULL,
      quantity     INTEGER NOT NULL CHECK (quantity > 0),
      -- The unit price the buyer agreed to, the Leaf held, and the part of it the seller is not paid.
      price        INTEGER NOT NULL CHECK (price > 0),
      leaf         INTEGER NOT NULL CHECK (leaf > 0),
      fee          INTEGER NOT NULL CHECK (fee >= 0 AND fee < leaf),
      state        TEXT    NOT NULL CHECK (state IN ('placed', 'delivered', 'disputed', 'completed', 'cancelled', 'refunded')),
      placed_at    INTEGER NOT NULL,
      delivered_at INTEGER,
      disputed_at  INTEGER,
      -- When it was completed, cancelled or refunded.
      closed_at    INTEGER,
      UNIQUE (buyer_id, request_id),
      CHECK (buyer_id <> seller_id)
    ) STRICT
  `;
  yield* sql`CREATE INDEX market_orders_by_listing ON market_orders (listing_id, state)`;
  yield* sql`CREATE INDEX market_orders_by_buyer ON market_orders (buyer_id, id)`;
  yield* sql`CREATE INDEX market_orders_by_seller ON market_orders (seller_id, id)`;
  // Delivered orders by when they were delivered, for confirming them on their own; and the disputes.
  yield* sql`CREATE INDEX market_orders_by_state ON market_orders (state, delivered_at)`;
  // An order only moves forward, and a closed one never changes: whatever the code does, the
  // seller can't be paid after a refund, nor the buyer refunded after the seller was paid.
  yield* sql`
    CREATE TRIGGER market_orders_forward_only
    BEFORE UPDATE ON market_orders
    WHEN NEW.state IS NOT OLD.state AND NOT (
      (OLD.state = 'placed' AND NEW.state IN ('delivered', 'completed', 'cancelled'))
      OR (OLD.state = 'delivered' AND NEW.state IN ('disputed', 'completed'))
      OR (OLD.state = 'disputed' AND NEW.state IN ('completed', 'refunded'))
    )
    BEGIN
      SELECT RAISE(ABORT, 'market_order_state');
    END
  `;
  yield* sql`
    CREATE TRIGGER market_orders_terms_fixed
    BEFORE UPDATE ON market_orders
    WHEN OLD.state IN ('completed', 'cancelled', 'refunded')
      OR NEW.listing_id IS NOT OLD.listing_id OR NEW.seller_id IS NOT OLD.seller_id
      OR NEW.buyer_id IS NOT OLD.buyer_id OR NEW.quantity IS NOT OLD.quantity
      OR NEW.price IS NOT OLD.price OR NEW.leaf IS NOT OLD.leaf OR NEW.fee IS NOT OLD.fee
    BEGIN
      SELECT RAISE(ABORT, 'market_order_fixed');
    END
  `;

  // Every step an order took, each at most once, with who took it: a player's
  // id, or NULL for Leaf itself. `note` is a dispute's reason or a staff note.
  yield* sql`
    CREATE TABLE market_order_steps (
      order_id   INTEGER NOT NULL REFERENCES market_orders (id),
      step       TEXT    NOT NULL CHECK (step IN (
                   'placed', 'delivered', 'confirmed', 'auto_confirmed', 'cancelled', 'disputed', 'released', 'refunded'
                 )),
      role       TEXT    NOT NULL CHECK (role IN ('buyer', 'seller', 'staff', 'system')),
      actor      TEXT,
      note       TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (order_id, step),
      CHECK ((role = 'system') = (actor IS NULL))
    ) STRICT, WITHOUT ROWID
  `;
  yield* sql`
    CREATE TRIGGER market_order_steps_append_only_update
    BEFORE UPDATE ON market_order_steps
    BEGIN
      SELECT RAISE(ABORT, 'market_audit_append_only');
    END
  `;
  yield* sql`
    CREATE TRIGGER market_order_steps_append_only_delete
    BEFORE DELETE ON market_order_steps
    BEGIN
      SELECT RAISE(ABORT, 'market_audit_append_only');
    END
  `;
});
