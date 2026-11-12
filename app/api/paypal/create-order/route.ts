import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getAccessToken } from "@/lib/paypal";
import { createSession } from "@/lib/sessions";
import {
  parsePayPalError,
  humanisePayPalError,
  CREATE_ISSUE_MESSAGES,
} from "@/lib/paypal-error";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const amount: string = body.amount ?? "10.00";
    const currency: string = body.currency ?? "USD";

    const token = await getAccessToken();

    const paypalRequestId = uuidv4(); // idempotency key — server stores for 6 hours

    // Negative testing header — sandbox only.
    // Source: PayPal quick start guide — ENABLE_NEGATIVE_TESTING / NEGATIVE_TEST_TYPE.
    // Never sent in production (PAYPAL_ENVIRONMENT=production).
    const createHeaders: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": paypalRequestId,
      Prefer: "return=representation",
    };
    if (
      process.env.PAYPAL_ENVIRONMENT !== "production" &&
      process.env.ENABLE_NEGATIVE_TESTING === "true" &&
      process.env.NEGATIVE_TEST_TYPE
    ) {
      createHeaders["PayPal-Mock-Response"] = JSON.stringify({
        mock_application_codes: process.env.NEGATIVE_TEST_TYPE,
      });
    }

    const orderRes = await fetch(
      "https://api-m.sandbox.paypal.com/v2/checkout/orders",
      {
        method: "POST",
        headers: createHeaders,
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              amount: {
                currency_code: currency,
                value: amount,
              },
              description: "PayVerify AI-Gated Payment",
            },
          ],
          application_context: {
            brand_name: "PayVerify",
            user_action: "PAY_NOW",
          },
        }),
      }
    );

    if (!orderRes.ok) {
      const { errorBody, rawText } = await parsePayPalError(orderRes);
      const { userMessage, issueCode, debugId } = humanisePayPalError(
        errorBody,
        CREATE_ISSUE_MESSAGES
      );

      console.error(
        `[create-order] PayPal HTTP ${orderRes.status}` +
          (debugId ? ` debug_id=${debugId}` : "") +
          (issueCode ? ` issue=${issueCode}` : "") +
          `: ${rawText}`
      );

      // Map PayPal HTTP status codes to appropriate client-facing status codes
      // Source: Python SDK create_order errors table (400 / 401 / 422)
      const clientStatus =
        orderRes.status === 401 ? 401
        : orderRes.status === 422 ? 422
        : orderRes.status === 400 ? 400
        : 502;

      return NextResponse.json(
        {
          error: userMessage,
          issueCode,
          debugId,
        },
        { status: clientStatus }
      );
    }

    const order = await orderRes.json();
    const orderId: string = order.id;
    const orderStatus: string = order.status ?? "CREATED";
    const sessionId = uuidv4();

    createSession(sessionId, orderId, amount, currency);

    return NextResponse.json({ orderId, sessionId, orderStatus });
  } catch (err) {
    console.error("[create-order]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
