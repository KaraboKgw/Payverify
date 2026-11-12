import { NextRequest, NextResponse } from "next/server";
import { APIError, TypeSafeError } from "@typesafe-ai/sdk";
import { evaluateText } from "@/lib/evaluation/evaluate";
import { LIMITS } from "@/lib/evaluation/questions";

// POST /api/evaluate
// Body: { texts: string[] }  or  { text: string }
// Response: { results: Array<{ index, text, evaluation } | { index, text, error }> }
export async function POST(request: NextRequest) {
  if (!process.env.TYPESAFE_API_KEY) {
    return NextResponse.json(
      { error: "TYPESAFE_API_KEY is not set on the server" },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const raw = (body as { texts?: unknown; text?: unknown } | null) ?? {};
  const list = Array.isArray(raw.texts) ? raw.texts : raw.text !== undefined ? [raw.text] : null;
  if (!list || !list.every((t) => typeof t === "string")) {
    return NextResponse.json(
      { error: "Provide `texts` (array of strings) or `text` (string)" },
      { status: 400 },
    );
  }
  const texts = (list as string[]).map((t) => t.trim()).filter(Boolean);
  if (texts.length === 0) {
    return NextResponse.json({ error: "No non-empty texts supplied" }, { status: 400 });
  }
  if (texts.length > LIMITS.maxTexts) {
    return NextResponse.json(
      { error: `At most ${LIMITS.maxTexts} texts per request` },
      { status: 400 },
    );
  }
  if (texts.some((t) => t.length > LIMITS.maxCharsPerText)) {
    return NextResponse.json(
      { error: `Each text must be at most ${LIMITS.maxCharsPerText} characters` },
      { status: 400 },
    );
  }

  // Bounded concurrency. A failed call is reported as an error for that text,
  // never as an answer.
  const results = new Array(texts.length);
  let next = 0;
  async function worker() {
    while (next < texts.length) {
      const index = next++;
      const text = texts[index];
      try {
        results[index] = { index, text, evaluation: await evaluateText(text) };
      } catch (err) {
        console.error("[evaluate]", err);
        const message =
          err instanceof APIError || err instanceof TypeSafeError
            ? err.message
            : "Evaluation failed";
        results[index] = { index, text, error: message };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(LIMITS.concurrency, texts.length) }, worker),
  );

  return NextResponse.json({ results });
}
