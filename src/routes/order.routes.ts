import { Router } from "express";
import {
  addOrderLine,
  createOrder,
  deleteOrder,
  getOrder,
  listOrders,
  setOrderLineQty,
  updateOrderStatus,
} from "../controllers/order.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/orders", requireAuth, listOrders);
router.get("/orders/:id", requireAuth, getOrder);
router.post("/orders", requireAuth, createOrder);
router.patch("/orders/:id/status", requireAuth, updateOrderStatus);
router.post("/orders/:id/lines", requireAuth, addOrderLine);
router.patch("/orders/:id/lines/:lineId", requireAuth, setOrderLineQty);
router.delete("/orders/:id", requireAuth, deleteOrder);

export default router;
