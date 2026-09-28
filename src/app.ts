import express, { Application, NextFunction, Request, Response } from "express";
// Sends errors thrown by async route handlers to the error handler below;
// without it Express 4 leaves the request hanging.
import "express-async-errors";
import cors from "cors";
import healthRoutes from "./routes/health.routes";
import authRoutes from "./routes/auth.routes";
import platformRoutes from "./routes/platform.routes";
import tableRoutes from "./routes/table.routes";
import categoryRoutes from "./routes/category.routes";
import dishRoutes from "./routes/dish.routes";
import orderRoutes from "./routes/order.routes";
import bookingRoutes from "./routes/booking.routes";
import settingsRoutes from "./routes/settings.routes";
import publicRoutes from "./routes/public.routes";
import tableRequestRoutes from "./routes/table-request.routes";
import staffRoutes from "./routes/staff.routes";
import { TenantNotConnectedError } from "./config/tenant-db";
import { limitTextLength } from "./middleware/limit-text";

const app: Application = express();

app.use(cors());
app.use(express.json());
app.use(limitTextLength);

app.use("/", healthRoutes);
app.use("/", authRoutes);
app.use("/", platformRoutes);
app.use("/", tableRoutes);
app.use("/", categoryRoutes);
app.use("/", dishRoutes);
app.use("/", orderRoutes);
app.use("/", bookingRoutes);
app.use("/", settingsRoutes);
app.use("/", tableRequestRoutes);
app.use("/", staffRoutes);
app.use("/public", publicRoutes);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if ((err as { type?: string })?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "The request body isn't valid JSON." });
  }
  if ((err as { type?: string })?.type === "entity.too.large") {
    return res.status(413).json({ error: "That's too large. Images must be smaller than 4MB." });
  }
  if (err instanceof TenantNotConnectedError) {
    return res.status(409).json({ error: "DATABASE_NOT_CONNECTED", message: "Connect your business's database first." });
  }
  console.error(err);
  return res.status(500).json({ error: "Internal server error" });
});

export default app;
