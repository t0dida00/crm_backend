import { Router } from "express";
import { createPlatform, getMyPlatform, updateMyPlatform } from "../controllers/platform.controller";
import {
  getConnections,
  putDatabase,
  putPusher,
  testConnections,
} from "../controllers/connection.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/platforms/me", requireAuth, getMyPlatform);
router.post("/platforms", requireAuth, createPlatform);
router.patch("/platforms/me", requireAuth, updateMyPlatform);
router.get("/platforms/me/connections", requireAuth, getConnections);
router.put("/platforms/me/connections/database", requireAuth, putDatabase);
router.put("/platforms/me/connections/pusher", requireAuth, putPusher);
router.post("/platforms/me/connections/test", requireAuth, testConnections);

export default router;
