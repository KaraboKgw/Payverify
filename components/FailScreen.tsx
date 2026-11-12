"use client";

interface FailScreenProps {
  reason: string;
  onRetry?: () => void;
}

export default function FailScreen({ reason, onRetry }: FailScreenProps) {
  return (
    <div className="flex flex-col items-center gap-6 p-8 rounded-2xl border border-red-200 bg-red-50 max-w-sm w-full text-center">
      <div className="text-5xl">⚠️</div>
      <div>
        <h2 className="text-2xl font-bold text-red-800">Payment Not Captured</h2>
        <p className="text-red-700 mt-2 text-sm">{reason}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 px-6 py-2 rounded-full bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors"
        >
          Try Again
        </button>
      )}
    </div>
  );
}
