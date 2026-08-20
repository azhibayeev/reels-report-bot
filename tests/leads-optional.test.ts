import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getLeadLevels, leadsConfigured } from "../lib/leads";
import { formatTargetMessage } from "../lib/format";
import type { AdInsights } from "../lib/meta";

const ADS: AdInsights = {
  spend: 12.5,
  currency: "USD",
  leads: 7,
  costPerResult: 1.79,
  impressions: 4210,
  clicks: 96,
  reach: 3800,
  leadActionType: "lead",
  periodStart: "2026-08-19",
  periodEnd: "2026-08-19",
  hasData: true,
};

describe("lead breakdown is optional", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllGlobals();
  });

  it("says the lead source is off instead of throwing", async () => {
    // База лидов квиза не подключена (LEAD_STORE в проекте квиза не задан).
    // Раньше это роняло всю команду /target вместе с рекламными цифрами.
    expect(leadsConfigured()).toBe(false);
    expect(await getLeadLevels(null)).toBeNull();
  });

  it("still reports the ad numbers when there is no lead breakdown", () => {
    const msg = formatTargetMessage(ADS, null, "за сутки", "🗓 вчера");
    expect(msg).toContain("Потрачено");
    expect(msg).toContain("Лидов (результатов)");
    expect(msg).toContain("Разбивка по лидам не настроена");
    expect(msg).not.toContain("Высокий");
  });

  it("keeps the breakdown when the source is configured", () => {
    const msg = formatTargetMessage(ADS, { high: 2, medium: 3, low: 4, total: 9, sinceIso: null }, "за сутки", "🗓 вчера");
    expect(msg).toContain("Высокий");
    expect(msg).toContain("Σ Всего лидов");
  });
});
