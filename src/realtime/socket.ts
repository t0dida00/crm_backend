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
 * see live. A Vercel serverless function can't hold a persistent socket
 * connection the way Socket.IO needs, so Pusher's REST-based publish (no
 * long-lived connection required server-side) replaces it here — the
 * frontend subscribes with pusher-js instead of connecting a raw socket. */
export function emitToPlatform(platformId: string, event: string, payload: unknown) {
  const client = getPusher();
  if (!client) return;
  client.trigger(platformChannel(platformId), event, payload).catch((err) => {
    console.error("Pusher trigger failed:", err);
  });
}
