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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A "YYYY-MM-DD" calendar date as the UTC-midnight Date Prisma stores in a
 * @db.Date column, or null if it isn't a real date. */
function parseBookingDate(value: string): Date | null {
  if (!DATE_RE.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) ? date : null;
}

export async function createBooking(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { name, time, party, date } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (typeof time !== "string" || !TIME_RE.test(time.trim())) {
    return res.status(400).json({ error: "time must be HH:MM" });
  }
  if (typeof party !== "number" || party <= 0) {
    return res.status(400).json({ error: "party must be a positive number" });
  }
  // The client sends its own local calendar date; without one, fall back to
  // today in UTC (not the server's local midnight, which can be yesterday in UTC).
  const bookingDate =
    date === undefined ? parseBookingDate(new Date().toISOString().slice(0, 10)) : typeof date === "string" ? parseBookingDate(date) : null;
  if (!bookingDate) {
    return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  }
  // No bookings for past days. The client's "today" can be a calendar day behind
  // UTC (e.g. UTC-10), so allow from yesterday-in-UTC; the UI enforces the
  // viewer's own today.
  const earliest = parseBookingDate(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10))!;
  if (bookingDate < earliest) {
    return res.status(400).json({ error: "Bookings can't be made for a past date" });
  }

  const booking = await prisma.bookings.create({
    data: {
      platform_id: platformId,
      name: name.trim(),
      time: time.trim(),
      party,
      date: bookingDate,
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
