import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../config/prisma";
import { checkEmailAvailable, findAccountByEmail, findMembership } from "../lib/accounts";
import { isFullName } from "../lib/validation";

const JWT_SECRET = process.env.JWT_SECRET as string;
const JWT_EXPIRES_IN = "1d";
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const signToken = (user: { id: string; email: string | null }, role: string | null) =>
  jwt.sign({ sub: user.id, email: user.email, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

export async function login(req: Request, res: Response) {
  const { email, password } = req.body ?? {};

  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required" });
  }

  // Central accounts, or staff stored in their business's own database.
  const account = await findAccountByEmail(email);
  const user = account?.user;

  if (!user || !user.is_active) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const membership = await findMembership(user.id);

  // A membership that exists but is inactive means an owner disabled this
  // account (or it was left behind when the business moved to its own
  // database) — distinct from having no platform at all (a new user who
  // should be allowed to proceed to workspace setup).
  if (membership && !membership.isActive) {
    return res.status(403).json({
      error: "ACCOUNT_DISABLED",
      message: "Your account is disabled temporarily. Please contact your owner(s).",
    });
  }

  const role = membership?.role ?? null;

  const token = signToken(user, role);

  return res.status(200).json({
    token,
    user: { id: user.id, email: user.email, full_name: user.full_name, role },
  });
}

/**
 * Creates an owner-to-be account and signs it in. The new user has no
 * platform yet: creating one (`POST /platforms`) makes them its OWNER.
 */
export async function register(req: Request, res: Response) {
  const { fullName, email, password } = req.body ?? {};

  if (typeof fullName !== "string" || !fullName.trim()) {
    return res.status(400).json({ error: "Full name is required" });
  }
  if (!isFullName(fullName)) {
    return res.status(400).json({ error: "Full name must be at least two words" });
  }
  if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim())) {
    return res.status(400).json({ error: "A valid email is required" });
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!(await checkEmailAvailable(normalizedEmail)).available) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      password_hash: await bcrypt.hash(password, 10),
      full_name: fullName.trim(),
    },
  });

  return res.status(201).json({
    token: signToken(user, null),
    user: { id: user.id, email: user.email, full_name: user.full_name, role: null },
  });
}
