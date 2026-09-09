export const DEFAULT_ANALYSIS_BATCH_SIZE = 10;
export const MAX_ANALYSIS_BATCH_SIZE = 25;

export function clampAnalysisBatchSize(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_ANALYSIS_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_ANALYSIS_BATCH_SIZE, Math.floor(value!)));
}
