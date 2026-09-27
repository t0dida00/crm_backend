import { Router } from "express";
import {
  addOrderLine,
  createOrder,
  deleteOrder,
  getOrder,
  getOrderSeries,
  getOrderStats,
  listOrderHistory,
  listOrders,
  setOrderLineQty,
  updateOrderStatus,
} from "../controllers/order.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { requireOwner } from "../middleware/require-owner";

const router = Router();

router.get("/orders", requireAuth, listOrders);
// Registered before /orders/:id so "history"/"stats" aren't captured as an id.
router.get("/orders/history", requireAuth, listOrderHistory);
router.get("/orders/stats", requireAuth, requireOwner, getOrderStats);
router.get("/orders/stats/series", requireAuth, requireOwner, getOrderSeries);
router.get("/orders/:id", requireAuth, getOrder);
router.post("/orders", requireAuth, createOrder);
router.patch("/orders/:id/status", requireAuth, updateOrderStatus);
router.post("/orders/:id/lines", requireAuth, addOrderLine);
router.patch("/orders/:id/lines/:lineId", requireAuth, setOrderLineQty);
router.delete("/orders/:id", requireAuth, deleteOrder);

export default router;
