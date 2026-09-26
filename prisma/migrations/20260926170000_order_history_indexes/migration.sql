-- Paginated order history and dashboard stats filter orders by platform and
-- time, and every order load joins its lines — none of which had an index.
CREATE INDEX IF NOT EXISTS "idx_orders_platform_ts" ON "orders"("platform_id", "ts");
CREATE INDEX IF NOT EXISTS "idx_orders_platform_closed_ts" ON "orders"("platform_id", "closed_ts");
CREATE INDEX IF NOT EXISTS "idx_orders_session" ON "orders"("session_id");
CREATE INDEX IF NOT EXISTS "idx_order_lines_order" ON "order_lines"("order_id");
