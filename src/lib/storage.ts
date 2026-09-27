import { createHash, randomUUID } from "crypto";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { del, put } from "@vercel/blob";
import { ConnectionInputError, type S3StorageConfig, type StorageConfig } from "./connection-input";

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
/** Under Vercel's 4.5 MB request-body limit (uploads pass through a function). */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const CHECK_TIMEOUT_MS = 10_000;

/** The shared Vercel Blob store, for businesses that haven't connected their own. */
export function sharedStorage(): StorageConfig | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  return token ? { provider: "vercel_blob", token } : null;
}

/** "dishes/<timestamp>-<name>", with the name reduced to URL-safe characters. */
export function imageKey(filename: string | undefined, now = Date.now()): string {
  const name = (filename ?? "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "").slice(-100);
  return `dishes/${now}-${name || "upload"}`;
}

// One client per storage account, reused across uploads on this instance
// (like the Pusher clients). New keys give a new client.
const s3Clients = new Map<string, S3Client>();

function s3Client(c: S3StorageConfig): S3Client {
  const id = [c.endpoint, c.region, c.accessKeyId, createHash("sha256").update(c.secretAccessKey).digest("hex")].join("|");
  let client = s3Clients.get(id);
  if (!client) {
    client = new S3Client({
      endpoint: c.endpoint,
      region: c.region,
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
      // Most S3-compatible services (MinIO, R2, B2) expect bucket-in-path URLs.
      forcePathStyle: true,
    });
    s3Clients.set(id, client);
  }
  return client;
}

/** Stores a public file and returns its URL. */
export async function uploadObject(config: StorageConfig, key: string, body: Buffer, contentType: string): Promise<string> {
  if (config.provider === "vercel_blob") {
    const blob = await put(key, body, { access: "public", contentType, token: config.token });
    return blob.url;
  }
  await s3Client(config).send(
    new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: contentType }),
  );
  return `${config.publicUrl}/${key}`;
}

export async function deleteObject(config: StorageConfig, key: string, url: string): Promise<void> {
  if (config.provider === "vercel_blob") return del(url, { token: config.token });
  await s3Client(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}

/** A short reason a storage service refused or failed, safe to show the owner. */
export function describeStorageError(err: unknown): string {
  const e = err as { name?: string; code?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const cause = (err as { cause?: { code?: string } })?.cause?.code ?? e?.code;
  if (cause === "ENOTFOUND" || cause === "ECONNREFUSED" || cause === "ETIMEDOUT") return "couldn't reach the storage endpoint";
  switch (e?.name) {
    case "NoSuchBucket":
      return "that bucket doesn't exist";
    case "InvalidAccessKeyId":
    case "SignatureDoesNotMatch":
      return "the access key ID or secret is wrong";
    case "AccessDenied":
      return "these keys aren't allowed to write to that bucket";
    case "BlobAccessError":
      return "Vercel Blob rejected this token";
    case "BlobStoreNotFoundError":
      return "that Vercel Blob store doesn't exist";
  }
  if (e?.$metadata?.httpStatusCode) return `the storage service answered ${e.$metadata.httpStatusCode}${e.name ? ` (${e.name})` : ""}`;
  // Anything else stays in the server log: raw SDK messages can name internal hosts.
  return "the storage service refused the request";
}

/**
 * Checks storage works end to end: writes a small file, reads it back from
 * its public URL (images must be viewable by guests), then deletes it. The
 * public read doesn't follow redirects, so the check can't be pointed at
 * another host.
 */
export async function verifyStorage(config: StorageConfig, fetchImpl: typeof fetch = fetch): Promise<void> {
  const key = `connection-check/${randomUUID()}.txt`;
  const content = `crm storage check ${randomUUID()}`;

  let url: string;
  try {
    url = await uploadObject(config, key, Buffer.from(content), "text/plain");
  } catch (err) {
    throw new ConnectionInputError(`Storage refused a test upload: ${describeStorageError(err)}`);
  }

  try {
    let res: Response;
    try {
      res = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    } catch {
      throw new ConnectionInputError(`Couldn't open the test file at ${url}. Check the public URL.`);
    }
    if (!res.ok || (await res.text()) !== content) {
      throw new ConnectionInputError(
        `The test file isn't publicly readable at ${url} (answered ${res.status}). Check the public URL and that the bucket allows public reads.`,
      );
    }
  } finally {
    // Best effort: keys that can't delete still work for uploads.
    await deleteObject(config, key, url).catch(() => undefined);
  }
}
