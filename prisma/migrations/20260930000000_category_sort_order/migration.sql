-- Categories keep an order the owner sets by dragging (0 = first).
ALTER TABLE "menu_categories" ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0;

-- Start from the alphabetical order every menu showed until now.
UPDATE "menu_categories" c
SET "sort_order" = r.pos
FROM (
  SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "platform_id" ORDER BY "name") - 1)::int AS pos
  FROM "menu_categories"
) r
WHERE c."id" = r."id";
