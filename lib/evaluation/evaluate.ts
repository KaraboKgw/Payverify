// Calls Jev for the narrow judgments, then makes every decision in code.

import { TypeSafeClient } from "@typesafe-ai/sdk";
import {
  FRAUD_BANDS,
  FRAUD_STRENGTH,
  MODEL,
  NOUL_THRESHOLDS,
  PRIORITY_BANDS,
  PRIORITY_WEIGHTS,
  SCORE_MAX,
  questions,
} from "./questions";

export type Band = "low" | "medium" | "high";
export type NoulReading = "yes" | "no" | "unsettled";

export interface NoulResult {
  probability: number;
  reading: NoulReading;
}

export interface ScoreResult {
  /** Expected level, 0..SCORE_MAX. */
  score: number;
  /** Probability per level, index = level. */
  probabilities: number[];
}

export interface Evaluation {
  signals: Record<string, NoulResult>;
  scores: Record<string, ScoreResult>;
  primaryTopic: { choice: string; probabilities: Record<string, number> };
  /** False when Jev says the text isn't a customer/payment text, so topic is unreliable. */
  topicApplies: boolean;
  fraud: { risk: number; band: Band; contributions: Record<string, number> };
  priority: { value: number; band: Band; contributions: Record<string, number> };
  /** Signals whose Noul landed between the thresholds; worth a human look. */
  unsettled: string[];
  model: string;
}

let client: TypeSafeClient | undefined;
function getClient(): TypeSafeClient {
  // Throws if TYPESAFE_API_KEY is missing; the route surfaces that as an error.
  client ??= new TypeSafeClient({ defaultModel: MODEL });
  return client;
}

export function readNoul(p: number): NoulReading {
  if (p > NOUL_THRESHOLDS.high) return "yes";
  if (p < NOUL_THRESHOLDS.low) return "no";
  return "unsettled";
}

function band(value: number, bands: { medium: number; high: number }): Band {
  if (value >= bands.high) return "high";
  if (value >= bands.medium) return "medium";
  return "low";
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export async function evaluateText(text: string): Promise<Evaluation> {
  const { answers, model } = await getClient().systemOne({
    state: { text },
    questions,
  });

  const signals: Record<string, NoulResult> = {};
  const scores: Record<string, ScoreResult> = {};
  for (const [name, answer] of Object.entries(answers)) {
    if (answer.type === "noul") {
      signals[name] = { probability: answer.noul, reading: readNoul(answer.noul) };
    } else if (answer.type === "score") {
      const probs = Object.entries(answer.probabilities)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, p]) => p as number);
      scores[name] = { score: answer.score, probabilities: probs };
    }
  }

  // Fraud: noisy-OR over weighted signals.
  const fraudContrib: Record<string, number> = {};
  let none = 1;
  for (const [name, strength] of Object.entries(FRAUD_STRENGTH)) {
    const c = strength * signals[name].probability;
    fraudContrib[name] = round(c);
    none *= 1 - c;
  }
  const fraudRisk = 1 - none;

  // Priority: weighted sum of normalized inputs (0..1).
  const priorityContrib: Record<string, number> = {};
  let priority = 0;
  for (const [name, weight] of Object.entries(PRIORITY_WEIGHTS)) {
    const input =
      name in scores ? scores[name].score / SCORE_MAX : signals[name].probability;
    const c = weight * input;
    priorityContrib[name] = round(c);
    priority += c;
  }

  const unsettled = Object.entries(signals)
    .filter(([, s]) => s.reading === "unsettled")
    .map(([name]) => name);

  const topic = answers.primary_topic;
  return {
    signals,
    scores,
    primaryTopic: { choice: topic.choice, probabilities: { ...topic.probabilities } },
    topicApplies: signals.has_listed_topic.reading !== "no",
    fraud: { risk: round(fraudRisk), band: band(fraudRisk, FRAUD_BANDS), contributions: fraudContrib },
    priority: {
      value: round(priority),
      band: band(priority, PRIORITY_BANDS),
      contributions: priorityContrib,
    },
    unsettled,
    model,
  };
}
