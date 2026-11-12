import { NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/sessions";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const eventType: string = body.event_type ?? "UNKNOWN";
    const resource = body.resource ?? {};

    console.log(`[webhook] PayPal event: ${eventType}`, JSON.stringify(resource, null, 2));

    if (
      eventType === "CHECKOUT.ORDER.COMPLETED" ||
      eventType === "CHECKOUT.ORDER.APPROVED"
    ) {
      // resource.id is the order ID — try to find the matching session
      // In a production app you'd have a reverse lookup; here we just log
      const orderId: string = resource.id ?? resource.order_id ?? "";
      console.log(`[webhook] Order ${orderId} event: ${eventType}`);
    }

    if (eventType === "CHECKOUT.ORDER.COMPLETED") {
      // Mark the session order as completed if we can find it
      const orderId: string = resource.id ?? "";
      // Attempt to update any active session with this orderId
      // (Simple scan — fine for demo scale)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sessions: Map<string, any> = (globalThis as any).__sessions__;
      if (sessions) {
        for (const [sessionId, sess] of sessions.entries()) {
          if (sess.orderId === orderId) {
            updateSession(sessionId, { orderStatus: "COMPLETED" });
            console.log(`[webhook] Marked session ${sessionId} as COMPLETED`);
            break;
          }
        }
      }
    }

    // Always return 200 to acknowledge receipt to PayPal
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[webhook] Error:", err);
    return NextResponse.json({ received: true });
  }
}
