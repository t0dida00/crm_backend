import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/** Thrown when CREDENTIALS_KEY is missing or malformed. */
export class CredentialsKeyError extends Error {
  constructor() {
    super("CREDENTIALS_KEY must be set to 64 hex characters (32 bytes)");
  }
}

const VERSION = "v1";

function key(): Buffer {
  const hex = process.env.CREDENTIALS_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new CredentialsKeyError();
  return Buffer.from(hex, "hex");
}

/** True when secrets can be stored (CREDENTIALS_KEY is valid). */
export function canEncrypt(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/** AES-256-GCM: "v1:<iv>:<auth tag>:<ciphertext>", each part base64. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), body].map((p) => (typeof p === "string" ? p : p.toString("base64"))).join(":");
}

/** Reverses `encrypt`. Throws if the value was tampered with or the key changed. */
export function decrypt(stored: string): string {
  const [version, iv, tag, body] = stored.split(":");
  if (version !== VERSION || !iv || !tag || body === undefined) throw new Error("Unrecognised encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}
