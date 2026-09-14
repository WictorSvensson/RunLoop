"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { getCoachFacts } from "@/lib/coach/facts";
import { BriefGenerationError, generateAndSaveBrief } from "@/lib/coach/generate";

// Server-side spend guard: every click is one LLM call + one row, so refuse
// rapid repeats. Client-side disable alone is not a guard.
const GENERATE_COOLDOWN_MS = 5 * 60 * 1000;

export interface GenerateActionState {
  ok: boolean;
  message: string;
}

// Manual trigger for one fresh AI brief. Facts come from the same helper the
// page renders, so the stored `facts` always match what the user saw. Every
// click stores a new audit row; newest wins for display.
export async function generateCoachBrief(): Promise<GenerateActionState> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { ok: false, message: "Your session expired. Please log in again." };
    }
    const latest = await prisma.coachBrief.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (
      latest &&
      Date.now() - latest.createdAt.getTime() < GENERATE_COOLDOWN_MS
    ) {
      return {
        ok: false,
        message: "A fresh analysis already exists — wait a few minutes before generating again.",
      };
    }
    const facts = await getCoachFacts(user.id);
    await generateAndSaveBrief(user.id, facts);
    revalidatePath("/coach");
    return { ok: true, message: "New analysis generated." };
  } catch (err) {
    if (err instanceof BriefGenerationError) {
      return { ok: false, message: err.message };
    }
    console.error("Coach brief generation failed:", err);
    return {
      ok: false,
      message: "Could not generate analysis. Please try again later.",
    };
  }
}
