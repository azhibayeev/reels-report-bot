import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDailyClicks } from "../lib/posthog";

describe("getDailyClicks", () => {
  beforeEach(() => {
    process.env.POSTHOG_PERSONAL_API_KEY = "phx_test";
    process.env.POSTHOG_PROJECT_ID = "501630";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("maps daily rows and keeps WHERE free of property filters", async () => {
    let sentBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: any) => {
        sentBody = init.body as string;
        return {
          ok: true,
          json: async () => ({
            results: [
              ["2026-07-30", 5],
              ["2026-07-31", 8],
            ],
          }),
        } as any;
      })
    );

    const res = await getDailyClicks(1_753_800_000);

    expect(res).toEqual([
      { date: "2026-07-30", value: 5 },
      { date: "2026-07-31", value: 8 },
    ]);
    const query = JSON.parse(sentBody).query.query as string;
    expect(query).toContain("event = '$pageview'");
    expect(query).toContain("uniq(person_id)");
    // Бакеты выровнены на спринт 12:30 Джакарты (как дневной прирост просмотров),
    // а не по календарной полуночи — иначе последняя точка неполная.
    expect(query).toContain("toTimeZone(timestamp, 'Asia/Jakarta')");
    expect(query).toContain("INTERVAL 690 MINUTE");
    // квирк: никаких property-фильтров в WHERE
    expect(query).not.toContain("properties.");
  });
});
