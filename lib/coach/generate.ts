// Server-only LLM generation layer (imports Prisma + secrets — never import
// from client components). MVP flow: build prompt from deterministic facts,
// one Foundry chat call with a capped JSON response, validate, persist the
// full audit row (sent facts, produced text, model name).

import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import type { CoachBrief } from "@/generated/prisma/client";
import { buildCoachPrompt, type CoachFacts } from "./prompt";

export interface BriefResult {
  interpretation: string;
  recommendation: string;
}

// Injectable chat transport so unit tests never touch the network.
export interface BriefChatClient {
  complete(system: string, user: string): Promise<unknown>;
}

export class BriefGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BriefGenerationError";
  }
}

interface FoundryConfig {
  endpoint: string; // full OpenAI-compatible base URL, e.g. https://<resource>.services.ai.azure.com/openai/v1/
  apiKey: string;
  deployment: string;
}

export function getFoundryConfig(): FoundryConfig {
  const endpoint = process.env.FOUNDRY_ENDPOINT?.trim();
  const apiKey = process.env.FOUNDRY_API_KEY?.trim();
  const deployment = process.env.FOUNDRY_DEPLOYMENT?.trim();
  if (!endpoint || !apiKey || !deployment) {
    throw new BriefGenerationError(
      "AI coaching is not configured. Set FOUNDRY_ENDPOINT, FOUNDRY_API_KEY and FOUNDRY_DEPLOYMENT.",
    );
  }
  return { endpoint, apiKey, deployment };
}

// Accepts either the AI Services account base
// (https://<account>.services.ai.azure.com/openai/v1/) or a Foundry project
// endpoint (https://<account>.services.ai.azure.com/api/projects/<name>)
// and resolves the OpenAI-compatible inference base in both cases.
export function resolveInferenceBaseUrl(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  const projectIndex = trimmed.indexOf("/api/projects/");
  if (projectIndex !== -1) return `${trimmed.slice(0, projectIndex)}/openai/v1/`;
  return trimmed.endsWith("/openai/v1") ? `${trimmed}/` : `${trimmed}/openai/v1/`;
}

export function createFoundryClient(config: FoundryConfig): BriefChatClient {
  const client = new OpenAI({
    baseURL: resolveInferenceBaseUrl(config.endpoint),
    apiKey: config.apiKey,
  });
  return {
    async complete(system: string, user: string): Promise<unknown> {
      const res = await client.chat.completions.create({
        model: config.deployment,
        temperature: 0.3,
        max_tokens: 400,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      const content = res.choices[0]?.message?.content;
      if (!content) throw new BriefGenerationError("The model returned an empty response.");
      try {
        return JSON.parse(content) as unknown;
      } catch {
        throw new BriefGenerationError("The model returned invalid JSON.");
      }
    },
  };
}

const MAX_BRIEF_FIELD_CHARS = 4000;

function validateBrief(value: unknown): BriefResult {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as Record<string, unknown>).interpretation !== "string" ||
    typeof (value as Record<string, unknown>).recommendation !== "string" ||
    (value as { interpretation: string }).interpretation.trim() === "" ||
    (value as { recommendation: string }).recommendation.trim() === ""
  ) {
    throw new BriefGenerationError("The model response was missing interpretation or recommendation.");
  }
  const { interpretation, recommendation } = value as {
    interpretation: string;
    recommendation: string;
  };
  // Length-bounded: max_tokens caps the live path, but the injectable client
  // path has no such cap — never persist unbounded text into TEXT columns.
  if (
    interpretation.length > MAX_BRIEF_FIELD_CHARS ||
    recommendation.length > MAX_BRIEF_FIELD_CHARS
  ) {
    throw new BriefGenerationError("The model response was unexpectedly long.");
  }
  return { interpretation: interpretation.trim(), recommendation: recommendation.trim() };
}

// One full generation: prompt -> model -> validate -> persist audit row.
// Every call stores a new row; newest wins for display. The persisted model
// is always the deployment that actually ran — no override parameter, so the
// audit row can never claim a model that wasn't used.
export async function generateAndSaveBrief(
  userId: string,
  facts: CoachFacts,
  client?: BriefChatClient,
): Promise<CoachBrief> {
  const config = getFoundryConfig();
  const chat = client ?? createFoundryClient(config);
  const model = config.deployment;
  const prompt = buildCoachPrompt(facts);

  let raw: unknown;
  try {
    raw = await chat.complete(prompt.system, prompt.user);
  } catch (err) {
    if (err instanceof BriefGenerationError) throw err;
    throw new BriefGenerationError(
      "Could not reach the AI service. Please try again later.",
    );
  }
  const brief = validateBrief(raw);

  return prisma.coachBrief.create({
    data: {
      userId,
      facts: { recovery: facts.recovery, training: facts.training },
      interpretation: brief.interpretation,
      recommendation: brief.recommendation,
      model,
    },
  });
}
