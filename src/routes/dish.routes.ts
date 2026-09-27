import { Router } from "express";
import { createDish, deleteDish, listDishes, updateDish } from "../controllers/dish.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { requireOwner } from "../middleware/require-owner";

const router = Router();

router.get("/dishes", requireAuth, listDishes);
router.post("/dishes", requireAuth, requireOwner, createDish);
router.patch("/dishes/:id", requireAuth, updateDish);
router.delete("/dishes/:id", requireAuth, requireOwner, deleteDish);

export default router;
