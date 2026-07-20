export interface ReelSnapshot {
  id: string;
  permalink: string;
  /** ISO timestamp of publication (as returned by Instagram) */
  publishedAt: string;
  caption: string;
  views: number;
}

export interface Snapshot {
  /** ISO timestamp when the snapshot was taken */
  takenAt: string;
  reels: ReelSnapshot[];
}

export interface ReelReport extends ReelSnapshot {
  gain: number;
  isNew: boolean;
}

export interface Report {
  periodStart: string | null;
  periodEnd: string;
  isBaseline: boolean;
  totalViews: number;
  totalGain: number;
  newReels: ReelReport[];
  top: ReelReport[];
  all: ReelReport[];
}
