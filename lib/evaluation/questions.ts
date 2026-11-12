// All question wording, weights, and thresholds for text evaluation live here
// so they can be audited and edited in one place.
//
// Jev only makes narrow judgments about `text`. The decisions (risk bands,
// composite scores) are made in code in ./evaluate.ts using the weights below.

import { choice, noul, score } from "@typesafe-ai/sdk";

/** Pinned so thresholds tuned here don't silently shift with an alias move. */
export const MODEL = "jev-1.14.0";

export const LIMITS = {
  maxTexts: 50,
  maxCharsPerText: 8000,
  concurrency: 4,
} as const;

/** Noul above HIGH reads as yes, below LOW as no; in between is "unsettled". */
export const NOUL_THRESHOLDS = { low: 0.3, high: 0.7 } as const;

export const questions = {
  // ---- Scam / fraud signals (Noul: several can be true at once) ----
  pressure_to_act_fast: noul(
    "Does `text` pressure the reader to act or pay immediately, or threaten consequences if they delay?",
  ),
  off_platform_payment: noul(
    "Does `text` ask the reader to pay or communicate outside the platform, for example by gift card, wire transfer, crypto, or a friends-and-family payment?",
  ),
  asks_for_credentials: noul(
    "Does `text` ask the reader to share a password, one-time code, card number, or other login or payment secret?",
  ),
  too_good_to_be_true: noul(
    "Does `text` promise something that sounds too good to be true, such as a far-below-market price, guaranteed profit, or an unexpected prize?",
  ),
  impersonates_authority: noul(
    "Does the sender of `text` claim to be PayPal, a bank, a government body, or official support staff in order to be trusted?",
  ),
  overpayment_refund_trick: noul(
    "Does `text` say too much money was sent and ask for the difference to be returned or forwarded?",
  ),

  // ---- Customer message dimensions ----
  frustration: score("How upset is the sender of `text`?", [
    "Neutral or positive; no sign of being upset",
    "Mild annoyance, or a minor inconvenience is mentioned",
    "Clearly frustrated about a problem",
    "Angry, using strong language or complaining repeatedly",
    "Furious or abusive, or says they are leaving for good",
  ]),
  problem_impact: score(
    "How much harm has the sender suffered from the problem described in `text`?",
    [
      "No problem is described",
      "A minor inconvenience; nothing is lost",
      "A delay or hassle, but no money or goods are lost",
      "Money or goods are lost or unavailable to the sender",
      "A large financial loss, or an account locked with funds inside it",
    ],
  ),
  requests_refund: noul("Does the sender of `text` ask for their money back?", {
    true: "The sender asks for a refund or reimbursement, or asks for a payment to be reversed",
    false: "The sender only asks about, or comments on, the refund policy, or does not mention refunds",
  }),
  threatens_chargeback: noul(
    "Does the sender of `text` say they will dispute the payment with their bank or card issuer?",
  ),
  threatens_legal_action: noul(
    "Does the sender of `text` threaten legal action or a report to a regulator?",
  ),
  wants_human: noul("Does the sender of `text` ask to speak with a person?"),

  // Choice always picks an option, so it is paired with a Noul for "nothing fits".
  primary_topic: choice("What is `text` mainly about?", {
    refund_request: null,
    payment_dispute: null,
    shipping_problem: null,
    account_access: null,
    product_quality: null,
    payment_failure: null,
    praise: null,
    general_question: null,
  }),
  has_listed_topic: noul(
    "Is `text` about a customer's purchase, payment, account, or experience with a seller or service?",
  ),
};

export type QuestionName = keyof typeof questions;

// ---- Composite weights (code-owned; tune freely) ----

/**
 * Per-signal strength in 0..1. Fraud risk is a noisy-OR:
 *   risk = 1 - prod(1 - strength_i * p_i)
 * so one strong signal (e.g. asking for a one-time code) is enough to raise the
 * risk, and several weaker signals add up.
 */
export const FRAUD_STRENGTH = {
  asks_for_credentials: 0.9,
  overpayment_refund_trick: 0.9,
  off_platform_payment: 0.8,
  impersonates_authority: 0.7,
  too_good_to_be_true: 0.6,
  pressure_to_act_fast: 0.5,
} as const satisfies Partial<Record<QuestionName, number>>;

export const FRAUD_BANDS = { medium: 0.3, high: 0.6 } as const;

/** Support priority is a weighted sum of 0..1 inputs; weights sum to 1. */
export const PRIORITY_WEIGHTS = {
  problem_impact: 0.3, // score / 4
  frustration: 0.2, // score / 4
  threatens_chargeback: 0.15, // noul
  threatens_legal_action: 0.15, // noul
  requests_refund: 0.1, // noul
  wants_human: 0.1, // noul
} as const satisfies Partial<Record<QuestionName, number>>;

export const PRIORITY_BANDS = { medium: 0.3, high: 0.6 } as const;

/** Highest score level for the Score questions above (5 levels, 0..4). */
export const SCORE_MAX = 4;
