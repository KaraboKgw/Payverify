import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/paypal";
import { parsePayPalError, humanisePayPalError } from "@/lib/paypal-error";

/**
 * GET /api/paypal/order/[orderId]
 *
 * Proxies to PayPal GET /v2/checkout/orders/{id}.
 * Source: Python SDK get_order endpoint — shows details for an order by ID.
 *
 * Optional query param:
 *   ?fields=payment_source  — request the payment_source field in the response
 *   (documented as the only valid filter field in the SDK)
 *
 * Error codes handled (from Python SDK get_order errors table):
 *   401 AUTHENTICATION_FAILURE  → 401
 *   404 RESOURCE_NOT_FOUND      → 404
 *   403 NOT_AUTHORIZED          → 403
 */

interface RouteParams {
  params: Promise<{ orderId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { orderId } = await params;

    // Validate orderId format: 1–36 uppercase alphanumeric chars
    // Source: Python SDK get_order — id constraints: Pattern ^[A-Z0-9]+$, Max 36
    if (!orderId || !/^[A-Z0-9]{1,36}$/.test(orderId)) {
      return NextResponse.json(
        { error: "Invalid order ID format. Expected 1–36 uppercase alphanumeric characters." },
        { status: 400 }
      );
    }

    // Optional fields query param
    // Source: Python SDK get_order — fields query param, valid value: payment_source
    const { searchParams } = new URL(request.url);
    const fields = searchParams.get("fields");
    const validFields = ["payment_source"];
    const fieldsParam =
      fields && validFields.includes(fields) ? `?fields=${fields}` : "";

    const token = await getAccessToken();

    const orderRes = await fetch(
      `https://api-m.sandbox.paypal.com/v2/checkout/orders/${orderId}${fieldsParam}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      }
    );

    if (!orderRes.ok) {
      const { errorBody, rawText } = await parsePayPalError(orderRes);
      const { userMessage, issueCode, debugId } = humanisePayPalError(errorBody);

      console.error(
        `[get-order] PayPal HTTP ${orderRes.status}` +
          (debugId ? ` debug_id=${debugId}` : "") +
          (issueCode ? ` issue=${issueCode}` : "") +
          `: ${rawText}`
      );

      // Map to client-facing status codes per SDK errors table
      const clientStatus =
        orderRes.status === 401 ? 401
        : orderRes.status === 403 ? 403
        : orderRes.status === 404 ? 404
        : 502;

      return NextResponse.json(
        { error: userMessage, issueCode, debugId },
        { status: clientStatus }
      );
    }

    const order = await orderRes.json();

    // Return the full order object — caller decides what to use
    return NextResponse.json({
      id: order.id,
      status: order.status,
      intent: order.intent,
      purchase_units: order.purchase_units,
      payment_source: order.payment_source ?? null,
      create_time: order.create_time ?? null,
      update_time: order.update_time ?? null,
      links: order.links ?? [],
    });
  } catch (err) {
    console.error("[get-order]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
