import { Router } from "express";
import {
  checkoutTable,
  createTable,
  deleteTable,
  freeTable,
  listTableQrTokens,
  listTables,
  seatTable,
  updateTable,
} from "../controllers/table.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { requireOwner } from "../middleware/require-owner";

const router = Router();

router.get("/tables", requireAuth, listTables);
router.get("/tables/qr-tokens", requireAuth, requireOwner, listTableQrTokens);
router.post("/tables", requireAuth, requireOwner, createTable);
router.patch("/tables/:id", requireAuth, requireOwner, updateTable);
router.delete("/tables/:id", requireAuth, requireOwner, deleteTable);
router.post("/tables/:id/seat", requireAuth, seatTable);
router.post("/tables/:id/checkout", requireAuth, checkoutTable);
router.post("/tables/:id/free", requireAuth, freeTable);

export default router;
