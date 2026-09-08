import { Router } from "express";
import {
  createSpecialTax,
  deleteSpecialTax,
  getSettings,
  updateSettings,
  updateSpecialTax,
} from "../controllers/settings.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/settings", requireAuth, getSettings);
router.patch("/settings", requireAuth, updateSettings);
router.post("/settings/special-taxes", requireAuth, createSpecialTax);
router.patch("/settings/special-taxes/:id", requireAuth, updateSpecialTax);
router.delete("/settings/special-taxes/:id", requireAuth, deleteSpecialTax);

export default router;
