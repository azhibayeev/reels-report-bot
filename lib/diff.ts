import { Report, ReelReport, Snapshot } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeReport(current: Snapshot, prev: Snapshot | null): Report {
  const prevViews = new Map<string, number>();
  for (const r of prev?.reels ?? []) prevViews.set(r.id, r.views);

  const endMs = Date.parse(current.takenAt);
  const startMs = prev ? Date.parse(prev.takenAt) : endMs - DAY_MS;

  const all: ReelReport[] = current.reels.map((r) => {
    const publishedMs = Date.parse(r.publishedAt);
    const isNew = !prevViews.has(r.id) && publishedMs >= startMs && publishedMs <= endMs;
    const gain = prev ? r.views - (prevViews.get(r.id) ?? 0) : 0;
    return { ...r, gain, isNew };
  });

  const newReels = all
    .filter((r) => r.isNew)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  const top = prev ? [...all].sort((a, b) => b.gain - a.gain).slice(0, 10) : [];

  const followers =
    current.followersCount != null
      ? {
          count: current.followersCount,
          delta: prev?.followersCount != null ? current.followersCount - prev.followersCount : null,
        }
      : null;

  return {
    periodStart: prev?.takenAt ?? null,
    periodEnd: current.takenAt,
    isBaseline: !prev,
    totalViews: all.reduce((s, r) => s + r.views, 0),
    totalGain: all.reduce((s, r) => s + r.gain, 0),
    followers,
    newReels,
    top,
    all,
  };
}
