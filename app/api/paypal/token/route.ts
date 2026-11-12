/**
 * GET /api/paypal/token
 *
 * Returns a fresh PayPal Bearer access token derived from client credentials.
 *
 * This endpoint exists to support the PayPal Remote MCP server integration.
 * The remote MCP server at https://mcp.sandbox.paypal.com/sse requires an
 * "Authorization: Bearer <access_token>" header.  Rather than hardcoding a
 * long-lived token in the MCP client config, callers can fetch a fresh token
 * here and pass it as the auth_header value.
 *
 * Source (screenshots):
 *   Remote MCP server — Set up token authorization
 *   PayPal supports using your PayPal client credentials to connect to the
 *   remote MCP server. With this type of authorization, you use your PayPal
 *   account's client ID and secret from PayPal Developer Dashboard.
 *
 * Security:
 *   - Only callable server-side or from trusted internal services.
 *   - Add an API key / IP whitelist in production before exposing publicly.
 *   - Token is not cached here — lib/paypal.ts manages the in-process cache.
 */

import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/paypal";

export async function GET() {
  try {
    const accessToken = await getAccessToken();

    // Return the token in the shape the remote MCP client config expects:
    //   "Authorization: Bearer <auth_header>"
    // Callers substitute this value for <auth_header> in their MCP config.
    return NextResponse.json(
      {
        access_token: accessToken,
        token_type: "Bearer",
        environment: process.env.PAYPAL_ENVIRONMENT ?? "sandbox",
        // Instruct callers not to cache the response themselves —
        // the token cache is managed inside lib/paypal.ts.
        note: "Token is cached server-side with PAYPAL_O_AUTH_CLOCK_SKEW protection. Refetch when you receive 401.",
      },
      {
        headers: {
          // Prevent CDN / browser caching of the token response.
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to retrieve PayPal access token", detail: message },
      { status: 500 }
    );
  }
}
