import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkToken, exchangeForLongLived, fetchPageToken } from "../lib/farm/token";

beforeEach(() => vi.unstubAllGlobals());

describe("exchangeForLongLived", () => {
  it("меняет короткий токен на 60-дневный", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ access_token: "LONG", expires_in: 5184000 }))
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await exchangeForLongLived("SHORT", "APP", "SECRET")).toBe("LONG");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("grant_type=fb_exchange_token");
    expect(url).toContain("fb_exchange_token=SHORT");
  });

  it("отказ отдаёт текст ошибки наружу", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad secret" } }), { status: 400 })));
    await expect(exchangeForLongLived("S", "A", "X")).rejects.toThrow(/bad secret/);
  });
});

describe("fetchPageToken", () => {
  it("берёт токен той страницы, к которой привязан нужный IG-аккаунт", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [
        { name: "Другая", access_token: "PT_OTHER", instagram_business_account: { id: "111" } },
        { name: "Видео из Фото", access_token: "PT_RIGHT", instagram_business_account: { id: "17841413773053161" } },
      ],
    }))));

    expect(await fetchPageToken("LONG", "17841413773053161")).toBe("PT_RIGHT");
  });

  it("нужного аккаунта нет среди страниц — внятная ошибка, а не пустая строка", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }))));
    await expect(fetchPageToken("LONG", "17841413773053161")).rejects.toThrow(/не найден/);
  });
});

describe("checkToken", () => {
  it("возвращает срок и права", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: { is_valid: true, expires_at: 1766000000, scopes: ["instagram_basic", "instagram_content_publish"] },
    }))));

    const info = await checkToken("T");
    expect(info.valid).toBe(true);
    expect(info.expiresAt).toBe(1766000000 * 1000);
    expect(info.scopes).toContain("instagram_content_publish");
  });

  it("бессрочный Page-токен отдаёт expires_at = 0 — это не «истёк»", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { is_valid: true, expires_at: 0, scopes: [] } }))));
    const info = await checkToken("T");
    expect(info.valid).toBe(true);
    expect(info.expiresAt).toBeNull();
  });
});
