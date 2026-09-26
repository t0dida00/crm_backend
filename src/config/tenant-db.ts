import { PrismaClient } from "@prisma/client";
import prisma from "./prisma";
import { getConnection, sharedInfraAllowed } from "../lib/platform-connections";

/** The business has no database of its own and the shared one is turned off. */
export class TenantNotConnectedError extends Error {
  constructor() {
    super("DATABASE_NOT_CONNECTED");
  }
}

const MAX_CLIENTS = 20;
// Map keeps insertion order, so the first key is the least recently used.
const clients = new Map<string, PrismaClient>();

/** One connection per serverless instance per business database, so many instances don't exhaust it. */
export function withPoolLimits(url: string): string {
  const u = new URL(url);
  if (!u.searchParams.has("connection_limit")) u.searchParams.set("connection_limit", "1");
  if (!u.searchParams.has("pool_timeout")) u.searchParams.set("pool_timeout", "10");
  return u.toString();
}

function clientFor(url: string): PrismaClient {
  const existing = clients.get(url);
  if (existing) {
    clients.delete(url);
    clients.set(url, existing);
    return existing;
  }
  const client = new PrismaClient({ datasources: { db: { url: withPoolLimits(url) } } });
  clients.set(url, client);
  if (clients.size > MAX_CLIENTS) {
    const [oldestUrl, oldest] = clients.entries().next().value as [string, PrismaClient];
    clients.delete(oldestUrl);
    void oldest.$disconnect().catch(() => {});
  }
  return client;
}

/**
 * The Prisma client for a business's operational data (menu, tables, orders,
 * bookings, requests, preferences): its own database if it connected one,
 * otherwise the shared DATABASE_URL. Accounts, businesses and credentials
 * always use the default `prisma` client (the central database).
 */
export async function tenantDb(platformId: string): Promise<PrismaClient> {
  const { databaseUrl } = await getConnection(platformId);
  if (databaseUrl) return clientFor(databaseUrl);
  if (!sharedInfraAllowed()) throw new TenantNotConnectedError();
  return prisma;
}
