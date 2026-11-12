import Pusher from "pusher";

// Singleton pattern — reuse across hot reloads in dev
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pusherServer: Pusher = (globalThis as any).__pusherServer__ ??
  (() => {
    const instance = new Pusher({
      appId: process.env.PUSHER_APP_ID!,
      key: process.env.PUSHER_KEY!,
      secret: process.env.PUSHER_SECRET!,
      cluster: process.env.PUSHER_CLUSTER!,
      useTLS: true,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__pusherServer__ = instance;
    return instance;
  })();

export default pusherServer;
