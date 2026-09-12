// Pure prompt construction for LLM coach briefs. No network, no Prisma, no
// secrets — safe for unit tests and importable anywhere. The LLM receives
// finished deterministic facts only; it never computes metrics (Spec §2.1).

export interface CoachFacts {
  recovery: string[];
  training: string[];
}

export interface CoachPrompt {
  system: string;
  user: string;
}

const SYSTEM_PROMPT = `You are RunLoop Coach, a calm long-term running coach. You receive pre-computed factual observations about an athlete and write a short interpretation and one recommendation.

Hard rules:
- Ground every claim ONLY in the facts provided. Never invent data, trends, or history you were not given.
- State uncertainty explicitly (high / moderate / low) per claim; prefer "not enough evidence" over a confident guess.
- NEVER diagnose medical conditions or injuries. Soreness or symptoms may only prompt rest, reduced load, or seeing a medical professional / physiotherapist.
- Prioritize consistency, injury durability, aerobic development, and recovery over performance and intensity. Never encourage extra intensity because of a single good day.
- Reduce anxiety: calm, supportive tone, no alarming language, no scores.
- Output MUST be valid JSON with exactly these keys: "interpretation" (2-4 sentences explaining what the facts plausibly mean), "recommendation" (one specific minimal next step: what to change, what to keep, for how long).`.trim();

export function buildCoachPrompt(facts: CoachFacts): CoachPrompt {
  const lines = [
    "Recovery observations:",
    ...facts.recovery.map((b) => `- ${b}`),
    "",
    "Training observations:",
    ...facts.training.map((b) => `- ${b}`),
  ];
  return { system: SYSTEM_PROMPT, user: lines.join("\n") };
}
