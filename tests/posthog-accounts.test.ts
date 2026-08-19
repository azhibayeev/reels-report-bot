import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QURANY_APP } from "../lib/accounts";
import { getDailyClicks } from "../lib/posthog";

describe("getDailyClicks for one account's link", () => {
  let sentBody = "";

  beforeEach(() => {
    process.env.POSTHOG_PERSONAL_API_KEY = "phx_test";
    process.env.POSTHOG_PROJECT_ID = "501630";
    sentBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: any) => {
        sentBody = init.body as string;
        return { ok: true, json: async () => ({ results: [["2026-08-19", 12]] }) } as never;
      })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("counts only the people who came through this account's link", async () => {
    const res = await getDailyClicks(1_755_000_000, QURANY_APP.clicksCondition);

    expect(res).toEqual([{ date: "2026-08-19", value: 12 }]);
    const query = JSON.parse(sentBody).query.query as string;
    // Квирк проекта: property-фильтр в WHERE отдаёт results:null — условие живёт
    // только внутри uniqIf, а WHERE остаётся на event+timestamp.
    expect(query).toContain("uniqIf(person_id, properties.utm_content IN ('qurany_app','link_in_bio'))");
    const where = query.slice(query.indexOf("WHERE"), query.indexOf("GROUP BY"));
    expect(where).not.toContain("properties.");
  });
});
