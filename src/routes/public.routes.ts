import { Router } from "express";
import {
  createTableRequest,
  getPublicMenu,
  getPublicSettings,
  getPublicTables,
} from "../controllers/public.controller";

const router = Router();

router.get("/platforms/:platformId/menu", getPublicMenu);
router.get("/platforms/:platformId/tables", getPublicTables);
router.get("/platforms/:platformId/settings", getPublicSettings);
router.post("/platforms/:platformId/requests", createTableRequest);

export default router;
