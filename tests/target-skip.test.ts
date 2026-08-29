import { describe, it, expect } from "vitest";
import { adsRan, type AdInsights } from "../lib/meta";
import { targetWorthSending } from "../lib/format";
import type { LeadLevels } from "../lib/leads";

const ads = (over: Partial<AdInsights> = {}): AdInsights => ({
  spend: 0,
  impressions: 0,
  clicks: 0,
  reach: 0,
  leads: 0,
  costPerResult: null,
  currency: "USD",
  leadActionType: null,
  periodStart: null,
  periodEnd: null,
  hasData: false,
  ...over,
});

const levels = (total: number): LeadLevels => ({
  high: total,
  medium: 0,
  low: 0,
  total,
  sinceIso: null,
});

describe("adsRan", () => {
  it("пустой ответ кабинета — открутки не было", () => {
    expect(adsRan(ads())).toBe(false);
  });

  it("строка из нулей — тоже не было: кампания включена, но не крутилась", () => {
    // Insights умеет вернуть строку с датами и нулями, hasData при этом true.
    expect(adsRan(ads({ hasData: true, periodStart: "2026-08-27", periodEnd: "2026-08-27" }))).toBe(false);
  });

  it("потрачены деньги — крутилась", () => {
    expect(adsRan(ads({ hasData: true, spend: 12.4, impressions: 3100 }))).toBe(true);
  });

  it("показы без списанных денег — всё равно крутилась", () => {
    // Кабинет может показать открутку раньше, чем спишет деньги.
    expect(adsRan(ads({ hasData: true, impressions: 900 }))).toBe(true);
  });
});

describe("targetWorthSending", () => {
  it("нет открутки и нет базы лидов — сообщение не о чем", () => {
    expect(targetWorthSending(ads(), null)).toBe(false);
  });

  it("нет открутки и лидов за период ноль — тоже не о чем", () => {
    expect(targetWorthSending(ads(), levels(0))).toBe(false);
  });

  it("открутки не было, но заявки с квиза пришли — отправляем ради них", () => {
    expect(targetWorthSending(ads(), levels(3))).toBe(true);
  });

  it("реклама крутилась — отправляем, даже если лидов ноль", () => {
    expect(targetWorthSending(ads({ hasData: true, spend: 5, impressions: 800 }), levels(0))).toBe(true);
  });
});
