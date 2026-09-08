import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import prisma from "../config/prisma";
import { resolvePlatformId } from "../lib/platform-context";

const JWT_SECRET = process.env.JWT_SECRET as string;

let io: SocketIOServer | null = null;

const platformRoom = (platformId: string) => `platform:${platformId}`;

/**
 * A connecting client is either staff (carries the same JWT used for REST
 * auth, resolved to a platform exactly like requireAuth/resolvePlatformId
 * does) or a guest (carries only the platformId from their public /client
 * URL, no auth — matches what the public REST endpoints already allow).
 */
async function resolveSocketPlatformId(socket: Socket): Promise<string | null> {
  const { token, platformId: guestPlatformId } = socket.handshake.auth ?? {};

  if (typeof token === "string" && token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { sub: string };
      return await resolvePlatformId(payload.sub);
    } catch {
      return null;
    }
  }

  if (typeof guestPlatformId === "string" && guestPlatformId) {
    const platform = await prisma.platforms.findUnique({ where: { id: guestPlatformId } });
    return platform && platform.is_active ? platform.id : null;
  }

  return null;
}

export function initSocketServer(httpServer: HttpServer) {
  io = new SocketIOServer(httpServer, {
    cors: { origin: process.env.FRONTEND_URL || true },
  });

  io.on("connection", (socket) => {
    resolveSocketPlatformId(socket).then((platformId) => {
      if (!platformId) {
        socket.disconnect();
        return;
      }
      socket.join(platformRoom(platformId));
    });
  });

  return io;
}

/** Broadcasts an event to every client (staff and guest) connected for a
 * platform. Call this after any write that other sessions should see live. */
export function emitToPlatform(platformId: string, event: string, payload: unknown) {
  io?.to(platformRoom(platformId)).emit(event, payload);
}
