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
  /** Followers at snapshot time (absent in snapshots taken before this field existed) */
  followersCount?: number;
  reels: ReelSnapshot[];
}

export interface FollowerStats {
  count: number;
  /** Net change vs previous snapshot; null when prev has no followersCount */
  delta: number | null;
}

/** Gross follows/unfollows as reported by Instagram insights */
export interface FollowerChanges {
  follows: number;
  unfollows: number;
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
  followers: FollowerStats | null;
  newReels: ReelReport[];
  top: ReelReport[];
  all: ReelReport[];
}

/** Одна точка суточного ряда для графика динамики */
export interface DayPoint {
  /** Ключ дня в формате YYYY-MM-DD */
  date: string;
  /** Значение за этот день (прирост просмотров или заходы) */
  value: number;
}

/**
 * Три уровня суточной воронки для графика. Вход — сколько роликов выложили,
 * середина — сколько просмотров они принесли, выход — во что просмотры превратились.
 * Без входа рост просмотров не читается: непонятно, контент стал лучше или роликов
 * стало больше.
 */
export interface FunnelSeries {
  /** Вход: ролики за день. */
  published: DayPoint[];
  /** Середина: прирост просмотров за день. */
  views: DayPoint[];
  /** Выход: заходы в сообщество по ссылке аккаунта. */
  joins: DayPoint[];
  /** Выход: переходы в стор по короткой ссылке аккаунта. */
  store: DayPoint[];
}
