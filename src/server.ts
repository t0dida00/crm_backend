import "dotenv/config";
import { createServer } from "http";
import app from "./app";
import { initSocketServer } from "./realtime/socket";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const httpServer = createServer(app);
initSocketServer(httpServer);

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
