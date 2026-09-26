import { findMembership } from "./accounts";

/** The caller's business, or null if they have none or their account is inactive. */
export async function resolvePlatformId(userId: string): Promise<string | null> {
  const membership = await findMembership(userId);
  if (!membership || !membership.isActive) return null;
  return membership.platformId;
}

/** Like resolvePlatformId, but also returns the caller's role — for
 * endpoints (like staff management) that need to verify OWNER rather than
 * just any active platform member. Re-checks the DB rather than trusting
 * the JWT's role claim, since that claim is only as fresh as the token. */
export async function resolvePlatformMembership(
  userId: string,
): Promise<{ platformId: string; role: string } | null> {
  const membership = await findMembership(userId);
  if (!membership || !membership.isActive) return null;
  return { platformId: membership.platformId, role: membership.role };
}
