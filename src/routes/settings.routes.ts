import { Router } from "express";
import {
  createSpecialTax,
  deleteSpecialTax,
  getSettings,
  updateSettings,
  updateSpecialTax,
} from "../controllers/settings.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { requireOwner } from "../middleware/require-owner";

const router = Router();

router.get("/settings", requireAuth, getSettings);
router.patch("/settings", requireAuth, requireOwner, updateSettings);
router.post("/settings/special-taxes", requireAuth, requireOwner, createSpecialTax);
router.patch("/settings/special-taxes/:id", requireAuth, requireOwner, updateSpecialTax);
router.delete("/settings/special-taxes/:id", requireAuth, requireOwner, deleteSpecialTax);

export default router;
