"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Standard PayPal JavaScript SDK declaration
// ---------------------------------------------------------------------------
declare global {
  interface Window {
    paypal?: {
      Buttons: (config: {
        style?: {
          layout?: "vertical" | "horizontal";
          color?: "gold" | "blue" | "silver" | "white" | "black";
          shape?: "rect" | "pill";
          label?: "paypal" | "checkout" | "buynow" | "pay";
        };
        createOrder: () => Promise<string>;
        onApprove: (data: { orderID: string }) => Promise<void>;
        onCancel?: (data: unknown) => void;
        onError?: (err: unknown) => void;
      }) => {
        render: (container: string | HTMLElement) => Promise<void>;
      };
    };
  }
}

type PageState =
  | "loading_sdk"
  | "ready"
  | "approving"
  | "cancelled"
  | "error";

export default function CheckoutPage() {
  const router = useRouter();
  const [amount, setAmount] = useState("10.00");
  const [pageState, setPageState] = useState<PageState>("loading_sdk");
  const [errorMsg, setErrorMsg] = useState("");

  const sessionIdRef = useRef<string | null>(null);
  const amountRef = useRef(amount);
  amountRef.current = amount;

  const buttonsRendered = useRef(false);

  // ---------------------------------------------------------------------------
  // onApprove — buyer approved the order in the popup
  // ---------------------------------------------------------------------------
  const handleApprove = useCallback(
    async () => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      setPageState("approving");
      await fetch(`/api/session/${sid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flag: "buyerPaypalApproved" }),
      });
      router.push(`/session/${sid}?role=buyer`);
    },
    [router]
  );

  // ---------------------------------------------------------------------------
  // Initialize and Render PayPal Buttons
  // ---------------------------------------------------------------------------
  const renderPayPalButtons = useCallback(() => {
    if (!window.paypal || buttonsRendered.current) return;
    const container = document.getElementById("paypal-button-container");
    if (!container) return;

    container.innerHTML = "";
    buttonsRendered.current = true;

    window.paypal
      .Buttons({
        style: {
          layout: "vertical",
          color: "gold",
          shape: "rect",
          label: "paypal",
        },
        createOrder: async () => {
          try {
            setErrorMsg("");
            const res = await fetch("/api/paypal/create-order", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                amount: amountRef.current,
                currency: "USD",
              }),
            });
            const data = await res.json();
            if (!res.ok) {
              throw new Error(data.error || "Failed to create order");
            }
            sessionIdRef.current = data.sessionId;
            return data.orderId;
          } catch (err: unknown) {
            const msg =
              err instanceof Error ? err.message : "Failed to create order";
            setErrorMsg(msg);
            setPageState("error");
            throw err;
          }
        },
        onApprove: async () => {
          await handleApprove();
        },
        onCancel: () => {
          setPageState("ready");
          setErrorMsg("Payment was cancelled. You can try again whenever you're ready.");
        },
        onError: (err: unknown) => {
          console.error("[PayPal SDK error]", err);
          const msg = err instanceof Error ? err.message : String(err);
          let userMsg = "An error occurred with PayPal checkout. Please try again.";
          if (msg.includes("INSTRUMENT_DECLINED")) {
            userMsg = "Your payment instrument was declined. Please try another funding source.";
          }
          setErrorMsg(userMsg);
          setPageState("error");
        },
      })
      .render("#paypal-button-container")
      .then(() => {
        setPageState("ready");
      })
      .catch((err) => {
        console.error("[PayPal render error]", err);
        setPageState("error");
        setErrorMsg("Failed to render PayPal button.");
      });
  }, [handleApprove]);

  // ---------------------------------------------------------------------------
  // Load standard PayPal JS SDK Script
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
    if (!clientId) {
      setErrorMsg("PayPal Client ID is missing in environment variables.");
      setPageState("error");
      return;
    }

    const scriptId = "paypal-js-sdk-script";
    if (document.getElementById(scriptId)) {
      if (window.paypal) {
        renderPayPalButtons();
      }
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=USD&components=buttons`;
    script.async = true;
    script.onload = () => {
      renderPayPalButtons();
    };
    script.onerror = () => {
      setErrorMsg("Failed to load PayPal SDK. Please check your internet connection.");
      setPageState("error");
    };
    document.body.appendChild(script);
  }, [renderPayPalButtons]);

  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-6 py-16 bg-zinc-50">
      <div className="w-full max-w-md flex flex-col gap-6 bg-white p-8 rounded-2xl shadow-sm border border-zinc-200">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-2xl font-bold text-zinc-900">PayVerify Checkout</h1>
          <p className="text-zinc-500 text-sm mt-1">
            AI-Gated Payment — verified by both buyer and seller biometrics.
          </p>
        </div>

        {/* Amount input */}
        <div className="flex flex-col gap-2">
          <label htmlFor="amount" className="text-sm font-medium text-zinc-700">
            Payment Amount (USD)
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 font-semibold">
              $
            </span>
            <input
              id="amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full pl-8 pr-4 py-3 rounded-xl border border-zinc-200 bg-white text-zinc-900 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Status messages */}
        {pageState === "loading_sdk" && (
          <p className="text-blue-600 text-sm animate-pulse text-center">
            Loading secure PayPal button…
          </p>
        )}
        {pageState === "approving" && (
          <p className="text-blue-600 text-sm animate-pulse text-center font-medium">
            Payment approved! Redirecting to face liveness check…
          </p>
        )}
        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
            {errorMsg}
          </div>
        )}

        {/* PayPal button container */}
        <div id="paypal-button-container" className="min-h-[50px] w-full" />

        {/* Sandbox info */}
        <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-800 space-y-1">
          <div className="font-semibold">🧪 PayPal Sandbox Test Account:</div>
          <div>Email: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono">sb-kljmq53386712@personal.example.com</code></div>
          <div>Password: <code className="bg-blue-100 px-1 py-0.5 rounded font-mono">Freshpak123!</code></div>
        </div>
      </div>
    </main>
  );
}
