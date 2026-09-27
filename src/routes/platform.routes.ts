import express, { Router } from "express";
import { createPlatform, getMyPlatform, updateMyPlatform } from "../controllers/platform.controller";
import {
  checkConnections,
  getConnections,
  putConnections,
  testConnections,
} from "../controllers/connection.controller";
import { uploadImage } from "../controllers/upload.controller";
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "../lib/storage";
import { requireAuth } from "../middleware/auth.middleware";
import { requireOwner } from "../middleware/require-owner";

const router = Router();

router.get("/platforms/me", requireAuth, getMyPlatform);
router.post("/platforms", requireAuth, createPlatform);
router.patch("/platforms/me", requireAuth, requireOwner, updateMyPlatform);
router.get("/platforms/me/connections", requireAuth, getConnections);
router.put("/platforms/me/connections", requireAuth, putConnections);
router.post("/platforms/me/connections/test", requireAuth, testConnections);
router.post("/platforms/me/connections/check", requireAuth, checkConnections);
router.post(
  "/platforms/me/uploads",
  requireAuth,
  express.raw({ type: IMAGE_TYPES, limit: MAX_IMAGE_BYTES }),
  uploadImage,
);

export default router;
