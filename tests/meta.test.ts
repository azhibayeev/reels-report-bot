import { describe, it, expect } from "vitest";
import { parseInsights, pickLeads, type InsightRow } from "../lib/meta";

describe("pickLeads", () => {
  it("prefers the most specific lead action_type over generic 'lead'", () => {
    const { leads, type } = pickLeads([
      { action_type: "lead", value: "12" },
      { action_type: "offsite_conversion.fb_pixel_lead", value: "7" },
    ]);
    expect(type).toBe("offsite_conversion.fb_pixel_lead");
    expect(leads).toBe(7);
  });

  it("honours a pinned action_type from env", () => {
    const { leads, type } = pickLeads(
      [
        { action_type: "lead", value: "12" },
        { action_type: "onsite_conversion.lead_grouped", value: "9" },
      ],
      "lead"
    );
    expect(type).toBe("lead");
    expect(leads).toBe(12);
  });

  it("returns zero when no actions", () => {
    expect(pickLeads(undefined)).toEqual({ leads: 0, type: null });
    expect(pickLeads([])).toEqual({ leads: 0, type: null });
  });
});

describe("parseInsights", () => {
  it("parses a row and computes cost per result", () => {
    const row: InsightRow = {
      spend: "123.45",
      impressions: "1000",
      clicks: "50",
      reach: "800",
      account_currency: "USD",
      actions: [{ action_type: "lead", value: "10" }],
      date_start: "2026-08-02",
      date_stop: "2026-08-02",
    };
    const r = parseInsights(row);
    expect(r.spend).toBeCloseTo(123.45);
    expect(r.impressions).toBe(1000);
    expect(r.clicks).toBe(50);
    expect(r.reach).toBe(800);
    expect(r.leads).toBe(10);
    expect(r.costPerResult).toBeCloseTo(12.345);
    expect(r.currency).toBe("USD");
    expect(r.hasData).toBe(true);
  });

  it("returns zeroed, no-data result for an empty window", () => {
    const r = parseInsights(undefined);
    expect(r.hasData).toBe(false);
    expect(r.spend).toBe(0);
    expect(r.leads).toBe(0);
    expect(r.costPerResult).toBeNull();
  });

  it("cost per result is null when there are no leads", () => {
    const r = parseInsights({ spend: "50", impressions: "10", clicks: "1", reach: "9" });
    expect(r.leads).toBe(0);
    expect(r.costPerResult).toBeNull();
  });
});
