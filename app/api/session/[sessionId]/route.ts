import { NextRequest, NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/sessions";
import pusherServer from "@/lib/pusher-server";

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params;
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json(
      { error: "Session not found or expired" },
      { status: 404 }
    );
  }
  return NextResponse.json({
    sessionId,
    orderId: session.orderId,
    buyerVerified: session.buyerVerified,
    sellerVerified: session.sellerVerified,
    buyerPaypalApproved: session.buyerPaypalApproved,
    orderStatus: session.orderStatus,
    amount: session.amount,
    currency: session.currency,
    createdAt: session.createdAt,
  });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params;
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json(
      { error: "Session not found or expired" },
      { status: 404 }
    );
  }

  const body = await request.json();
  const { flag } = body as { flag: string };

  const allowedFlags = ["buyerVerified", "sellerVerified", "buyerPaypalApproved"];
  if (!allowedFlags.includes(flag)) {
    return NextResponse.json(
      { error: `Unknown flag: ${flag}` },
      { status: 400 }
    );
  }

  const updated = updateSession(sessionId, { [flag]: true });
  if (!updated) {
    return NextResponse.json(
      { error: "Session not found or expired" },
      { status: 404 }
    );
  }

  // Broadcast real-time update to both devices on this session channel
  try {
    await pusherServer.trigger(`session-${sessionId}`, "verification-update", {
      buyerVerified: updated.buyerVerified,
      sellerVerified: updated.sellerVerified,
      buyerPaypalApproved: updated.buyerPaypalApproved,
    });
  } catch (err) {
    console.warn("[pusher] Real-time sync event skipped (fallback polling active):", err);
  }

  return NextResponse.json({
    sessionId,
    buyerVerified: updated.buyerVerified,
    sellerVerified: updated.sellerVerified,
    buyerPaypalApproved: updated.buyerPaypalApproved,
  });
}
