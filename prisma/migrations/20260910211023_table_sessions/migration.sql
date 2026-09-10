-- CreateTable
CREATE TABLE "table_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "platform_id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "table_name" VARCHAR(100) NOT NULL,
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(6),

    CONSTRAINT "table_sessions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "table_sessions" ADD CONSTRAINT "fk_session_platform" FOREIGN KEY ("platform_id") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "table_sessions" ADD CONSTRAINT "fk_session_table" FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Only one open (closed_at IS NULL) session per table at a time.
CREATE UNIQUE INDEX "one_open_session_per_table" ON "table_sessions" ("table_id") WHERE "closed_at" IS NULL;

-- AlterTable: link orders to the session they belong to
ALTER TABLE "orders" ADD COLUMN "session_id" UUID;
ALTER TABLE "orders" ADD CONSTRAINT "fk_order_session" FOREIGN KEY ("session_id") REFERENCES "table_sessions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Backfill: give every existing order a session, grouping orders at the same
-- table that share a closed_ts (paid together) into one session, and each
-- still-open order into its own session.
INSERT INTO "table_sessions" ("id", "platform_id", "table_id", "table_name", "opened_at", "closed_at")
SELECT gen_random_uuid(), platform_id, table_id, table_name, MIN(ts), closed_ts
FROM "orders"
WHERE table_id IS NOT NULL AND closed_ts IS NOT NULL
GROUP BY platform_id, table_id, table_name, closed_ts;

-- Every table's currently-open orders collapse into one open session
-- (matching the new "at most one open session per table" invariant), opened
-- at the earliest of those orders' timestamps.
INSERT INTO "table_sessions" ("id", "platform_id", "table_id", "table_name", "opened_at", "closed_at")
SELECT gen_random_uuid(), platform_id, table_id, table_name, MIN(ts), NULL
FROM "orders"
WHERE table_id IS NOT NULL AND closed_ts IS NULL
GROUP BY platform_id, table_id, table_name;

UPDATE "orders" o
SET session_id = s.id
FROM "table_sessions" s
WHERE o.table_id = s.table_id
  AND o.table_id IS NOT NULL
  AND (
    (o.closed_ts IS NOT NULL AND o.closed_ts = s.closed_at)
    OR (o.closed_ts IS NULL AND s.closed_at IS NULL)
  );
