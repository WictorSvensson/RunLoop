import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getActivityDetail } from "@/lib/activity-detail";
import { isInternalRequestAuthorized } from "@/lib/http-auth";

// GET /api/activities/[id]
// Returns the detailed representation of one activity (stored laps included).
// Detail is stored at import time for every source, so this is a pure DB
// read. Same-origin protected.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const activity = await getActivityDetail(user.id, id);
    return NextResponse.json({ activity });
  } catch (err) {
    if (err instanceof Error && err.message === "Activity not found") {
      return NextResponse.json({ error: "Activity not found." }, { status: 404 });
    }
    console.error("Activity detail fetch failed:", err);
    return NextResponse.json(
      { error: "Could not load activity details. Please try again." },
      { status: 500 },
    );
  }
}
