import {
  AnalysisInput,
  MetricTrend,
  RunActivity,
} from "./types";

function daysAgo(dateString: string): number {
  const now = new Date();
  const date = new Date(dateString);

  const milliseconds =
    now.getTime() - date.getTime();

  return milliseconds / (1000 * 60 * 60 * 24);
}

export function getRunsWithinDays(
  activities: RunActivity[],
  days: number
): RunActivity[] {
  return activities.filter(
    (activity) => daysAgo(activity.date) <= days
  );
}

export function totalDistance(
  activities: RunActivity[]
): number {
  return activities.reduce(
    (sum, activity) => sum + activity.distanceKm,
    0
  );
}

export function totalMinutes(
  activities: RunActivity[]
): number {
  return activities.reduce(
    (sum, activity) => sum + activity.durationMinutes,
    0
  );
}

function average(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }

  return (
    values.reduce((sum, value) => sum + value, 0) /
    values.length
  );
}

export function averageEasyHeartRate(
  activities: RunActivity[]
): number | undefined {
  const values = activities
    .filter(
      (activity) =>
        activity.intendedType === "easy" &&
        activity.averageHeartRate !== undefined
    )
    .map((activity) => activity.averageHeartRate!);

  return average(values);
}

export function averageEasyPace(
  activities: RunActivity[]
): number | undefined {
  const values = activities
    .filter(
      (activity) =>
        activity.intendedType === "easy" &&
        activity.averagePaceSecondsPerKm !== undefined
    )
    .map(
      (activity) =>
        activity.averagePaceSecondsPerKm!
    );

  return average(values);
}

export function averageRPE(
  activities: RunActivity[]
): number | undefined {
  return average(
    activities
      .filter(
        (activity) => activity.rpe !== undefined
      )
      .map((activity) => activity.rpe!)
  );
}

export function averageFatigue(
  input: AnalysisInput,
  days = 7
): number | undefined {
  const values = input.dailyContext
    .filter(
      (entry) => daysAgo(entry.date) <= days
    )
    .filter(
      (entry) => entry.fatigue !== undefined
    )
    .map((entry) => entry.fatigue!);

  return average(values);
}

export function buildBasicTrends(
  input: AnalysisInput
): MetricTrend[] {
  const recent = getRunsWithinDays(
    input.activities,
    28
  );

  const previous = input.activities.filter((activity) => {
    const age = daysAgo(activity.date);

    return age > 28 && age <= 56;
  });

  const recentEasyHR =
    averageEasyHeartRate(recent);

  const previousEasyHR =
    averageEasyHeartRate(previous);

  const recentEasyPace =
    averageEasyPace(recent);

  const previousEasyPace =
    averageEasyPace(previous);

  const trends: MetricTrend[] = [];

  if (
    recentEasyHR !== undefined &&
    previousEasyHR !== undefined
  ) {
    const difference =
      recentEasyHR - previousEasyHR;

    trends.push({
      metric: "Easy-run heart rate",
      currentValue: recentEasyHR,
      previousValue: previousEasyHR,

      direction:
        difference <= -3
          ? "improving"
          : difference >= 5
          ? "declining"
          : "stable",

      confidence: "moderate",

      explanation:
        difference <= -3
          ? "Average heart rate on easy runs is lower than during the previous comparison period."
          : difference >= 5
          ? "Average heart rate on easy runs is meaningfully higher than during the previous comparison period."
          : "Easy-run heart rate is broadly stable.",
    });
  }

  if (
    recentEasyPace !== undefined &&
    previousEasyPace !== undefined
  ) {
    const difference =
      recentEasyPace - previousEasyPace;

    trends.push({
      metric: "Easy-run pace",
      currentValue: recentEasyPace,
      previousValue: previousEasyPace,

      direction:
        difference <= -8
          ? "improving"
          : difference >= 12
          ? "declining"
          : "stable",

      confidence: "moderate",

      explanation:
        difference <= -8
          ? "Average easy-run pace has become faster."
          : difference >= 12
          ? "Average easy-run pace has become slower."
          : "Easy-run pace is broadly stable.",
    });
  }

  return trends;
}
