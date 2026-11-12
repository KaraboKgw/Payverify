/**
 * In-memory session store for dual-party payment verification.
 * Keyed by sessionId (UUID). TTL: 5 minutes.
 */

export interface SessionState {
  orderId: string;
  buyerVerified: boolean;
  sellerVerified: boolean;
  buyerPaypalApproved: boolean;
  orderStatus: string;
  amount: string;
  currency: string;
  createdAt: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes for comfortable testing

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessions: Map<string, SessionState> = (globalThis as any).__sessions__ ??
  (() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__sessions__ = new Map<string, SessionState>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (globalThis as any).__sessions__;
  })();

/** Create a new session and return it. */
export function createSession(
  sessionId: string,
  orderId: string,
  amount: string,
  currency: string
): SessionState {
  purgeExpired();
  const session: SessionState = {
    orderId,
    buyerVerified: false,
    sellerVerified: false,
    buyerPaypalApproved: false,
    orderStatus: "CREATED",
    amount,
    currency,
    createdAt: Date.now(),
  };
  sessions.set(sessionId, session);
  return session;
}

/** Retrieve a session; returns undefined if missing or expired. */
export function getSession(sessionId: string): SessionState | undefined {
  const session = sessions.get(sessionId);
  if (!session) return undefined;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    return undefined;
  }
  return session;
}

/** Update one or more fields on an existing session. */
export function updateSession(
  sessionId: string,
  patch: Partial<Omit<SessionState, "orderId" | "createdAt">>
): SessionState | undefined {
  const session = getSession(sessionId);
  if (!session) return undefined;
  Object.assign(session, patch);
  return session;
}

function purgeExpired() {
  const now = Date.now();
  for (const [id, sess] of sessions.entries()) {
    if (now - sess.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}
