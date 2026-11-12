"use client";

import { useState } from "react";
import type { Evaluation } from "@/lib/evaluation/evaluate";

type Item =
  | { index: number; text: string; evaluation: Evaluation }
  | { index: number; text: string; error: string };

const BAND_STYLE: Record<string, string> = {
  low: "bg-green-50 text-green-700 border-green-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  high: "bg-red-50 text-red-700 border-red-200",
};

const READING_STYLE: Record<string, string> = {
  yes: "text-red-700 font-semibold",
  unsettled: "text-amber-700",
  no: "text-zinc-400",
};

const label = (s: string) => s.replace(/_/g, " ");

function Badge({ band, children }: { band: string; children: React.ReactNode }) {
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded border ${BAND_STYLE[band]}`}>
      {children}
    </span>
  );
}

function Result({ item }: { item: Item }) {
  if ("error" in item) {
    return (
      <li className="border border-red-200 rounded-lg p-4 bg-red-50 text-sm text-red-700">
        <p className="font-medium">Text {item.index + 1}: evaluation failed</p>
        <p className="mt-1">{item.error}</p>
      </li>
    );
  }
  const e = item.evaluation;
  const signals = Object.entries(e.signals).filter(([k]) => k !== "has_listed_topic");
  return (
    <li className="border border-zinc-200 rounded-lg p-4 bg-white">
      <p className="text-sm text-zinc-700 whitespace-pre-wrap line-clamp-4">{item.text}</p>

      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <span>
          Fraud risk <Badge band={e.fraud.band}>{e.fraud.band} · {e.fraud.risk.toFixed(2)}</Badge>
        </span>
        <span>
          Support priority{" "}
          <Badge band={e.priority.band}>{e.priority.band} · {e.priority.value.toFixed(2)}</Badge>
        </span>
        {e.topicApplies && (
          <span className="text-zinc-600">Topic: {label(e.primaryTopic.choice)}</span>
        )}
      </div>

      <div className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
        {signals.map(([name, s]) => (
          <div key={name} className="flex justify-between gap-2">
            <span className="text-zinc-600">{label(name)}</span>
            <span className={READING_STYLE[s.reading]}>
              {s.probability.toFixed(2)} {s.reading === "unsettled" ? "?" : ""}
            </span>
          </div>
        ))}
        {Object.entries(e.scores).map(([name, s]) => (
          <div key={name} className="flex justify-between gap-2">
            <span className="text-zinc-600">{label(name)} (0–4)</span>
            <span>{s.score.toFixed(2)}</span>
          </div>
        ))}
      </div>

      {e.unsettled.length > 0 && (
        <p className="mt-3 text-xs text-amber-700">
          Unsettled (between thresholds): {e.unsettled.map(label).join(", ")}
        </p>
      )}
      <p className="mt-2 text-xs text-zinc-400">{e.model}</p>
    </li>
  );
}

export default function EvaluatePage() {
  const [input, setInput] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One text per blank-line-separated block.
  const texts = input
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const content = await file.text();
    if (file.name.endsWith(".json")) {
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed) && parsed.every((t) => typeof t === "string")) {
          setInput(parsed.join("\n\n"));
          return;
        }
      } catch {
        /* fall through to plain text */
      }
    }
    setInput(content);
  }

  async function run() {
    setLoading(true);
    setError(null);
    setItems([]);
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setItems(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold text-zinc-900">Text evaluation</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Jev judges each text on narrow fraud-signal and customer-message questions; fraud risk and
        support priority are computed in code from those answers.
      </p>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={10}
        placeholder="Paste texts here. Separate multiple texts with a blank line."
        className="mt-6 w-full border border-zinc-300 rounded-lg p-3 text-sm text-zinc-900"
      />

      <div className="mt-3 flex items-center gap-4">
        <button
          onClick={run}
          disabled={loading || texts.length === 0}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-40"
        >
          {loading ? "Evaluating…" : `Evaluate ${texts.length} text${texts.length === 1 ? "" : "s"}`}
        </button>
        <label className="text-sm text-zinc-600">
          Upload .txt or .json (array of strings){" "}
          <input
            type="file"
            accept=".txt,.json,text/plain,application/json"
            onChange={(e) => onFile(e.target.files?.[0])}
            className="block mt-1 text-xs"
          />
        </label>
      </div>

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

      <ul className="mt-8 space-y-4">
        {items.map((item) => (
          <Result key={item.index} item={item} />
        ))}
      </ul>
    </main>
  );
}
