import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getAccessToken } from "@/lib/paypal";
import { getSession, updateSession } from "@/lib/sessions";
import pusherServer from "@/lib/pusher-server";
import {
  parsePayPalError,
  humanisePayPalError,
} from "@/lib/paypal-error";

// ---------------------------------------------------------------------------
// Processor response_code → human-readable description
// Source: PayPal card testing docs + sandbox rejection trigger table
// ---------------------------------------------------------------------------
const PROCESSOR_RESPONSE_MESSAGES: Record<string, string> = {
  // Standard acquirer decline codes
  "0500": "Card refused (DO_NOT_HONOR). Use a different card.",
  "5400": "Card expired (EXPIRED_CARD). Use a card with a future expiry date.",
  "5100": "Card invalid or restricted (INVALID_OR_RESTRICTED_CARD). Use a different card.",
  "5120": "Insufficient funds (INSUFFICIENT_FUNDS). Use a different card.",
  "9500": "Fraudulent card detected (SUSPECTED_FRAUD). Use a different card.",
  "9520": "Card reported lost or stolen (LOST_OR_STOLEN). Use a different card.",
  "1338": "Card not valid (INVALID_ACCOUNT). Use a different card.",
  "5180": "Card declined by bank (GENERIC_DECLINE). Use a different card.",
  "00N7": "CVV check failed (CVV2_FAILURE_POSSIBLE_RETRY_WITH_CVV). Recheck your CVV.",
  // PayPal mock-response codes
  "INSTRUMENT_DECLINED": "The payment instrument was declined. Use a different payment method.",
  "DUPLICATE_INVOICE_ID": "Duplicate invoice ID. This transaction was already processed.",
};

// AVS codes referenced in the sample response
const AVS_DESCRIPTIONS: Record<string, string> = {
  A: "Address matches, ZIP does not",
  B: "Address matches (international)",
  C: "No match",
  D: "Address and ZIP match (international)",
  E: "Not allowed for MOTO transactions",
  F: "Address and ZIP match (UK-specific)",
  G: "Globally unavailable — card issuer does not support AVS",
  I: "International — not verified",
  M: "Address and ZIP match",
  N: "Neither address nor ZIP match",
  P: "ZIP matches (international)",
  R: "Retry — issuer system unavailable",
  S: "AVS not supported by issuer",
  U: "Address information unavailable",
  W: "ZIP matches, address does not",
  X: "Exact match (address and 9-digit ZIP)",
  Y: "Address and 5-digit ZIP match",
  Z: "5-digit ZIP matches, address does not",
};

// CVV codes
const CVV_DESCRIPTIONS: Record<string, string> = {
  E: "CVV not provided",
  I: "CVV invalid",
  M: "CVV match",
  N: "CVV no match",
  P: "CVV not processed",
  S: "CVV should have been present",
  U: "CVV issuer unable to process",
  X: "CVV not supported",
};

function describeProcessorResponse(processorResponse: {
  response_code?: string;
  avs_code?: string;
  cvv_code?: string;
} | undefined): string | null {
  if (!processorResponse) return null;

  const { response_code, avs_code, cvv_code } = processorResponse;
  const parts: string[] = [];

  if (response_code) {
    const desc = PROCESSOR_RESPONSE_MESSAGES[response_code];
    parts.push(desc ?? `Processor declined (code ${response_code}).`);
  }

  if (avs_code && avs_code !== "M" && avs_code !== "Y" && avs_code !== "X") {
    const desc = AVS_DESCRIPTIONS[avs_code];
    if (desc) parts.push(`AVS: ${desc}.`);
  }

  if (cvv_code && cvv_code !== "M") {
    const desc = CVV_DESCRIPTIONS[cvv_code];
    if (desc) parts.push(`CVV: ${desc}.`);
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, orderId } = body;

    if (!sessionId || !orderId) {
      return NextResponse.json(
        { error: "sessionId and orderId are required" },
        { status: 400 }
      );
    }

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: "Session not found or expired" },
        { status: 404 }
      );
    }

    // Enforce the dual-verification gate
    if (
      !session.buyerVerified ||
      !session.sellerVerified ||
      !session.buyerPaypalApproved
    ) {
      return NextResponse.json(
        {
          error:
            "Payment not authorised: both parties must complete liveness verification",
          buyerVerified: session.buyerVerified,
          sellerVerified: session.sellerVerified,
          buyerPaypalApproved: session.buyerPaypalApproved,
        },
        { status: 403 }
      );
    }

    const token = await getAccessToken();

    // Negative testing header — sandbox only.
    // Source: PayPal quick start guide — ENABLE_NEGATIVE_TESTING / NEGATIVE_TEST_TYPE.
    const captureHeaders: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": uuidv4(),
      Prefer: "return=representation",
    };
    if (
      process.env.PAYPAL_ENVIRONMENT !== "production" &&
      process.env.ENABLE_NEGATIVE_TESTING === "true" &&
      process.env.NEGATIVE_TEST_TYPE
    ) {
      captureHeaders["PayPal-Mock-Response"] = JSON.stringify({
        mock_application_codes: process.env.NEGATIVE_TEST_TYPE,
      });
    }

    const captureRes = await fetch(
      `https://api-m.sandbox.paypal.com/v2/checkout/orders/${orderId}/capture`,
      {
        method: "POST",
        headers: captureHeaders,
      }
    );

    // -------------------------------------------------------------------------
    // PayPal HTTP-level errors — parse structured JSON body.
    // The Python SDK documents these for capture_order:
    //   400 INVALID_REQUEST, 401 AUTHENTICATION_FAILURE,
    //   403 NOT_AUTHORIZED (CONSENT_NEEDED, PERMISSION_DENIED),
    //   404 RESOURCE_NOT_FOUND (INVALID_RESOURCE_ID),
    //   422 UNPROCESSABLE_ENTITY (INSTRUMENT_DECLINED, ORDER_NOT_APPROVED,
    //       ORDER_ALREADY_CAPTURED, DUPLICATE_INVOICE_ID, etc.),
    //   500 INTERNAL_SERVER_ERROR
    // -------------------------------------------------------------------------
    if (!captureRes.ok) {
      const { errorBody, rawText } = await parsePayPalError(captureRes);
      const { userMessage, issueCode, debugId, isDeclined } =
        humanisePayPalError(errorBody);

      console.error(
        `[capture-order] PayPal HTTP ${captureRes.status}` +
          (debugId ? ` debug_id=${debugId}` : "") +
          (issueCode ? ` issue=${issueCode}` : "") +
          `: ${rawText}`
      );

      // INSTRUMENT_DECLINED and REDIRECT_PAYER_FOR_ALTERNATE_FUNDING are
      // "soft" declines — show the DeclinedScreen with retry guidance.
      // All other HTTP errors are hard failures.
      if (isDeclined) {
        updateSession(sessionId, { orderStatus: "DECLINED" });
        try {
          await pusherServer.trigger(`session-${sessionId}`, "payment-declined", {
            transactionId: "unknown",
            captureStatus: issueCode ?? "DECLINED",
            declineReason: userMessage,
            processorResponse: null,
          });
        } catch { /* Pusher broadcast failure handled silently */ }
        return NextResponse.json(
          {
            declined: true,
            transactionId: "unknown",
            captureStatus: issueCode ?? "DECLINED",
            declineReason: userMessage,
            processorResponse: null,
          },
          { status: 402 }
        );
      }

      // Map to a sensible client-facing status code
      // Source: Python SDK capture_order errors table
      const clientStatus =
        captureRes.status === 400 ? 400
        : captureRes.status === 401 ? 401
        : captureRes.status === 403 ? 403
        : captureRes.status === 404 ? 404
        : captureRes.status === 422 ? 422
        : 502;

      return NextResponse.json(
        { error: userMessage, issueCode, debugId },
        { status: clientStatus }
      );
    }

    const capture = await captureRes.json();

    // Drill into the capture object inside purchase_units
    const captureObj = capture.purchase_units?.[0]?.payments?.captures?.[0];
    const transactionId: string = captureObj?.id ?? "unknown";
    const captureStatus: string = captureObj?.status ?? capture.status ?? "UNKNOWN";
    const processorResponse = captureObj?.processor_response;

    // -----------------------------------------------------------------------
    // Critical: order-level status can be COMPLETED while the individual
    // capture status is DECLINED (e.g. expired card, insufficient funds).
    // Detect this and return a 402 so the client shows the declined screen.
    // -----------------------------------------------------------------------
    if (captureStatus === "DECLINED" || captureStatus === "FAILED") {
      const processorMsg = describeProcessorResponse(processorResponse);
      const declineReason = processorMsg ?? "The payment was declined by your card issuer.";

      console.warn(
        `[capture-order] Capture DECLINED for order ${orderId}. ` +
          `Processor: ${JSON.stringify(processorResponse)}`
      );

      updateSession(sessionId, { orderStatus: "DECLINED" });

      // Notify both devices about the decline
      try {
        await pusherServer.trigger(`session-${sessionId}`, "payment-declined", {
          transactionId,
          captureStatus,
          declineReason,
          processorResponse: {
            responseCode: processorResponse?.response_code ?? null,
            avsCode: processorResponse?.avs_code ?? null,
            cvvCode: processorResponse?.cvv_code ?? null,
            avsDescription: processorResponse?.avs_code
              ? AVS_DESCRIPTIONS[processorResponse.avs_code] ?? null
              : null,
            cvvDescription: processorResponse?.cvv_code
              ? CVV_DESCRIPTIONS[processorResponse.cvv_code] ?? null
              : null,
            humanReadable: processorMsg,
          },
        });
      } catch { /* Pusher broadcast failure handled silently */ }

      return NextResponse.json(
        {
          declined: true,
          transactionId,
          captureStatus,
          declineReason,
          processorResponse: {
            responseCode: processorResponse?.response_code ?? null,
            avsCode: processorResponse?.avs_code ?? null,
            cvvCode: processorResponse?.cvv_code ?? null,
            humanReadable: processorMsg,
          },
        },
        { status: 402 } // Payment Required — declined
      );
    }

    // Successful capture
    const orderStatus: string = capture.status ?? captureStatus;
    updateSession(sessionId, { orderStatus });

    // Broadcast to both devices
    try {
      await pusherServer.trigger(`session-${sessionId}`, "payment-captured", {
        transactionId,
        status: orderStatus,
        amount: session.amount,
        currency: session.currency,
      });
    } catch { /* Pusher broadcast failure handled silently */ }

    return NextResponse.json({
      transactionId,
      status: orderStatus,
      amount: session.amount,
      currency: session.currency,
    });
  } catch (err) {
    console.error("[capture-order]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
