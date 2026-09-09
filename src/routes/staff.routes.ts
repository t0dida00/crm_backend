import { Router } from "express";
import { createStaff, listStaff, updateStaff } from "../controllers/staff.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/staff", requireAuth, listStaff);
router.post("/staff", requireAuth, createStaff);
router.patch("/staff/:id", requireAuth, updateStaff);

export default router;
