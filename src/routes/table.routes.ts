import { Router } from "express";
import {
  checkoutTable,
  createTable,
  deleteTable,
  freeTable,
  listTables,
  seatTable,
  updateTable,
} from "../controllers/table.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/tables", requireAuth, listTables);
router.post("/tables", requireAuth, createTable);
router.patch("/tables/:id", requireAuth, updateTable);
router.delete("/tables/:id", requireAuth, deleteTable);
router.post("/tables/:id/seat", requireAuth, seatTable);
router.post("/tables/:id/checkout", requireAuth, checkoutTable);
router.post("/tables/:id/free", requireAuth, freeTable);

export default router;
