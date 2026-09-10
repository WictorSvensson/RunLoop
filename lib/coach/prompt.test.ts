import { describe, expect, it } from "vitest";
import { buildCoachPrompt } from "@/lib/coach/prompt";

const FACTS = {
  recovery: ["Average energy 3.4/5 across 10 check-ins in the last 14 days."],
  training: ["Volume up 12% (30 km/week vs 27 km/week)."],
};

describe("buildCoachPrompt", () => {
  it("embeds every fact verbatim in the user message", () => {
    const prompt = buildCoachPrompt(FACTS);
    for (const bullet of [...FACTS.recovery, ...FACTS.training]) {
      expect(prompt.user).toContain(bullet);
    }
  });

  it("labels recovery and training sections", () => {
    const prompt = buildCoachPrompt(FACTS);
    expect(prompt.user).toContain("Recovery observations:");
    expect(prompt.user).toContain("Training observations:");
  });

  it("encodes the safety and grounding contract in the system prompt", () => {
    const { system } = buildCoachPrompt(FACTS);
    expect(system).toContain("ONLY in the facts provided");
    expect(system).toContain("NEVER diagnose");
    expect(system).toContain("uncertainty explicitly");
    expect(system).toContain('"interpretation"');
    expect(system).toContain('"recommendation"');
  });

  it("encodes the conservative coaching philosophy", () => {
    const { system } = buildCoachPrompt(FACTS);
    expect(system).toContain("consistency");
    expect(system).toMatch(/intensity/i);
  });
});
