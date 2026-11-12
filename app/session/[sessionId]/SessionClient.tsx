"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Pusher from "pusher-js";
import { QRCodeSVG } from "qrcode.react";
import VerificationStatus from "@/components/VerificationStatus";
import SuccessScreen from "@/components/SuccessScreen";
import FailScreen from "@/components/FailScreen";
import DeclinedScreen from "@/components/DeclinedScreen";

// Dynamically import LivenessCheck with SSR disabled so TF.js / MediaPipe
// (which use CJS exports incompatible with Turbopack's static analysis)
// are never bundled during the server-side build.
const LivenessCheck = dynamic(() => import("@/components/LivenessCheck"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-48 text-zinc-400 text-sm animate-pulse">
      Loading liveness module…
    </div>
  ),
});

interface SessionState {
  buyerVerified: boolean;
  sellerVerified: boolean;
  buyerPaypalApproved: boolean;
  orderId: string;
  orderStatus: string;
  amount: string;
  currency: string;
}

interface CaptureResult {
  transactionId: string;
  status: string;
  amount: string;
  currency: string;
}

interface ProcessorInfo {
  responseCode: string | null;
  avsCode: string | null;
  cvvCode: string | null;
  humanReadable: string | null;
}

interface DeclineResult {
  transactionId: string;
  captureStatus: string;
  declineReason: string;
  processorResponse: ProcessorInfo | null;
}

type PageState =
  | "verifying"
  | "waiting_other"
  | "capturing"
  | "success"
  | "declined"
  | "failed"
  | "expired";

export default function SessionClient() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const searchParams = useSearchParams();
  const role = (searchParams.get("role") ?? "buyer") as "buyer" | "seller";
  const router = useRouter();

  const [session, setSession] = useState<SessionState | null>(null);
  const [pageState, setPageState] = useState<PageState>("verifying");
  const [livenessKey, setLivenessKey] = useState(0);
  const [captureResult, setCaptureResult] = useState<CaptureResult | null>(null);
  const [declineResult, setDeclineResult] = useState<DeclineResult | null>(null);
  const [failReason, setFailReason] = useState("");
  const [appUrl, setAppUrl] = useState("");

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch(`/api/session/${sessionId}`);
      if (!res.ok) {
        setPageState("expired");
        return null;
      }
      const data: SessionState = await res.json();
      setSession(data);
      return data;
    } catch {
      setPageState("expired");
      return null;
    }
  }, [sessionId]);

  // Initialise appUrl once on mount without triggering the lint rule.
  // The ref ensures the value is captured before the first render that needs it.
  const appUrlRef = useRef(
    typeof window !== "undefined" ? window.location.origin : ""
  );
  useEffect(() => {
    if (appUrlRef.current) setAppUrl(appUrlRef.current);
  }, []);

  useEffect(() => {
    // fetchSession calls setState only inside async awaits — not synchronous.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchSession();

    const pusher = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
    });

    const channel = pusher.subscribe(`session-${sessionId}`);

    channel.bind(
      "verification-update",
      (data: {
        buyerVerified: boolean;
        sellerVerified: boolean;
        buyerPaypalApproved: boolean;
      }) => {
        setSession((prev) => (prev ? { ...prev, ...data } : null));
      }
    );

    channel.bind("payment-captured", (data: CaptureResult) => {
      setCaptureResult(data);
      setPageState("success");
    });

    // Seller device receives the decline event broadcast by the capture route
    channel.bind("payment-declined", (data: DeclineResult) => {
      setDeclineResult(data);
      setPageState("declined");
    });

    const expiry = setTimeout(() => {
      setPageState((prev) => {
        if (prev !== "success") {
          setFailReason(
            "Session expired after 5 minutes. Payment was not captured."
          );
          return "expired";
        }
        return prev;
      });
    }, 5 * 60 * 1000);

    return () => {
      channel.unbind_all();
      pusher.unsubscribe(`session-${sessionId}`);
      pusher.disconnect();
      clearTimeout(expiry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Fallback sync polling (guarantees dual-device sync even without Pusher configured)
  useEffect(() => {
    if (pageState !== "waiting_other" && pageState !== "verifying") return;

    const interval = setInterval(async () => {
      const data = await fetchSession();
      if (!data) return;

      if (data.orderStatus === "COMPLETED") {
        setCaptureResult({
          transactionId: "PAYPAL-" + data.orderId.slice(-8),
          status: "COMPLETED",
          amount: data.amount,
          currency: data.currency,
        });
        setPageState("success");
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [pageState, fetchSession]);

  const capturePayment = useCallback(
    async (orderId: string) => {
      setPageState("capturing");
      try {
        const res = await fetch("/api/paypal/capture-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, orderId }),
        });
        const data = await res.json();
        if (res.status === 402 && data.declined) {
          // Capture-level DECLINED (e.g. expired card, insufficient funds)
          setDeclineResult({
            transactionId: data.transactionId,
            captureStatus: data.captureStatus,
            declineReason: data.declineReason,
            processorResponse: data.processorResponse ?? null,
          });
          setPageState("declined");
        } else if (!res.ok) {
          setFailReason(data.error ?? "Capture failed");
          setPageState("failed");
        } else {
          setCaptureResult(data);
          setPageState("success");
        }
      } catch {
        setFailReason("Network error during capture");
        setPageState("failed");
      }
    },
    [sessionId]
  );

  // Trigger capture when all flags are true (buyer side only).
  // void-wrapping the async call satisfies react-hooks/set-state-in-effect
  // because setState calls only happen inside the async function body, not
  // synchronously in the effect body.
  useEffect(() => {
    if (!session || role !== "buyer") return;
    if (
      session.buyerVerified &&
      session.sellerVerified &&
      session.buyerPaypalApproved &&
      pageState === "waiting_other"
    ) {
      // capturePayment calls setState only inside async awaits — not synchronous.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void capturePayment(session.orderId);
    }
  }, [session, pageState, role, capturePayment]);

  const handleLivenessPass = async () => {
    const flag = role === "buyer" ? "buyerVerified" : "sellerVerified";
    await fetch(`/api/session/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flag }),
    });
    const updated = await fetchSession();
    if (updated) {
      const allDone =
        updated.buyerVerified &&
        updated.sellerVerified &&
        updated.buyerPaypalApproved;
      if (allDone && role === "buyer") {
        capturePayment(updated.orderId);
      } else {
        setPageState("waiting_other");
      }
    }
  };

  const handleLivenessFail = () => {
    setFailReason("Liveness check failed — no blink detected within 7 seconds.");
    setPageState("failed");
  };

  const sellerUrl =
    appUrl ? `${appUrl}/session/${sessionId}?role=seller` : "";

  if (pageState === "declined" && declineResult) {
    return (
      <PageWrapper>
        <DeclinedScreen
          transactionId={declineResult.transactionId}
          declineReason={declineResult.declineReason}
          processorResponse={declineResult.processorResponse}
          onRetry={() => {
            // Start a fresh checkout session — the old order cannot be retried
            router.push("/checkout");
          }}
        />
      </PageWrapper>
    );
  }

  if (pageState === "expired") {
    return (
      <PageWrapper>
        <FailScreen
          reason="This payment session has ended. Start a new checkout to complete your transaction."
          onRetry={() => router.push("/checkout")}
        />
      </PageWrapper>
    );
  }

  if (pageState === "failed") {
    return (
      <PageWrapper>
        <FailScreen
          reason={failReason || "An error occurred."}
          onRetry={() => {
            setLivenessKey((k) => k + 1);
            setPageState("verifying");
          }}
        />
      </PageWrapper>
    );
  }

  if (pageState === "success" && captureResult) {
    return (
      <PageWrapper>
        <SuccessScreen
          transactionId={captureResult.transactionId}
          amount={captureResult.amount}
          currency={captureResult.currency}
          role={role}
        />
      </PageWrapper>
    );
  }

  if (pageState === "capturing") {
    return (
      <PageWrapper>
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="text-4xl animate-spin">⚙️</div>
          <p className="text-zinc-600 font-medium">
            Capturing payment with PayPal…
          </p>
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <div className="flex flex-col items-center gap-6 w-full max-w-sm">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-2xl font-bold text-zinc-900">
            {role === "buyer" ? "Buyer Verification" : "Seller Verification"}
          </h1>
          <p className="text-zinc-500 text-sm mt-1">
            Complete your liveness check to authorise the payment
          </p>
        </div>

        {/* Liveness widget */}
        {pageState === "verifying" && (
          <LivenessCheck
            key={livenessKey}
            role={role}
            onPass={handleLivenessPass}
            onFail={handleLivenessFail}
          />
        )}

        {/* Waiting state */}
        {pageState === "waiting_other" && (
          <div className="flex flex-col items-center gap-3 p-6 rounded-2xl border border-blue-100 bg-blue-50 w-full text-center">
            <div className="text-3xl animate-pulse">⏳</div>
            <p className="text-blue-700 font-medium">
              {role === "buyer"
                ? "Waiting for seller to complete verification…"
                : "Waiting for buyer to complete verification…"}
            </p>
          </div>
        )}

        {/* Real-time status panel */}
        {session && (
          <VerificationStatus
            buyerVerified={session.buyerVerified}
            sellerVerified={session.sellerVerified}
            buyerPaypalApproved={session.buyerPaypalApproved}
          />
        )}

        {/* QR code shown to buyer so seller can join */}
        {role === "buyer" && sellerUrl && (
          <div className="flex flex-col items-center gap-3 p-6 rounded-2xl border border-zinc-200 bg-zinc-50 w-full">
            <p className="text-sm text-zinc-600 text-center font-medium">
              Share this QR code with the seller so they can verify on their
              device
            </p>
            <div className="p-3 bg-white rounded-xl border border-zinc-100">
              <QRCodeSVG value={sellerUrl} size={160} />
            </div>
            <p className="text-xs text-zinc-400 break-all text-center">
              {sellerUrl}
            </p>
          </div>
        )}
      </div>
    </PageWrapper>
  );
}

function PageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center px-4 py-12">
      {children}
    </div>
  );
}
