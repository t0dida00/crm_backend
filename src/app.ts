import express, { Application } from "express";
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

const app: Application = express();

app.use(cors());
app.use(express.json());

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
app.use("/public", publicRoutes);

export default app;
