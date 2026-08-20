import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { triggerRender, TRIGGER_ATTEMPTS } from "../lib/farm/tick";

// Пинок цепочки — единственное место, через которое проходят все вызовы
// следующего звена рендера: и /reels, и запуск пачки, и само-вызов тика, и
// суточный крон. Поэтому надёжность стоит закрывать здесь, а не в каждом из них.
describe("triggerRender", () => {
  const ok = { ok: true, status: 202 } as Response;
  const fail = (status: number) => ({ ok: false, status }) as Response;
  const sleep = vi.fn(async () => {});

  beforeEach(() => {
    process.env.FARM_BASE_URL = "https://qurany.example";
    process.env.FARM_TOKEN_SECRET = "secret";
    sleep.mockClear();
  });
  afterEach(() => {
    delete process.env.FARM_BASE_URL;
    delete process.env.FARM_TOKEN_SECRET;
  });

  it("холодный старт: 500 на первом запросе не роняет пачку", async () => {
    // Ровно то, что случилось на проде: свежий деплой, первый запрос к
    // /api/farm/render не уложился в лимит инициализации и вернул 500. Пинок
    // сдавался сразу, и тринадцать готовых к сборке роликов висели до крона.
    const doFetch = vi.fn().mockResolvedValueOnce(fail(500)).mockResolvedValueOnce(ok);
    await expect(triggerRender("batch-1", { fetch: doFetch, sleep })).resolves.toBeUndefined();
    expect(doFetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("оборванная сеть тоже повод повторить, а не сдаться", async () => {
    const doFetch = vi.fn().mockRejectedValueOnce(new Error("socket hang up")).mockResolvedValueOnce(ok);
    await expect(triggerRender("batch-1", { fetch: doFetch, sleep })).resolves.toBeUndefined();
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  it("сдаётся после отведённых попыток и называет последнюю причину", async () => {
    const doFetch = vi.fn().mockResolvedValue(fail(503));
    await expect(triggerRender("batch-1", { fetch: doFetch, sleep })).rejects.toThrow(/503/);
    expect(doFetch).toHaveBeenCalledTimes(TRIGGER_ATTEMPTS);
  });

  it("403 не повторяет: неверный ключ повтором не исправить", async () => {
    // Повтор здесь — не осторожность, а трата: тот же ключ даст тот же отказ.
    const doFetch = vi.fn().mockResolvedValue(fail(403));
    await expect(triggerRender("batch-1", { fetch: doFetch, sleep })).rejects.toThrow(/403/);
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("429 повторяет: это «попробуй позже», а не «нельзя»", async () => {
    const doFetch = vi.fn().mockResolvedValueOnce(fail(429)).mockResolvedValueOnce(ok);
    await expect(triggerRender("batch-1", { fetch: doFetch, sleep })).resolves.toBeUndefined();
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  it("успех с первого раза не тратит ни повторов, ни пауз", async () => {
    const doFetch = vi.fn().mockResolvedValue(ok);
    await triggerRender("batch-1", { fetch: doFetch, sleep });
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    const [url, init] = doFetch.mock.calls[0];
    expect(String(url)).toContain("https://qurany.example/api/farm/render?batch=batch-1&key=");
    expect(init).toMatchObject({ method: "POST" });
  });
});
