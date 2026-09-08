import { Response } from "express";
import prisma from "../config/prisma";
import { resolvePlatformId } from "../lib/platform-context";
import { AuthedRequest } from "../middleware/auth.middleware";

export async function createTableRequest(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { tableName, type } = req.body ?? {};
  if (typeof tableName !== "string" || !tableName.trim()) {
    return res.status(400).json({ error: "tableName is required" });
  }
  if (type !== "call_staff" && type !== "checkout") {
    return res.status(400).json({ error: "type must be call_staff or checkout" });
  }

  const table = await prisma.tables.findFirst({
    where: { platform_id: platformId, name: tableName.trim() },
  });
  if (!table) return res.status(400).json({ error: "Unknown table" });

  const existing = await prisma.table_requests.findFirst({
    where: { platform_id: platformId, table_id: table.id, type, status: "pending" },
  });
  if (existing) return res.status(200).json({ request: existing });

  const request = await prisma.table_requests.create({
    data: {
      platform_id: platformId,
      table_id: table.id,
      table_name: table.name,
      type,
      status: "pending",
    },
  });

  return res.status(201).json({ request });
}

export async function listTableRequests(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { status } = req.query;
  const requests = await prisma.table_requests.findMany({
    where: {
      platform_id: platformId,
      status: typeof status === "string" ? status : "pending",
    },
    orderBy: { created_at: "asc" },
  });

  return res.status(200).json({ requests });
}

export async function resolveTableRequest(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { id } = req.params;
  const existing = await prisma.table_requests.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Request not found" });

  if (existing.status === "resolved") {
    return res.status(200).json({ request: existing });
  }

  await prisma.table_requests.updateMany({
    where: { id, platform_id: platformId, status: "pending" },
    data: { status: "resolved", resolved_at: new Date() },
  });

  const request = await prisma.table_requests.findUnique({ where: { id } });
  return res.status(200).json({ request });
}
