import { describe, expect, it, vi } from "vitest";
import { installFarmToken, looksLikeToken, SetupDeps } from "../lib/farm/token-setup";

const SHORT = "EAAG" + "a".repeat(60);
const LONG = "EAAG" + "b".repeat(80);
const PAGE = "EAAG" + "c".repeat(90);
const SCOPES = ["instagram_basic", "instagram_content_publish", "pages_show_list"];

function makeDeps(over: Partial<SetupDeps> = {}): SetupDeps {
  return {
    appId: "111",
    appSecret: "secret",
    igUserId: "17841413773053161",
    exchangeForLongLived: vi.fn(async () => LONG),
    fetchPageToken: vi.fn(async () => PAGE),
    checkToken: vi.fn(async () => ({ valid: true, expiresAt: null, scopes: SCOPES })),
    saveToken: vi.fn(async (_t: string) => {}),
    ...over,
  };
}

describe("looksLikeToken", () => {
  it("длинная строка без пробелов — похоже", () => {
    expect(looksLikeToken(SHORT)).toBe(true);
  });

  it("с пробелом или переносом — нет: это самая частая порча при вставке", () => {
    expect(looksLikeToken(`${SHORT} `)).toBe(false);
    expect(looksLikeToken(`${SHORT}\n`)).toBe(false);
  });

  it("короткая строка — нет", () => {
    expect(looksLikeToken("abc")).toBe(false);
  });
});

describe("installFarmToken", () => {
  it("меняет временный ключ на бессрочный и сохраняет именно его", async () => {
    const deps = makeDeps();
    const result = await installFarmToken(SHORT, deps);

    expect(result.ok).toBe(true);
    expect(deps.exchangeForLongLived).toHaveBeenCalledWith(SHORT, "111", "secret");
    expect(deps.fetchPageToken).toHaveBeenCalledWith(LONG, "17841413773053161");
    // Сохраняется токен Страницы, а не пользовательский: только он бессрочный.
    expect(deps.saveToken).toHaveBeenCalledWith(PAGE);
    expect(result.message).toContain("бессрочный");
  });

  it("негодный ключ не сохраняется: иначе починка ломала бы заливку", async () => {
    const deps = makeDeps({
      checkToken: vi.fn(async () => ({ valid: false, expiresAt: null, scopes: [] })),
    });
    const result = await installFarmToken(SHORT, deps);

    expect(result.ok).toBe(false);
    expect(deps.saveToken).not.toHaveBeenCalled();
  });

  it("ключ без прав на публикацию не сохраняется и называет недостающее", async () => {
    const deps = makeDeps({
      checkToken: vi.fn(async () => ({ valid: true, expiresAt: null, scopes: ["instagram_basic"] })),
    });
    const result = await installFarmToken(SHORT, deps);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("instagram_content_publish");
    expect(deps.saveToken).not.toHaveBeenCalled();
  });

  it("ключ со сроком сохраняется, но об этом говорится вслух", async () => {
    // Молчание тут дороже всего: человек уйдёт в уверенности, что настроил
    // навсегда, а заливка встанет посреди пачки.
    const expiresAt = Date.parse("2026-10-20T00:00:00.000Z");
    const deps = makeDeps({
      checkToken: vi.fn(async () => ({ valid: true, expiresAt, scopes: SCOPES })),
    });
    const result = await installFarmToken(SHORT, deps);

    expect(result.ok).toBe(true);
    expect(deps.saveToken).toHaveBeenCalledWith(PAGE);
    expect(result.message).toContain("НЕ бессрочный");
  });

  it("сбой обмена — понятная причина, ничего не сохранено", async () => {
    const deps = makeDeps({
      exchangeForLongLived: vi.fn(async () => {
        throw new Error("Обмен токена не прошёл: Invalid client secret");
      }),
    });
    const result = await installFarmToken(SHORT, deps);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Invalid client secret");
    expect(deps.saveToken).not.toHaveBeenCalled();
  });

  it("страница аккаунта не найдена — говорим прямо", async () => {
    const deps = makeDeps({
      fetchPageToken: vi.fn(async () => {
        throw new Error("Аккаунт 178414 не найден среди страниц этого токена");
      }),
    });
    const result = await installFarmToken(SHORT, deps);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("не найден");
  });

  it("без секрета приложения даже не ходим в Graph", async () => {
    const deps = makeDeps({ appSecret: undefined });
    const result = await installFarmToken(SHORT, deps);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("META_APP_SECRET");
    expect(deps.exchangeForLongLived).not.toHaveBeenCalled();
  });

  it("мусор вместо ключа отсекается до сети", async () => {
    const deps = makeDeps();
    const result = await installFarmToken("не ключ", deps);

    expect(result.ok).toBe(false);
    expect(deps.exchangeForLongLived).not.toHaveBeenCalled();
  });
});
