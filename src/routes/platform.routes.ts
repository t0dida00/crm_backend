import { Router } from "express";
import { createPlatform, getMyPlatform, updateMyPlatform } from "../controllers/platform.controller";
import {
  getConnections,
  putConnections,
  testConnections,
} from "../controllers/connection.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/platforms/me", requireAuth, getMyPlatform);
router.post("/platforms", requireAuth, createPlatform);
router.patch("/platforms/me", requireAuth, updateMyPlatform);
router.get("/platforms/me/connections", requireAuth, getConnections);
router.put("/platforms/me/connections", requireAuth, putConnections);
router.post("/platforms/me/connections/test", requireAuth, testConnections);

export default router;
