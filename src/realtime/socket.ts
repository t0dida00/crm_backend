import Pusher from "pusher";

import { getConnection } from "../lib/platform-connections";
import type { PusherCredentials } from "../lib/connection-input";

// One client per Pusher app (the shared one from env, plus one per business
// that connected its own), reused across requests on this instance.
const clients = new Map<string, Pusher>();

function clientFor(creds: PusherCredentials): Pusher {
  const id = `${creds.appId}:${creds.key}:${creds.cluster}`;
  let client = clients.get(id);
  if (!client) {
    client = new Pusher({ ...creds, useTLS: true });
    clients.set(id, client);
  }
  return client;
}

function sharedCredentials(): PusherCredentials | null {
  const { PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER } = process.env;
  if (!PUSHER_APP_ID || !PUSHER_KEY || !PUSHER_SECRET || !PUSHER_CLUSTER) return null;
  return { appId: PUSHER_APP_ID, key: PUSHER_KEY, secret: PUSHER_SECRET, cluster: PUSHER_CLUSTER };
}

/** The business's own Pusher app if it connected one, else the shared one (null = none configured). */
async function getPusher(platformId: string): Promise<Pusher | null> {
  const own = (await getConnection(platformId)).pusher;
  const creds = own ?? sharedCredentials();
  return creds ? clientFor(creds) : null;
}

const platformChannel = (platformId: string) => `platform-${platformId}`;

/** Publishes an event to every client (staff and guest) subscribed to a
 * platform's channel. Call this after any write that other sessions should
 * see live, and always `await` it before the response is sent — Vercel can
 * freeze a serverless function immediately after it responds, so a
 * fire-and-forget trigger() call can get killed mid-flight before it ever
 * reaches Pusher (this doesn't show up locally, where the Node process
 * keeps running regardless). A Vercel serverless function can't hold a
 * persistent socket connection the way Socket.IO needs either, which is why
 * this is a REST-based publish (no long-lived connection required
 * server-side) rather than a socket.io room broadcast. */
export async function emitToPlatform(platformId: string, event: string, payload: unknown) {
  try {
    const client = await getPusher(platformId);
    if (!client) return;
    await client.trigger(platformChannel(platformId), event, payload);
  } catch (err) {
    console.error("Pusher trigger failed:", err);
  }
}
