import { lookup } from "dns/promises";
import { isIP } from "net";

/** A user-supplied connection value that can't be used; `message` is safe to show. */
export class ConnectionInputError extends Error {}

const SSL_MODES = new Set(["require", "verify-ca", "verify-full"]);

/** True for loopback, private, link-local, CGNAT, multicast and reserved addresses. */
export function isPrivateAddress(ip: string): boolean {
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || /^ff/.test(v6);
}

export interface CheckedDatabaseUrl {
  url: string;
  /** "host/database", shown to the owner instead of the URL. */
  label: string;
}

/**
 * Validates a business's Postgres URL before the backend connects to it. In
 * production the URL must use SSL and must not resolve to a private address,
 * so the API can't be used to reach machines inside the host's network.
 */
export async function checkDatabaseUrl(
  raw: unknown,
  { production = process.env.NODE_ENV === "production", resolve = lookup } = {},
): Promise<CheckedDatabaseUrl> {
  if (typeof raw !== "string" || !raw.trim()) throw new ConnectionInputError("Database URL is required");
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ConnectionInputError("Database URL isn't a valid URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new ConnectionInputError("Database URL must start with postgresql://");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!host) throw new ConnectionInputError("Database URL has no host");
  if (!database) throw new ConnectionInputError("Database URL has no database name");

  if (production) {
    if (!SSL_MODES.has(url.searchParams.get("sslmode") ?? "")) {
      throw new ConnectionInputError("Database URL must use SSL (add ?sslmode=require)");
    }
    const addresses = isIP(host) ? [host] : (await resolve(host, { all: true }).catch(() => [])).map((a) => a.address);
    if (addresses.length === 0) throw new ConnectionInputError("Database host can't be found");
    if (addresses.some(isPrivateAddress)) {
      throw new ConnectionInputError("Database host must be publicly reachable");
    }
  }

  return { url: url.toString(), label: `${host}/${database}` };
}

export interface PusherCredentials {
  appId: string;
  key: string;
  secret: string;
  cluster: string;
}

/** Validates Pusher credentials' shape (the cluster ends up in a hostname). */
export function checkPusherCredentials(body: unknown): PusherCredentials {
  const { appId, key, secret, cluster } = (body ?? {}) as Record<string, unknown>;
  const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const creds = { appId: clean(appId), key: clean(key), secret: clean(secret), cluster: clean(cluster) };
  if (!/^\d{1,20}$/.test(creds.appId)) throw new ConnectionInputError("Pusher app ID must be a number");
  if (!/^[A-Za-z0-9]{8,64}$/.test(creds.key)) throw new ConnectionInputError("Pusher key looks wrong");
  if (!/^[A-Za-z0-9]{8,64}$/.test(creds.secret)) throw new ConnectionInputError("Pusher secret looks wrong");
  if (!/^[a-z0-9-]{2,20}$/.test(creds.cluster)) throw new ConnectionInputError("Pusher cluster looks wrong (e.g. eu, ap1)");
  return creds;
}
