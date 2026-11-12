# Tools & Technologies Used in PayVerify

This document details the core tools, APIs, libraries, and frameworks integrated into **PayVerify — AI-Gated Dual-Party Payment**.

---

## 1. PayPal MCP Server Integration

### Local MCP Server (`@paypal/mcp`)
- **Command:** `npm run mcp:local` (runs `npx @paypal/mcp --tools=all`)
- **Requires:** Node.js v18+, `PAYPAL_ACCESS_TOKEN` and `PAYPAL_ENVIRONMENT=SANDBOX` in `.env.local`
- **Purpose:** Connects any MCP client (Claude Desktop, Bob, Cursor) directly to all PayPal sandbox tools so AI agents can create invoices, orders, subscriptions and manage disputes via natural language.
- **Config file:** `mcp.json` → `paypal-local` entry

### Remote MCP Server (`https://mcp.sandbox.paypal.com`)
- **Sandbox SSE endpoint:** `https://mcp.sandbox.paypal.com/sse`
- **Sandbox HTTP endpoint:** `https://mcp.sandbox.paypal.com/http` (Streamable HTTP — responses arrive in chunks as they are produced)
- **Production endpoints:** `https://mcp.paypal.com/sse` / `https://mcp.paypal.com/http`
- **Auth:** Bearer token from PayPal OAuth2 client credentials grant
  - Generate via: `GET /api/paypal/token` (this app's own token endpoint)
  - Or via `curl -X POST https://api-m.sandbox.paypal.com/v1/oauth2/token -u "CLIENT_ID:SECRET" -d "grant_type=client_credentials"`
- **Config file:** `mcp.json` → `paypal-remote-sse` / `paypal-remote-http` entries

### Token Endpoint (`GET /api/paypal/token`)
- **Purpose:** Returns a fresh sandbox Bearer access token derived from `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET`.
- **Use case:** Supplies the `<auth_header>` value required by the remote MCP server's `Authorization: Bearer` header without needing to hardcode long-lived tokens in the MCP client config.
- **Caching:** Token is cached in-process by `lib/paypal.ts` with `PAYPAL_O_AUTH_CLOCK_SKEW` protection. The endpoint itself sets `Cache-Control: no-store`.

### Prompt Best Practices (from PayPal MCP docs)
| Principle | Usage |
|---|---|
| Be clear about action | Put the action first ("Create an invoice…"), then supply parameters in the order the tool expects. |
| Be specific | Include every required field (currency, invoice_id). Unclear input can cause failure. |
| Separate complex tasks | Checkout sequence: 1) Create order 2) Pay order 3) Create shipment. |
| Encourage thinking | Begin analytic requests with "Think step-by-step before calling the tool…" |
| Protect PII | Never embed card numbers, SSNs, passwords, or secrets in prompts. |

### Example multistep prompts
- **Invoice a client:** `create_invoice` → `send_invoice` → `send_invoice_reminder`
- **Online order:** `create_order` → `pay_order` → `create_shipment_tracking`
- **Sell subscription:** `create_product` → `create_subscription_plan` → `create_subscription`
- **Dispute resolution:** `list_disputes` → `get_dispute` → `accept_dispute_claim`
- **Invoice with QR code:** `create_invoice` → `send_invoice` → `generate_invoice_qr_code`

---

## 2. Artificial Intelligence & Biometric Liveness

### TensorFlow.js & MediaPipe FaceMesh
- **Package:** `@tensorflow/tfjs`, `@tensorflow-models/face-landmarks-detection`, `@mediapipe/face_mesh`
- **Purpose:** Real-time 468-point facial landmark estimation running entirely on the client side inside the browser.
- **Privacy Guarantee:** All video frames and biometric landmark coordinates are processed locally on device memory using WebGL / WASM acceleration. No facial imagery or biometric PII is transmitted to any external server.
- **Liveness Mechanism (Eye Aspect Ratio - EAR):**
  - Continuous tracking of canonical eye landmark points (Left eye: 362, 385, 387, 263, 373, 380; Right eye: 33, 160, 158, 133, 153, 144).
  - Calculates real-time EAR formula: `(dist(p2, p6) + dist(p3, p5)) / (2 * dist(p1, p4))`.
  - Enforces dynamic blink detection (EAR < 0.2 threshold across consecutive frames) within an active verification window, preventing spoofing via static photographs or replay attacks.

---

## 3. PayPal Sandbox Developer Tools & APIs

### PayPal Orders v2 REST API
- **Endpoints:**
  - `POST /v1/oauth2/token` — Server-to-server OAuth2 client credentials grant for secure Bearer token retrieval.
  - `POST /v2/checkout/orders` — Server-side order creation (`intent: CAPTURE`) with purchase details and currency configurations.
  - `POST /v2/checkout/orders/{id}/capture` — Server-side gated capture executed only after both parties have completed biometrics and buyer approval.
  - `GET /v2/checkout/orders/{id}` — Order verification and status checks.

### PayPal JavaScript SDK (v6) / `@paypal/react-paypal-js`
- **Purpose:** Renders the client-side PayPal smart payment buttons, managing the buyer approval modal flow securely connected to the sandbox environment (`sandbox.paypal.com`).
- **Integration Mode:** Delegated client approval where `onApprove` transitions to biometric liveness verification instead of immediately auto-capturing.

### PayPal Webhooks & Webhook Simulator
- **Events Subscribed:**
  - `CHECKOUT.ORDER.APPROVED`
  - `CHECKOUT.ORDER.COMPLETED`
  - `CHECKOUT.ORDER.DECLINED`
- **Purpose:** Asynchronous server notification of transaction completion and audit logging. Tested using the PayPal Developer Dashboard Webhook Simulator.

### Negative Testing Headers
- `PayPal-Mock-Response` headers (e.g. `INSTRUMENT_DECLINED`, `DUPLICATE_INVOICE_ID`) to validate edge cases and resilient error handling.

---

## 4. Real-Time Synchronization & Communication

### Pusher Channels
- **Packages:** `pusher` (server-side events dispatch), `pusher-js` (client-side real-time subscriptions).
- **Purpose:** Real-time event transport between dual devices (Buyer ↔ Seller) across ephemeral channels (`session-{sessionId}`).
- **Events Dispatched:**
  - `verification-update`: Broadcasts real-time liveness state updates (`buyerVerified`, `sellerVerified`, `buyerPaypalApproved`) immediately without polling.

---

## 5. Application Framework & Infrastructure

- **Next.js 14 / React 19:** Full-stack App Router architecture with integrated TypeScript API route handlers.
- **Tailwind CSS:** Responsive, accessible UI components.
- **QR Code Generation (`qrcode.react`):** Generates mobile-scannable QR links encoding session invitations for the secondary verifying party.
- **UUID (`uuid`):** Cryptographically secure session token generation for duel-party handshake isolation.
