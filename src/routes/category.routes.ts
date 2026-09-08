import { Router } from "express";
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from "../controllers/category.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/categories", requireAuth, listCategories);
router.post("/categories", requireAuth, createCategory);
router.patch("/categories/:id", requireAuth, updateCategory);
router.delete("/categories/:id", requireAuth, deleteCategory);

export default router;
