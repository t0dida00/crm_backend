/**
 * Input rules shared by the controllers. The frontend (CRM/lib/validation.ts)
 * applies the same rules in its forms; change both together.
 */

/** Digits with an optional leading +; spaces between groups allowed. 6–15 digits. */
export function isValidPhone(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!/^\+?[0-9][0-9 ]*$/.test(v)) return false;
  const digits = v.replace(/\D/g, "").length;
  return digits >= 6 && digits <= 15;
}

export const isValidEmail = (value: unknown): value is string =>
  typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());

/** At least two words, e.g. "Ana Ruiz". */
export const isFullName = (value: unknown): value is string =>
  typeof value === "string" && value.trim().split(/\s+/).filter(Boolean).length >= 2;

/** A count (seats, party size, quantity): a whole number, at least 1. */
export const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1;

/** A price or percentage: a finite number, 0 or more. */
export const isNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Highest allowed rates (the frontend enforces the same). */
export const MAX_COMMON_TAX = 100;
export const MAX_SPECIAL_TAX = 200;

/** Text inputs are capped at this many characters (text areas and URLs aren't). */
export const MAX_TEXT_LENGTH = 250;

export const MESSAGES = {
  phone: "Phone must contain only digits, with an optional + at the start",
  email: "Enter a valid email",
  fullName: "Full name must be at least two words",
} as const;
