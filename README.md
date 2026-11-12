# PayVerify — AI-Gated Dual-Party Payment

> A PayPal hackathon project: a PayPal sandbox payment is only captured after **both** buyer and seller independently pass a real-time AI liveness check (blink detection) in the browser.

[![Next.js](https://img.shields.io/badge/Next.js-16.4-black)](https://nextjs.org)
[![PayPal Sandbox](https://img.shields.io/badge/PayPal-Sandbox-003087)](https://developer.paypal.com)
[![TensorFlow.js](https://img.shields.io/badge/TF.js-4.22-orange)](https://www.tensorflow.org/js)

---

## Features

- 🔐 **Dual-party liveness gate** — payment captures only after both buyer and seller blink on camera
- 💳 **PayPal JS SDK v6** — smart payment button with sandbox approval flow
- 🤖 **TensorFlow.js + MediaPipe FaceMesh** — real-time 468-point facial landmark EAR blink detection, fully client-side (no biometric data leaves the device)
- 📡 **PayPal MCP Server** — local and remote MCP integration for AI agent workflows (invoices, orders, disputes)
- 🔄 **Pusher Channels** — real-time dual-device sync between buyer and seller
- 📲 **QR Code** — seller scans the QR to join the session on a second device
- ⚠️ **Negative testing** — `PayPal-Mock-Response` header support for DECLINED / INSUFFICIENT_FUNDS flows
- 🪝 **Webhooks** — `CHECKOUT.ORDER.APPROVED` / `CHECKOUT.ORDER.COMPLETED` listeners

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.4 (App Router, TypeScript, Turbopack) |
| Styling | Tailwind CSS v4 |
| PayPal | Orders v2 REST API · JS SDK v6 · Webhooks · MCP Server |
| AI | TensorFlow.js 4.22 · MediaPipe FaceMesh · EAR blink detection |
| Real-time | Pusher Channels (free tier) |
| QR code | qrcode.react |

---

## Getting Started

### Prerequisites

- Node.js v18+
- A [PayPal Developer](https://developer.paypal.com) account with a sandbox app (Client ID + Secret)
- A [Pusher](https://pusher.com) account (free tier, Channels)

### Install

```bash
git clone <repo>
cd payverify
npm install
```

### Configure `.env.local`

Copy `.env.local` and fill in your real credentials:

```bash
# PayPal sandbox credentials
PAYPAL_CLIENT_ID=your_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_sandbox_client_secret
NEXT_PUBLIC_PAYPAL_CLIENT_ID=your_sandbox_client_id

# Must be "sandbox" for testing
PAYPAL_ENVIRONMENT=sandbox

# Pusher Channels
PUSHER_APP_ID=...
PUSHER_KEY=...
PUSHER_SECRET=...
PUSHER_CLUSTER=...
NEXT_PUBLIC_PUSHER_KEY=...
NEXT_PUBLIC_PUSHER_CLUSTER=...

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PAYPAL_CLIENT_ID` | ✅ | Sandbox Client ID from PayPal Developer Dashboard |
| `PAYPAL_CLIENT_SECRET` | ✅ | Sandbox Client Secret |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | ✅ | Same Client ID — exposed to the browser for the JS SDK |
| `PAYPAL_ENVIRONMENT` | ✅ | `sandbox` or `production` |
| `PUSHER_APP_ID` | ✅ | Pusher app ID |
| `PUSHER_KEY` | ✅ | Pusher key (server) |
| `PUSHER_SECRET` | ✅ | Pusher secret |
| `PUSHER_CLUSTER` | ✅ | Pusher cluster (e.g. `us2`) |
| `NEXT_PUBLIC_PUSHER_KEY` | ✅ | Pusher key (browser) |
| `NEXT_PUBLIC_PUSHER_CLUSTER` | ✅ | Pusher cluster (browser) |
| `NEXT_PUBLIC_APP_URL` | ✅ | Base URL for QR codes (e.g. `http://localhost:3000`) |
| `PAYPAL_O_AUTH_CLOCK_SKEW` | optional | Token expiry buffer in seconds (default: 60) |
| `PAYPAL_TIMEOUT` | optional | PayPal API request timeout in ms (default: 10000) |
| `PAYPAL_LOG_LEVEL` | optional | `DEBUG` \| `INFO` \| `WARN` \| `ERROR` (default: INFO) |
| `ENABLE_NEGATIVE_TESTING` | optional | `true` to inject `PayPal-Mock-Response` headers |
| `NEGATIVE_TEST_TYPE` | optional | `INSUFFICIENT_FUNDS` \| `INSTRUMENT_DECLINED` \| etc. |

---

## How to Test

### Happy path

1. Open [http://localhost:3000](http://localhost:3000) and click **Start Payment**.
2. Enter an amount and click the PayPal button.
3. Log in with your **PayPal sandbox buyer account** (find it in your Developer Dashboard under sandbox accounts).
4. Approve the payment — you are redirected to the liveness check page.
5. A QR code is shown. Scan it on a second device (or open the URL in another browser tab) to join as the seller.
6. Both parties blink to pass liveness.
7. Once both have blinked and the buyer approval is recorded, the capture fires automatically.
8. ✅ Transaction ID and amount are shown on the success screen.

### Negative testing

Set `ENABLE_NEGATIVE_TESTING=true` and `NEGATIVE_TEST_TYPE=INSTRUMENT_DECLINED` in `.env.local`, restart, and run the happy path — the capture will be declined and the declined screen will display the rejection reason with a sandbox test card hint.

### Webhooks (optional)

Use the [PayPal Developer Dashboard Webhook Simulator](https://developer.paypal.com/dashboard/webhooks/sandbox) to send `CHECKOUT.ORDER.APPROVED` and `CHECKOUT.ORDER.COMPLETED` events to:

```
https://<your-tunnel>.ngrok.io/api/webhooks/paypal
```

---

## PayPal MCP Server

PayVerify ships with a full MCP server configuration in [`mcp.json`](./mcp.json).

### Local MCP server

Requires an access token. Generate one from the running app:

```bash
# Get a fresh token from the app's own endpoint
curl http://localhost:3000/api/paypal/token

# Then start the local MCP server
PAYPAL_ACCESS_TOKEN=<token> PAYPAL_ENVIRONMENT=SANDBOX npm run mcp:local
```

Or simply add `PAYPAL_ACCESS_TOKEN=your_token` to `.env.local` and run:

```bash
npm run mcp:local
```

### Remote MCP server (sandbox)

**SSE transport:**

```bash
npx -y mcp-remote https://mcp.sandbox.paypal.com/sse --header "Authorization: Bearer <token>"
```

**Streamable HTTP transport:**

```bash
npx -y mcp-remote https://mcp.sandbox.paypal.com/http --header "Authorization: Bearer <token>"
```

### MCP client config (`mcp.json`)

The included [`mcp.json`](./mcp.json) has ready-to-use entries for all four server modes. Copy the entry for your preferred mode into your MCP client's config file (e.g. `~/Claude/claude_desktop_config.json` for Claude Desktop).

### Example MCP prompt (invoice a client)

```
Think step-by-step before calling any tool.
1. create_invoice: Create an invoice for alice@example.com for 2 hours of web development at $150/hr (currency USD).
2. send_invoice: Send invoice {invoice_id} to the client.
3. send_invoice_reminder: Send a reminder for invoice {invoice_id}.
```

---

## Architecture

```
Browser (Buyer)                   Browser (Seller)
      │                                 │
      │  PayPal JS SDK v6               │
      │  LivenessCheck (TF.js)          │  LivenessCheck (TF.js)
      │                                 │
      └──────────── Pusher ─────────────┘
                       │
              Next.js App Router
                       │
        ┌──────────────┴──────────────┐
        │                             │
   PayPal REST API            Pusher Server API
   (Orders v2)                (verification-update,
   - create-order              payment-captured,
   - capture-order             payment-declined)
   - GET order
        │
   PayPal Webhooks
   (ORDER.APPROVED,
    ORDER.COMPLETED)
        │
   PayPal MCP Server
   (local @paypal/mcp or
    remote mcp.sandbox.paypal.com)
```

---

## Tools Used

See [TOOLS.md](./TOOLS.md) for the complete breakdown of every API, library, and framework used, including:
- PayPal MCP Server (local + remote, SSE + Streamable HTTP)
- PayPal Orders v2 REST API
- PayPal JS SDK v6
- TensorFlow.js + MediaPipe FaceMesh EAR blink detection
- Pusher Channels real-time sync

---

## License

MIT — see [LICENSE](./LICENSE).
