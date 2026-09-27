import { NextFunction, Response } from "express";
import { resolvePlatformMembership } from "../lib/platform-context";
import { AuthedRequest } from "./auth.middleware";

/**
 * After requireAuth: lets only the business's OWNER through (the admin app's
 * writes and revenue stats). Staff get 403 even if they call the API
 * directly. The role is re-read from the database, never taken from the JWT.
 */
export async function requireOwner(req: AuthedRequest, res: Response, next: NextFunction) {
  const membership = await resolvePlatformMembership(req.userId as string);
  if (!membership) return res.status(404).json({ error: "No platform found for this user" });
  if (membership.role !== "OWNER") return res.status(403).json({ error: "Only the owner can do this" });
  next();
}
