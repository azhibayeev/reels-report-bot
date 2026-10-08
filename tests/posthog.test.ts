import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDailyClicks, phQuery } from "../lib/posthog";

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

describe("phQuery: повтор при перегрузке PostHog", () => {
  const busy = () =>
    new Response(JSON.stringify({ type: "server_error", detail: "Queries are a little too busy right now." }), {
      status: 503,
    });
  const ok = () => new Response(JSON.stringify({ results: [[1]] }), { status: 200 });

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("503 «too busy» → пауза и повтор, затем результат", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);

    const p = phQuery("SELECT 1", "1", "phx_test");
    await vi.runAllTimersAsync();

    await expect(p).resolves.toEqual([[1]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("перегрузка не проходит — сдаётся после нескольких попыток с ошибкой PostHog", async () => {
    const fetchMock = vi.fn(async () => busy());
    vi.stubGlobal("fetch", fetchMock);

    const p = phQuery("SELECT 1", "1", "phx_test");
    const failed = expect(p).rejects.toThrow("PostHog query failed (503)");
    await vi.runAllTimersAsync();
    await failed;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("403 (нет доступа) не повторяется — ключ от этого не исправится", async () => {
    const fetchMock = vi.fn(async () => new Response("no access", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(phQuery("SELECT 1", "1", "phx_test")).rejects.toThrow("PostHog query failed (403)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
