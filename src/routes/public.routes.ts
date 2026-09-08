import { Router } from "express";
import {
  createPublicOrder,
  createTableRequest,
  getPublicMenu,
  getPublicSettings,
  getPublicTableOrders,
  getPublicTables,
  resolveTableQrToken,
} from "../controllers/public.controller";

const router = Router();

router.get("/platforms/:platformId/menu", getPublicMenu);
router.get("/platforms/:platformId/tables", getPublicTables);
router.get("/platforms/:platformId/settings", getPublicSettings);
router.get("/platforms/:platformId/orders", getPublicTableOrders);
router.post("/platforms/:platformId/orders", createPublicOrder);
router.post("/platforms/:platformId/requests", createTableRequest);
router.get("/tokens/:token", resolveTableQrToken);

export default router;
