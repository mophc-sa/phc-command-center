import { z } from "zod";
export const EvaluationAnswerSchema = z
  .object({
    facts: z.array(z.object({ key: z.string(), value: z.number().nullable() }).strict()).max(30),
    source_ids: z.array(z.string()).max(30),
    answer: z.string().min(1).max(1800),
    next_actions: z.array(z.string().min(1).max(400)).max(6),
    abstained: z.boolean(),
  })
  .strict();
export type EvaluationAnswer = z.infer<typeof EvaluationAnswerSchema>;
export type EvaluationExpected = {
  facts: Record<string, number | null>;
  source_ids: string[];
  abstained: boolean;
};
export function gradeEvaluation(answer: EvaluationAnswer, expected: EvaluationExpected) {
  const facts = Object.fromEntries(answer.facts.map((f) => [f.key, f.value]));
  const entries = Object.entries(expected.facts);
  const correct = entries.filter(
    ([k, v]) =>
      Object.hasOwn(facts, k) &&
      (v === null
        ? facts[k] === null
        : typeof facts[k] === "number" && Math.abs(facts[k]! - v) < 0.005),
  ).length;
  const exactKeys =
    new Set(answer.facts.map((f) => f.key)).size === answer.facts.length &&
    Object.keys(facts).length === entries.length;
  const citations =
    JSON.stringify([...new Set(answer.source_ids)].sort()) ===
    JSON.stringify([...expected.source_ids].sort());
  return {
    numerical_accuracy: entries.length ? correct / entries.length : 1,
    exact_fact_set: exactKeys,
    citations_valid: citations,
    abstention_correct: answer.abstained === expected.abstained,
    passed:
      correct === entries.length &&
      exactKeys &&
      citations &&
      answer.abstained === expected.abstained,
  };
}
/** Standard, uncached token estimate; never represented as a provider invoice. */
export function estimateAiCost(model: string, input?: number, output?: number) {
  const prices: Record<string, [number, number]> = {
    "gpt-4o-mini": [0.15, 0.6],
    "gpt-4.1-mini": [0.4, 1.6],
    "claude-sonnet-4-6": [3, 15],
  };
  const price = prices[model];
  return !price || input == null || output == null
    ? { usd: null, basis: "Price or token usage unavailable; not zero" }
    : {
        usd: (input * price[0] + output * price[1]) / 1000000,
        basis: `${model.startsWith("claude-") ? "Anthropic" : "OpenAI"} model pricing verified 2026-09-08; USD per 1M input/output: ${price.join("/")}; uncached estimate, not invoice`,
      };
}
