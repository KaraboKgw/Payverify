"use client";

interface VerificationStatusProps {
  buyerVerified: boolean;
  sellerVerified: boolean;
  buyerPaypalApproved: boolean;
}

export default function VerificationStatus({
  buyerVerified,
  sellerVerified,
  buyerPaypalApproved,
}: VerificationStatusProps) {
  return (
    <div className="flex flex-col gap-2 w-full max-w-sm">
      <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-widest mb-1">
        Session Status
      </h3>
      <StatusRow
        label="Buyer PayPal Approval"
        done={buyerPaypalApproved}
      />
      <StatusRow label="Buyer Liveness" done={buyerVerified} />
      <StatusRow label="Seller Liveness" done={sellerVerified} />
    </div>
  );
}

function StatusRow({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2 rounded-xl border border-zinc-100 bg-zinc-50">
      <span className="text-sm text-zinc-700">{label}</span>
      <span
        className={`text-sm font-semibold ${done ? "text-green-600" : "text-amber-500"}`}
      >
        {done ? "✓ Done" : "⏳ Waiting"}
      </span>
    </div>
  );
}
