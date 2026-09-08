import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET as string;
const TOKEN_TYPE = "table-qr";

interface TableTokenPayload {
  type: typeof TOKEN_TYPE;
  platformId: string;
  tableId: string;
}

// QR codes are printed and reused indefinitely, so these tokens don't expire —
// `type` distinguishes them from login JWTs so one can never be used as the other.
export function signTableToken(platformId: string, tableId: string): string {
  const payload: TableTokenPayload = { type: TOKEN_TYPE, platformId, tableId };
  return jwt.sign(payload, JWT_SECRET);
}

export function verifyTableToken(token: string): { platformId: string; tableId: string } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as TableTokenPayload;
    if (payload.type !== TOKEN_TYPE || !payload.platformId || !payload.tableId) return null;
    return { platformId: payload.platformId, tableId: payload.tableId };
  } catch {
    return null;
  }
}
