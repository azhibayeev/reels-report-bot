import { describe, expect, it, vi } from "vitest";
import { fetchReelMetrics, REEL_METRICS } from "../lib/farm/insights";

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function graphError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), { status });
}

// Ответ Graph в «новом» формате: значение лежит в total_value.
function totalValue(pairs: Record<string, number>): Response {
  return ok({
    data: Object.entries(pairs).map(([name, value]) => ({ name, total_value: { value } })),
  });
}

describe("fetchReelMetrics", () => {
  it("понимает оба формата ответа Graph — цифры не теряются из-за формы ответа", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/m_total/")) {
        return totalValue({
          views: 300000,
          reach: 250000,
          likes: 1200,
          // Ноль именно в total_value: ролик собрал 300 тысяч и ни одного
          // репоста — это факт, который обязан доехать до отчёта нулём,
          // а не прочерком «метрики нет».
          shares: 0,
          comments: 40,
          saved: 900,
          ig_reels_avg_watch_time: 4300,
        });
      }
      return ok({
        data: [
          { name: "views", values: [{ value: 500 }] },
          { name: "reach", values: [{ value: 450 }] },
          { name: "likes", values: [{ value: 3 }] },
          { name: "comments", values: [{ value: 0 }] },
          { name: "saved", values: [{ value: 1 }] },
          { name: "shares", values: [{ value: 2 }] },
          { name: "ig_reels_avg_watch_time", values: [{ value: 1500 }] },
        ],
      });
    });

    const out = await fetchReelMetrics(["m_total", "m_values"], {
      token: "T",
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });

    expect(out.get("m_total")).toEqual({
      views: 300000,
      reach: 250000,
      likes: 1200,
      comments: 40,
      saved: 900,
      shares: 0,
      avgWatchMs: 4300,
      error: null,
    });
    expect(out.get("m_values")).toEqual({
      views: 500,
      reach: 450,
      likes: 3,
      // Ноль — это настоящий ноль, а не «метрики нет»: путать их нельзя,
      // иначе отчёт покажет прочерк там, где ролик реально без комментариев.
      comments: 0,
      saved: 1,
      shares: 2,
      avgWatchMs: 1500,
      error: null,
    });
  });

  it("метрика, которой нет в ответе, остаётся пустой, а не превращается в ноль", async () => {
    const fetchImpl = vi.fn(async () => totalValue({ views: 10, reach: 8 }));

    const out = await fetchReelMetrics(["m1"], {
      token: "T",
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });

    const m = out.get("m1")!;
    expect(m.views).toBe(10);
    expect(m.likes).toBeNull();
    expect(m.saved).toBeNull();
    expect(m.avgWatchMs).toBeNull();
    expect(m.error).toBeNull();
  });

  it("сдохший ролик не уносит с собой остальные — у каждого своя запись", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/bad/")) return graphError(500, "Internal error");
      if (url.includes("/boom/")) throw new Error("сеть отвалилась");
      return totalValue({ views: 42 });
    });

    const out = await fetchReelMetrics(["good", "bad", "boom", "good2"], {
      token: "T",
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });

    expect(out.size).toBe(4);
    expect(out.get("good")!.views).toBe(42);
    expect(out.get("good2")!.views).toBe(42);

    expect(out.get("bad")!.views).toBeNull();
    expect(out.get("bad")!.error).toContain("500");
    expect(out.get("bad")!.error).toContain("Internal error");

    expect(out.get("boom")!.views).toBeNull();
    expect(out.get("boom")!.error).toContain("сеть отвалилась");
  });

  it("отвергнутая метрика не оставляет ролик совсем без цифр — берём то, что Graph отдаёт", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("ig_reels_avg_watch_time")) {
        return graphError(400, "(#100) The metric[6] must be one of the following values");
      }
      return totalValue({ views: 1000, reach: 900 });
    });

    const out = await fetchReelMetrics(["m1"], {
      token: "T",
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });

    expect(urls).toHaveLength(2);
    // Повтор идёт с сокращённым набором — иначе он отвалился бы ровно так же.
    expect(urls[1]).not.toContain("ig_reels_avg_watch_time");
    expect(out.get("m1")).toEqual({
      views: 1000,
      reach: 900,
      likes: null,
      comments: null,
      saved: null,
      shares: null,
      avgWatchMs: null,
      error: null,
    });
  });

  it("если и сокращённый набор отвергнут — это честная ошибка в записи, а не тишина", async () => {
    const fetchImpl = vi.fn(async () => graphError(400, "Object does not exist"));

    const out = await fetchReelMetrics(["m1"], {
      token: "T",
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out.get("m1")!.error).toContain("Object does not exist");
    expect(out.get("m1")!.views).toBeNull();
  });

  it("не заваливает Graph лавиной запросов — держит не больше восьми разом", async () => {
    let active = 0;
    let peak = 0;
    const release: Array<() => void> = [];

    const fetchImpl = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => release.push(resolve));
      active -= 1;
      return totalValue({ views: 1 });
    });

    const ids = Array.from({ length: 25 }, (_, i) => `m${i}`);
    const pending = fetchReelMetrics(ids, {
      token: "T",
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });

    // Отпускаем запросы по одному, пока пул не разгребёт всю очередь.
    for (let i = 0; i < ids.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      while (release.length === 0) await new Promise<void>((r) => setTimeout(r, 0));
      release.shift()!();
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((r) => setTimeout(r, 0));
    }

    const out = await pending;
    expect(out.size).toBe(25);
    // Ровно восемь, а не «меньше восьми»: последовательный обход тоже уложился бы
    // в лимит, но растянул бы отчёт на 25 походов подряд.
    expect(peak).toBe(8);
  });

  it("пустой список — пустая карта и ни одного похода в Graph", async () => {
    const fetchImpl = vi.fn();

    const out = await fetchReelMetrics([], {
      token: "T",
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });

    expect(out.size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("токен не утекает в адрес незакодированным, а набор метрик — тот самый", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      urls.push(String(input));
      return totalValue({ views: 1 });
    });

    await fetchReelMetrics(["m1"], {
      token: "a b+c/d",
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    });

    expect(urls[0]).toContain("https://graph.facebook.com/v23.0/m1/insights");
    expect(urls[0]).toContain(`metric=${REEL_METRICS.join("%2C")}`);
    expect(urls[0]).toContain(`access_token=${encodeURIComponent("a b+c/d")}`);
  });
});
