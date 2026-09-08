import { Router } from "express";
import { createDish, deleteDish, listDishes, updateDish } from "../controllers/dish.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/dishes", requireAuth, listDishes);
router.post("/dishes", requireAuth, createDish);
router.patch("/dishes/:id", requireAuth, updateDish);
router.delete("/dishes/:id", requireAuth, deleteDish);

export default router;
