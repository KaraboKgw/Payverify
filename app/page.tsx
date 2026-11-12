import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-6 py-16 text-center">
      {/* Badge */}
      <span className="mb-6 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-semibold uppercase tracking-widest">
        PayPal Sandbox · AI Liveness
      </span>

      {/* Headline */}
      <h1 className="text-4xl sm:text-5xl font-extrabold text-zinc-900 leading-tight max-w-xl">
        PayVerify
        <br />
        <span className="text-blue-600">AI-Gated Dual-Party Payment</span>
      </h1>

      <p className="mt-5 max-w-lg text-zinc-500 text-lg leading-relaxed">
        A PayPal payment is only captured after{" "}
        <strong className="text-zinc-800">both</strong> the buyer and seller
        independently pass a real-time AI liveness check — right in the browser,
        with no face data leaving the device.
      </p>

      {/* How it works */}
      <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl w-full text-left">
        <StepCard
          step="1"
          icon="💳"
          title="Create Payment"
          body="Buyer enters amount and approves with PayPal sandbox account."
        />
        <StepCard
          step="2"
          icon="👁"
          title="Both Parties Blink"
          body="Buyer and seller each complete a real-time liveness blink check."
        />
        <StepCard
          step="3"
          icon="✅"
          title="Payment Captured"
          body="Only after both verifications pass does the server capture the payment."
        />
      </div>

      {/* CTA */}
      <Link
        href="/checkout"
        className="mt-10 inline-flex items-center gap-2 px-8 py-3 rounded-full bg-blue-600 text-white font-semibold text-lg hover:bg-blue-700 transition-colors shadow-sm"
      >
        Create Payment Session →
      </Link>

      {/* Sandbox notice */}
      <p className="mt-6 text-xs text-zinc-400">
        Running in PayPal Sandbox mode — no real money is moved.
      </p>
    </main>
  );
}

function StepCard({
  step,
  icon,
  title,
  body,
}: {
  step: string;
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col gap-2 p-5 rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-2xl">{icon}</span>
        <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
          Step {step}
        </span>
      </div>
      <h3 className="font-semibold text-zinc-800">{title}</h3>
      <p className="text-sm text-zinc-500 leading-relaxed">{body}</p>
    </div>
  );
}
