import { afterEach, describe, expect, it, vi } from "vitest";
import { createDub, getDubStatus, getSubscription } from "../lib/elevenlabs";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("getSubscription", () => {
  it("считает остаток кредитов", async () => {
    stubFetch(
      Response.json({ tier: "free", character_count: 334, character_limit: 10000 })
    );
    await expect(getSubscription("k")).resolves.toEqual({
      tier: "free",
      used: 334,
      limit: 10000,
      remaining: 9666,
    });
  });

  it("не уходит в минус, если лимит уже превышен", async () => {
    stubFetch(
      Response.json({ tier: "free", character_count: 12000, character_limit: 10000 })
    );
    await expect(getSubscription("k")).resolves.toMatchObject({ remaining: 0 });
  });

  it("бросает понятную ошибку при отказе", async () => {
    stubFetch(new Response("nope", { status: 401 }));
    await expect(getSubscription("k")).rejects.toThrow(/401/);
  });
});

describe("createDub", () => {
  it("отправляет ru→id и возвращает dubbing_id", async () => {
    const fetchMock = stubFetch(Response.json({ dubbing_id: "abc" }));
    await expect(
      createDub("k", { sourceUrl: "https://blob/x.mov", watermark: true, name: "job-1" })
    ).resolves.toBe("abc");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.elevenlabs.io/v1/dubbing");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("source_url")).toBe("https://blob/x.mov");
    expect(form.get("source_lang")).toBe("ru");
    expect(form.get("target_lang")).toBe("id");
    expect(form.get("watermark")).toBe("true");
  });

  it("пробрасывает текст ошибки — по нему отличается отказ из-за тарифа", async () => {
    stubFetch(
      new Response(
        JSON.stringify({ detail: { message: "Dubbing without a watermark is only available for Starter+ users." } }),
        { status: 400 }
      )
    );
    await expect(
      createDub("k", { sourceUrl: "https://blob/x.mov", watermark: false, name: "job-1" })
    ).rejects.toThrow(/Starter\+/);
  });
});

describe("getDubStatus", () => {
  it("разбирает готовый дубляж", async () => {
    stubFetch(
      Response.json({
        status: "dubbed",
        error: null,
        media_metadata: { content_type: "video/mp4", duration: 12.5 },
      })
    );
    await expect(getDubStatus("k", "abc")).resolves.toEqual({
      status: "dubbed",
      error: null,
      durationSec: 12.5,
    });
  });

  it("разбирает ошибку дубляжа", async () => {
    stubFetch(Response.json({ status: "failed", error: "no speech detected" }));
    await expect(getDubStatus("k", "abc")).resolves.toEqual({
      status: "failed",
      error: "no speech detected",
      durationSec: null,
    });
  });
});
