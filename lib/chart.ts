import { jakartaDateKey } from "./storage";
import { DayPoint, Snapshot } from "./types";

function totalViews(s: Snapshot): number {
  return s.reels.reduce((sum, r) => sum + r.views, 0);
}

// Дневной прирост тотал-просмотров между соседними снапшотами.
// Вход — снапшоты по возрастанию takenAt; date = день Джакарты второго снапшота пары.
export function computeDailyViewGains(snaps: Snapshot[]): DayPoint[] {
  const out: DayPoint[] = [];
  for (let i = 1; i < snaps.length; i++) {
    out.push({
      date: jakartaDateKey(new Date(snaps[i].takenAt)),
      value: totalViews(snaps[i]) - totalViews(snaps[i - 1]),
    });
  }
  return out;
}
