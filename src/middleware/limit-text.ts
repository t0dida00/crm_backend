import { NextFunction, Request, Response } from "express";
import { MAX_TEXT_LENGTH } from "../lib/validation";

/** Fields that come from text areas or hold URLs, which may be longer. */
const LONG_FIELDS = new Set(["description", "note", "databaseUrl", "url", "imageUrl", "logoUrl"]);

/** The first string field (at any depth) longer than MAX_TEXT_LENGTH, or null. */
export function findTooLong(value: unknown, key = ""): string | null {
  if (typeof value === "string") {
    return !LONG_FIELDS.has(key) && value.length > MAX_TEXT_LENGTH ? key || "value" : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTooLong(item, key);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const found = findTooLong(v, k);
      if (found) return found;
    }
  }
  return null;
}

/** Rejects request bodies with an input field longer than 250 characters. */
export function limitTextLength(req: Request, res: Response, next: NextFunction) {
  const field = findTooLong(req.body);
  if (field) return res.status(400).json({ error: `${field} must be ${MAX_TEXT_LENGTH} characters or fewer` });
  next();
}
