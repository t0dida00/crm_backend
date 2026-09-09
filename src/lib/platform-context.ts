import prisma from "../config/prisma";

export async function resolvePlatformId(userId: string): Promise<string | null> {
  const platformUser = await prisma.platform_users.findUnique({
    where: { user_id: userId },
  });
  if (!platformUser || !platformUser.is_active) return null;
  return platformUser.platform_id;
}

/** Like resolvePlatformId, but also returns the caller's role — for
 * endpoints (like staff management) that need to verify OWNER rather than
 * just any active platform member. Re-checks the DB rather than trusting
 * the JWT's role claim, since that claim is only as fresh as the token. */
export async function resolvePlatformMembership(
  userId: string,
): Promise<{ platformId: string; role: string } | null> {
  const platformUser = await prisma.platform_users.findUnique({
    where: { user_id: userId },
  });
  if (!platformUser || !platformUser.is_active) return null;
  return { platformId: platformUser.platform_id, role: platformUser.role };
}
