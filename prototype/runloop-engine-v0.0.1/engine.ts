import {
  AnalysisInput,
  CoachAnalysis,
  Finding,
  MissingDataRequest,
  Recommendation,
} from "./types";

import {
  averageFatigue,
  buildBasicTrends,
  getRunsWithinDays,
  totalDistance,
} from "./metrics";

export function analyzeAthlete(
  input: AnalysisInput
): CoachAnalysis {
  const trends = buildBasicTrends(input);

  const findings: Finding[] = [];
  const missingData: MissingDataRequest[] = [];
  const uncertainty: string[] = [];

  const last7Days = getRunsWithinDays(
    input.activities,
    7
  );

  const last28Days = getRunsWithinDays(
    input.activities,
    28
  );

  const currentWeekDistance =
    totalDistance(last7Days);

  const fourWeekDistance =
    totalDistance(last28Days);

  const averageWeeklyDistance =
    fourWeekDistance / 4;

  const fatigue =
    averageFatigue(input, 7);

  const easyHRTrend = trends.find(
    (trend) =>
      trend.metric === "Easy-run heart rate"
  );

  const easyPaceTrend = trends.find(
    (trend) =>
      trend.metric === "Easy-run pace"
  );

  const performanceSignalsDeclining =
    [
      easyHRTrend?.direction === "declining",
      easyPaceTrend?.direction === "declining",
    ].filter(Boolean).length;

  const highFatigue =
    fatigue !== undefined && fatigue >= 7;

  const loadElevated =
    averageWeeklyDistance > 0 &&
    currentWeekDistance >
      averageWeeklyDistance * 1.15;

  if (loadElevated) {
    findings.push({
      id: "increased-load",

      title: "Training load is elevated",

      detail:
        "Your current seven-day running volume is above your recent four-week weekly average.",

      type: "neutral",

      confidence: "moderate",

      evidence: [
        `Current 7-day distance: ${currentWeekDistance.toFixed(
          1
        )} km`,
        `Recent weekly average: ${averageWeeklyDistance.toFixed(
          1
        )} km`,
      ],
    });
  }

  if (highFatigue) {
    findings.push({
      id: "high-fatigue",

      title: "Subjective fatigue is elevated",

      detail:
        "Recent fatigue ratings are high enough to deserve context, but fatigue alone does not prove that training is failing.",

      type: "attention",

      confidence: "moderate",

      evidence: [
        `Recent average fatigue: ${fatigue?.toFixed(
          1
        )}/10`,
      ],
    });
  }

  if (
    highFatigue &&
    performanceSignalsDeclining === 0
  ) {
    findings.push({
      id: "fatigue-with-stable-performance",

      title:
        "Fatigue is elevated but performance indicators remain stable",

      detail:
        "This pattern can be consistent with expected training fatigue rather than loss of fitness.",

      type: "neutral",

      confidence: "moderate",

      evidence: [
        "Subjective fatigue is elevated",
        "Easy-run performance indicators are not meaningfully deteriorating",
      ],
    });
  }

  if (
    highFatigue &&
    performanceSignalsDeclining >= 2
  ) {
    findings.push({
      id: "fatigue-with-decline",

      title:
        "Fatigue and performance deterioration are occurring together",

      detail:
        "Multiple indicators are moving in the wrong direction at the same time. This deserves more attention than fatigue alone.",

      type: "warning",

      confidence: "moderate",

      evidence: [
        "Subjective fatigue is elevated",
        "Easy-run heart rate has worsened",
        "Easy-run pace has worsened",
      ],
    });
  }

  if (input.dailyContext.length === 0) {
    missingData.push({
      field: "daily-context",

      reason:
        "Sleep, fatigue, stress and recovery information would help distinguish expected training fatigue from unexplained performance decline.",

      importance: "high",
    });
  }

  const recommendation =
    buildRecommendation({
      highFatigue,
      loadElevated,
      performanceSignalsDeclining,
      blockPurpose: input.currentBlock?.purpose,
    });

  uncertainty.push(
    "Short-term changes do not necessarily represent changes in underlying fitness."
  );

  uncertainty.push(
    "Environmental conditions, route differences and measurement error may affect pace and heart-rate comparisons."
  );

  return {
    summary: recommendation.headline,

    recommendation,

    findings,

    trends,

    missingData,

    uncertainty,
  };
}

function buildRecommendation({
  highFatigue,
  loadElevated,
  performanceSignalsDeclining,
  blockPurpose,
}: {
  highFatigue: boolean;
  loadElevated: boolean;
  performanceSignalsDeclining: number;
  blockPurpose?: string;
}): Recommendation {
  if (
    highFatigue &&
    performanceSignalsDeclining >= 2
  ) {
    return {
      action: "reduce-load",

      headline:
        "I think backing off temporarily is the better move.",

      explanation:
        "Fatigue is elevated and multiple performance indicators are deteriorating at the same time. That combination is more concerning than fatigue by itself. I would reduce load briefly and see whether performance begins returning before increasing training again.",

      parameters: [
        "Reduce running volume temporarily",
        "Keep easy running genuinely easy",
        "Avoid adding a new training stimulus",
        "Reassess after several easier days",
      ],

      confidence: "moderate",
    };
  }

  if (
    highFatigue &&
    loadElevated &&
    performanceSignalsDeclining === 0
  ) {
    return {
      action: "continue",

      headline:
        "You're tired, but I don't see enough evidence to change the plan yet.",

      explanation:
        `Training load is elevated${
          blockPurpose
            ? ` during a ${blockPurpose} block`
            : ""
        }, while the available performance indicators remain broadly stable. Fatigue may therefore be an expected consequence of the current workload rather than evidence that the training is failing.`,

      parameters: [
        "Continue the current block",
        "Watch whether fatigue improves with easier running or the next recovery period",
        "Reassess if performance indicators begin deteriorating",
      ],

      confidence: "moderate",
    };
  }

  if (
    performanceSignalsDeclining >= 2
  ) {
    return {
      action: "collect-more-data",

      headline:
        "Something may be changing, but I don't have enough context yet.",

      explanation:
        "Multiple performance indicators have deteriorated, but the available information does not clearly explain why. I would avoid making a large training change until we understand whether this reflects training load, recovery, environment or another factor.",

      parameters: [
        "Keep the next few sessions controlled",
        "Collect fatigue, sleep and stress information",
        "Compare against similar historical sessions",
      ],

      confidence: "low",
    };
  }

  return {
    action: "continue",

    headline:
      "Nothing currently gives me a strong reason to change course.",

    explanation:
      "The available data does not show a sufficiently strong negative pattern to justify changing the current training plan. Continue collecting data and evaluate the trend over a longer window.",

    parameters: [
      "Continue current training",
      "Avoid reacting to individual bad sessions",
      "Evaluate progress across the training block",
    ],

    confidence: "moderate",
  };
}
