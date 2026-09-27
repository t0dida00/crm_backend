import prisma from "../config/prisma";

/** Whether new owner accounts wait for review before they can sign in (REQUIRE_ACCOUNT_APPROVAL=true). */
export const approvalRequired = () => process.env.REQUIRE_ACCOUNT_APPROVAL === "true";

/**
 * True while a central account is waiting for review. Accounts without an
 * `account_approvals` row are approved, and turning REQUIRE_ACCOUNT_APPROVAL
 * off lets waiting accounts in too.
 */
export async function isPendingApproval(userId: string): Promise<boolean> {
  if (!approvalRequired()) return false;
  const row = await prisma.account_approvals.findUnique({ where: { user_id: userId } });
  return !!row && row.status !== "approved";
}
