// Provider sport-type field (stored as Activity.type) covers rides, swims,
// strength sessions, ski, etc. — the Dashboard and Analytics pages only care
// about running-type activities for volume/frequency/pace stats. This does
// NOT apply to the Training archive page, which intentionally shows every
// activity type.
export const RUNNING_TYPES = ["Run", "TrailRun", "VirtualRun"] as const;
