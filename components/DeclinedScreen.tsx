"use client";

interface ProcessorInfo {
  responseCode: string | null;
  avsCode: string | null;
  cvvCode: string | null;
  humanReadable: string | null;
}

interface DeclinedScreenProps {
  transactionId: string;
  declineReason: string;
  processorResponse: ProcessorInfo | null;
  onRetry?: () => void;
}

// Rejection trigger reference for sandbox testing
// Source: PayPal card testing docs
const REJECTION_TRIGGERS = [
  { trigger: "CCREJECT-REFUSED",    code: "0500", description: "Card refused (DO_NOT_HONOR)" },
  { trigger: "CCREJECT-SF",         code: "9500", description: "Fraudulent card (SUSPECTED_FRAUD)" },
  { trigger: "CCREJECT-EC",         code: "5400", description: "Card expired (EXPIRED_CARD)" },
  { trigger: "CCREJECT-INC",        code: "5100", description: "Luhn check fails (INVALID_OR_RESTRICTED_CARD)" },
  { trigger: "CCREJECT-IF",         code: "5120", description: "Insufficient funds" },
  { trigger: "CCREJECT-LS",         code: "9520", description: "Card lost or stolen" },
  { trigger: "CCREJECT-IA",         code: "1338", description: "Card not valid (INVALID_ACCOUNT)" },
  { trigger: "CCREJECT-BANK_ERROR", code: "5180", description: "Card declined by bank (GENERIC_DECLINE)" },
  { trigger: "CCREJECT-CVV-F",      code: "00N7", description: "CVV check failed" },
];

export default function DeclinedScreen({
  transactionId,
  declineReason,
  processorResponse,
  onRetry,
}: DeclinedScreenProps) {
  return (
    <div className="flex flex-col items-center gap-6 p-8 rounded-2xl border border-orange-200 bg-orange-50 max-w-md w-full text-center">
      <div className="text-5xl">🚫</div>

      <div>
        <h2 className="text-2xl font-bold text-orange-900">Payment Declined</h2>
        <p className="text-orange-800 mt-2 text-sm leading-relaxed">{declineReason}</p>
      </div>

      {/* Processor response codes */}
      {processorResponse &&
        (processorResponse.responseCode ||
          processorResponse.avsCode ||
          processorResponse.cvvCode) && (
          <div className="w-full bg-white rounded-xl border border-orange-100 divide-y divide-orange-50 text-left">
            <div className="px-4 py-2">
              <span className="text-xs font-semibold text-orange-600 uppercase tracking-widest">
                Processor Response
              </span>
            </div>
            {processorResponse.responseCode && (
              <CodeRow label="Response Code" value={processorResponse.responseCode} />
            )}
            {processorResponse.avsCode && (
              <CodeRow label="AVS Code" value={processorResponse.avsCode} />
            )}
            {processorResponse.cvvCode && (
              <CodeRow label="CVV Code" value={processorResponse.cvvCode} />
            )}
            {transactionId !== "unknown" && (
              <CodeRow label="Capture ID" value={transactionId} mono />
            )}
          </div>
        )}

      {/* Sandbox testing hint */}
      <div className="w-full p-4 rounded-xl bg-blue-50 border border-blue-100 text-left">
        <p className="text-xs font-semibold text-blue-700 uppercase tracking-widest mb-2">
          Sandbox Testing
        </p>
        <p className="text-xs text-blue-700 mb-3 leading-relaxed">
          Use test card{" "}
          <code className="font-mono bg-blue-100 px-1 rounded">4012 8888 8888 1881</code>{" "}
          (Visa) with a future expiry and any 3-digit CVV for a successful payment.
          To simulate a decline, enter a rejection trigger in the cardholder name field:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-blue-100 text-blue-800">
                <th className="text-left px-2 py-1 font-semibold">Name on Card</th>
                <th className="text-left px-2 py-1 font-semibold">Code</th>
                <th className="text-left px-2 py-1 font-semibold">Reason</th>
              </tr>
            </thead>
            <tbody>
              {REJECTION_TRIGGERS.map((t) => (
                <tr key={t.trigger} className="border-t border-blue-100">
                  <td className="px-2 py-1 font-mono text-blue-900">{t.trigger}</td>
                  <td className="px-2 py-1 text-zinc-600">{t.code}</td>
                  <td className="px-2 py-1 text-zinc-600">{t.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 px-6 py-2 rounded-full bg-orange-600 text-white font-semibold hover:bg-orange-700 transition-colors"
        >
          Try Another Card
        </button>
      )}
    </div>
  );
}

function CodeRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between items-center px-4 py-2 gap-4">
      <span className="text-xs text-zinc-500 shrink-0">{label}</span>
      <span
        className={`text-xs font-mono text-right break-all ${mono ? "text-zinc-600" : "text-orange-800 font-semibold"}`}
      >
        {value}
      </span>
    </div>
  );
}
