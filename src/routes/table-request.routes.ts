import { Router } from "express";
import {
  createTableRequest,
  listTableRequests,
  resolveTableRequest,
} from "../controllers/table-request.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/table-requests", requireAuth, listTableRequests);
router.post("/table-requests", requireAuth, createTableRequest);
router.post("/table-requests/:id/resolve", requireAuth, resolveTableRequest);

export default router;
