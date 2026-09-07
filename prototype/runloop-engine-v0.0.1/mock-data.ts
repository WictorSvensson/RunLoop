import { AnalysisInput } from "./types";

function dateDaysAgo(days: number): string {
  const date = new Date();

  date.setDate(date.getDate() - days);

  return date.toISOString();
}

export const mockAnalysisInput: AnalysisInput = {
  athlete: {
    id: "kevin-test",

    name: "Kevin",

    experience: "experienced",

    goal: {
      type: "marathon",
      priority: "performance",
      description:
        "Maximize marathon performance",
    },

    preferences: {
      coachingDepth: "deep",
      coachingTone: "direct",
      wantsBenchmarkSessions: true,
      preferredTrainingDays: 5,
    },
  },

  currentBlock: {
    startDate: dateDaysAgo(35),
    expectedEndDate: dateDaysAgo(-21),

    purpose: "threshold",

    plannedWeeks: 8,
  },

  activities: [
    {
      id: "run-1",
      date: dateDaysAgo(3),

      distanceKm: 12,
      durationMinutes: 61,

      averageHeartRate: 137,
      averagePaceSecondsPerKm: 305,

      rpe: 4,

      intendedType: "easy",
      executionQuality: "on-target",
    },

    {
      id: "run-2",
      date: dateDaysAgo(5),

      distanceKm: 10,
      durationMinutes: 51,

      averageHeartRate: 136,
      averagePaceSecondsPerKm: 306,

      rpe: 4,

      intendedType: "easy",
      executionQuality: "on-target",
    },

    {
      id: "run-3",
      date: dateDaysAgo(8),

      distanceKm: 18,
      durationMinutes: 95,

      averageHeartRate: 140,
      averagePaceSecondsPerKm: 317,

      rpe: 6,

      intendedType: "long-run",
      executionQuality: "on-target",
    },

    {
      id: "old-run-1",
      date: dateDaysAgo(35),

      distanceKm: 10,
      durationMinutes: 52,

      averageHeartRate: 138,
      averagePaceSecondsPerKm: 312,

      rpe: 4,

      intendedType: "easy",
      executionQuality: "on-target",
    },

    {
      id: "old-run-2",
      date: dateDaysAgo(42),

      distanceKm: 12,
      durationMinutes: 63,

      averageHeartRate: 139,
      averagePaceSecondsPerKm: 315,

      rpe: 4,

      intendedType: "easy",
      executionQuality: "on-target",
    },
  ],

  dailyContext: [
    {
      date: dateDaysAgo(0),

      sleepHours: 7.5,
      sleepQuality: 7,

      fatigue: 7,
      stress: 4,

      restingHeartRate: 48,
    },

    {
      date: dateDaysAgo(1),

      sleepHours: 7,
      sleepQuality: 6,

      fatigue: 7,
      stress: 5,

      restingHeartRate: 49,
    },

    {
      date: dateDaysAgo(2),

      sleepHours: 8,
      sleepQuality: 8,

      fatigue: 8,
      stress: 4,

      restingHeartRate: 48,
    },
  ],
};
