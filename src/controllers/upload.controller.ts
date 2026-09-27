import { Response } from "express";
import { AuthedRequest } from "../middleware/auth.middleware";
import { resolvePlatformMembership } from "../lib/platform-context";
import { getConnection, sharedInfraAllowed } from "../lib/platform-connections";
import { describeStorageError, IMAGE_TYPES, imageKey, sharedStorage, uploadObject } from "../lib/storage";

/**
 * Stores a dish photo or logo (raw image body, name in X-Filename) in the
 * business's own storage, or the shared Vercel Blob when it hasn't connected
 * one. Answers `{ url }`. Any member of the business may upload.
 */
export async function uploadImage(req: AuthedRequest, res: Response) {
  const membership = await resolvePlatformMembership(req.userId as string);
  if (!membership) return res.status(404).json({ error: "No platform found for this user" });

  const contentType = (req.headers["content-type"] ?? "").split(";")[0].trim();
  if (!IMAGE_TYPES.includes(contentType) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: "Please upload a PNG, JPEG, WEBP, or GIF image." });
  }

  const own = (await getConnection(membership.platformId)).storage;
  const storage = own ?? (sharedInfraAllowed() ? sharedStorage() : null);
  if (!storage) {
    return own === null && !sharedInfraAllowed()
      ? res.status(409).json({ error: "Connect your image storage in Settings → Connections first." })
      : res.status(503).json({ error: "Image uploads aren't set up on this server (BLOB_READ_WRITE_TOKEN isn't set)." });
  }

  try {
    const url = await uploadObject(storage, imageKey(req.header("x-filename")), req.body, contentType);
    return res.status(200).json({ url });
  } catch (err) {
    console.error("Image upload failed", err);
    return res.status(502).json({ error: `Couldn't save the image: ${describeStorageError(err)}.` });
  }
}
