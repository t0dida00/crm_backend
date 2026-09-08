import prisma from "../config/prisma";

export async function resolvePlatformId(userId: string): Promise<string | null> {
  const platformUser = await prisma.platform_users.findUnique({
    where: { user_id: userId },
  });
  if (!platformUser || !platformUser.is_active) return null;
  return platformUser.platform_id;
}
