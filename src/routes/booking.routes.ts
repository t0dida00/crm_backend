import { Router } from "express";
import {
  assignBooking,
  createBooking,
  deleteBooking,
  listBookings,
  unassignBooking,
  updateBooking,
} from "../controllers/booking.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.get("/bookings", requireAuth, listBookings);
router.post("/bookings", requireAuth, createBooking);
router.patch("/bookings/:id", requireAuth, updateBooking);
router.delete("/bookings/:id", requireAuth, deleteBooking);
router.post("/bookings/:id/assign", requireAuth, assignBooking);
router.post("/bookings/:id/unassign", requireAuth, unassignBooking);

export default router;
