-- CreateEnum
CREATE TYPE "DishStatus" AS ENUM ('valid', 'sold_out', 'hidden');

-- AlterTable: add the new status column, backfilled from is_available
ALTER TABLE "menu_items" ADD COLUMN "status" "DishStatus" NOT NULL DEFAULT 'valid';

UPDATE "menu_items" SET "status" = CASE WHEN "is_available" THEN 'valid' ELSE 'hidden' END::"DishStatus";

-- Drop the old boolean now that status has replaced it
ALTER TABLE "menu_items" DROP COLUMN "is_available";
