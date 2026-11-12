"use client";

interface SuccessScreenProps {
  transactionId: string;
  amount: string;
  currency: string;
  role: "buyer" | "seller";
}

export default function SuccessScreen({
  transactionId,
  amount,
  currency,
  role,
}: SuccessScreenProps) {
  const now = new Date().toLocaleString();

  return (
    <div className="flex flex-col items-center gap-6 p-8 rounded-2xl border border-green-200 bg-green-50 max-w-sm w-full text-center">
      <div className="text-5xl">🎉</div>
      <div>
        <h2 className="text-2xl font-bold text-green-800">Payment Captured!</h2>
        <p className="text-green-700 mt-1 text-sm">
          {role === "buyer"
            ? "Your payment was processed successfully."
            : "Payment received successfully."}
        </p>
      </div>

      <div className="w-full bg-white rounded-xl border border-green-100 divide-y divide-green-100 text-left">
        <Row label="Amount" value={`${currency} ${amount}`} />
        <Row label="Transaction ID" value={transactionId} mono />
        <Row label="Date / Time" value={now} />
        <Row
          label="Environment"
          value="PayPal Sandbox"
          badge
          badgeColor="text-blue-700 bg-blue-50"
        />
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  badge,
  badgeColor,
}: {
  label: string;
  value: string;
  mono?: boolean;
  badge?: boolean;
  badgeColor?: string;
}) {
  return (
    <div className="flex justify-between items-center px-4 py-3 gap-4">
      <span className="text-xs text-zinc-500 shrink-0">{label}</span>
      {badge ? (
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badgeColor}`}
        >
          {value}
        </span>
      ) : (
        <span
          className={`text-sm text-right break-all ${mono ? "font-mono text-xs" : "font-medium text-zinc-800"}`}
        >
          {value}
        </span>
      )}
    </div>
  );
}
