import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  BriefGenerationError,
  generateAndSaveBrief,
  getFoundryConfig,
  resolveInferenceBaseUrl,
  type BriefChatClient,
} from "@/lib/coach/generate";

const FACTS = { recovery: ["Energy 3.4/5."], training: ["Volume up 12%."] };

function fakeClient(response: unknown): BriefChatClient {
  return { complete: async () => response };
}

// generateAndSaveBrief persists via Prisma — stub the generated client's
// create so tests never touch the database.
vi.mock("@/generated/prisma/client", () => ({
  PrismaClient: class {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    coachBrief: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: "brief-1",
        ...data,
        createdAt: new Date("2026-09-10T12:00:00.000Z"),
      }),
    },
  },
}));

const ENV_BACKUP = { ...process.env };

beforeEach(() => {
  process.env.FOUNDRY_ENDPOINT = "https://example.services.ai.azure.com/openai/v1/";
  process.env.FOUNDRY_API_KEY = "test-key";
  process.env.FOUNDRY_DEPLOYMENT = "gpt-4o-mini-test";
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
});

describe("getFoundryConfig", () => {
  it("throws a friendly error when secrets are missing", () => {
    delete process.env.FOUNDRY_API_KEY;
    expect(() => getFoundryConfig()).toThrow(BriefGenerationError);
  });

  it("treats whitespace-only env values as missing", () => {
    process.env.FOUNDRY_API_KEY = "   ";
    expect(() => getFoundryConfig()).toThrow(BriefGenerationError);
    process.env.FOUNDRY_API_KEY = "test-key";
    process.env.FOUNDRY_ENDPOINT = "  ";
    expect(() => getFoundryConfig()).toThrow(BriefGenerationError);
  });
});

describe("resolveInferenceBaseUrl", () => {
  it("strips a Foundry project endpoint to the account inference base", () => {
    expect(
      resolveInferenceBaseUrl(
        "https://myacct.services.ai.azure.com/api/projects/wisv-proj",
      ),
    ).toBe("https://myacct.services.ai.azure.com/openai/v1/");
  });

  it("accepts an account base with or without trailing slash", () => {
    expect(
      resolveInferenceBaseUrl("https://myacct.services.ai.azure.com/openai/v1/"),
    ).toBe("https://myacct.services.ai.azure.com/openai/v1/");
    expect(
      resolveInferenceBaseUrl("https://myacct.services.ai.azure.com/openai/v1"),
    ).toBe("https://myacct.services.ai.azure.com/openai/v1/");
  });

  it("never throws on garbage input (pure string ops, no URL parsing)", () => {
    expect(() => resolveInferenceBaseUrl("")).not.toThrow();
    expect(() => resolveInferenceBaseUrl("not-a-url")).not.toThrow();
    expect(resolveInferenceBaseUrl("")).toBe("/openai/v1/");
    expect(resolveInferenceBaseUrl("not-a-url")).toBe(
      "not-a-url/openai/v1/",
    );
  });

  it("trims whitespace and collapses trailing slashes", () => {
    expect(
      resolveInferenceBaseUrl("  https://myacct.services.ai.azure.com/openai/v1///  "),
    ).toBe("https://myacct.services.ai.azure.com/openai/v1/");
  });
});

describe("generateAndSaveBrief", () => {
  it("persists facts, produced text, and model name", async () => {
    const row = await generateAndSaveBrief(
      "user-1",
      FACTS,
      fakeClient({ interpretation: "Steady base.", recommendation: "Hold volume." }),
    );

    expect(row.interpretation).toBe("Steady base.");
    expect(row.recommendation).toBe("Hold volume.");
    expect(row.model).toBe("gpt-4o-mini-test");
    expect(row.facts).toEqual(FACTS);
    expect(row.userId).toBe("user-1");
  });

  it("rejects responses missing required fields", async () => {
    await expect(
      generateAndSaveBrief("user-1", FACTS, fakeClient({ interpretation: "Only half." })),
    ).rejects.toThrow(BriefGenerationError);
  });

  it("passes valid JSON through with trimmed text and tolerates extra keys", async () => {
    const row = await generateAndSaveBrief(
      "user-1",
      FACTS,
      fakeClient({
        interpretation: "  Steady base.  ",
        recommendation: "\nHold volume.\n",
        extra: "ignored",
      }),
    );
    expect(row.interpretation).toBe("Steady base.");
    expect(row.recommendation).toBe("Hold volume.");
  });

  it("rejects whitespace-only interpretation or recommendation", async () => {
    await expect(
      generateAndSaveBrief(
        "user-1",
        FACTS,
        fakeClient({ interpretation: "   ", recommendation: "Hold volume." }),
      ),
    ).rejects.toThrow(BriefGenerationError);
    await expect(
      generateAndSaveBrief(
        "user-1",
        FACTS,
        fakeClient({ interpretation: "Steady base.", recommendation: "  \n " }),
      ),
    ).rejects.toThrow(BriefGenerationError);
  });

  it("rejects arrays, scalars, and non-string fields", async () => {
    await expect(
      generateAndSaveBrief("user-1", FACTS, fakeClient(["Steady", "Hold"])),
    ).rejects.toThrow(BriefGenerationError);
    await expect(
      generateAndSaveBrief("user-1", FACTS, fakeClient("just a string")),
    ).rejects.toThrow(BriefGenerationError);
    await expect(
      generateAndSaveBrief(
        "user-1",
        FACTS,
        fakeClient({ interpretation: 123, recommendation: "Hold volume." }),
      ),
    ).rejects.toThrow(BriefGenerationError);
    await expect(
      generateAndSaveBrief("user-1", FACTS, fakeClient(null)),
    ).rejects.toThrow(BriefGenerationError);
  });

  it("persists exactly {recovery, training} as facts, dropping extra keys", async () => {
    const factsWithExtra = {
      ...FACTS,
      extra: "should not persist",
    } as unknown as typeof FACTS;
    const row = await generateAndSaveBrief(
      "user-1",
      factsWithExtra,
      fakeClient({ interpretation: "Steady base.", recommendation: "Hold volume." }),
    );
    expect(row.facts).toEqual(FACTS);
  });

  it("wraps transport failures in a friendly error", async () => {
    const failing: BriefChatClient = {
      complete: async () => {
        throw new Error("socket hang up");
      },
    };
    await expect(generateAndSaveBrief("user-1", FACTS, failing)).rejects.toThrow(
      "Could not reach the AI service.",
    );
  });
});
