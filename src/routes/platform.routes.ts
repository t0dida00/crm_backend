import { Router } from "express";
import { createPlatform, getMyPlatform, updateMyPlatform } from "../controllers/platform.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/platforms/me", requireAuth, getMyPlatform);
router.post("/platforms", requireAuth, createPlatform);
router.patch("/platforms/me", requireAuth, updateMyPlatform);

export default router;
