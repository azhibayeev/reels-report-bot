import crypto from "node:crypto";
import { jakartaDateKey } from "./storage";
import { Snapshot } from "./types";

export interface DashboardStats {
  followers: number | null;
  viewsByDay: { day: string; total: number }[];
}

/** Один снапшот на день Джакарты (самый поздний); total = сумма просмотров роликов. */
export function toDashboardStats(snaps: Snapshot[]): DashboardStats {
  const sorted = [...snaps].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
  const byDay = new Map<string, Snapshot>();
  for (const s of sorted) byDay.set(jakartaDateKey(new Date(s.takenAt)), s);
  const viewsByDay = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, s]) => ({ day, total: s.reels.reduce((sum, r) => sum + r.views, 0) }));
  const latest = sorted[sorted.length - 1];
  return { followers: latest?.followersCount ?? null, viewsByDay };
}

/** Сравнение bearer-токена за постоянное время; пустой/отсутствующий секрет — всегда false. */
export function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
