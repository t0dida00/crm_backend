import { Response } from "express";
import prisma from "../config/prisma";
import { resolvePlatformId } from "../lib/platform-context";
import { AuthedRequest } from "../middleware/auth.middleware";

export async function listBookings(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { date } = req.query;
  const where: { platform_id: string; date?: Date } = { platform_id: platformId };
  if (typeof date === "string") {
    where.date = new Date(date);
  }

  const bookings = await prisma.bookings.findMany({ where, orderBy: { time: "asc" } });
  return res.status(200).json({ bookings });
}

export async function createBooking(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { name, time, party, date } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (typeof time !== "string" || !time.trim()) {
    return res.status(400).json({ error: "time is required" });
  }
  if (typeof party !== "number" || party <= 0) {
    return res.status(400).json({ error: "party must be a positive number" });
  }

  const booking = await prisma.bookings.create({
    data: {
      platform_id: platformId,
      name: name.trim(),
      time: time.trim(),
      party,
      date: typeof date === "string" ? new Date(date) : new Date(new Date().toDateString()),
    },
  });
  return res.status(201).json({ booking });
}

export async function updateBooking(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { id } = req.params;
  const existing = await prisma.bookings.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Booking not found" });

  const { status, name, time, party } = req.body ?? {};
  const booking = await prisma.bookings.update({
    where: { id },
    data: {
      ...(typeof status === "string" ? { status } : {}),
      ...(typeof name === "string" && name.trim() ? { name: name.trim() } : {}),
      ...(typeof time === "string" && time.trim() ? { time: time.trim() } : {}),
      ...(typeof party === "number" && party > 0 ? { party } : {}),
    },
  });
  return res.status(200).json({ booking });
}

export async function deleteBooking(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { id } = req.params;
  const existing = await prisma.bookings.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Booking not found" });

  await prisma.bookings.delete({ where: { id } });
  return res.status(204).send();
}

export async function assignBooking(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { id } = req.params;
  const existing = await prisma.bookings.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Booking not found" });

  const { tableId } = req.body ?? {};
  if (typeof tableId !== "string") {
    return res.status(400).json({ error: "tableId is required" });
  }
  const table = await prisma.tables.findFirst({ where: { id: tableId, platform_id: platformId } });
  if (!table) return res.status(404).json({ error: "Table not found" });

  const result = await prisma.$transaction(async (tx) => {
    const booking = await tx.bookings.update({ where: { id }, data: { table_id: tableId } });
    const updatedTable = await tx.tables.update({ where: { id: tableId }, data: { state: "Booked" } });
    return { booking, table: updatedTable };
  });

  return res.status(200).json(result);
}

export async function unassignBooking(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { id } = req.params;
  const existing = await prisma.bookings.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Booking not found" });

  const result = await prisma.$transaction(async (tx) => {
    const booking = await tx.bookings.update({ where: { id }, data: { table_id: null } });
    let table = null;
    if (existing.table_id) {
      const current = await tx.tables.findUnique({ where: { id: existing.table_id } });
      if (current?.state === "Booked") {
        table = await tx.tables.update({ where: { id: existing.table_id }, data: { state: "Free" } });
      }
    }
    return { booking, table };
  });

  return res.status(200).json(result);
}
