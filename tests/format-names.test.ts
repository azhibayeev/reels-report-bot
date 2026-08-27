import { describe, it, expect } from "vitest";
import { ambassadorLabel } from "../lib/applink";
import { formatClicksMessage, formatStoreClicksMessage, formatTargetMessage } from "../lib/format";
import type { ClicksStats } from "../lib/posthog";
import type { StoreClicks } from "../lib/applink-store";
import type { AdInsights } from "../lib/meta";

const FROM = new Date("2026-08-26T05:30:00Z");
const TO = new Date("2026-08-27T05:30:00Z");

const clicks: ClicksStats = {
  sinceEpoch: Math.floor(FROM.getTime() / 1000),
  sources: [
    { category: "bio", name: "daristeppe", uniq: 75 },
    { category: "bio", name: "qurany_app", uniq: 10 },
    { category: "inf", name: "bara", uniq: 12 },
    { category: "direct", name: "Прямые", uniq: 8 },
    { category: "other", name: "DM-бот", uniq: 3 },
  ],
};

const store: StoreClicks[] = [
  { slug: "daristeppe", android: 11, ios: 16, desktop: 14 },
  { slug: "bara", android: 9, ios: 2, desktop: 0 },
  { slug: "quranyapp", android: 0, ios: 0, desktop: 0 },
];

describe("ambassadorLabel", () => {
  it("matches the same person however the source spells the name", () => {
    // PostHog отдаёт метку utm_content «qurany_app», а слаг короткой ссылки —
    // «quranyapp»: без нормализации один аккаунт назывался бы двумя способами
    // в соседних сообщениях отчёта.
    expect(ambassadorLabel("quranyapp")).toBe("@qurany_app");
    expect(ambassadorLabel("qurany_app")).toBe("@qurany_app");
    expect(ambassadorLabel("bara")).toBe("Бара");
    expect(ambassadorLabel("BARA")).toBe("Бара");
  });

  it("leaves a name that is not a slug alone", () => {
    // «Прямые» и «DM-бот» — категории источника, а не люди со ссылкой.
    expect(ambassadorLabel("Прямые")).toBe("Прямые");
    expect(ambassadorLabel("DM-бот")).toBe("DM-бот");
  });
});

describe("заходы и переходы называют людей одинаково", () => {
  const clicksMsg = formatClicksMessage(clicks, "Заходы по ссылкам · за сутки");
  const storeMsg = formatStoreClicksMessage(store, "Переходы в стор · за сутки", FROM, TO);

  it("prints ambassador labels, not raw utm tags", () => {
    expect(clicksMsg).toContain("Бара — <b>12</b>");
    expect(clicksMsg).toContain("@daristeppe — <b>75</b>");
    expect(clicksMsg).toContain("@qurany_app — <b>10</b>");
    expect(clicksMsg).not.toContain("bara —");
    expect(clicksMsg).not.toContain("qurany_app —</b>");
  });

  it("keeps non-person sources as they are", () => {
    expect(clicksMsg).toContain("<b>Прямые:</b>");
    expect(clicksMsg).toContain("DM-бот — <b>3</b>");
  });

  it("names the metric in both headers so 12 and 11 do not read as a mismatch", () => {
    // Заходы — уникальные люди (person_id), переходы — клики по редиректу,
    // у которого ни куки, ни person_id. Соседние числа несопоставимы.
    expect(clicksMsg).toContain("<i>(уникальные люди)</i>");
    expect(storeMsg).toContain("<i>(клики по ссылке)</i>");
  });
});

describe("окно рекламы в сводке таргета", () => {
  const ads = (over: Partial<AdInsights> = {}): AdInsights => ({
    spend: 12.34,
    currency: "USD",
    leads: 5,
    costPerResult: 2.47,
    impressions: 12345,
    clicks: 234,
    reach: 9876,
    leadActionType: "lead",
    periodStart: "2026-08-26",
    periodEnd: "2026-08-26",
    hasData: true,
    ...over,
  });

  it("prints the calendar window the ad account itself returned", () => {
    const msg = formatTargetMessage(ads(), null, "за сутки", "с 12:30 вчера");
    expect(msg).toContain("🗓 Реклама — 26.08.2026 · лиды — с 12:30 вчера");
  });

  it("prints a range when the window spans days", () => {
    const msg = formatTargetMessage(
      ads({ periodStart: "2026-06-01", periodEnd: "2026-08-27" }),
      null,
      "за всё время",
      "за всё время"
    );
    expect(msg).toContain("🗓 Реклама — 01.06.2026 — 27.08.2026 · лиды — за всё время");
  });

  it("falls back to the caller's title when there was no spend at all", () => {
    // hasData:false — кабинет не присылает ни date_start, ни date_stop.
    const msg = formatTargetMessage(
      ads({ hasData: false, periodStart: null, periodEnd: null }),
      null,
      "за сутки",
      "с 12:30 вчера"
    );
    expect(msg).toContain("🗓 Реклама — за сутки · лиды — с 12:30 вчера");
  });
});
