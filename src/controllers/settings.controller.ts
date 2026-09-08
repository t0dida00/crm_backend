import { Response } from "express";
import prisma from "../config/prisma";
import { resolvePlatformId } from "../lib/platform-context";
import { AuthedRequest } from "../middleware/auth.middleware";

const DEFAULT_CURRENCY_SYMBOL = "€";

// platform_preferences.currency historically stored 3-letter ISO codes; the frontend
// works in currency symbols, so normalize any legacy code to its symbol on read.
const CODE_TO_SYMBOL: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };
const toSymbol = (currency: string) => CODE_TO_SYMBOL[currency] ?? currency;

async function getOrCreatePreferences(platformId: string) {
  const existing = await prisma.platform_preferences.findUnique({ where: { platform_id: platformId } });
  if (existing) return existing;
  return prisma.platform_preferences.create({
    data: { platform_id: platformId, currency: DEFAULT_CURRENCY_SYMBOL },
  });
}

export async function getSettings(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const [preferences, specialTaxes] = await Promise.all([
    getOrCreatePreferences(platformId),
    prisma.special_taxes.findMany({ where: { platform_id: platformId }, orderBy: { name: "asc" } }),
  ]);

  return res.status(200).json({
    settings: {
      currency: toSymbol(preferences.currency),
      taxRate: preferences.common_tax_rate,
      specialTaxes: specialTaxes.map((t) => ({ id: t.id, name: t.name, pct: t.tax_rate })),
    },
  });
}

export async function updateSettings(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { currency, taxRate } = req.body ?? {};
  await getOrCreatePreferences(platformId);

  const preferences = await prisma.platform_preferences.update({
    where: { platform_id: platformId },
    data: {
      ...(typeof currency === "string" ? { currency } : {}),
      ...(typeof taxRate === "number" ? { common_tax_rate: taxRate } : {}),
    },
  });

  return res
    .status(200)
    .json({ settings: { currency: toSymbol(preferences.currency), taxRate: preferences.common_tax_rate } });
}

export async function createSpecialTax(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { name, pct } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (typeof pct !== "number") {
    return res.status(400).json({ error: "pct is required" });
  }

  const tax = await prisma.special_taxes.create({
    data: { platform_id: platformId, name: name.trim(), tax_rate: pct },
  });
  return res.status(201).json({ specialTax: { id: tax.id, name: tax.name, pct: tax.tax_rate } });
}

export async function updateSpecialTax(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { id } = req.params;
  const existing = await prisma.special_taxes.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Special tax not found" });

  const { name, pct } = req.body ?? {};
  const tax = await prisma.special_taxes.update({
    where: { id },
    data: {
      ...(typeof name === "string" && name.trim() ? { name: name.trim() } : {}),
      ...(typeof pct === "number" ? { tax_rate: pct } : {}),
    },
  });
  return res.status(200).json({ specialTax: { id: tax.id, name: tax.name, pct: tax.tax_rate } });
}

export async function deleteSpecialTax(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { id } = req.params;
  const existing = await prisma.special_taxes.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Special tax not found" });

  await prisma.special_taxes.delete({ where: { id } });
  return res.status(204).send();
}
