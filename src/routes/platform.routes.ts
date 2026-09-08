import { Router } from "express";
import { createPlatform, getMyPlatform } from "../controllers/platform.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/platforms/me", requireAuth, getMyPlatform);
router.post("/platforms", requireAuth, createPlatform);

export default router;
