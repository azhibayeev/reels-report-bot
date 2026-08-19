import { describe, it, expect } from "vitest";
import { buildStoreUrl, detectPlatform, sanitizeSlug } from "../lib/applink";

describe("detectPlatform", () => {
  it("recognises Android phones", () => {
    expect(
      detectPlatform(
        "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36"
      )
    ).toBe("android");
  });

  it("recognises iPhone and iPad", () => {
    expect(
      detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")
    ).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")).toBe(
      "ios"
    );
  });

  it("recognises the Instagram in-app browser on both systems", () => {
    // Ссылка живёт в шапке Instagram — почти весь трафик придёт из его встроенного браузера.
    expect(
      detectPlatform(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Instagram 335.0.0.32.94"
      )
    ).toBe("ios");
    expect(
      detectPlatform("Mozilla/5.0 (Linux; Android 13; V2111) AppleWebKit/537.36 Chrome/125 Instagram 335.0.0.32.94")
    ).toBe("android");
  });

  it("falls back to other for desktop and unknown agents", () => {
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126")).toBe(
      "other"
    );
    expect(detectPlatform("")).toBe("other");
    expect(detectPlatform(null)).toBe("other");
  });
});

describe("sanitizeSlug", () => {
  it("keeps normal ambassador names", () => {
    expect(sanitizeSlug("bara")).toBe("bara");
    expect(sanitizeSlug("Zahid")).toBe("zahid");
    expect(sanitizeSlug("influencer_01")).toBe("influencer_01");
  });

  it("refuses anything that could leak into the store URL", () => {
    // Слаг уходит в query-параметры ссылки на стор — мусор туда попадать не должен.
    expect(sanitizeSlug("bara&utm_medium=hack")).toBeNull();
    expect(sanitizeSlug("../../etc")).toBeNull();
    expect(sanitizeSlug("")).toBeNull();
    expect(sanitizeSlug("a".repeat(33))).toBeNull();
  });
});

describe("buildStoreUrl", () => {
  it("sends Android to Play with the referrer Play Console reads", () => {
    const url = buildStoreUrl("android", "bara", null)!;
    expect(url.startsWith("https://play.google.com/store/apps/details?id=com.qurany.app&referrer=")).toBe(true);
    // referrer должен приехать одним закодированным значением, иначе Play разберёт его как свои параметры
    const referrer = decodeURIComponent(new URL(url).searchParams.get("referrer")!);
    expect(referrer).toBe("utm_source=bara&utm_medium=influencer&utm_campaign=ambassador");
  });

  it("sends iOS to the App Store campaign link", () => {
    const url = buildStoreUrl("ios", "bara", "123456789")!;
    const q = new URL(url).searchParams;
    expect(url.startsWith("https://apps.apple.com/id/app/id6743374163")).toBe(true);
    expect(q.get("ct")).toBe("bara");
    expect(q.get("pt")).toBe("123456789");
    expect(q.get("mt")).toBe("8");
  });

  it("still works on iOS before the provider token exists", () => {
    // pt выдаётся в App Store Connect; пока его нет, ссылка обязана вести в стор,
    // просто без разбивки по источнику в отчётах Apple.
    const url = buildStoreUrl("ios", "bara", null)!;
    expect(url.startsWith("https://apps.apple.com/id/app/id6743374163")).toBe(true);
    expect(new URL(url).searchParams.get("pt")).toBeNull();
    expect(new URL(url).searchParams.get("ct")).toBe("bara");
  });

  it("has no store to pick on desktop", () => {
    expect(buildStoreUrl("other", "bara", null)).toBeNull();
  });
});
