-- Appended to the generated schema when the API sets up a business's own
-- database (npm run tenant:sql). Keep in step with the migrations that add
-- the same objects to the central database.

-- Keeps menu_items.sold_count current (see migration 20260926180000_dish_sold_count).
CREATE OR REPLACE FUNCTION menu_items_track_sold_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE "menu_items"
    SET "sold_count" = GREATEST("sold_count" - OLD."qty", 0)
    WHERE "id" = OLD."item_id";
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE "menu_items"
    SET "sold_count" = "sold_count" + NEW."qty"
    WHERE "id" = NEW."item_id";
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "order_lines_sold_count" ON "order_lines";
CREATE TRIGGER "order_lines_sold_count"
AFTER INSERT OR DELETE OR UPDATE OF "qty", "item_id" ON "order_lines"
FOR EACH ROW EXECUTE FUNCTION menu_items_track_sold_count();

-- One open dining session per table (see migration 20260910211023_table_sessions).
CREATE UNIQUE INDEX IF NOT EXISTS "one_open_session_per_table" ON "table_sessions" ("table_id") WHERE "closed_at" IS NULL;

-- Marks the database as belonging to one business, so it's never set up twice
-- or claimed by another business.
CREATE TABLE IF NOT EXISTS "tenant_meta" (
  "platform_id" UUID PRIMARY KEY,
  "schema_version" INTEGER NOT NULL,
  "provisioned_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
