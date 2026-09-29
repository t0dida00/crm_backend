import { Router } from "express";
import {
  createCategory,
  deleteCategory,
  listCategories,
  reorderCategories,
  updateCategory,
} from "../controllers/category.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { requireOwner } from "../middleware/require-owner";

const router = Router();

router.get("/categories", requireAuth, listCategories);
router.post("/categories", requireAuth, requireOwner, createCategory);
router.put("/categories/order", requireAuth, requireOwner, reorderCategories);
router.patch("/categories/:id", requireAuth, requireOwner, updateCategory);
router.delete("/categories/:id", requireAuth, requireOwner, deleteCategory);

export default router;
