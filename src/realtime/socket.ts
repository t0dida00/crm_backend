import Pusher from "pusher";

let pusher: Pusher | null = null;

function getPusher(): Pusher | null {
  if (pusher) return pusher;
  const { PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER } = process.env;
  if (!PUSHER_APP_ID || !PUSHER_KEY || !PUSHER_SECRET || !PUSHER_CLUSTER) return null;

  pusher = new Pusher({
    appId: PUSHER_APP_ID,
    key: PUSHER_KEY,
    secret: PUSHER_SECRET,
    cluster: PUSHER_CLUSTER,
    useTLS: true,
  });
  return pusher;
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
  const client = getPusher();
  if (!client) return;
  try {
    await client.trigger(platformChannel(platformId), event, payload);
  } catch (err) {
    console.error("Pusher trigger failed:", err);
  }
}
