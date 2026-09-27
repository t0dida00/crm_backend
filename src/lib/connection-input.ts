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

type Resolve = typeof lookup;

/** Throws unless `host` resolves only to public addresses; `what` names it in the message. */
async function checkPublicHost(host: string, what: string, resolve: Resolve) {
  const addresses = isIP(host) ? [host] : (await resolve(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) throw new ConnectionInputError(`${what} host can't be found`);
  if (addresses.some(isPrivateAddress)) {
    throw new ConnectionInputError(`${what} host must be publicly reachable`);
  }
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
    await checkPublicHost(host, "Database", resolve);
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

export interface S3StorageConfig {
  provider: "s3";
  /** e.g. https://<account>.r2.cloudflarestorage.com or https://s3.eu-west-1.amazonaws.com */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Where the bucket's files can be read publicly, without a trailing slash. */
  publicUrl: string;
}

export interface VercelBlobStorageConfig {
  provider: "vercel_blob";
  token: string;
}

/** Where a business's images go. Stored encrypted as a whole. */
export type StorageConfig = VercelBlobStorageConfig | S3StorageConfig;

const BLOB_TOKEN = /^vercel_blob_rw_([A-Za-z0-9]+)_[A-Za-z0-9]+$/;

/** An http(s) URL with nothing but an origin and an optional path; https only in production. */
async function checkServiceUrl(raw: string, what: string, production: boolean, resolve: Resolve): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConnectionInputError(`${what} isn't a valid URL`);
  }
  const allowed = production ? ["https:"] : ["https:", "http:"];
  if (!allowed.includes(url.protocol)) throw new ConnectionInputError(`${what} must start with https://`);
  if (url.username || url.password || url.search || url.hash) {
    throw new ConnectionInputError(`${what} must be a plain address, without a login or ?query`);
  }
  if (production) await checkPublicHost(url.hostname.replace(/^\[|\]$/g, ""), what, resolve);
  return url.toString().replace(/\/+$/, "");
}

/**
 * Validates the storage an owner connects: `{ provider: "vercel_blob", token }`
 * or `{ provider: "s3", endpoint, region, bucket, accessKeyId, secretAccessKey,
 * publicUrl }`. As with the database, production requires https and public
 * hosts, since the API connects to the endpoint and reads from the public URL.
 */
export async function checkStorageConfig(
  body: unknown,
  { production = process.env.NODE_ENV === "production", resolve = lookup } = {},
): Promise<StorageConfig> {
  const fields = (body ?? {}) as Record<string, unknown>;
  const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  if (fields.provider === "vercel_blob") {
    const token = clean(fields.token);
    if (!BLOB_TOKEN.test(token)) throw new ConnectionInputError("Vercel Blob token looks wrong (it starts with vercel_blob_rw_)");
    return { provider: "vercel_blob", token };
  }
  if (fields.provider !== "s3") throw new ConnectionInputError("Choose where images are stored");

  const [endpoint, publicUrl] = [clean(fields.endpoint), clean(fields.publicUrl)];
  if (!endpoint) throw new ConnectionInputError("Storage endpoint is required");
  if (!publicUrl) throw new ConnectionInputError("Public URL is required");
  const config: S3StorageConfig = {
    provider: "s3",
    endpoint: await checkServiceUrl(endpoint, "Storage endpoint", production, resolve),
    region: clean(fields.region) || "auto",
    bucket: clean(fields.bucket),
    accessKeyId: clean(fields.accessKeyId),
    secretAccessKey: clean(fields.secretAccessKey),
    publicUrl: await checkServiceUrl(publicUrl, "Public URL", production, resolve),
  };
  if (!/^[a-z0-9-]{2,30}$/.test(config.region)) throw new ConnectionInputError("Region looks wrong (e.g. auto, eu-west-1)");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket)) {
    throw new ConnectionInputError("Bucket name looks wrong (lowercase letters, numbers, dots and dashes)");
  }
  if (!/^[A-Za-z0-9]{8,128}$/.test(config.accessKeyId)) throw new ConnectionInputError("Access key ID looks wrong");
  if (!/^\S{8,256}$/.test(config.secretAccessKey)) throw new ConnectionInputError("Secret access key looks wrong");
  return config;
}

/** What the owner sees about their storage: never the token or keys. */
export function storageLabel(config: StorageConfig): string {
  if (config.provider === "vercel_blob") return `Vercel Blob · store ${config.token.match(BLOB_TOKEN)?.[1] ?? ""}`;
  return `${config.bucket} · ${new URL(config.publicUrl).host}`;
}
