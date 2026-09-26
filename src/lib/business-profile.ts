import prisma from "../config/prisma";
import { tenantDb } from "../config/tenant-db";

/** Contact details and logo: stored with the business's other data (its own
 * database once connected). The central `platforms` row keeps only what's
 * needed to find the business: id, name, type and active flag. */
export interface BusinessProfile {
  phone: string | null;
  email: string | null;
  address: string | null;
  logo_url: string | null;
}

const PROFILE_SELECT = { phone: true, email: true, address: true, logo_url: true } as const;
export const EMPTY_PROFILE: BusinessProfile = { phone: null, email: null, address: null, logo_url: null };

const hasAny = (p: BusinessProfile | null | undefined) =>
  !!p && Object.values(p).some((v) => v !== null && v !== "");

/** The business's profile from wherever its data lives. */
export async function readProfile(platformId: string): Promise<BusinessProfile> {
  const db = await tenantDb(platformId);
  const own = (await db.platforms.findUnique({ where: { id: platformId }, select: PROFILE_SELECT })) ?? EMPTY_PROFILE;
  if (db === prisma) return own;

  // A business that connected its database before profiles moved there still
  // has them in the central row: move them over once, then clear them centrally.
  const central = await prisma.platforms.findUnique({ where: { id: platformId }, select: PROFILE_SELECT });
  if (!hasAny(central)) return own;
  const merged: BusinessProfile = {
    phone: own.phone ?? central!.phone,
    email: own.email ?? central!.email,
    address: own.address ?? central!.address,
    logo_url: own.logo_url ?? central!.logo_url,
  };
  await db.platforms.update({ where: { id: platformId }, data: merged });
  await prisma.platforms.update({ where: { id: platformId }, data: EMPTY_PROFILE });
  return merged;
}
