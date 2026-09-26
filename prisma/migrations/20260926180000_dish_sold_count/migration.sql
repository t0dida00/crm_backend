-- How many units of each dish have been ordered. Kept in step with
-- order_lines by a trigger, so every write path (placing an order, adding a
-- line, changing a line's qty, deleting a line or a whole order via cascade)
-- updates it without application code having to remember to.
ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "sold_count" INTEGER NOT NULL DEFAULT 0;

-- Backfill from the orders that already exist.
UPDATE "menu_items" m
SET "sold_count" = s.total
FROM (
  SELECT "item_id", SUM("qty")::int AS total
  FROM "order_lines"
  GROUP BY "item_id"
) s
WHERE m."id" = s."item_id";

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
